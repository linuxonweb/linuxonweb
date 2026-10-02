/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
// Guest JIT packets 4, 6, 7a and 7b: runtime PBL-to-wasm loop specializer
// (adapter source).
//
// Compiled with the same command as PortableBaselineInterpret.cpp and linked
// beside a copy of it whose CASE(LoopHead) calls pbljit::OnLoopHead (see
// tools/build-firefox-pbl-jit.py). Upstream SpiderMonkey files are unchanged.
//
// A hot innermost loop (LoopHead .. the last Goto/JumpIfTrue back to it, with
// no nested loop) whose ops are all in the subset below is translated into one
// wasm function (23 x i64) -> i64 and installed with the private jit_install
// syscall (docs/guest-jit-runtime-primitive-20260928.md). Values have static
// types (Int32, Double, Boolean, undefined, null, the TDZ magic); frame locals
// and unaliased formal arguments ("vars") and the PBL operand stack live in
// wasm locals (an i32 and an f64 local each). Double is a number type: a
// Double var accepts an Int32 or a double at entry, and numeric vars whose
// Int32/Double type differs around the loop or at a join are widened to
// Double and the loop is translated again. Forward jumps inside the body
// (if/else, &&, ||, ??, continue) become nested wasm blocks; their joins must
// agree on all types. A head-live var holding an Array (class-guarded at
// entry, never written in the loop) supports dense in-bounds GetElem/SetElem
// of numbers and `.length`; holes, out-of-bounds indices, frozen elements and
// unexpected element types bail. Vars read before
// being written in an iteration are type-guarded at entry and must keep that
// type around the loop; the others are reloaded from the frame each
// iteration. The code leaves the loop at:
//   - a jump out of the region (normal exit, e.g. the loop condition),
//   - an int32 overflow / non-int result, or a double outside the int32 range
//     of a bitwise op, *before* the op (PBL redoes it with exact semantics),
//   - a pending interrupt at the backedge (PBL handles it at the LoopHead).
// Each exit writes back the modified vars and the boxed operand stack, and
// reports the new sp, the pc (relative to the LoopHead) and the IC entry
// index, so the interpreter resumes exactly where PBL itself would be.
// IC indices are static: PBL calls NEXT_IC exactly once per executed JOF_IC
// op on the fast paths used here, and JumpTarget/LoopHead reset it from their
// operand.

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <atomic>
#include <new>

#ifdef PBLJIT_HOST_TEST
#  include "host-test/mock.h"  // host emitter test (tools/pbl-jit/host-test)
#else
#  include "jit/BaselineFrame.h"
#  include "vm/ArrayObject.h"
#  include "vm/BytecodeUtil.h"
#  include "vm/JSContext.h"
#  include "vm/JSScript.h"
#  include "vm/Opcodes.h"
#  include "vm/StringType.h"
#endif

