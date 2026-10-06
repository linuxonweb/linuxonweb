// Host emitter test: translate symbolically assembled pinned Nightly bytecode loops with
// the real PblJit.cpp Compiler and write each module to OUTDIR/<name>.wasm,
// with OUTDIR/<name>.json describing the region (run by run.mjs).
#define PBLJIT_HOST_TEST 1
#include <stdio.h>
#include <vector>
#include "../PblJit.cpp"
using namespace js::pbljit;
struct Code {
  std::vector<uint8_t> b;
  size_t op(JSOp o) { b.push_back(uint8_t(o)); return b.size() - 1; }
  void u(uint32_t v, int n) { for (int i = 0; i < n; i++) { b.push_back(uint8_t(v)); v >>= 8; } }
  size_t head(uint32_t ic) { size_t at = op(JSOp::LoopHead); u(ic, 4); u(1, 1); return at; }
  void loc(JSOp o, uint32_t n) { op(o); u(n, 3); }
  void arg(JSOp o, uint32_t n) { op(o); u(n, 2); }
  size_t jump(JSOp o) { size_t at = op(o); u(0, 4); return at; }
  void patch(size_t at, size_t target) { int32_t d = int32_t(target - at); for (int i = 0; i < 4; i++) b[at + 1 + i] = uint8_t(uint32_t(d) >> (8 * i)); }
  void here(size_t at) { patch(at, b.size()); }
  void target(uint32_t ic) { op(JSOp::JumpTarget); u(ic, 4); }
  void dbl(double x) { uint64_t v; memcpy(&v, &x, 8); op(JSOp::Double); u(uint32_t(v), 4); u(uint32_t(v >> 32), 4); }
};
// Compile-time frame image: locals below `frame`, arguments in gArgs. Only the
// tags matter (they choose the guarded head types).
constexpr uint32_t INT = 0xFFFFFF81u, BOOL = 0xFFFFFF82u, UNDEF = 0xFFFFFF83u,
                   DOUBLE_HI = 0x40000000u, OBJECT = 0xFFFFFF8Cu;
