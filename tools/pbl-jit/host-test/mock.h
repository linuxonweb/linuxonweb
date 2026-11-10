// Minimal SpiderMonkey stand-ins for the host emitter test. Opcode numbers and
// lengths match the final159 source export (js/src/vm/Opcodes.h); operands are
// little-endian. These definitions are used only to construct host fixtures.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#define MOZ_UNLIKELY(x) (__builtin_expect(!!(x), 0))
#define MOZ_CRASH(msg) (fprintf(stderr, "MOZ_CRASH %s\n", msg), abort())
typedef uint8_t jsbytecode;
#define PBLJIT_OPS(X) X(Undefined, 0, 1) X(Null, 1, 1) X(False, 2, 1) X(True, 3, 1) X(Int32, 4, 5) X(Zero, 5, 1) \
  X(One, 6, 1) X(Int8, 7, 2) X(Uint16, 8, 3) X(Uint24, 9, 4) X(Double, 10, 9) X(Pos, 18, 1) X(Neg, 19, 1)     \
  X(BitNot, 20, 1) X(Not, 21, 1)     \
  X(BitOr, 22, 1) X(BitXor, 23, 1) X(BitAnd, 24, 1) X(Eq, 25, 1) X(Ne, 26, 1)   \
  X(StrictEq, 27, 1) X(StrictNe, 28, 1) X(Lt, 31, 1) X(Gt, 32, 1) X(Le, 33, 1) \
  X(Ge, 34, 1) X(Lsh, 37, 1) X(Rsh, 38, 1) X(Ursh, 39, 1) X(Add, 40, 1)         \
  X(Sub, 41, 1) X(Inc, 42, 1) X(Dec, 43, 1) X(Mul, 44, 1) X(Div, 45, 1) X(Mod, 46, 1) X(NopIsAssignOp, 48, 1)  \
  X(ToPropertyKey, 49, 1) X(ToNumeric, 50, 1) X(Call, 117, 3) X(CallIgnoresRv, 121, 3) X(GetGName, 188, 5) X(SetProp, 78, 5) X(StrictSetProp, 79, 5) X(GetProp, 76, 5) X(GetElem, 77, 1) X(SetElem, 80, 1) X(StrictSetElem, 81, 1) \
  X(JumpTarget, 151, 5) X(LoopHead, 152, 6) X(Goto, 153, 5)                     \
  X(JumpIfFalse, 154, 5) X(JumpIfTrue, 155, 5) X(And, 156, 5)                \
  X(Or, 157, 5) X(Coalesce, 158, 5) X(Return, 162, 1) X(Uninitialized, 177, 1)                \
  X(InitLexical, 178, 4) X(CheckLexical, 181, 4) X(GetArg, 189, 3)              \
  X(GetLocal, 191, 4) X(SetArg, 205, 3) X(SetLocal, 206, 4) X(DebugLeaveLexicalEnv, 211, 1) X(Pop, 226, 1) X(Dup, 228, 1) X(Dup2, 229, 1)         \
  X(Throw, 167, 1) X(ThrowWithStack, 168, 1) \
  X(Swap, 231, 1) X(Nop, 234, 1)
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
#define GET_ARGNO(pc) GET_UINT16(pc)
#define GET_ARGC(pc) GET_UINT16(pc)
template<class T> bool MockInspectObject(uint32_t, T&);
template<class T> bool MockReadArrayInitNode(uint32_t, T&);
template<class T> bool MockLookupSlot(uint32_t, uint32_t, T&);
uint8_t MockIdentifyMath(uint32_t);
// Mock arrays (see emit.cpp): class pointer, element kind per object, and
// GetProp's atom index 1 standing for "length".
constexpr uint32_t kMockArrayClasp = 0x5000;
int MockArrayKind(uint32_t payload);
inline bool MockAtomIsLength(const jsbytecode* pc) { return rd(pc + 1, 4) == 1; }
enum JSWhyMagic { JS_ELEMENTS_HOLE = 0, JS_UNINITIALIZED_LEXICAL = 10 };
namespace js {
enum class TryNoteKind { Catch, Finally };
struct MockTryNote {
  TryNoteKind kind_;
  TryNoteKind kind() const { return kind_; }
};
}
struct JSScript {
  jsbytecode* code_;
  size_t length_;
  jsbytecode* code() const { return code_; }
  jsbytecode* codeEnd() const { return code_ + length_; }
  const char* filename() const { return "host-test"; }
  uint32_t lineno() const { return 1; }
  bool argsAliased_ = false;
  bool argsObjAliasesFormals() const { return argsAliased_; }
  std::vector<js::MockTryNote> tryNotes_;
  const std::vector<js::MockTryNote>& trynotes() const { return tryNotes_; }
};
struct JSContext {
  uint32_t bits;
  uint64_t majorGC = 0;
  bool incrementalGC = false;
  uint32_t global = 0xa000;
  void* addressOfInterruptBits() { return &bits; }
};
template<class T, class S> bool MockGlobalSlot(JSContext*, uint32_t, T&, T&, T&, S&);
namespace js { namespace jit {
struct BaselineFrame {  // only used by Compile/OnLoopHead, not by the test
  uint64_t* argv_;
  uint32_t nformals_;
  bool isFunctionFrame() const { return argv_ != nullptr; }
  uint32_t numFormalArgs() const { return nformals_; }
  uint64_t* argv() const { return argv_; }
};
} }