namespace js {
namespace pbljit {

struct Exit {
  uint64_t* sp;
  int32_t pcDelta;
  uint32_t icIndex;
};

namespace {

constexpr long SYS_jit_install = 0x6a490001;
constexpr long SYS_jit_free = 0x6a490002;

constexpr uint32_t kCacheBits = 10;
constexpr uint32_t kCompileHits = 1000;
constexpr uint32_t kMaxBails = 64;
constexpr uint32_t kMaxRegion = 512;
constexpr uint32_t kMaxVars = 32;  // locals + arguments
constexpr uint32_t kMaxTargets = 32;
constexpr uint32_t kMaxDepth = 16;
constexpr uint32_t kMaxInstalls = 4000;

enum Kind : int64_t { NoEntry = 0, Normal = 1, Bail = 2, Interrupt = 3 };

struct Entry {
  const jsbytecode* pc;
  uint8_t* bytes;
  uint32_t hits;
  uint32_t fn;
  uint16_t len;
  uint16_t nargs;  // arguments the code reads or writes (argv slots)
  uint8_t state;  // 0 counting, 1 compiled, 2 rejected
  uint8_t bails;
};

thread_local Entry* tCache;
std::atomic<uint32_t> gInstalls{0};
std::atomic<uint32_t> gCompiles{0};
std::atomic<uint32_t> gRejects{0};
std::atomic<uint32_t> gRuns{0};
std::atomic<uint32_t> gBails{0};
std::atomic<int> gLogBudget{-1};
std::atomic<int> gEnabled{-1};

bool Enabled() {
  int e = gEnabled.load(std::memory_order_relaxed);
  if (e < 0) {
    const char* v = getenv("PBLJIT");
    e = (v && v[0] == '0') ? 0 : 1;
    const char* l = getenv("PBLJIT_LOG");
    gLogBudget.store(l ? atoi(l) : 24, std::memory_order_relaxed);
    gEnabled.store(e, std::memory_order_relaxed);
    if (e) {
      fprintf(stderr, "PBLJIT enabled (threshold=%u)\n", kCompileHits);
    }
  }
  return e != 0;
}

bool TakeLog() { return gLogBudget.fetch_sub(1, std::memory_order_relaxed) > 0; }

// ---- wasm byte emitter ----------------------------------------------------

struct Buf {
  uint8_t* p = nullptr;
  size_t n = 0, cap = 0;
  bool oom = false;
  ~Buf() { free(p); }
  void put(uint8_t v) {
    if (n == cap) {
      size_t ncap = cap ? cap * 2 : 512;
      uint8_t* np = static_cast<uint8_t*>(realloc(p, ncap));
      if (!np) {
        oom = true;
        return;
      }
      p = np;
      cap = ncap;
    }
    p[n++] = v;
  }
  void putn(const void* d, size_t len) {
    for (size_t i = 0; i < len; i++) put(static_cast<const uint8_t*>(d)[i]);
  }
  void uleb(uint32_t v) {
    do {
      uint8_t b = v & 0x7f;
      v >>= 7;
      put(b | (v ? 0x80 : 0));
    } while (v);
  }
  void sleb(int64_t v) {
    for (;;) {
      uint8_t b = v & 0x7f;
      v >>= 7;
      bool done = (v == 0 && !(b & 0x40)) || (v == -1 && (b & 0x40));
      put(b | (done ? 0 : 0x80));
      if (done) return;
    }
  }
  void name(const char* s) {
    uleb(uint32_t(strlen(s)));
    putn(s, strlen(s));
  }
  void section(uint8_t id, Buf& c) {
    put(id);
    uleb(uint32_t(c.n));
    putn(c.p, c.n);
    c.n = 0;
  }
};

// Opcodes.
enum : uint8_t {
  W_UNREACHABLE = 0x00, W_BLOCK = 0x02, W_LOOP = 0x03, W_IF = 0x04, W_END = 0x0b,
  W_BR = 0x0c, W_BRIF = 0x0d, W_RETURN = 0x0f, W_LGET = 0x20, W_LSET = 0x21, W_LTEE = 0x22,
  W_I64LOAD = 0x29, W_I32STORE = 0x36, W_I64STORE = 0x37, W_I32CONST = 0x41,
  W_I64CONST = 0x42, W_I32EQZ = 0x45, W_I32EQ = 0x46, W_I32NE = 0x47,
  W_I32LTS = 0x48, W_I32GTS = 0x4a, W_I32LES = 0x4c, W_I32GES = 0x4e,
  W_I64NE = 0x52, W_I32ADD = 0x6a, W_I32SUB = 0x6b, W_I32REMS = 0x6f, W_I32AND = 0x71,
  W_I32OR = 0x72, W_I32XOR = 0x73, W_I32SHL = 0x74, W_I32SHRS = 0x75,
  W_I32SHRU = 0x76, W_I64ADD = 0x7c, W_I64SUB = 0x7d, W_I64MUL = 0x7e,
  W_I64OR = 0x84, W_I64SHRU = 0x88, W_I32WRAP = 0xa7, W_I64EXTS = 0xac,
  W_I64EXTU = 0xad, W_ATOMIC = 0xfe, W_I32ATOMICLOAD = 0x10, W_VOID = 0x40,
  W_ELSE = 0x05, W_SELECT = 0x1b, W_F64STORE = 0x39, W_F64CONST = 0x44,
  W_I32GTU = 0x4b, W_I32GEU = 0x4f, W_I32LOAD = 0x28, W_F64EQ = 0x61, W_F64NE = 0x62, W_F64LT = 0x63, W_F64GT = 0x64,
  W_F64LE = 0x65, W_F64GE = 0x66, W_F64ABS = 0x99, W_F64NEG = 0x9a,
  W_F64ADD = 0xa0, W_F64SUB = 0xa1, W_F64MUL = 0xa2, W_F64DIV = 0xa3,
  W_I32TRUNCF64S = 0xaa, W_F64CONVI32S = 0xb7, W_F64REINTI64 = 0xbf,
};

// Value types of stack slots and frame variables. The numbering is
// JSValueType's, so a type's NUNBOX32 tag is 0xFFFFFF80 | type. Head marks a
// head-dead variable that still holds the value its frame slot had at the
// loop head (no wasm copy exists yet in this iteration). Double has no tag: a
// value is a double when its high word is <= JSVAL_TAG_CLEAR (0xFFFFFF80).
// ArrTy(v) is an Array object that came from head-live var v (its wasm local
// holds the object pointer); its elements have type elemTy[v].
enum class Ty : uint8_t { Head = 0, Int, Bool, Undef, Null, Magic, Unknown, Double };
constexpr uint32_t kTagObject = 0xFFFFFF8Cu;
constexpr bool IsArr(Ty t) { return uint8_t(t) >= 16; }
constexpr Ty ArrTy(uint32_t v) { return Ty(16 + v); }
constexpr uint32_t ArrVar(Ty t) { return uint8_t(t) - 16u; }
constexpr uint32_t TagOf(Ty t) { return IsArr(t) ? kTagObject : 0xFFFFFF80u | uint32_t(t); }
#ifndef PBLJIT_HOST_TEST
static_assert(TagOf(Ty::Int) == uint32_t(JSVAL_TAG_INT32));
static_assert(TagOf(Ty::Bool) == uint32_t(JSVAL_TAG_BOOLEAN));
static_assert(TagOf(Ty::Undef) == uint32_t(JSVAL_TAG_UNDEFINED));
static_assert(TagOf(Ty::Null) == uint32_t(JSVAL_TAG_NULL));
static_assert(TagOf(Ty::Magic) == uint32_t(JSVAL_TAG_MAGIC));
static_assert(kTagObject == uint32_t(JSVAL_TAG_OBJECT));
#endif
constexpr uint32_t kTagClear = 0xFFFFFF80u;
constexpr uint64_t kCanonicalNaN = 0x7FF8000000000000ull;  // JS::GenericNaN
Ty TyOfTag(uint32_t tag) {
  if (tag <= kTagClear) return Ty::Double;
  uint32_t t = tag ^ kTagClear;
  return (t >= 1 && t <= 4) ? Ty(t) : Ty::Unknown;
}
bool IsNum(Ty t) { return t == Ty::Int || t == Ty::Double; }

// Object layout used by the array ops: obj->shape->base->clasp identifies an
// ArrayObject (class pointers are static; shapes may move), and the
// ObjectElements header sits just below obj->elements_.
#ifdef PBLJIT_HOST_TEST
uint32_t ArrayClasp() { return kMockArrayClasp; }
int32_t OffShape() { return 0; }
int32_t OffBase() { return 0; }
int32_t OffClasp() { return 0; }
int32_t OffElements() { return 8; }
int32_t OffFlags() { return -16; }
int32_t OffInitLen() { return -12; }
int32_t OffLength() { return -4; }
uint32_t FrozenFlag() { return 0x40; }
// -1: not an Array; 0: other element types; 1: Int32; 2: numbers.
int ArrayKind(uint64_t bits) { return MockArrayKind(uint32_t(bits)); }
bool AtomIsLength(JSScript*, jsbytecode* pc) { return MockAtomIsLength(pc); }
#else
uint32_t ArrayClasp() { return uint32_t(uintptr_t(&ArrayObject::class_)); }
int32_t OffShape() { return int32_t(offsetof(JS::shadow::Object, shape)); }  // offsetOfShape is protected
int32_t OffBase() { return int32_t(Shape::offsetOfBaseShape()); }
int32_t OffClasp() { return int32_t(BaseShape::offsetOfClasp()); }
int32_t OffElements() { return int32_t(NativeObject::offsetOfElements()); }
int32_t OffFlags() { return ObjectElements::offsetOfFlags(); }
int32_t OffInitLen() { return ObjectElements::offsetOfInitializedLength(); }
int32_t OffLength() { return ObjectElements::offsetOfLength(); }
uint32_t FrozenFlag() { return ObjectElements::FROZEN; }
// Samples the first 64 dense elements (holes skipped) at compile time; the
// generated code checks every element it reads.
int ArrayKind(uint64_t bits) {
  Value v = Value::fromRawBits(bits);
  if (!v.isObject() || !v.toObject().is<ArrayObject>()) return -1;
  ArrayObject& a = v.toObject().as<ArrayObject>();
  uint32_t n = a.getDenseInitializedLength();
  if (n > 64) n = 64;
  int kind = 1;
  for (uint32_t i = 0; i < n; i++) {
    Value e = a.getDenseElement(i);
    if (e.isMagic(JS_ELEMENTS_HOLE) || e.isInt32()) continue;
    if (!e.isDouble()) return 0;
    kind = 2;
  }
  return kind;
}
bool AtomIsLength(JSScript* script, jsbytecode* pc) {
  return StringEqualsLiteral(script->getAtom(pc), "length");
}
#endif

// Wasm local layout: params 0..22 (i64); i32 locals frame, sp, interrupt
// bits, out, argv; the frame variables; the operand stack; one i32 and one
// i64 temporary; then f64 locals mirroring the variables, the operand stack
// and the i32 temporary (f64 local = i32 local + fOff()).
constexpr uint32_t P_FRAME = 23, P_SP = 24, P_INTR = 25, P_OUT = 26,
                   P_ARGV = 27, L_BASE = 28, kParams = 5;
constexpr uint32_t kArgKey = 0x80000000u;

// Int32/Double widening masks: variables, and stack slots per join target.
struct Widen {
  uint32_t vars = 0;
  uint32_t elems = 0;  // Array vars whose elements are read as Double
  uint32_t slots[kMaxTargets] = {};
};

// Abstract state at one program point.
struct State {
  bool live = false;
  uint32_t depth = 0;
  Ty stack[kMaxDepth];
  Ty var[kMaxVars];
};

struct Compiler {
  JSScript* script;
  jsbytecode* head;
  jsbytecode* end;  // one past the region's last op
  // Compile-time view of the frame. It only chooses the guarded type of each
  // head-live variable; the entry guards check it on every call.
  const uint8_t* frame = nullptr;
  const uint64_t* argv = nullptr;
  uint32_t nformals = 0;
  bool argsAliased = false;

  // Frame variables (locals, and arguments with kArgKey set).
  uint32_t nvars = 0;
  uint32_t varKey[kMaxVars];
  bool varWritten[kMaxVars];
  bool varLive[kMaxVars];  // read before written on some path from the head
  Ty headTy[kMaxVars];
  Ty elemTy[kMaxVars];  // for Array vars: Int, Double or Unknown
  uint32_t maxArg = 0;  // 1 + highest argument index used
  // Forward jump targets inside the region, ascending. Each one is the end
  // of a wasm block opened at the top of the loop body (innermost first).
  uint32_t ntargets = 0;
  jsbytecode* targetPc[kMaxTargets];
  State targetSt[kMaxTargets];
  uint32_t firstOpen = 0;  // first target not yet reached
  State st;
  uint32_t maxDepth = 0, nops = 0, icIndex = 0, headIc = 0;
  Buf code;
  const char* reason = nullptr;
  jsbytecode* reasonPc = nullptr;
  // `widen` is this attempt's input (see TranslateLoop); `want` collects the
  // variables and join slots whose Int32/Double types disagreed.
  Widen widen, want;
  uint32_t attempts = 1;

  uint32_t varLocal(uint32_t v) const { return L_BASE + v; }
  uint32_t slotLocal(uint32_t i) const { return L_BASE + nvars + i; }
  uint32_t tmp32() const { return L_BASE + nvars + kMaxDepth; }
  uint32_t tmp64() const { return L_BASE + nvars + kMaxDepth + 1; }
  // The f64 mirror of an i32 value local (variable, stack slot or tmp32).
  uint32_t fl(uint32_t l) const { return l + nvars + kMaxDepth + 2; }
  uint32_t loc(uint32_t l, Ty t) const { return t == Ty::Double ? fl(l) : l; }
  static bool mixed(Ty a, Ty b) { return a != b && IsNum(a) && IsNum(b); }