static uint64_t gFrame[64], gArgs[8];
// Compile-time array payloads and their element kinds (see MockArrayKind).
constexpr uint32_t ARR_INT = 0x8000, ARR_NUM = 0x8100, ARR_OTHER = 0x8200, NOT_ARR = 0x8300;
int MockArrayKind(uint32_t payload) {
  return payload == ARR_INT ? 1 : payload == ARR_NUM ? 2 : payload == ARR_OTHER ? 0 : -1;
}
// JIT8 object layouts: shape/slots pointers at 0/4, fixed slot at 16.
constexpr uint32_t OBJ = 0x9000, OBJ_RO = 0x9200, OBJ_UNSAFE = 0x9300, OBJ_NURSERY = 0x9400;
constexpr uint32_t GLOBAL = 0xa000, LEXICAL = 0xa100, MATH = 0xa200, FN = 0xa300;
static JSContext gContext{0};
template<class T> bool MockInspectObject(uint32_t p, T& info) {
  info.pointer = p; info.tenured = true;
  if (p == OBJ || p == OBJ_RO || p == OBJ_UNSAFE || p == OBJ_NURSERY) {
    info.tenured = p != OBJ_NURSERY;
    info.shape = (p == OBJ || p == OBJ_NURSERY) ? 0x7000 : p == OBJ_RO ? 0x7040 : 0x7080;
    info.plain = true; info.canWrite = p != OBJ_UNSAFE; return true;
  }
  if (p == GLOBAL || p == LEXICAL || p == MATH) {
    info.shape = p == GLOBAL ? 0x7200 : p == LEXICAL ? 0x7300 : 0x7400;
    info.plain = false; info.canWrite = false; return true;
  }
  if (p >= FN && p < FN + 8 * 0x40 && ((p - FN) % 0x40) == 0) {
    info.shape = 0x7500 + ((p - FN) / 0x40) * 0x20;
    info.plain = false; info.canWrite = false; return true;
  }
  return false;
}
template<class T> bool MockLookupSlot(uint32_t p, uint32_t atom, T& slot) {
  slot.writable = p != OBJ_RO;
  if ((p == OBJ || p == OBJ_RO || p == OBJ_UNSAFE || p == OBJ_NURSERY) && atom >= 2 && atom <= 4) {
    slot.offset = atom == 3 ? 0 : 16 + (atom == 4 ? 8 : 0);
    slot.dynamic = atom == 3;
    slot.bits = uint64_t(INT) << 32 | (atom == 3 ? 4 : 2);
    if (atom == 4) slot.writable = false;
    return true;
  }
  if (p == MATH && atom >= 10 && atom <= 17) {
    slot.offset = 16 + 8 * (atom - 10);
    slot.bits = uint64_t(OBJECT) << 32 | (FN + (atom - 10) * 0x40);
    return true;
  }
  if (p == GLOBAL && (atom >= 20 && atom <= 23)) {
    slot.offset = 16 + (atom - 20) * 8;
    slot.bits = atom == 20 ? uint64_t(OBJECT) << 32 | MATH : atom == 21 ? uint64_t(INT) << 32 | 7 : uint64_t(OBJECT) << 32 | (atom == 22 ? OBJ : OBJ_NURSERY);
    return true;
  }
  return false;
}
uint8_t MockIdentifyMath(uint32_t p) {
  return p >= FN && p < FN + 8 * 0x40 ? 1 + (p - FN) / 0x40 : 0;
}
template<class T, class S> bool MockGlobalSlot(JSContext* cx, uint32_t atom,
                                            T& lex, T& global, T& holder, S& slot) {
  if (!cx || !MockInspectObject(LEXICAL, lex) || !MockInspectObject(GLOBAL, global)) return false;
  holder = global; return MockLookupSlot(GLOBAL, atom, slot);
}
// pc offsets (from the loop head) of marked ops, written to the JSON.
static int gMark[2] = {-1, -1};
static uint32_t gFormals;
static bool gAliased, gFunction;
static void reset() {
  for (auto& v : gFrame) v = uint64_t(INT) << 32;
  for (auto& v : gArgs) v = uint64_t(INT) << 32;
  gFormals = 0;
  gAliased = false;
  gFunction = false;
}
static void setLocal(uint32_t no, uint32_t tag, uint32_t v = 0) { gFrame[63 - no] = (uint64_t(tag) << 32) | v; }
static void setArg(uint32_t no, uint32_t tag, uint32_t v = 0) { gArgs[no] = (uint64_t(tag) << 32) | v; }
static int emit(const char* dir, const char* name, Code& c, size_t headAt) {
  JSScript s{c.b.data(), c.b.size()};
  s.argsAliased_ = gAliased;
  Buf m;
  Compiler* kp = TranslateLoop(
      [&](Compiler& k) {
        k.script = &s;
        k.cx = &gContext;
        k.head = c.b.data() + headAt;
        k.end = nullptr;
        k.frame = reinterpret_cast<const uint8_t*>(gFrame + 64);
        if (gFunction) {
          k.argv = gArgs;
          k.nformals = gFormals;
          k.argsAliased = gAliased;
        }
      },
      m);
  Compiler& k = *kp;
  bool ok = !k.reason;
  char path[512];
  snprintf(path, sizeof path, "%s/%s.json", dir, name);
  FILE* j = fopen(path, "w");
  fprintf(j, "{\"ok\":%s,\"reason\":\"%s\",\"len\":%d,\"vars\":[", ok ? "true" : "false",
          k.reason ? k.reason : "", k.end ? int(k.end - k.head) : -1);
  for (uint32_t i = 0; i < k.nvars; i++) {
    uint32_t key = k.varKey[i];
    fprintf(j, "%s{\"%s\":%u,\"live\":%s,\"written\":%s,\"headTy\":%u}", i ? "," : "",
            key & kArgKey ? "arg" : "local", key & ~kArgKey, k.varLive[i] ? "true" : "false",
            k.varWritten[i] ? "true" : "false", unsigned(k.headTy[i]));
  }
  fprintf(j, "],\"targets\":%u,\"maxArg\":%u,\"maxDepth\":%u,\"ops\":%u,\"attempts\":%u,\"mark\":[%d,%d]}\n",
          k.ntargets, k.maxArg, k.maxDepth, k.nops, k.attempts, gMark[0] < 0 ? -1 : gMark[0] - int(headAt),
          gMark[1] < 0 ? -1 : gMark[1] - int(headAt));
  gMark[0] = gMark[1] = -1;
  fclose(j);
  if (ok) {
    snprintf(path, sizeof path, "%s/%s.wasm", dir, name);
    FILE* f = fopen(path, "wb");
    fwrite(m.p, 1, m.n, f);
    fclose(f);
  }
  printf("%s ok=%d reason=%s bytes=%zu attempts=%u\n", name, ok, k.reason ? k.reason : "-", m.n, k.attempts);
  FreeCompiler(kp);
  return ok;
}
// for (; i < 10000; i++) BODY;   i = local 1. Returns the exit jump to patch.
static size_t forHead(Code& c, size_t& h) {
  h = c.head(0);
  c.loc(JSOp::GetLocal, 1); c.op(JSOp::Uint16); c.u(10000, 2); c.op(JSOp::Lt);
  size_t jf = c.jump(JSOp::JumpIfFalse);
  c.target(2);
  return jf;
}
static void forTail(Code& c, size_t h, size_t jf, uint32_t ic) {
  c.loc(JSOp::GetLocal, 1); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 1); c.op(JSOp::Pop);
  size_t g = c.jump(JSOp::Goto); c.patch(g, h);
  c.here(jf); c.target(ic); c.op(JSOp::Return);
}
int main(int argc, char** argv) {
  const char* dir = argv[1];
  reset();
  {  // int-loop: for (let i = 0; i < N; i++) sum = (sum + i) | 0;  sum=local0 i=local1
    Code c;
    size_t h = c.head(0);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Uint16); c.u(10000, 2); c.op(JSOp::Lt);
    size_t jf = c.jump(JSOp::JumpIfFalse);
    c.target(2);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 1); c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 1); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    c.patch(jf, c.b.size()); c.target(5); c.op(JSOp::Return);
    emit(dir, "intloop", c, h);
  }
  {  // add-overflow: for (...; i < N; i++) sum = sum + i;   (no |0)
    Code c;
    size_t h = c.head(0);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Uint16); c.u(10000, 2); c.op(JSOp::Lt);
    size_t jf = c.jump(JSOp::JumpIfFalse);
    c.target(2);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 1); c.op(JSOp::Add);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 1); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    c.patch(jf, c.b.size()); c.target(4); c.op(JSOp::Return);
    emit(dir, "addovf", c, h);
  }
  {  // do { x = x * 3 - 1 ^ (x >>> 1) } while (x < 100000)  (local 2; mul, sub, ursh, xor, JumpIfTrue)
    Code c;
    size_t h = c.head(7);
    c.loc(JSOp::GetLocal, 2); c.op(JSOp::Int8); c.u(3, 1); c.op(JSOp::Mul); c.op(JSOp::One); c.op(JSOp::Sub);
    c.loc(JSOp::GetLocal, 2); c.op(JSOp::One); c.op(JSOp::Ursh); c.op(JSOp::BitXor);
    c.loc(JSOp::SetLocal, 2); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 2); c.op(JSOp::Int32); c.u(100000, 4); c.op(JSOp::Lt);
    size_t jt = c.jump(JSOp::JumpIfTrue); c.patch(jt, h);
    c.target(12); c.op(JSOp::Return);
    emit(dir, "dowhile", c, h);
  }
  {  // stack operands live across the backedge exit: Dup/Swap/Not/Ge/Dec with a stack value kept
    Code c;
    size_t h = c.head(3);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::Dup); c.op(JSOp::Zero); c.op(JSOp::Ge); c.op(JSOp::Not);
    size_t jt = c.jump(JSOp::JumpIfTrue);  // exits with the dup'd value on the stack
    c.op(JSOp::Pop); c.loc(JSOp::GetLocal, 0); c.op(JSOp::Dec); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    c.patch(jt, c.b.size()); c.target(9); c.op(JSOp::Return);
    emit(dir, "stackexit", c, h);
  }
  {  // if/else: for (...) { if (i % 3 == 0) a = (a + i) | 0; else a = (a - 1) | 0; }  a=local0
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Int8); c.u(3, 1); c.op(JSOp::Mod); c.op(JSOp::Zero); c.op(JSOp::Eq);
    size_t je = c.jump(JSOp::JumpIfFalse);
    c.target(5);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 1); c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    size_t gj = c.jump(JSOp::Goto);
    c.here(je); c.target(7);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::One); c.op(JSOp::Sub); c.op(JSOp::Zero); c.op(JSOp::BitOr);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.here(gj); c.target(9);
    forTail(c, h, jf, 10);
    emit(dir, "ifelse", c, h);
  }

  for (uint32_t tag : {BOOL, UNDEF, DOUBLE_HI, OBJECT}) {
    reset(); setLocal(0, tag);
    Code c; size_t h = c.head(0);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    char name[80]; snprintf(name, sizeof name, "reject-head-%u", tag);
    emit(dir, name, c, h);
  }
  reset();
