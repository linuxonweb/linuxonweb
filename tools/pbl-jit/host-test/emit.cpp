// Host emitter test: translate hand-assembled Firefox 128 bytecode loops with
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
  void u(uint32_t v, int n) { for (int i = 0; i < n; i++) b.push_back(uint8_t(v >> (8 * i))); }
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
  {  // if ((i & 1) == 1 && i % 5 != 0 || i === 7) n++;   n=local0
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::One); c.op(JSOp::BitAnd); c.op(JSOp::One); c.op(JSOp::Eq);
    size_t ja = c.jump(JSOp::And); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Int8); c.u(5, 1); c.op(JSOp::Mod); c.op(JSOp::Zero); c.op(JSOp::Ne);
    c.here(ja); c.target(7);
    size_t jo = c.jump(JSOp::Or); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Int8); c.u(7, 1); c.op(JSOp::StrictEq);
    c.here(jo); c.target(9);
    size_t js = c.jump(JSOp::JumpIfFalse);
    c.target(10);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.here(js); c.target(11);
    forTail(c, h, jf, 12);
    emit(dir, "andor", c, h);
  }
  {  // rejected: (i & 1) && ... joins Int32 with Boolean
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::One); c.op(JSOp::BitAnd);
    size_t ja = c.jump(JSOp::And); c.op(JSOp::Pop);
    c.op(JSOp::True);
    c.here(ja); c.target(4);
    size_t js = c.jump(JSOp::JumpIfFalse);
    c.target(5);
    c.here(js); c.target(5);
    forTail(c, h, jf, 6);
    emit(dir, "reject-jointype", c, h);
  }
  {  // while (i < N) { i++; if (i % 4 === 0) continue; s = (s + i) | 0; }  s=local0
    Code c;
    size_t h = c.head(0);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Uint16); c.u(10000, 2); c.op(JSOp::Lt);
    size_t jf = c.jump(JSOp::JumpIfFalse);
    c.target(2);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 1); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Int8); c.u(4, 1); c.op(JSOp::Mod); c.op(JSOp::Zero); c.op(JSOp::StrictEq);
    size_t js = c.jump(JSOp::JumpIfFalse);
    c.target(6);
    size_t gc = c.jump(JSOp::Goto); c.patch(gc, h);  // continue
    c.here(js); c.target(6);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 1); c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    c.here(jf); c.target(8); c.op(JSOp::Return);
    emit(dir, "continue", c, h);
  }
  {  // for (...) { let t = i * 2; s = (s ^ t) | 0; }   s=local0 t=local2 (TDZ each iteration)
    reset();
    setLocal(2, DOUBLE_HI);  // head-dead: not guarded
    Code c;
    size_t h, jf = forHead(c, h);
    c.op(JSOp::Uninitialized); c.loc(JSOp::InitLexical, 2); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Int8); c.u(2, 1); c.op(JSOp::Mul); c.loc(JSOp::InitLexical, 2); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 2); c.loc(JSOp::CheckLexical, 2); c.op(JSOp::BitXor);
    c.op(JSOp::Zero); c.op(JSOp::BitOr); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.op(JSOp::DebugLeaveLexicalEnv);
    forTail(c, h, jf, 6);
    emit(dir, "letbody", c, h);
    reset();
  }
  {  // rejected: reading a let binding in its TDZ
    Code c;
    size_t h = c.head(0);
    c.op(JSOp::Uninitialized); c.loc(JSOp::InitLexical, 0); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::CheckLexical, 0); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    emit(dir, "reject-tdz", c, h);
  }
  {  // function f(a, b) { for (let i = 0; i < b; i++) a = (a + -(~i)) | 0; }  a,b=args i=local0
    gFunction = true;
    gFormals = 2;
    Code c;
    size_t h = c.head(0);
    c.loc(JSOp::GetLocal, 0); c.arg(JSOp::GetArg, 1); c.op(JSOp::Lt);
    size_t jf = c.jump(JSOp::JumpIfFalse);
    c.target(2);
    c.arg(JSOp::GetArg, 0); c.loc(JSOp::GetLocal, 0); c.op(JSOp::BitNot); c.op(JSOp::Neg); c.op(JSOp::Add);
    c.op(JSOp::Zero); c.op(JSOp::BitOr); c.arg(JSOp::SetArg, 0); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    c.here(jf); c.target(7); c.op(JSOp::Return);
    emit(dir, "args", c, h);
    gAliased = true;
    emit(dir, "reject-argsaliased", c, h);
    gAliased = false;
    gFormals = 1;
    emit(dir, "reject-argindex", c, h);
    gFunction = false;
    emit(dir, "reject-noargv", c, h);
    reset();
  }
  {  // s = (s + (u ?? 2) + +(n ?? 100) + (b ? 1 : 0)) | 0;  s=0 i=1 u=2(undefined) b=3(bool) n=4
    setLocal(2, UNDEF);
    setLocal(3, BOOL, 1);
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 0);
    c.loc(JSOp::GetLocal, 2); size_t q1 = c.jump(JSOp::Coalesce); c.op(JSOp::Pop); c.op(JSOp::Int8); c.u(2, 1);
    c.here(q1); c.target(2);
    c.op(JSOp::Add);
    c.loc(JSOp::GetLocal, 4); size_t q2 = c.jump(JSOp::Coalesce); c.op(JSOp::Pop); c.op(JSOp::Int8); c.u(100, 1);
    c.here(q2); c.target(3);
    c.op(JSOp::Pos); c.op(JSOp::Add);
    c.loc(JSOp::GetLocal, 3); size_t je = c.jump(JSOp::JumpIfFalse);
    c.target(6); c.op(JSOp::One); size_t gj = c.jump(JSOp::Goto);
    c.here(je); c.target(6); c.op(JSOp::Zero);
    c.here(gj); c.target(6);
    c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.op(JSOp::Undefined); c.op(JSOp::Pop); c.op(JSOp::Null); c.op(JSOp::Not); c.op(JSOp::Pop);
    forTail(c, h, jf, 8);
    emit(dir, "coalesce", c, h);
    setLocal(0, OBJECT);
    emit(dir, "reject-headtype", c, h);
    reset();
  }
  {  // rejected: nested loop inside the region
    Code c;
    size_t h = c.head(0);
    c.head(1);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    emit(dir, "reject-nested", c, h);
  }
  // JIT 7a: doubles.
  {  // s = s + i / 3   (s widens Int -> Double on the backedge: attempts=2)
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 1); c.op(JSOp::Int8); c.u(3, 1); c.op(JSOp::Div); c.op(JSOp::Add);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 4);
    emit(dir, "divsum", c, h);
  }
  {  // for (; i < lim; i++) n = (n + 1) | 0;   n=0 i=1 lim=2 (double): Int < Double
    setLocal(2, DOUBLE_HI);
    Code c;
    size_t h = c.head(0);
    c.loc(JSOp::GetLocal, 1); c.loc(JSOp::GetLocal, 2); c.op(JSOp::Lt);
    size_t jf = c.jump(JSOp::JumpIfFalse);
    c.target(2);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::One); c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    emit(dir, "mixcmp", c, h);
    reset();
  }
  {  // s = (s + ((i * 1.5) | 0)) | 0
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 1); c.dbl(1.5); c.op(JSOp::Mul); c.op(JSOp::Zero); c.op(JSOp::BitOr);
    c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    emit(dir, "bitdbl", c, h);
  }
  {  // x = (x * 3.5) | 0   x=local0; bails once x * 3.5 leaves the int32 range
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 0); c.dbl(3.5); c.op(JSOp::Mul); c.op(JSOp::Zero); c.op(JSOp::BitOr);
    c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 4);
    emit(dir, "bitovf", c, h);
  }
  {  // d++; e = -e; f = ~f   d=2 e=3 (doubles) f=4 (double, ToInt32 then int)
    setLocal(2, DOUBLE_HI);
    setLocal(3, DOUBLE_HI);
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 2); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 2); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 3); c.op(JSOp::Neg); c.loc(JSOp::SetLocal, 3); c.op(JSOp::Pop);
    c.loc(JSOp::GetLocal, 2); c.op(JSOp::BitNot); c.loc(JSOp::SetLocal, 4); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    emit(dir, "incneg", c, h);
    reset();
  }
  {  // if (d) n++;   n=0 i=1 d=2 (double)
    setLocal(2, DOUBLE_HI);
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 2);
    size_t js = c.jump(JSOp::JumpIfFalse);
    c.target(3);
    c.loc(JSOp::GetLocal, 0); c.op(JSOp::Inc); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    c.here(js); c.target(4);
    forTail(c, h, jf, 5);
    emit(dir, "truthy", c, h);
    reset();
  }
  {  // x = d - d   d=2 (double, Infinity at run time) x=3: NaN boxed canonically
    setLocal(2, DOUBLE_HI);
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 2); c.loc(JSOp::GetLocal, 2); c.op(JSOp::Sub); c.loc(JSOp::SetLocal, 3); c.op(JSOp::Pop);
    forTail(c, h, jf, 3);
    emit(dir, "nanbox", c, h);
    reset();
  }
  {  // s = s + ((i & 1) ? 1 : 0.5)   join of an Int and a Double stack slot
    Code c;
    size_t h, jf = forHead(c, h);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 1); c.op(JSOp::One); c.op(JSOp::BitAnd);
    size_t je = c.jump(JSOp::JumpIfFalse);
    c.target(4); c.op(JSOp::One); size_t gj = c.jump(JSOp::Goto);
    c.here(je); c.target(4); c.dbl(0.5);
    c.here(gj); c.target(4);
    c.op(JSOp::Add); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    emit(dir, "slotjoin", c, h);
  }
  // JIT 7b: dense arrays (a = local 3) and .length.
  // for (; i < a.length; i++) BODY   i = local 1. Marks GetProp as mark[0].
  auto arrHead = [](Code& c, size_t& h, uint32_t atom = 1) {
    h = c.head(0);
    c.loc(JSOp::GetLocal, 1); c.loc(JSOp::GetLocal, 3);
    gMark[0] = int(c.op(JSOp::GetProp)); c.u(atom, 4);
    c.op(JSOp::Lt);
    size_t jf = c.jump(JSOp::JumpIfFalse);
    c.target(3);  // GetProp, Lt, JumpIfFalse
    return jf;
  };
  {  // s = (s + a[i]) | 0
    setLocal(3, OBJECT, ARR_INT);
    Code c;
    size_t h, jf = arrHead(c, h);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 3); c.loc(JSOp::GetLocal, 1);
    gMark[1] = int(c.op(JSOp::GetElem));
    c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    emit(dir, "arrsum", c, h);
  }
  {  // a[i] = i
    Code c;
    size_t h, jf = arrHead(c, h);
    c.loc(JSOp::GetLocal, 3); c.loc(JSOp::GetLocal, 1); c.loc(JSOp::GetLocal, 1);
    gMark[1] = int(c.op(JSOp::SetElem)); c.op(JSOp::Pop);
    forTail(c, h, jf, 4);
    emit(dir, "arrfill", c, h);
  }
  {  // a[i] += i   (Dup2, GetElem, Add, NopIsAssignOp, StrictSetElem)
    Code c;
    size_t h, jf = arrHead(c, h);
    c.loc(JSOp::GetLocal, 3); c.loc(JSOp::GetLocal, 1); c.op(JSOp::Dup2);
    gMark[1] = int(c.op(JSOp::GetElem));
    c.loc(JSOp::GetLocal, 1); c.op(JSOp::Add); c.op(JSOp::NopIsAssignOp); c.op(JSOp::StrictSetElem); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    emit(dir, "arrinc", c, h);
  }
  {  // s = s + a[i]   s double, a holds numbers
    setLocal(0, DOUBLE_HI);
    setLocal(3, OBJECT, ARR_NUM);
    Code c;
    size_t h, jf = arrHead(c, h);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 3); c.loc(JSOp::GetLocal, 1);
    gMark[1] = int(c.op(JSOp::GetElem));
    c.op(JSOp::Add); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 5);
    emit(dir, "arrdbl", c, h);
    reset();
  }
  {  // a[i] = a[i] / 3   Int32 array widened to Double elements (attempts=2)
    setLocal(3, OBJECT, ARR_INT);
    Code c;
    size_t h, jf = arrHead(c, h);
    c.loc(JSOp::GetLocal, 3); c.loc(JSOp::GetLocal, 1); c.loc(JSOp::GetLocal, 3); c.loc(JSOp::GetLocal, 1);
    c.op(JSOp::GetElem); c.op(JSOp::Int8); c.u(3, 1); c.op(JSOp::Div);
    gMark[1] = int(c.op(JSOp::SetElem)); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    emit(dir, "arrwiden", c, h);
  }
  {  // rejects: not an Array, array var written, element type, other atom
    Code c;
    size_t h, jf = arrHead(c, h);
    c.loc(JSOp::GetLocal, 0); c.loc(JSOp::GetLocal, 3); c.loc(JSOp::GetLocal, 1); c.op(JSOp::GetElem);
    c.op(JSOp::Add); c.op(JSOp::Zero); c.op(JSOp::BitOr); c.loc(JSOp::SetLocal, 0); c.op(JSOp::Pop);
    forTail(c, h, jf, 6);
    setLocal(3, OBJECT, NOT_ARR);
    emit(dir, "reject-notarray", c, h);
    setLocal(3, OBJECT, ARR_OTHER);
    emit(dir, "reject-elemtype", c, h);
    setLocal(3, OBJECT, ARR_INT);
    Code w;
    jf = arrHead(w, h);
    w.loc(JSOp::GetLocal, 3); w.loc(JSOp::SetLocal, 3); w.op(JSOp::Pop);
    forTail(w, h, jf, 4);
    emit(dir, "reject-arrwritten", w, h);
    Code g;
    jf = arrHead(g, h, 2);
    forTail(g, h, jf, 4);
    emit(dir, "reject-getprop", g, h);
    reset();
  }
  return 0;
}