  bool reject(const char* why, jsbytecode* at) {
    if (!reason) {
      reason = why;
      reasonPc = at;
    }
    return false;
  }

  static bool isArgOp(JSOp op) { return op == JSOp::GetArg || op == JSOp::SetArg; }
  static uint32_t keyOf(jsbytecode* pc) {
    return isArgOp(JSOp(*pc)) ? (kArgKey | GET_ARGNO(pc)) : GET_LOCALNO(pc);
  }
  int findVar(uint32_t key) const {
    for (uint32_t i = 0; i < nvars; i++)
      if (varKey[i] == key) return int(i);
    return -1;
  }
  int findTarget(const jsbytecode* t) const {
    for (uint32_t i = 0; i < ntargets; i++)
      if (targetPc[i] == t) return int(i);
    return -1;
  }
  static bool isJump(JSOp op) {
    return op == JSOp::Goto || op == JSOp::JumpIfFalse ||
           op == JSOp::JumpIfTrue || op == JSOp::And || op == JSOp::Or ||
           op == JSOp::Coalesce;
  }

  void lget(uint32_t l) { code.put(W_LGET), code.uleb(l); }
  void lset(uint32_t l) { code.put(W_LSET), code.uleb(l); }
  void i32c(int32_t v) { code.put(W_I32CONST), code.sleb(v); }
  void i64c(int64_t v) { code.put(W_I64CONST), code.sleb(v); }
  void f64c(double d) { code.put(W_F64CONST), code.putn(&d, 8); }
  // Copy a value of type `t` between value locals.
  void move(uint32_t from, uint32_t to, Ty t) { lget(loc(from, t)), lset(loc(to, t)); }
  // Push value local `l` (Int or Double) as an f64.
  void getNum(uint32_t l, Ty t) {
    lget(loc(l, t));
    if (t == Ty::Int) code.put(W_F64CONVI32S);
  }

  void varAddr(uint32_t v) {
    uint32_t key = varKey[v];
    if (key & kArgKey) {
      lget(P_ARGV), i32c(int32_t(8 * (key & ~kArgKey))), code.put(W_I32ADD);
    } else {
      lget(P_FRAME), i32c(int32_t(8 * (key + 1))), code.put(W_I32SUB);
    }
  }
  void slotAddr(uint32_t i) {
    lget(P_SP), i32c(int32_t(8 * (i + 1))), code.put(W_I32SUB);
  }
  // [addr] -> []: store the boxed value of `valueLocal` with type `t`.
  void boxStore(uint32_t valueLocal, Ty t) {
    if (t == Ty::Double) {
      // A double Value's NaN must be the canonical one.
      uint32_t f = fl(valueLocal);
      uint64_t nan = kCanonicalNaN;
      code.put(W_F64CONST), code.putn(&nan, 8);
      lget(f), lget(f), lget(f), code.put(W_F64NE);
      code.put(W_SELECT);
      code.put(W_F64STORE), code.uleb(3), code.uleb(0);
      return;
    }
    i64c(int64_t(uint64_t(TagOf(t)) << 32));
    lget(valueLocal);
    code.put(W_I64EXTU);
    code.put(W_I64OR);
    code.put(W_I64STORE), code.uleb(3), code.uleb(0);
  }

  // Write back the current state and return to the interpreter at `target`.
  void emitExit(Kind kind, jsbytecode* target, uint32_t ic) {
    for (uint32_t i = 0; i < st.depth; i++) {
      slotAddr(i);
      boxStore(slotLocal(i), st.stack[i]);
    }
    for (uint32_t v = 0; v < nvars; v++) {
      Ty t = st.var[v];
      if (t == Ty::Head) continue;                    // frame already current
      if (varLive[v] && !varWritten[v]) continue;     // never changed
      varAddr(v);
      boxStore(varLocal(v), t);
    }
    lget(P_OUT);
    lget(P_SP);
    i32c(int32_t(8 * st.depth));
    code.put(W_I32SUB);
    code.put(W_I32STORE), code.uleb(2), code.uleb(0);
    lget(P_OUT);
    i32c(int32_t(target - head));
    code.put(W_I32STORE), code.uleb(2), code.uleb(4);
    lget(P_OUT);
    i32c(int32_t(ic));
    code.put(W_I32STORE), code.uleb(2), code.uleb(8);
    i64c(kind);
    code.put(W_RETURN);
  }

  // Head-live variables stay in wasm locals with their head type across the
  // backedge; head-dead ones are stored to the frame so the next iteration
  // starts with them in the Head state again.
  bool checkBackedge(jsbytecode* pc) {
    if (st.depth != 0) return reject("backedge depth", pc);
    bool same = true;
    for (uint32_t v = 0; v < nvars; v++) {
      if (!varLive[v] || st.var[v] == headTy[v]) continue;
      same = false;
      if (mixed(st.var[v], headTy[v])) want.vars |= 1u << v;
    }
    return same || reject("backedge type", pc);
  }
  // `nest` = enclosing structured blocks between here and the `loop`.
  void emitBackedge(uint32_t nest) {
    lget(P_INTR);
    code.put(W_ATOMIC), code.put(W_I32ATOMICLOAD), code.uleb(2), code.uleb(0);
    code.put(W_IF), code.put(W_VOID);
    emitExit(Interrupt, head, headIc);
    code.put(W_END);
    for (uint32_t v = 0; v < nvars; v++) {
      if (!varLive[v] && st.var[v] != Ty::Head) {
        varAddr(v);
        boxStore(varLocal(v), st.var[v]);
      }
    }
    code.put(W_BR), code.uleb(nest);
  }

  bool push(Ty t, jsbytecode* pc) {
    if (st.depth >= kMaxDepth) return reject("stack depth", pc);
    st.stack[st.depth++] = t;
    if (st.depth > maxDepth) maxDepth = st.depth;
    return true;
  }

  // Record the state flowing along an edge to inside target j.
  // Emitted on the edge's own path (before the br / block end). A join slot
  // widened by an earlier attempt takes every incoming Int32 as a Double.
  bool edge(uint32_t j, jsbytecode* pc) {
    for (uint32_t i = 0; i < st.depth; i++) {
      if ((widen.slots[j] >> i & 1) && st.stack[i] == Ty::Int) {
        lget(slotLocal(i)), code.put(W_F64CONVI32S), lset(fl(slotLocal(i)));
        st.stack[i] = Ty::Double;
      }
    }
    State& t = targetSt[j];
    if (!t.live) {
      t = st;
      return true;
    }
    if (t.depth != st.depth) return reject("join depth", pc);
    bool same = true;
    for (uint32_t i = 0; i < st.depth; i++) {
      if (t.stack[i] == st.stack[i]) continue;
      same = false;
      if (mixed(t.stack[i], st.stack[i])) want.slots[j] |= 1u << i;
    }
    for (uint32_t v = 0; v < nvars; v++) {
      if (t.var[v] == st.var[v]) continue;
      same = false;
      if (mixed(t.var[v], st.var[v])) want.vars |= 1u << v;
    }
    return same || reject("join type", pc);
  }