#define REJECT_OP(n, v, l) { \
    if (!IntegerOpcodeAllowed(JSOp::n)) { \
      Code c; size_t h = c.head(0); c.op(JSOp::n); c.u(0, l - 1); \
      size_t g = c.jump(JSOp::Goto); c.patch(g, h); \
      emit(dir, "reject-op-" #n, c, h); \
    } \
  }
  PBLJIT_OPS(REJECT_OP)
#undef REJECT_OP
#define COUNT_OP(n, v, l) + 1
  constexpr unsigned opcodeCount = 0 PBLJIT_OPS(COUNT_OP);
#undef COUNT_OP
  for (unsigned op = opcodeCount; op < 256; op++) {
    Code c; size_t h = c.head(0); c.op(JSOp(op));
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    char name[80]; snprintf(name, sizeof name, "reject-raw-%u", op);
    emit(dir, name, c, h);
  }
  { Code c; size_t h = c.head(0); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    emit(dir, "reject-underflow", c, h);
  }
  { Code c; size_t h = c.head(0);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::Neg); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::Int8); c.u(7, 1); c.op(JSOp::Ne);
    size_t g = c.jump(JSOp::JumpIfTrue); c.patch(g, h);
    c.target(2); c.op(JSOp::Return);
    emit(dir, "negloop", c, h);
  }
  { // Exercise the real OnLoopHead identity gate without a wasm install.
    // Rejected entries have the same invalidation path as compiled entries.
    uint32_t checks = 0, failures = 0;
    auto test = [&](bool ok, const char* name) {
      checks++; if (!ok) { failures++; fprintf(stderr, "CACHE FAIL %s\n", name); }
    };
    Code c; c.head(0); c.op(JSOp::Return);
    JSScript first{c.b.data(), c.b.size()}, peers[64]{};
    JSScript* second = nullptr;
    uint32_t hash = CacheIndex(&first, c.b.data());
    for (auto& peer : peers) {
      peer.code_ = c.b.data(); peer.length_ = c.b.size();
      if (!second && CacheIndex(&peer, c.b.data()) != hash) second = &peer;
    }
    test(second != nullptr, "shared bytecode scripts can occupy separate buckets");
    if (!second) return 1;
    js::jit::BaselineFrame frame{};
    JSContext cx{0}; Exit exit{}; uint64_t stack[2] = {};
    gEnabled.store(1); gLogBudget.store(0);
    test(!OnLoopHead(&first, &frame, stack, c.b.data(), &cx, &exit), "counting entry");
    Entry* e = &tCache[hash];
    test(e->script == &first && e->majorGC == 0 && e->hits == 1, "initial stamp");
    e->state = 2; e->bytes = static_cast<uint8_t*>(malloc(3)); e->len = 3;
    test(!OnLoopHead(&first, &frame, stack, c.b.data(), &cx, &exit), "same identity rejected");
    test(e->state == 2 && e->hits == 1 && e->bytes != nullptr, "same identity retained");
    e->state = 1; // A compiled entry: epoch mismatch must prevent invocation.
    cx.incrementalGC = true; cx.majorGC = 1;
    test(!OnLoopHead(second, &frame, stack, c.b.data(), &cx, &exit), "incremental skips");
    test(e->state == 1 && e->script == &first && e->majorGC == 0, "incremental no cache access");
    cx.incrementalGC = false;
    test(!OnLoopHead(&first, &frame, stack, c.b.data(), &cx, &exit), "major evicts");
    test(e->state == 0 && e->bytes == nullptr && e->majorGC == 1 && e->hits == 1, "major reset stamp");
    e->state = 2; e->bytes = static_cast<uint8_t*>(malloc(3)); e->len = 3;
    test(!OnLoopHead(second, &frame, stack, c.b.data(), &cx, &exit), "second shared code script counts");
    Entry* other = &tCache[CacheIndex(second, c.b.data())];
    test(other->script == second && other->hits == 1, "second shared code stamp");
    test(e->script == &first && e->state == 2 && e->bytes != nullptr,
         "second shared code script retains first specialization");
    test(!OnLoopHead(&first, &frame, stack, c.b.data(), &cx, &exit), "first shared code revisited");
    test(e->state == 2 && e->bytes != nullptr && e->hits == 1,
         "alternating shared bytecode does not reset first entry");
    // Ordinary hash collisions still require exact script identity checks.
    other->script = &first; other->state = 2;
    other->bytes = static_cast<uint8_t*>(malloc(3)); other->len = 3;
    test(!OnLoopHead(second, &frame, stack, c.b.data(), &cx, &exit), "script changes same code");
    test(other->script == second && other->state == 0 && other->bytes == nullptr && other->hits == 1,
         "script identity resets identical bytecode");
    uint32_t oldGlobal = cx.global; cx.global += 0x100;
    test(!OnLoopHead(second, &frame, stack, c.b.data(), &cx, &exit), "global mismatch");
    test(other->hits == 1 && other->global == oldGlobal, "global mismatch skips counting");
    cx.global = oldGlobal;
    test(!OnLoopHead(second, &frame, stack, c.b.data(), &cx, &exit), "restore global");
    test(other->hits == 2, "restored global counts");
    Evict(e); Evict(other); free(tCache); tCache = nullptr;
    char path[512]; snprintf(path, sizeof path, "%s/cache-tests.json", dir);
    FILE* f = fopen(path, "w");
    fprintf(f, "{\"pass\":%s,\"checks\":%u,\"failures\":%u}\n", failures ? "false" : "true", checks, failures);
    fclose(f);
    if (failures) return 1;
  }
  return 0;
}
