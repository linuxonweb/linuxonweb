// Minimal SpiderMonkey stand-ins for the host emitter test. Opcode numbers and
// lengths are Firefox 128.14.0's (js/src/vm/Opcodes.h); operands little-endian.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#define MOZ_UNLIKELY(x) (__builtin_expect(!!(x), 0))
#define MOZ_CRASH(msg) (fprintf(stderr, "MOZ_CRASH %s\n", msg), abort())
typedef uint8_t jsbytecode;
#define PBLJIT_OPS(X) X(False, 2, 1) X(True, 3, 1) X(Int32, 4, 5) X(Zero, 5, 1) \
  X(One, 6, 1) X(Int8, 7, 2) X(Uint16, 8, 3) X(Uint24, 9, 4) X(Not, 21, 1)     \
  X(BitOr, 22, 1) X(BitXor, 23, 1) X(BitAnd, 24, 1) X(Eq, 25, 1) X(Ne, 26, 1)   \
  X(StrictEq, 27, 1) X(StrictNe, 28, 1) X(Lt, 29, 1) X(Gt, 30, 1) X(Le, 31, 1) \
  X(Ge, 32, 1) X(Lsh, 35, 1) X(Rsh, 36, 1) X(Ursh, 37, 1) X(Add, 38, 1)         \
  X(Sub, 39, 1) X(Inc, 40, 1) X(Dec, 41, 1) X(Mul, 42, 1) X(ToNumeric, 48, 1)   \
  X(JumpTarget, 158, 5) X(LoopHead, 159, 6) X(Goto, 160, 5)                     \
  X(JumpIfFalse, 161, 5) X(JumpIfTrue, 162, 5) X(Return, 169, 1)                \
  X(InitLexical, 184, 4) X(CheckLexical, 187, 4) X(GetArg, 194, 3)              \
  X(GetLocal, 196, 4) X(SetLocal, 211, 4) X(Pop, 231, 1) X(Dup, 233, 1)         \
  X(Swap, 236, 1) X(Nop, 239, 1)
enum class JSOp : uint8_t {
#define E(n, v, l) n = v,
  PBLJIT_OPS(E)
#undef E
};
#define E(n, v, l) constexpr uint32_t JSOpLength_##n = l;
PBLJIT_OPS(E)
#undef E
inline uint32_t GetBytecodeLength(const jsbytecode* pc) {
  switch (JSOp(*pc)) {
#define E(n, v, l) case JSOp::n: return l;
    PBLJIT_OPS(E)
#undef E
  }
  return 1;
}
inline const char* CodeName(JSOp op) {
  switch (op) {
#define E(n, v, l) case JSOp::n: return #n;
    PBLJIT_OPS(E)
#undef E
  }
  return "?";
}
inline uint32_t rd(const jsbytecode* p, int n) {
  uint32_t v = 0;
  for (int i = 0; i < n; i++) v |= uint32_t(p[i]) << (8 * i);
  return v;
}
#define GET_INT32(pc) int32_t(rd((pc) + 1, 4))
#define GET_JUMP_OFFSET(pc) GET_INT32(pc)
#define GET_INT8(pc) int32_t(int8_t((pc)[1]))
#define GET_UINT16(pc) rd((pc) + 1, 2)
#define GET_UINT24(pc) rd((pc) + 1, 3)
#define GET_LOCALNO(pc) GET_UINT24(pc)
struct JSScript {
  jsbytecode* code_;
  size_t length_;
  jsbytecode* code() const { return code_; }
  jsbytecode* codeEnd() const { return code_ + length_; }
  const char* filename() const { return "host-test"; }
  uint32_t lineno() const { return 1; }
};
struct JSContext {
  uint32_t bits;
  void* addressOfInterruptBits() { return &bits; }
};
namespace js { namespace jit { struct BaselineFrame; } }