  // Pass 1: find the region (up to the last backedge before any nested
  // loop), its frame variables and its forward jump targets.
  bool scan() {
    jsbytecode* body = head + JSOpLength_LoopHead;
    jsbytecode* limit = script->codeEnd();
    if (limit - head > int32_t(kMaxRegion)) limit = head + kMaxRegion;
    end = nullptr;
    const char* stop = "region size";
    for (jsbytecode* pc = body; pc < limit;) {
      JSOp op = JSOp(*pc);
      if (op == JSOp::LoopHead) {
        stop = "nested loop";
        break;
      }
      jsbytecode* next = pc + GetBytecodeLength(pc);
      if ((op == JSOp::Goto || op == JSOp::JumpIfTrue) &&
          pc + GET_JUMP_OFFSET(pc) == head)
        end = next;
      if (next > limit) break;
      pc = next;
    }
    if (!end) return reject(stop, body);
    for (jsbytecode* pc = body; pc < end; pc += GetBytecodeLength(pc)) {
      JSOp op = JSOp(*pc);
      switch (op) {
        case JSOp::GetArg:
        case JSOp::SetArg:
          if (!argv || argsAliased) return reject("arguments", pc);
          if (GET_ARGNO(pc) >= nformals) return reject("argument index", pc);
          if (GET_ARGNO(pc) + 1 > maxArg) maxArg = GET_ARGNO(pc) + 1;
          [[fallthrough]];
        case JSOp::GetLocal:
        case JSOp::SetLocal:
        case JSOp::InitLexical: {
          uint32_t key = keyOf(pc);
          int v = findVar(key);
          if (v < 0) {
            if (nvars >= kMaxVars) return reject("locals", pc);
            v = int(nvars++);
            varKey[v] = key;
            varWritten[v] = varLive[v] = false;
          }
          if (op != JSOp::GetLocal && op != JSOp::GetArg) varWritten[v] = true;
          break;
        }
        default:
          if (isJump(op)) {
            jsbytecode* t = pc + GET_JUMP_OFFSET(pc);
            if (t == head || t < head || t >= end) break;  // backedge / exit
            if (t <= pc) return reject("backward jump", pc);
            if (findTarget(t) >= 0) break;
            if (ntargets >= kMaxTargets) return reject("targets", pc);
            uint32_t i = ntargets++;
            while (i > 0 && targetPc[i - 1] > t) {
              targetPc[i] = targetPc[i - 1];
              i--;
            }
            targetPc[i] = t;
          }
          break;
      }
    }
    return true;
  }

  // Pass 2: which variables are read before being written on some path from
  // the head (the region is a DAG apart from the backedge).
  bool liveness() {
    uint32_t defw = 0;
    bool live = true;
    uint32_t tdef[kMaxTargets];
    bool tlive[kMaxTargets] = {};
    uint32_t nextT = 0;
    auto jumpTo = [&](jsbytecode* t) {
      int j = findTarget(t);
      if (j < 0) return;
      tdef[j] = tlive[j] ? (tdef[j] & defw) : defw;
      tlive[j] = true;
    };
    for (jsbytecode* pc = head + JSOpLength_LoopHead; pc < end;
         pc += GetBytecodeLength(pc)) {
      if (nextT < ntargets && targetPc[nextT] == pc) {
        if (tlive[nextT]) defw = live ? (defw & tdef[nextT]) : tdef[nextT];
        live = live || tlive[nextT];
        nextT++;
      }
      if (!live) continue;
      JSOp op = JSOp(*pc);
      switch (op) {
        case JSOp::GetLocal:
        case JSOp::GetArg: {
          int v = findVar(keyOf(pc));
          if (!(defw & (1u << v))) varLive[v] = true;
          break;
        }
        case JSOp::SetLocal:
        case JSOp::InitLexical:
        case JSOp::SetArg:
          defw |= 1u << findVar(keyOf(pc));
          break;
        default:
          if (isJump(op)) {
            jumpTo(pc + GET_JUMP_OFFSET(pc));
            if (op == JSOp::Goto) live = false;
          }
          break;
      }
    }
    // Speculate each head-live variable keeps the type it has right now.
    for (uint32_t v = 0; v < nvars; v++) {
      headTy[v] = Ty::Head;
      if (!varLive[v]) continue;
      uint32_t key = varKey[v];
      uint64_t bits;
      if (key & kArgKey) {
        bits = argv[key & ~kArgKey];
      } else {
        memcpy(&bits, frame - 8 * (size_t(key) + 1), 8);
      }
      if (uint32_t(bits >> 32) == kTagObject) {
        // An Array the loop never replaces: its local holds the pointer.
        int kind = ArrayKind(bits);
        if (kind < 0) return reject("head type", head);
        if (varWritten[v]) return reject("array var written", head);
        headTy[v] = ArrTy(v);
        elemTy[v] = kind == 0 ? Ty::Unknown : kind == 2 ? Ty::Double : Ty::Int;
        if (elemTy[v] == Ty::Int && (widen.elems >> v & 1)) elemTy[v] = Ty::Double;
        continue;
      }
      headTy[v] = TyOfTag(uint32_t(bits >> 32));
      if (headTy[v] == Ty::Unknown) return reject("head type", head);
      if (headTy[v] == Ty::Int && (widen.vars >> v & 1)) headTy[v] = Ty::Double;
    }
    return true;
  }

  // ToInt32 of the top `n` stack slots in place. A double outside
  // (-2^31 - 1, 2^31), or NaN, bails before the op.
  bool toInt32(jsbytecode* pc, uint32_t n) {
    if (st.depth < n) return reject("underflow", pc);
    bool any = false;
    for (uint32_t i = st.depth - n; i < st.depth; i++) {
      if (st.stack[i] == Ty::Int) continue;
      if (st.stack[i] != Ty::Double) return reject("operand type", pc);
      uint32_t f = fl(slotLocal(i));
      lget(f), f64c(-2147483649.0), code.put(W_F64GT);
      lget(f), f64c(2147483648.0), code.put(W_F64LT);
      code.put(W_I32AND);
      if (any) code.put(W_I32AND);
      any = true;
    }
    if (!any) return true;
    code.put(W_I32EQZ);
    code.put(W_IF), code.put(W_VOID);
    emitExit(Bail, pc, icIndex);
    code.put(W_END);
    for (uint32_t i = st.depth - n; i < st.depth; i++) {
      if (st.stack[i] != Ty::Double) continue;
      lget(fl(slotLocal(i))), code.put(W_I32TRUNCF64S), lset(slotLocal(i));
      st.stack[i] = Ty::Int;
    }
    return true;
  }

  // Number arithmetic: int32 (binaryInt) unless an operand is a double or
  // the op is Div; bitwise ops convert doubles with ToInt32 first.
  bool arith(jsbytecode* pc, JSOp op) {
    if (st.depth < 2) return reject("underflow", pc);
    Ty a = st.stack[st.depth - 2], b = st.stack[st.depth - 1];
    if (!IsNum(a) || !IsNum(b)) return reject("operand type", pc);
    uint32_t lhs = slotLocal(st.depth - 2), rhs = slotLocal(st.depth - 1);
    switch (op) {
      case JSOp::Add:
      case JSOp::Sub:
      case JSOp::Mul:
      case JSOp::Div:
        if (a == Ty::Int && b == Ty::Int && op != JSOp::Div) return binaryInt(pc, op);
        getNum(lhs, a), getNum(rhs, b);
        code.put(op == JSOp::Add   ? W_F64ADD
                 : op == JSOp::Sub ? W_F64SUB
                 : op == JSOp::Mul ? W_F64MUL
                                   : W_F64DIV);
        lset(fl(lhs));
        st.depth--;
        st.stack[st.depth - 1] = Ty::Double;
        return true;
      case JSOp::Mod:
        return binaryInt(pc, op);
      default:
        return toInt32(pc, 2) && binaryInt(pc, op);
    }
  }

