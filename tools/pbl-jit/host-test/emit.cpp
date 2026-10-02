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
  size_t jump(JSOp o) { size_t at = op(o); u(0, 4); return at; }
  void patch(size_t at, size_t target) { int32_t d = int32_t(target - at); for (int i = 0; i < 4; i++) b[at + 1 + i] = uint8_t(uint32_t(d) >> (8 * i)); }
  void target(uint32_t ic) { op(JSOp::JumpTarget); u(ic, 4); }
};
static int emit(const char* dir, const char* name, Code& c, size_t headAt) {
  JSScript s{c.b.data(), c.b.size()};
  Compiler k;
  k.script = &s;
  k.head = c.b.data() + headAt;
  k.end = nullptr;
  Buf m;
  bool ok = k.scan() && k.translate() && k.assemble(m);
  char path[512];
  snprintf(path, sizeof path, "%s/%s.json", dir, name);
  FILE* j = fopen(path, "w");
  fprintf(j, "{\"ok\":%s,\"reason\":\"%s\",\"len\":%d,\"locals\":[", ok ? "true" : "false",
          k.reason ? k.reason : "", k.end ? int(k.end - k.head) : -1);
  for (uint32_t i = 0; i < k.nlocals; i++) fprintf(j, "%s%u", i ? "," : "", k.localNo[i]);
  fprintf(j, "],\"maxDepth\":%u,\"ops\":%u}\n", k.maxDepth, k.nops);
  fclose(j);
  if (ok) {
    snprintf(path, sizeof path, "%s/%s.wasm", dir, name);
    FILE* f = fopen(path, "wb");
    fwrite(m.p, 1, m.n, f);
    fclose(f);
  }
  printf("%s ok=%d reason=%s bytes=%zu\n", name, ok, k.reason ? k.reason : "-", m.n);
  return ok;
}
int main(int argc, char** argv) {
  const char* dir = argv[1];
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
  {  // rejected: unsupported op (GetArg)
    Code c;
    size_t h = c.head(0);
    c.op(JSOp::GetArg); c.u(0, 2); c.op(JSOp::Pop);
    size_t g = c.jump(JSOp::Goto); c.patch(g, h);
    emit(dir, "reject-getarg", c, h);
  }
  return 0;
}