  bool binaryInt(jsbytecode* pc, JSOp op) {
    if (st.depth < 2) return reject("underflow", pc);
    if (st.stack[st.depth - 1] != Ty::Int || st.stack[st.depth - 2] != Ty::Int)
      return reject("operand type", pc);
    uint32_t lhs = slotLocal(st.depth - 2), rhs = slotLocal(st.depth - 1);
    switch (op) {
      case JSOp::Add:
      case JSOp::Sub:
      case JSOp::Mul: {
        lget(lhs), code.put(W_I64EXTS);
        lget(rhs), code.put(W_I64EXTS);
        code.put(op == JSOp::Add ? W_I64ADD
                                 : op == JSOp::Sub ? W_I64SUB : W_I64MUL);
        code.put(W_LTEE), code.uleb(tmp64());
        lget(tmp64()), code.put(W_I32WRAP), code.put(W_I64EXTS);
        code.put(W_I64NE);
        if (op == JSOp::Mul) {
          // -0: product == 0 and exactly one operand negative.
          lget(tmp64()), code.put(W_I32WRAP), code.put(W_I32EQZ);
          lget(lhs), lget(rhs), code.put(W_I32XOR);
          i32c(0), code.put(W_I32LTS);
          code.put(W_I32AND);
          code.put(W_I32OR);
        }
        code.put(W_IF), code.put(W_VOID);
        emitExit(Bail, pc, icIndex);
        code.put(W_END);
        lget(tmp64()), code.put(W_I32WRAP);
        break;
      }
      case JSOp::Mod:
        // Int32 result with the sign of a non-negative lhs; PBL handles the
        // rest (negative zero, division by zero, negative operands).
        lget(lhs), i32c(0), code.put(W_I32LTS);
        lget(rhs), i32c(0), code.put(W_I32LES);
        code.put(W_I32OR);
        code.put(W_IF), code.put(W_VOID);
        emitExit(Bail, pc, icIndex);
        code.put(W_END);
        lget(lhs), lget(rhs), code.put(W_I32REMS);
        break;
      case JSOp::Ursh:
        lget(lhs), lget(rhs), code.put(W_I32SHRU);
        code.put(W_LTEE), code.uleb(tmp32());
        i32c(0), code.put(W_I32LTS);
        code.put(W_IF), code.put(W_VOID);
        emitExit(Bail, pc, icIndex);
        code.put(W_END);
        lget(tmp32());
        break;
      default: {
        uint8_t w;
        switch (op) {
          case JSOp::BitOr: w = W_I32OR; break;
          case JSOp::BitAnd: w = W_I32AND; break;
          case JSOp::BitXor: w = W_I32XOR; break;
          case JSOp::Lsh: w = W_I32SHL; break;
          case JSOp::Rsh: w = W_I32SHRS; break;
          default: MOZ_CRASH("pbljit binaryInt");
        }
        lget(lhs), lget(rhs), code.put(w);  // wasm shifts mask by 31
        break;
      }
    }
    lset(lhs);
    st.depth--;
    return true;
  }

  bool compare(jsbytecode* pc, JSOp op) {
    if (st.depth < 2) return reject("underflow", pc);
    Ty a = st.stack[st.depth - 2], b = st.stack[st.depth - 1];
    bool equality = op == JSOp::Eq || op == JSOp::Ne ||
                    op == JSOp::StrictEq || op == JSOp::StrictNe;
    if (IsNum(a) && IsNum(b) && (a == Ty::Double || b == Ty::Double)) {
      // IEEE comparisons: false on NaN except !=, as in JS.
      uint32_t lhs = slotLocal(st.depth - 2), rhs = slotLocal(st.depth - 1);
      getNum(lhs, a), getNum(rhs, b);
      switch (op) {
        case JSOp::Lt: code.put(W_F64LT); break;
        case JSOp::Le: code.put(W_F64LE); break;
        case JSOp::Gt: code.put(W_F64GT); break;
        case JSOp::Ge: code.put(W_F64GE); break;
        case JSOp::Eq:
        case JSOp::StrictEq: code.put(W_F64EQ); break;
        case JSOp::Ne:
        case JSOp::StrictNe: code.put(W_F64NE); break;
        default: MOZ_CRASH("pbljit compare");
      }
      lset(lhs);
      st.depth--;
      st.stack[st.depth - 1] = Ty::Bool;
      return true;
    }
    if (!(a == Ty::Int && b == Ty::Int) &&
        !(equality && a == Ty::Bool && b == Ty::Bool))
      return reject("operand type", pc);
    uint32_t lhs = slotLocal(st.depth - 2), rhs = slotLocal(st.depth - 1);
    uint8_t w;
    switch (op) {
      case JSOp::Lt: w = W_I32LTS; break;
      case JSOp::Le: w = W_I32LES; break;
      case JSOp::Gt: w = W_I32GTS; break;
      case JSOp::Ge: w = W_I32GES; break;
      case JSOp::Eq:
      case JSOp::StrictEq: w = W_I32EQ; break;
      case JSOp::Ne:
      case JSOp::StrictNe: w = W_I32NE; break;
      default: MOZ_CRASH("pbljit compare");
    }
    lget(lhs), lget(rhs), code.put(w);
    lset(lhs);
    st.depth--;
    st.stack[st.depth - 1] = Ty::Bool;
    return true;
  }

  // Push ToBoolean(slot) as an i32.
  bool truthy(uint32_t slot, Ty t, jsbytecode* pc) {
    switch (t) {
      case Ty::Int:
      case Ty::Bool: lget(slotLocal(slot)); return true;
      case Ty::Undef:
      case Ty::Null: i32c(0); return true;
      case Ty::Double:  // false for +-0 and NaN
        lget(fl(slotLocal(slot))), code.put(W_F64ABS), f64c(0.0), code.put(W_F64GT);
        return true;
      default:
        if (IsArr(t)) {
          i32c(1);
          return true;
        }
        return reject("operand type", pc);
    }
  }

  // A jump to `target`; with `cond` the i32 condition is on the wasm stack.
  bool branch(jsbytecode* pc, jsbytecode* target, jsbytecode* next, bool cond) {
    uint32_t open = ntargets - firstOpen;
    if (target == head) {
      if (!checkBackedge(pc)) return false;
      if (cond) {
        code.put(W_IF), code.put(W_VOID);
        emitBackedge(open + 1);
        code.put(W_END);
        if (next == end) {
          // Fallthrough of the final conditional backedge leaves the loop.
          emitExit(Normal, next, icIndex);
          st.live = false;
        }
      } else {
        emitBackedge(open);
        st.live = false;
      }
      return true;
    }
    int j = findTarget(target);
    if (j >= 0) {
      if (uint32_t(j) < firstOpen) return reject("backward jump", pc);
      if (!edge(uint32_t(j), pc)) return false;
      code.put(cond ? W_BRIF : W_BR), code.uleb(uint32_t(j) - firstOpen);
      if (!cond) st.live = false;
      return true;
    }
    if (cond) code.put(W_IF), code.put(W_VOID);
    emitExit(Normal, target, icIndex);
    if (cond) {
      code.put(W_END);
    } else {
      st.live = false;
    }
    return true;
  }

  bool unaryNum(jsbytecode* pc) {
    if (st.depth < 1) return reject("underflow", pc);
    if (!IsNum(st.stack[st.depth - 1])) return reject("operand type", pc);
    return true;
  }

  // [addr] -> [i32 at addr + off]
  void load32(int32_t off) {
    if (off < 0) i32c(off), code.put(W_I32ADD), off = 0;
    code.put(W_I32LOAD), code.uleb(2), code.uleb(uint32_t(off));
  }
  void bailIf(jsbytecode* pc) {
    code.put(W_IF), code.put(W_VOID);
    emitExit(Bail, pc, icIndex);
    code.put(W_END);
  }
  // tmp32 = elements of the Array in stack slot `s`; bail unless the Int32 in
  // slot `ix` is below its initialized length.
  void denseIndex(jsbytecode* pc, uint32_t s, uint32_t ix) {
    lget(slotLocal(s)), load32(OffElements()), lset(tmp32());
    lget(slotLocal(ix)), lget(tmp32()), load32(OffInitLen()), code.put(W_I32GEU);
    bailIf(pc);
  }
  // [] -> [], tmp32 = address of element `ix` of elements tmp32.
  void elemAddr(uint32_t ix) {
    lget(tmp32()), lget(slotLocal(ix)), i32c(3), code.put(W_I32SHL), code.put(W_I32ADD);
    lset(tmp32());
  }

  // Dense element read: [arr, index] -> [element].
  bool getElem(jsbytecode* pc) {
    if (st.depth < 2) return reject("underflow", pc);
    Ty a = st.stack[st.depth - 2], i = st.stack[st.depth - 1];
    if (!IsArr(a) || i != Ty::Int) return reject("operand type", pc);
    Ty et = elemTy[ArrVar(a)];
    if (!IsNum(et)) return reject("element type", pc);
    uint32_t s = st.depth - 2, out = slotLocal(s);
    denseIndex(pc, s, s + 1);
    elemAddr(s + 1);
    lget(tmp32()), code.put(W_I64LOAD), code.uleb(3), code.uleb(0);
    code.put(W_LTEE), code.uleb(tmp64());
    i64c(32), code.put(W_I64SHRU), code.put(W_I32WRAP);
    if (et == Ty::Int) {
      i32c(int32_t(TagOf(Ty::Int))), code.put(W_I32NE);
      bailIf(pc);
      lget(tmp64()), code.put(W_I32WRAP), lset(out);
    } else {
      code.put(W_LTEE), code.uleb(tmp32());
      i32c(int32_t(TagOf(Ty::Int))), code.put(W_I32EQ);
      code.put(W_IF), code.put(W_VOID);
      lget(tmp64()), code.put(W_I32WRAP), code.put(W_F64CONVI32S), lset(fl(out));
      code.put(W_ELSE);
      lget(tmp32()), i32c(int32_t(kTagClear)), code.put(W_I32GTU);
      bailIf(pc);  // hole, or not a number
      lget(tmp64()), code.put(W_F64REINTI64), lset(fl(out));
      code.put(W_END);
    }
    st.depth--;
    st.stack[s] = et;
    return true;
  }

  // Dense element write of a number over a number: [arr, index, v] -> [v].
  // Neither value is a GC thing, so no barriers are needed.
  bool setElem(jsbytecode* pc) {
    if (st.depth < 3) return reject("underflow", pc);
    uint32_t s = st.depth - 3;
    Ty a = st.stack[s], i = st.stack[s + 1], t = st.stack[s + 2];
    if (!IsArr(a) || i != Ty::Int || !IsNum(t)) return reject("operand type", pc);
    uint32_t v = ArrVar(a);
    if (!IsNum(elemTy[v])) return reject("element type", pc);
    if (elemTy[v] == Ty::Int && t == Ty::Double) {
      want.elems |= 1u << v;
      return reject("element widen", pc);
    }
    denseIndex(pc, s, s + 1);
    lget(tmp32()), load32(OffFlags()), i32c(int32_t(FrozenFlag())), code.put(W_I32AND);
    bailIf(pc);
    elemAddr(s + 1);
    lget(tmp32()), load32(4), i32c(int32_t(TagOf(Ty::Int))), code.put(W_I32GTU);
    bailIf(pc);  // the old element is a hole or not a number
    lget(tmp32());
    boxStore(slotLocal(s + 2), t);
    move(slotLocal(s + 2), slotLocal(s), t);
    st.depth -= 2;
    st.stack[s] = t;
    return true;
  }

  // Array `.length`: [arr] -> [Int32]; lengths above INT32_MAX bail.
  bool getLength(jsbytecode* pc) {
    if (st.depth < 1) return reject("underflow", pc);
    uint32_t s = st.depth - 1;
    if (!IsArr(st.stack[s])) return reject("operand type", pc);
    lget(slotLocal(s)), load32(OffElements()), load32(OffLength());
    code.put(W_LTEE), code.uleb(tmp32());
    i32c(0), code.put(W_I32LTS);
    bailIf(pc);
    lget(tmp32()), lset(slotLocal(s));
    st.stack[s] = Ty::Int;
    return true;
  }

  // Pass 3: translate. Emits the entry guards, then the `loop` with one
  // `block` per forward target.
  bool translate() {
    for (uint32_t i = 0; i < kParams; i++) {
      lget(i), code.put(W_I32WRAP), lset(P_FRAME + i);
    }
    st = State();
    st.live = true;
    for (uint32_t v = 0; v < nvars; v++) {
      st.var[v] = headTy[v];
      if (!varLive[v]) continue;
      varAddr(v);
      code.put(W_I64LOAD), code.uleb(3), code.uleb(0);
      code.put(W_LTEE), code.uleb(tmp64());
      i64c(32), code.put(W_I64SHRU), code.put(W_I32WRAP);
      if (IsArr(headTy[v])) {
        // An object whose class is Array.
        i32c(int32_t(kTagObject)), code.put(W_I32NE);
        code.put(W_IF), code.put(W_VOID);
        i64c(NoEntry), code.put(W_RETURN);
        code.put(W_END);
        lget(tmp64()), code.put(W_I32WRAP), code.put(W_LTEE), code.uleb(varLocal(v));
        load32(OffShape()), load32(OffBase()), load32(OffClasp());
        i32c(int32_t(ArrayClasp())), code.put(W_I32NE);
        code.put(W_IF), code.put(W_VOID);
        i64c(NoEntry), code.put(W_RETURN);
        code.put(W_END);
        continue;
      }
      if (headTy[v] == Ty::Double) {
        // A number: an Int32 is converted, a double taken as is.
        code.put(W_LTEE), code.uleb(tmp32());
        i32c(int32_t(TagOf(Ty::Int))), code.put(W_I32EQ);
        code.put(W_IF), code.put(W_VOID);
        lget(tmp64()), code.put(W_I32WRAP), code.put(W_F64CONVI32S);
        lset(fl(varLocal(v)));
        code.put(W_ELSE);
        lget(tmp32()), i32c(int32_t(kTagClear)), code.put(W_I32GTU);
        code.put(W_IF), code.put(W_VOID);
        i64c(NoEntry), code.put(W_RETURN);
        code.put(W_END);
        lget(tmp64()), code.put(W_F64REINTI64), lset(fl(varLocal(v)));
        code.put(W_END);
        continue;
      }
      i32c(int32_t(TagOf(headTy[v]))), code.put(W_I32NE);
      code.put(W_IF), code.put(W_VOID);
      i64c(NoEntry), code.put(W_RETURN);
      code.put(W_END);
      lget(tmp64()), code.put(W_I32WRAP), lset(varLocal(v));
    }
    code.put(W_LOOP), code.put(W_VOID);
    for (uint32_t j = 0; j < ntargets; j++) code.put(W_BLOCK), code.put(W_VOID);

    headIc = uint32_t(GET_INT32(head));
    icIndex = headIc;
    jsbytecode* pc = head + JSOpLength_LoopHead;
    while (pc < end) {
      if (firstOpen < ntargets && targetPc[firstOpen] <= pc) {
        if (targetPc[firstOpen] != pc) return reject("jump target", pc);
        if (st.live && !edge(firstOpen, pc)) return false;  // fallthrough edge
        code.put(W_END);
        st = targetSt[firstOpen++];
      }
      JSOp op = JSOp(*pc);
      jsbytecode* next = pc + GetBytecodeLength(pc);
      if (!st.live) {  // unreachable from the head
        pc = next;
        continue;
      }
      nops++;
      uint32_t top = st.depth - 1;
      switch (op) {
        case JSOp::Nop:
        case JSOp::NopIsAssignOp:  // decompiler hint after the op of `x op= y`
          break;
        case JSOp::DebugLeaveLexicalEnv:  // no-op: OnLoopHead excludes debuggee frames
          break;
        case JSOp::JumpTarget:
          icIndex = uint32_t(GET_INT32(pc));
          break;
        case JSOp::Zero:
        case JSOp::One:
        case JSOp::Int8:
        case JSOp::Uint16:
        case JSOp::Uint24:
        case JSOp::Int32: {
          int32_t v = op == JSOp::Zero    ? 0
                      : op == JSOp::One   ? 1
                      : op == JSOp::Int8  ? GET_INT8(pc)
                      : op == JSOp::Uint16 ? int32_t(GET_UINT16(pc))
                      : op == JSOp::Uint24 ? int32_t(GET_UINT24(pc))
                                           : GET_INT32(pc);
          if (!push(Ty::Int, pc)) return false;
          i32c(v), lset(slotLocal(st.depth - 1));
          break;
        }
        case JSOp::Double:
          if (!push(Ty::Double, pc)) return false;
          code.put(W_F64CONST), code.putn(pc + 1, 8);  // the Value's bits
          lset(fl(slotLocal(st.depth - 1)));
          break;
        case JSOp::True:
        case JSOp::False:
          if (!push(Ty::Bool, pc)) return false;
          i32c(op == JSOp::True ? 1 : 0), lset(slotLocal(st.depth - 1));
          break;
        case JSOp::Undefined:
        case JSOp::Null:
          if (!push(op == JSOp::Null ? Ty::Null : Ty::Undef, pc)) return false;
          i32c(0), lset(slotLocal(st.depth - 1));
          break;
        case JSOp::Uninitialized:
          if (!push(Ty::Magic, pc)) return false;
          i32c(JS_UNINITIALIZED_LEXICAL), lset(slotLocal(st.depth - 1));
          break;
        case JSOp::GetLocal:
        case JSOp::GetArg: {
          uint32_t v = uint32_t(findVar(keyOf(pc)));
          if (st.var[v] == Ty::Head) return reject("head read", pc);
          if (!push(st.var[v], pc)) return false;
          move(varLocal(v), slotLocal(st.depth - 1), st.var[v]);
          break;
        }
        case JSOp::SetLocal:
        case JSOp::InitLexical:
        case JSOp::SetArg: {
          if (st.depth < 1) return reject("underflow", pc);
          uint32_t v = uint32_t(findVar(keyOf(pc)));
          Ty t = st.stack[top];
          if (t == Ty::Int && (widen.vars >> v & 1)) {
            lget(slotLocal(top)), code.put(W_F64CONVI32S), lset(fl(varLocal(v)));
            t = Ty::Double;
          } else {
            move(slotLocal(top), varLocal(v), t);
          }
          st.var[v] = t;
          break;
        }
        case JSOp::CheckLexical:
          if (st.depth < 1) return reject("underflow", pc);
          // Types are static: a TDZ value here would always throw.
          if (st.stack[top] == Ty::Magic) return reject("tdz", pc);
          break;
        case JSOp::Pop:
          if (st.depth < 1) return reject("underflow", pc);
          st.depth--;
          break;
        case JSOp::Dup:
          if (st.depth < 1) return reject("underflow", pc);
          if (!push(st.stack[top], pc)) return false;
          move(slotLocal(top), slotLocal(top + 1), st.stack[top]);
          break;
        case JSOp::Dup2:  // a[i] op= v
          if (st.depth < 2) return reject("underflow", pc);
          if (!push(st.stack[top - 1], pc) || !push(st.stack[top], pc)) return false;
          move(slotLocal(top - 1), slotLocal(top + 1), st.stack[top - 1]);
          move(slotLocal(top), slotLocal(top + 2), st.stack[top]);
          break;
        case JSOp::Swap: {
          if (st.depth < 2) return reject("underflow", pc);
          uint32_t a = slotLocal(top - 1), b = slotLocal(top);
          move(a, tmp32(), st.stack[top - 1]);
          move(b, a, st.stack[top]);
          move(tmp32(), b, st.stack[top - 1]);
          Ty t = st.stack[top - 1];
          st.stack[top - 1] = st.stack[top];
          st.stack[top] = t;
          break;
        }
        case JSOp::Add:
        case JSOp::Sub:
        case JSOp::Mul:
        case JSOp::Div:
        case JSOp::Mod:
        case JSOp::BitOr:
        case JSOp::BitAnd:
        case JSOp::BitXor:
        case JSOp::Lsh:
        case JSOp::Rsh:
        case JSOp::Ursh:
          if (!arith(pc, op)) return false;
          icIndex++;
          break;
        case JSOp::Lt:
        case JSOp::Le:
        case JSOp::Gt:
        case JSOp::Ge:
        case JSOp::Eq:
        case JSOp::Ne:
        case JSOp::StrictEq:
        case JSOp::StrictNe:
          if (!compare(pc, op)) return false;
          icIndex++;
          break;
        case JSOp::Inc:
        case JSOp::Dec: {
          if (!unaryNum(pc)) return false;
          uint32_t s = slotLocal(top);
          if (st.stack[top] == Ty::Double) {
            lget(fl(s)), f64c(1.0), code.put(op == JSOp::Inc ? W_F64ADD : W_F64SUB);
            lset(fl(s));
            icIndex++;
            break;
          }
          lget(s), i32c(op == JSOp::Inc ? INT32_MAX : INT32_MIN);
          code.put(W_I32EQ);
          code.put(W_IF), code.put(W_VOID);
          emitExit(Bail, pc, icIndex);
          code.put(W_END);
          lget(s), i32c(1), code.put(op == JSOp::Inc ? W_I32ADD : W_I32SUB);
          lset(s);
          icIndex++;
          break;
        }
        case JSOp::Neg: {
          // Int32: 0 and INT32_MIN negate to doubles (-0, 2^31) and bail.
          if (!unaryNum(pc)) return false;
          uint32_t s = slotLocal(top);
          if (st.stack[top] == Ty::Double) {
            lget(fl(s)), code.put(W_F64NEG), lset(fl(s));
            icIndex++;
            break;
          }
          lget(s), code.put(W_I32EQZ);
          lget(s), i32c(INT32_MIN), code.put(W_I32EQ);
          code.put(W_I32OR);
          code.put(W_IF), code.put(W_VOID);
          emitExit(Bail, pc, icIndex);
          code.put(W_END);
          i32c(0), lget(s), code.put(W_I32SUB), lset(s);
          icIndex++;
          break;
        }
        case JSOp::BitNot: {
          if (!toInt32(pc, 1)) return false;
          uint32_t s = slotLocal(top);
          lget(s), i32c(-1), code.put(W_I32XOR), lset(s);
          icIndex++;
          break;
        }
        case JSOp::Pos:
        case JSOp::ToNumeric:
          if (!unaryNum(pc)) return false;
          icIndex++;
          break;
        case JSOp::Not: {
          if (st.depth < 1) return reject("underflow", pc);
          if (!truthy(top, st.stack[top], pc)) return false;
          code.put(W_I32EQZ), lset(slotLocal(top));
          st.stack[top] = Ty::Bool;
          icIndex++;
          break;
        }
        case JSOp::JumpIfFalse:
        case JSOp::JumpIfTrue: {
          if (st.depth < 1) return reject("underflow", pc);
          Ty t = st.stack[top];
          st.depth--;
          icIndex++;
          if (!truthy(top, t, pc)) return false;
          if (op == JSOp::JumpIfFalse) code.put(W_I32EQZ);
          if (!branch(pc, pc + GET_JUMP_OFFSET(pc), next, true)) return false;
          break;
        }
        case JSOp::And:
        case JSOp::Or: {
          // ToBoolean(top); the value stays on the stack on both edges.
          if (st.depth < 1) return reject("underflow", pc);
          jsbytecode* target = pc + GET_JUMP_OFFSET(pc);
          if (target == head) return reject("backedge depth", pc);
          icIndex++;
          if (!truthy(top, st.stack[top], pc)) return false;
          if (op == JSOp::And) code.put(W_I32EQZ);
          if (!branch(pc, target, next, true)) return false;
          break;
        }
        case JSOp::Coalesce: {
          // Jumps unless the value is null or undefined; static here.
          if (st.depth < 1) return reject("underflow", pc);
          Ty t = st.stack[top];
          if (t == Ty::Int || t == Ty::Double || t == Ty::Bool || IsArr(t)) {
            if (!branch(pc, pc + GET_JUMP_OFFSET(pc), next, false)) return false;
          } else if (t != Ty::Undef && t != Ty::Null) {
            return reject("operand type", pc);
          }
          break;
        }
        case JSOp::Goto:
          if (!branch(pc, pc + GET_JUMP_OFFSET(pc), next, false)) return false;
          break;
        case JSOp::GetElem:
          if (!getElem(pc)) return false;
          icIndex++;
          break;
        case JSOp::SetElem:
        case JSOp::StrictSetElem:
          if (!setElem(pc)) return false;
          icIndex++;
          break;
        case JSOp::GetProp:
          if (!AtomIsLength(script, pc)) return reject("GetProp", pc);
          if (!getLength(pc)) return false;
          icIndex++;
          break;
        default:
          return reject(CodeName(op), pc);
      }
      if (code.oom) return reject("oom", pc);
      pc = next;
    }
    if (firstOpen != ntargets) return reject("jump target", end);
    if (st.live) return reject("region end", end);
    code.put(W_END);  // loop
    code.put(W_UNREACHABLE);
    return true;
  }

  // Assemble the module; returns false on reject.
  bool assemble(Buf& m) {
    Buf body;
    body.uleb(3);
    body.uleb(kParams + nvars + kMaxDepth + 1), body.put(0x7f);
    body.uleb(1), body.put(0x7e);
    body.uleb(nvars + kMaxDepth + 1), body.put(0x7c);
    body.putn(code.p, code.n);
    body.put(W_END);
    if (body.oom) return reject("oom", head);

    static const uint8_t header[] = {0, 'a', 's', 'm', 1, 0, 0, 0};
    m.putn(header, sizeof header);
    Buf c;
    c.uleb(1), c.put(0x60), c.uleb(23);
    for (int i = 0; i < 23; i++) c.put(0x7e);
    c.uleb(1), c.put(0x7e);
    m.section(1, c);
    c.uleb(2);
    c.name("env"), c.name("table"), c.put(0x01), c.put(0x70), c.put(0x00),
        c.uleb(0);
    c.name("env"), c.name("memory"), c.put(0x02), c.put(0x03), c.uleb(1),
        c.uleb(65536);
    m.section(2, c);
    c.uleb(1), c.uleb(0);
    m.section(3, c);
    c.uleb(1), c.name("f0"), c.put(0), c.uleb(0);
    m.section(7, c);
    c.uleb(1), c.uleb(uint32_t(body.n)), c.putn(body.p, body.n);
    m.section(10, c);
    if (m.oom || c.oom) return reject("oom", head);
    return true;
  }
};

// Translate one loop. `init` sets up a fresh Compiler for each attempt. If
// numeric types disagreed at a join or around the loop, the variables and
// join slots involved are widened to Double and the loop is translated again.
// Returns the last attempt's Compiler (free with FreeCompiler); `m` holds the
// module when its reason is null.
template <typename Init>
Compiler* TranslateLoop(Init init, Buf& m) {
  Widen w;
  for (int attempt = 0;; attempt++) {
    void* mem = malloc(sizeof(Compiler));
    if (!mem) return nullptr;
    Compiler* c = new (mem) Compiler;
    m.n = 0;
    init(*c);
    c->widen = w;
    c->attempts = uint32_t(attempt + 1);
    if (c->scan() && c->liveness() && c->translate() && c->assemble(m)) return c;
    bool grown = (c->want.vars & ~w.vars) || (c->want.elems & ~w.elems);
    w.vars |= c->want.vars;
    w.elems |= c->want.elems;
    for (uint32_t j = 0; j < kMaxTargets; j++) {
      grown = grown || (c->want.slots[j] & ~w.slots[j]);
      w.slots[j] |= c->want.slots[j];
    }
    if (!grown || attempt == 3) return c;
    c->~Compiler();
    free(c);
  }
}

void FreeCompiler(Compiler* c) {
  if (!c) return;
  c->~Compiler();
  free(c);
}

void LogReject(JSScript* script, const Compiler& c) {
  gRejects.fetch_add(1, std::memory_order_relaxed);
  if (!TakeLog()) return;
  jsbytecode* at = c.reasonPc ? c.reasonPc : c.head;
  fprintf(stderr, "PBLJIT reject %s:%u off=%u at=%u op=%s reason=%s\n",
          script->filename() ? script->filename() : "?", script->lineno(),
          unsigned(c.head - script->code()), unsigned(at - script->code()),
          at < script->codeEnd() ? CodeName(JSOp(*at)) : "-",
          c.reason ? c.reason : "?");
}

void Evict(Entry* e) {
  if (e->fn) {
    syscall(SYS_jit_free, long(e->fn), 1L);
  }
  free(e->bytes);
  memset(e, 0, sizeof *e);
}

bool Install(JSScript* script, jsbytecode* pc, Entry* e, Compiler& c, Buf& m) {
  if (c.reason) {
    LogReject(script, c);
    return false;
  }
  uint32_t idx[1] = {0};
  long rc = syscall(SYS_jit_install, long(uintptr_t(m.p)), long(m.n), 0L,
                    long(uintptr_t(idx)));
  if (rc != 0 || !idx[0]) {
    c.reason = "install failed";
    LogReject(script, c);
    if (TakeLog()) fprintf(stderr, "PBLJIT install rc=%ld bytes=%zu\n", rc, m.n);
    return false;
  }
  size_t len = size_t(c.end - pc);
  e->bytes = static_cast<uint8_t*>(malloc(len));
  if (!e->bytes) {
    syscall(SYS_jit_free, long(idx[0]), 1L);
    return false;
  }
  memcpy(e->bytes, pc, len);
  e->len = uint16_t(len);
  e->nargs = uint16_t(c.maxArg);
  e->fn = idx[0];
  gInstalls.fetch_add(1, std::memory_order_relaxed);
  uint32_t n = gCompiles.fetch_add(1, std::memory_order_relaxed) + 1;
  if (TakeLog()) {
    fprintf(stderr,
            "PBLJIT compile #%u %s:%u off=%u len=%zu ops=%u vars=%u depth=%u "
            "wasm=%zu idx=%u attempts=%u\n",
            n, script->filename() ? script->filename() : "?", script->lineno(),
            unsigned(pc - script->code()), len, c.nops, c.nvars, c.maxDepth,
            m.n, idx[0], c.attempts);
  }
  if ((n & (n - 1)) == 0) {
    fprintf(stderr,
            "PBLJIT stats compiles=%u rejects=%u runs=%u bails=%u\n", n,
            gRejects.load(std::memory_order_relaxed),
            gRuns.load(std::memory_order_relaxed),
            gBails.load(std::memory_order_relaxed));
  }
  return true;
}

bool Compile(JSScript* script, jit::BaselineFrame* frame, jsbytecode* pc,
             Entry* e) {
  if (gInstalls.load(std::memory_order_relaxed) >= kMaxInstalls) return false;
  Buf m;
  Compiler* cp = TranslateLoop(
      [&](Compiler& k) {
        k.script = script;
        k.head = pc;
        k.end = nullptr;
        k.frame = reinterpret_cast<const uint8_t*>(frame);
        if (frame->isFunctionFrame()) {
          k.argv = reinterpret_cast<const uint64_t*>(frame->argv());
          k.nformals = frame->numFormalArgs();
          k.argsAliased = script->argsObjAliasesFormals();
        }
      },
      m);
  if (!cp) return false;
  bool ok = Install(script, pc, e, *cp, m);
  FreeCompiler(cp);
  return ok;
}

}  // namespace

typedef int64_t (*JitFn)(void* frame, void* sp, void* intr, void* out,
                         void* argv);

bool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,
                jsbytecode* pc, JSContext* cx, Exit* exit) {
  Entry* cache = tCache;
  if (MOZ_UNLIKELY(!cache)) {
    if (!Enabled()) return false;
    cache = static_cast<Entry*>(calloc(size_t(1) << kCacheBits, sizeof(Entry)));
    if (!cache) return false;
    tCache = cache;
  }
  uint32_t h = (uint32_t(uintptr_t(pc)) * 2654435761u) >> (32 - kCacheBits);
  Entry* e = &cache[h];
  if (MOZ_UNLIKELY(e->pc != pc)) {
    Evict(e);
    e->pc = pc;
  }
  if (e->state != 1) {
    if (e->state == 2 || ++e->hits < kCompileHits) return false;
    e->state = Compile(script, frame, pc, e) ? 1 : 2;
    if (e->state != 1) return false;
  }
  // Same pc pointer, possibly a different (re-allocated) script: compare.
  if (MOZ_UNLIKELY(pc + e->len > script->codeEnd() ||
                   memcmp(pc, e->bytes, e->len) != 0)) {
    Evict(e);
    e->pc = pc;
    return false;
  }
  // The code was specialized for a frame whose argv has >= nargs unaliased
  // formals; another frame running the same bytecode may not (e.g. eval).
  void* argv = nullptr;
  if (e->nargs) {
    if (!frame->isFunctionFrame() || frame->numFormalArgs() < e->nargs ||
        script->argsObjAliasesFormals())
      return false;
    argv = frame->argv();
  }
  struct {
    uint32_t sp;
    int32_t pcDelta;
    uint32_t icIndex;
  } out;
  int64_t kind = reinterpret_cast<JitFn>(uintptr_t(e->fn))(
      frame, sp, cx->addressOfInterruptBits(), &out, argv);
  if (kind == NoEntry || kind == Bail) {
    gBails.fetch_add(1, std::memory_order_relaxed);
    if (++e->bails >= kMaxBails) {
      syscall(SYS_jit_free, long(e->fn), 1L);
      e->fn = 0;
      e->state = 2;
      if (TakeLog()) {
        fprintf(stderr, "PBLJIT disable %s:%u off=%u after %u bails\n",
                script->filename() ? script->filename() : "?",
                script->lineno(), unsigned(pc - script->code()), kMaxBails);
      }
    }
    if (kind == NoEntry) return false;
  }
  gRuns.fetch_add(1, std::memory_order_relaxed);
  exit->sp = reinterpret_cast<uint64_t*>(uintptr_t(out.sp));
  exit->pcDelta = out.pcDelta;
  exit->icIndex = out.icIndex;
  return true;
}

}  // namespace pbljit
}  // namespace js
