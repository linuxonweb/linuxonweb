/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
// Guest JIT packets 4, 6, 7 and 8: runtime PBL-to-wasm loop specializer
// (adapter source).
//
// Compiled with the same command as PortableBaselineInterpret.cpp and linked
// beside a copy of it whose CASE(LoopHead) calls pbljit::OnLoopHead (see
// tools/build-firefox-pbl-jit.py). Upstream SpiderMonkey files are unchanged.
//
// A hot loop (LoopHead .. its last backedge) whose ops are in the subset
// below is translated into one wasm function. Properly nested numeric loops
// up to depth three share that function; other nested shapes fail closed. The
// function (23 x i64) -> i64 is installed with the private jit_install
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
// unexpected element types bail. Never-replaced PlainObjects support own
// numeric slots behind entry shape guards; tenured global/object constants
// support hoisted identity guards and allocation-free Math operations.
// Cache entries are invalidated on script/major-GC changes and skipped during
// incremental GC. Vars read before being written are type-guarded at entry
// and must keep a converged type at every loop header. Other vars are flushed
// before a backedge forgets their types, and initialized before their next
// use. The code leaves the loop at:
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

#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <pthread.h>

#include <atomic>
#include <new>

#ifdef PBLJIT_HOST_TEST
#  include "host-test/mock.h"  // host emitter test (tools/pbl-jit/host-test)
#else
#  include "jit/BaselineFrame.h"
#  include "jit/InlinableNatives.h"
#  include "js/experimental/JitInfo.h"
#  include "gc/GCRuntime.h"
#  include "vm/GlobalObject.h"
#  include "vm/EnvironmentObject.h"
#  include "vm/JSFunction.h"
#  include "vm/PlainObject.h"
#  include "vm/Runtime.h"
#  include "vm/Watchtower.h"
#  include "vm/JSAtomUtils-inl.h"
#  include "vm/ArrayObject.h"
#  include "vm/BytecodeUtil.h"
#  include "vm/JSContext.h"
#  include "vm/JSScript.h"
#  include "vm/Opcodes.h"
#  include "vm/StringType.h"
#endif

namespace js {
namespace pbljit {

// A complete observation is one append transaction even when stdout shares fd2.
// Stdio retains its stderr lock; a short write is never retried as a remainder.
void PrintObservation(const char* failure, const char* format, ...)
    __attribute__((format(printf, 2, 3)));
void PrintObservation(const char* failure, const char* format, ...) {
  const int savedErrno = errno;
  char line[4096];
  va_list args;
  va_start(args, format);
  int length = vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  flockfile(stderr);
  if (length >= 0 && size_t(length) < sizeof(line)) {
    ssize_t written;
    do {
      written = syscall(SYS_write, long(STDERR_FILENO), long(uintptr_t(line)), long(length), 0L, 0L, 0L);
    } while (written < 0 && errno == EINTR);
    if (written == length) {
      funlockfile(stderr);
      errno = savedErrno;
      return;
    }
  }
  // Existing exhausted-family sentinels reject incomplete native evidence.
  ssize_t written;
  do {
    written = syscall(SYS_write, long(STDERR_FILENO), long(uintptr_t(failure)), long(strlen(failure)), 0L, 0L, 0L);
  } while (written < 0 && errno == EINTR);
  funlockfile(stderr);
  errno = savedErrno;
  if (written != ssize_t(strlen(failure))) abort();
}

void ObserveLocation(const char* filename, unsigned line, unsigned off, JSContext* cx,
                     const char* event, uint32_t fn, int64_t kind = -1,
                     uint32_t sp = 0, int32_t delta = 0, uint32_t ic = 0);

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
constexpr uint32_t kMaxLoops = 8;
constexpr uint32_t kMaxLoopNesting = 3;
constexpr uint32_t kMaxDepth = 16;
constexpr uint32_t kMaxInstalls = 4000;

enum Kind : int64_t { NoEntry = 0, Normal = 1, Bail = 2, Interrupt = 3 };

struct Entry {
  const jsbytecode* pc;
  JSScript* script;
  uint64_t majorGC;
  uint32_t global;
  uint8_t* bytes;
  uint32_t hits;
  uint32_t fn;
  uint16_t len;
  uint16_t nargs;  // arguments the code reads or writes (argv slots)
  uint8_t state;  // 0 counting, 1 compiled, 2 rejected
  uint8_t bails;
};

thread_local Entry* tCache;

#include "PblCacheObserve.h"

uint32_t CacheIndex(JSScript* script, const jsbytecode* pc) {
  // Firefox shares immutable bytecode between scripts with different atoms.
  // Include the script so those scripts do not continually evict each other.
  uint32_t h = uint32_t(uintptr_t(script)) * 2654435761u ^
               uint32_t(uintptr_t(pc));
  h ^= h >> 16;
  h *= 0x7feb352du;
  h ^= h >> 15;
  h *= 0x846ca68bu;
  h ^= h >> 16;
  return h >> (32 - kCacheBits);
}

std::atomic<uint32_t> gInstalls{0};
std::atomic<uint32_t> gCompiles{0};
std::atomic<uint32_t> gRejects{0};
std::atomic<uint32_t> gRuns{0};
std::atomic<uint32_t> gBails{0};
std::atomic<int> gLogBudget{-1};
std::atomic<bool> gLogEnabled{false};
std::atomic<int> gEnabled{-1};

bool Enabled() {
  int e = gEnabled.load(std::memory_order_relaxed);
  if (e < 0) {
    const char* v = getenv("PBLJIT");
    e = (v && v[0] == '0') ? 0 : 1;
    const char* l = getenv("PBLJIT_LOG");
    const int logBudget = l ? atoi(l) : 24;
    gLogBudget.store(logBudget, std::memory_order_relaxed);
    gLogEnabled.store(logBudget > 0, std::memory_order_relaxed);
    gEnabled.store(e, std::memory_order_relaxed);
    if (e && logBudget > 0) {
      fprintf(stderr, "PBLJIT enabled (threshold=%u, logBudget=%d)\n", kCompileHits, logBudget);
    }
  }
  return e != 0;
}

bool TakeLog() {
  return gLogEnabled.load(std::memory_order_relaxed) &&
         gLogBudget.fetch_sub(1, std::memory_order_relaxed) > 0;
}

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
  W_F64CEIL = 0x9b, W_F64FLOOR = 0x9c, W_F64TRUNC = 0x9d,
  W_F64SQRT = 0x9f, W_F64MIN = 0xa4, W_F64MAX = 0xa5, W_F64COPYSIGN = 0xa6,
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
constexpr bool IsArr(Ty t) { return uint8_t(t) >= 16 && uint8_t(t) < 48; }
constexpr bool IsObj(Ty t) { return uint8_t(t) >= 48 && uint8_t(t) < 80; }
constexpr bool IsConst(Ty t) { return uint8_t(t) >= 80 && uint8_t(t) < 96; }
constexpr bool IsObject(Ty t) { return IsArr(t) || IsObj(t) || IsConst(t); }
constexpr Ty ObjTy(uint32_t v) { return Ty(48 + v); }
constexpr uint32_t ObjVar(Ty t) { return uint8_t(t) - 48u; }
constexpr Ty ConstTy(uint32_t v) { return Ty(80 + v); }
constexpr uint32_t ConstIndex(Ty t) { return uint8_t(t) - 80u; }
constexpr Ty ArrTy(uint32_t v) { return Ty(16 + v); }
constexpr uint32_t ArrVar(Ty t) { return uint8_t(t) - 16u; }
constexpr uint32_t TagOf(Ty t) { return IsObject(t) ? kTagObject : 0xFFFFFF80u | uint32_t(t); }
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

// Compile-time descriptors hold only raw pointers. Compilation and generated
// loops never call JS or allocate GC things; entries are discarded before any
// major GC changes. Embedded object constants must additionally be tenured.
struct ObjectInfo {
  uint32_t pointer = 0, shape = 0;
  bool plain = false, canWrite = false, tenured = false;
};
struct SlotInfo {
  uint32_t offset = 0;
  bool dynamic = false, writable = false;
  uint64_t bits = 0;
};
enum class MathOp : uint8_t { None, Max, Min, Abs, Floor, Ceil, Round, Sqrt, Trunc };
struct Constant {
  ObjectInfo object;
  MathOp math = MathOp::None;
};
struct ConstantGuard {
  ObjectInfo holder;
  SlotInfo slot;
  bool hasSlot = false;
};
#ifdef PBLJIT_HOST_TEST
bool InspectObject(uint32_t pointer, ObjectInfo& info) { return MockInspectObject(pointer, info); }
bool LookupSlot(uint32_t pointer, JSScript*, jsbytecode* pc, SlotInfo& slot) {
  return MockLookupSlot(pointer, rd(pc + 1, 4), slot);
}
bool GlobalSlot(JSContext* cx, JSScript*, jsbytecode* pc, ObjectInfo& lex,
                ObjectInfo& global, ObjectInfo& holder, SlotInfo& slot) {
  return MockGlobalSlot(cx, rd(pc + 1, 4), lex, global, holder, slot);
}
MathOp IdentifyMath(uint32_t pointer) { return MathOp(MockIdentifyMath(pointer)); }
int32_t OffSlots() { return 4; }
uint64_t MajorGC(JSContext* cx) { return cx->majorGC; }
bool IncrementalGC(JSContext* cx) { return cx->incrementalGC; }
uint32_t CurrentGlobal(JSContext* cx) { return cx->global; }
#else
bool InspectObject(uint32_t pointer, ObjectInfo& info) {
  JSObject* obj = reinterpret_cast<JSObject*>(uintptr_t(pointer));
  if (!obj->is<NativeObject>()) return false;
  NativeObject& n = obj->as<NativeObject>();
  // Dictionary property maps can be edited in place; a shape pointer alone
  // cannot prove their slot mapping and permissions remain unchanged.
  if (n.inDictionaryMode()) return false;
  info.pointer = pointer;
  info.shape = uint32_t(uintptr_t(obj->shape()));
  info.plain = obj->is<PlainObject>();
  info.canWrite = info.plain && !Watchtower::watchesPropertyModification(&n);
  info.tenured = obj->isTenured();
  return true;
}
bool LookupSlot(uint32_t pointer, JSScript* script, jsbytecode* pc, SlotInfo& slot) {
  NativeObject& obj = reinterpret_cast<JSObject*>(uintptr_t(pointer))->as<NativeObject>();
  auto p = obj.lookupPure(AtomToId(script->getAtom(pc)));
  if (!p || !p->isDataProperty() || !p->hasSlot()) return false;
  uint32_t index = p->slot();
  slot.dynamic = !obj.isFixedSlot(index);
  slot.offset = uint32_t(slot.dynamic ? obj.dynamicSlotIndex(index) * sizeof(Value)
                                    : NativeObject::getFixedSlotOffset(index));
  slot.writable = p->writable();
  slot.bits = obj.getSlot(index).asRawBits();
  return true;
}
bool GlobalSlot(JSContext* cx, JSScript* script, jsbytecode* pc, ObjectInfo& lex,
                ObjectInfo& global, ObjectInfo& holder, SlotInfo& slot) {
  if (!cx || script->hasNonSyntacticScope()) return false;
  GlobalObject* g = cx->global().get();
  auto* l = &g->lexicalEnvironment();
  if (!InspectObject(uint32_t(uintptr_t(g)), global) ||
      !InspectObject(uint32_t(uintptr_t(l)), lex)) return false;
  if (LookupSlot(lex.pointer, script, pc, slot)) {
    holder = lex;
    return true;
  }
  // A lexical accessor/custom property must not fall through to the global.
  if (l->lookupPure(AtomToId(script->getAtom(pc)))) return false;
  holder = global;
  return LookupSlot(global.pointer, script, pc, slot);
}
MathOp IdentifyMath(uint32_t pointer) {
  JSObject* obj = reinterpret_cast<JSObject*>(uintptr_t(pointer));
  if (!obj->is<JSFunction>()) return MathOp::None;
  JSFunction& f = obj->as<JSFunction>();
  if (!f.isNativeFun() || !f.hasJitInfo()) return MathOp::None;
  auto* info = f.jitInfo();
  if (info->type() != JSJitInfo::InlinableNative) return MathOp::None;
  switch (info->inlinableNative) {
    case jit::InlinableNative::MathMax: return MathOp::Max;
    case jit::InlinableNative::MathMin: return MathOp::Min;
    case jit::InlinableNative::MathAbs: return MathOp::Abs;
    case jit::InlinableNative::MathFloor: return MathOp::Floor;
    case jit::InlinableNative::MathCeil: return MathOp::Ceil;
    case jit::InlinableNative::MathRound: return MathOp::Round;
    case jit::InlinableNative::MathSqrt: return MathOp::Sqrt;
    case jit::InlinableNative::MathTrunc: return MathOp::Trunc;
    default: return MathOp::None;
  }
}
int32_t OffSlots() { return int32_t(NativeObject::offsetOfSlots()); }
uint64_t MajorGC(JSContext* cx) { return cx->runtime()->gc.majorGCCount(); }
bool IncrementalGC(JSContext* cx) { return cx->runtime()->gc.isIncrementalGCInProgress(); }
uint32_t CurrentGlobal(JSContext* cx) { return uint32_t(uintptr_t(cx->global().get())); }
#endif

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

// Lexically nested natural loops. The entry state is checked against every
// compiled backedge, including a continue from a descendant loop.
struct Loop {
  jsbytecode* head = nullptr;
  jsbytecode* end = nullptr;
  uint32_t parent = 0, depth = 1, liveMask = 0, ic = 0;
  State entry;
};
struct Label {
  bool loop;
  uint32_t index;
};

struct Compiler {
  JSScript* script;
  JSContext* cx = nullptr;
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
  ObjectInfo objects[kMaxVars];
  bool objectWrites[kMaxVars] = {};
  Constant constants[16];
  uint32_t nconstants = 0;
  ConstantGuard guards[48];
  uint32_t nguards = 0;
  size_t guardInsertion = 0;
  Ty elemTy[kMaxVars];  // for Array vars: Int, Double or Unknown
  uint32_t maxArg = 0;  // 1 + highest argument index used
  // Forward targets, ascending. Each block opens inside its owning loop;
  // ancestor exit blocks surround all descendant loops.
  uint32_t ntargets = 0;
  jsbytecode* targetPc[kMaxTargets];
  State targetSt[kMaxTargets];
  uint32_t targetOwner[kMaxTargets];
  uint32_t nloops = 0;
  Loop loops[kMaxLoops] = {};
  Label labels[kMaxTargets + kMaxLoops];
  uint32_t nlabels = 0, nactive = 0, active[kMaxLoops];
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

  int findLoop(const jsbytecode* pc) const {
    for (uint32_t i = 0; i < nloops; i++)
      if (loops[i].head == pc) return int(i);
    return -1;
  }
  // Every explicit Wasm label is tracked; temporary IFs are passed as extra.
  int labelDepth(bool loop, uint32_t index, uint32_t extra = 0) const {
    for (uint32_t i = nlabels; i > 0; i--)
      if (labels[i - 1].loop == loop && labels[i - 1].index == index)
        return int(nlabels - i + extra);
    return -1;
  }
  bool beginLoop(uint32_t i, jsbytecode* pc) {
    Loop& l = loops[i];
    if (st.live) {
      if (st.depth) return reject("loop entry depth", pc);
      for (uint32_t v = 0; v < nvars; v++) {
        if (st.var[v] == Ty::Head && (l.liveMask >> v & 1))
          return reject("loop entry read", pc);
        if (nloops > 1 && st.var[v] != Ty::Head && !IsNum(st.var[v]))
          return reject("nested variable type", pc);
      }
    }
    l.entry = st;
    active[nactive++] = i;
    code.put(W_LOOP), code.put(W_VOID);
    labels[nlabels++] = {true, i};
    // Latest target is outermost so the earliest one closes first.
    for (uint32_t j = ntargets; j > 0; j--) {
      if (targetOwner[j - 1] != i) continue;
      code.put(W_BLOCK), code.put(W_VOID);
      labels[nlabels++] = {false, j - 1};
    }
    return true;
  }
  bool closeLoops(jsbytecode* pc) {
    while (nactive && loops[active[nactive - 1]].end == pc) {
      uint32_t i = active[--nactive];
      if (!nlabels || !labels[nlabels - 1].loop || labels[nlabels - 1].index != i)
        return reject("loop label", pc);
      code.put(W_END);
      nlabels--;
    }
    return true;
  }
  // Concrete header types must converge on every incoming backedge. A Head
  // variable is dead at that header; flush its value before forgetting it.
  bool checkBackedge(jsbytecode* pc, uint32_t i) {
    if (st.depth != 0) return reject("backedge depth", pc);
    const State& entry = loops[i].entry;
    if (!entry.live) return reject("loop entry", pc);
    bool same = true;
    for (uint32_t v = 0; v < nvars; v++) {
      Ty t = entry.var[v];
      if (t == Ty::Head || st.var[v] == t) continue;
      same = false;
      if (mixed(st.var[v], t)) want.vars |= 1u << v;
    }
    return same || reject("backedge type", pc);
  }
  void emitBackedge(uint32_t i, uint32_t nest) {
    const Loop& l = loops[i];
    lget(P_INTR);
    code.put(W_ATOMIC), code.put(W_I32ATOMICLOAD), code.uleb(2), code.uleb(0);
    code.put(W_IF), code.put(W_VOID);
    emitExit(Interrupt, l.head, l.ic);
    code.put(W_END);
    for (uint32_t v = 0; v < nvars; v++) {
      if (l.entry.var[v] == Ty::Head && st.var[v] != Ty::Head) {
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

  // This first nested-loop tier deliberately excludes objects, arrays, calls,
  // allocations, lexical checks and exception operations. Single-loop coverage
  // remains unchanged. Booleans may be temporary comparison/branch operands.
  static bool nestedOp(JSOp op) {
    switch (op) {
      case JSOp::LoopHead: case JSOp::JumpTarget:
      case JSOp::Nop: case JSOp::NopIsAssignOp: case JSOp::DebugLeaveLexicalEnv:
      case JSOp::Zero: case JSOp::One: case JSOp::Int8: case JSOp::Uint16:
      case JSOp::Uint24: case JSOp::Int32: case JSOp::Double:
      case JSOp::True: case JSOp::False:
      case JSOp::GetLocal: case JSOp::SetLocal: case JSOp::InitLexical:
      case JSOp::Pop: case JSOp::Dup: case JSOp::Dup2: case JSOp::Swap:
      case JSOp::Add: case JSOp::Sub: case JSOp::Mul: case JSOp::Div: case JSOp::Mod:
      case JSOp::BitOr: case JSOp::BitAnd: case JSOp::BitXor:
      case JSOp::Lsh: case JSOp::Rsh: case JSOp::Ursh:
      case JSOp::Eq: case JSOp::Ne: case JSOp::StrictEq: case JSOp::StrictNe:
      case JSOp::Lt: case JSOp::Le: case JSOp::Gt: case JSOp::Ge:
      case JSOp::Inc: case JSOp::Dec: case JSOp::Neg: case JSOp::BitNot:
      case JSOp::Pos: case JSOp::ToNumeric: case JSOp::Not:
      case JSOp::Goto: case JSOp::JumpIfFalse: case JSOp::JumpIfTrue:
      case JSOp::And: case JSOp::Or:
        return true;
      default:
        return false;
    }
  }

  // Pass 1: discover the outer region, all natural-loop intervals and edges.
  // Requiring laminar intervals and header-only entry makes the lexical Wasm
  // structure faithful to the bytecode CFG. Unsupported shapes never install.
  bool scan() {
    jsbytecode* body = head + JSOpLength_LoopHead;
    jsbytecode* limit = script->codeEnd();
    if (limit - head > int32_t(kMaxRegion)) limit = head + kMaxRegion;
    end = nullptr;
    for (jsbytecode* pc = body; pc < limit;) {
      JSOp op = JSOp(*pc);
      jsbytecode* next = pc + GetBytecodeLength(pc);
      if (next > limit) break;
      if ((op == JSOp::Goto || op == JSOp::JumpIfTrue || op == JSOp::JumpIfFalse) &&
          pc + GET_JUMP_OFFSET(pc) == head)
        end = next;
      pc = next;
    }
    if (!end) return reject("region size", body);
    bool boundary[kMaxRegion] = {};
    for (jsbytecode* pc = head; pc < end; pc += GetBytecodeLength(pc)) {
      boundary[pc - head] = true;
      if (JSOp(*pc) != JSOp::LoopHead) continue;
      if (nloops == kMaxLoops) return reject("loop count", pc);
      loops[nloops].head = pc;
      loops[nloops++].ic = uint32_t(GET_INT32(pc));
    }
    for (jsbytecode* pc = body; pc < end; pc += GetBytecodeLength(pc)) {
      JSOp op = JSOp(*pc);
      if (!isJump(op)) continue;
      jsbytecode* t = pc + GET_JUMP_OFFSET(pc);
      if (t < head || t >= end) continue;
      if (!boundary[t - head]) return reject("jump target", pc);
      if (t > pc) continue;
      int i = findLoop(t);
      if (i < 0 || (op != JSOp::Goto && op != JSOp::JumpIfTrue && op != JSOp::JumpIfFalse))
        return reject("backward jump", pc);
      loops[i].end = pc + GetBytecodeLength(pc);
    }
    for (uint32_t i = 0; i < nloops; i++) {
      Loop& l = loops[i];
      if (!l.end) return reject("loop without backedge", l.head);
      if (!i) continue;
      uint32_t parent = 0;
      for (uint32_t j = 0; j < i; j++) {
        const Loop& p = loops[j];
        if (l.head >= p.end) continue;
        if (l.end >= p.end) return reject("crossing loops", l.head);
        parent = j;
      }
      l.parent = parent;
      l.depth = loops[parent].depth + 1;
      if (l.depth > kMaxLoopNesting) return reject("loop nesting", l.head);
    }
    for (jsbytecode* pc = body; pc < end; pc += GetBytecodeLength(pc)) {
      JSOp op = JSOp(*pc);
      if (nloops > 1 && !nestedOp(op)) return reject("nested opcode", pc);
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
            if (t < head || t >= end) break;
            for (uint32_t i = 1; i < nloops; i++) {
              const Loop& l = loops[i];
              if (t > l.head && t < l.end && (pc < l.head || pc >= l.end))
                return reject("loop side entry", pc);
            }
            if (t <= pc) {
              int i = findLoop(t);
              if (i < 0 || pc >= loops[i].end) return reject("backward jump", pc);
              break;
            }
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
    for (uint32_t j = 0; j < ntargets; j++) {
      uint32_t owner = 0;
      for (uint32_t i = 1; i < nloops; i++)
        if (loops[i].head < targetPc[j] && targetPc[j] < loops[i].end) owner = i;
      targetOwner[j] = owner;
    }
    return true;
  }

  // Pass 2: backwards fixed-point liveness over the complete CFG, including
  // each inner/outer backedge. The bitvector equation is use | (out & ~def).
  // External edges leave the region and need no Wasm-local input state.
  bool liveness() {
    uint32_t in[kMaxRegion] = {};
    jsbytecode* pcs[kMaxRegion];
    uint32_t count = 0;
    for (jsbytecode* pc = head; pc < end; pc += GetBytecodeLength(pc)) pcs[count++] = pc;
    bool changed = true;
    for (uint32_t pass = 0; changed; pass++) {
      if (pass > count) return reject("liveness convergence", head);
      changed = false;
      for (uint32_t n = count; n > 0; n--) {
        jsbytecode* pc = pcs[n - 1];
        JSOp op = JSOp(*pc);
        jsbytecode* next = pc + GetBytecodeLength(pc);
        uint32_t live = op != JSOp::Goto && next < end ? in[next - head] : 0;
        if (isJump(op)) {
          jsbytecode* t = pc + GET_JUMP_OFFSET(pc);
          if (t >= head && t < end) live |= in[t - head];
        }
        if (op == JSOp::SetLocal || op == JSOp::InitLexical || op == JSOp::SetArg)
          live &= ~(1u << findVar(keyOf(pc)));
        if (op == JSOp::GetLocal || op == JSOp::GetArg)
          live |= 1u << findVar(keyOf(pc));
        if (in[pc - head] != live) { in[pc - head] = live; changed = true; }
      }
    }
    for (uint32_t i = 0; i < nloops; i++) loops[i].liveMask = in[loops[i].head - head];
    for (uint32_t v = 0; v < nvars; v++) varLive[v] = (in[0] >> v & 1) != 0;
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
      if (nloops > 1 && !IsNum(TyOfTag(uint32_t(bits >> 32))))
        return reject("nested variable type", head);
      if (uint32_t(bits >> 32) == kTagObject) {
        // An Array the loop never replaces: its local holds the pointer.
        int kind = ArrayKind(bits);
        if (kind < 0) {
          if (!InspectObject(uint32_t(bits), objects[v]) || !objects[v].plain)
            return reject("head type", head);
          if (varWritten[v]) return reject("object var written", head);
          headTy[v] = ObjTy(v);
          continue;
        }
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
        if (IsObject(t)) {
          i32c(1);
          return true;
        }
        return reject("operand type", pc);
    }
  }

  // A jump to `target`; with `cond` the i32 condition is on the wasm stack.
  bool branch(jsbytecode* pc, jsbytecode* target, jsbytecode* next, bool cond) {
    int loop = target <= pc ? findLoop(target) : -1;
    if (loop >= 0) {
      int nest = labelDepth(true, uint32_t(loop), cond ? 1 : 0);
      if (nest < 0) return reject("loop label", pc);
      if (!checkBackedge(pc, uint32_t(loop))) return false;
      if (cond) {
        code.put(W_IF), code.put(W_VOID);
        emitBackedge(uint32_t(loop), uint32_t(nest));
        code.put(W_END);
        if (next == end) {
          // Fallthrough of the final conditional backedge leaves the loop.
          emitExit(Normal, next, icIndex);
          st.live = false;
        }
      } else {
        emitBackedge(uint32_t(loop), uint32_t(nest));
        st.live = false;
      }
      return true;
    }
    int j = findTarget(target);
    if (j >= 0) {
      if (uint32_t(j) < firstOpen) return reject("backward jump", pc);
      if (!edge(uint32_t(j), pc)) return false;
      int nest = labelDepth(false, uint32_t(j));
      if (nest < 0) return reject("target label", pc);
      code.put(cond ? W_BRIF : W_BR), code.uleb(uint32_t(nest));
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

  bool addGuard(const ObjectInfo& holder, const SlotInfo* slot, jsbytecode* pc) {
    // Holders are embedded in wasm constants, so nursery pointers are unsafe.
    if (!holder.tenured) return reject("nursery constant", pc);
    for (uint32_t i = 0; i < nguards; i++) {
      auto& g = guards[i];
      if (g.holder.pointer == holder.pointer && g.hasSlot == bool(slot) &&
          (!slot || (g.slot.dynamic == slot->dynamic && g.slot.offset == slot->offset)))
        return true;
    }
    if (nguards >= 48) return reject("constant guards", pc);
    auto& g = guards[nguards++];
    g.holder = holder;
    g.hasSlot = bool(slot);
    if (slot) g.slot = *slot;
    return true;
  }
  int addConstant(uint32_t pointer, jsbytecode* pc) {
    for (uint32_t i = 0; i < nconstants; i++)
      if (constants[i].object.pointer == pointer) return int(i);
    if (nconstants >= 16) { reject("constants", pc); return -1; }
    ObjectInfo object;
    if (!InspectObject(pointer, object) || !object.tenured) {
      reject("constant object", pc); return -1;
    }
    if (!addGuard(object, nullptr, pc)) return -1;
    uint32_t i = nconstants++;
    constants[i].object = object;
    constants[i].math = IdentifyMath(pointer);
    return int(i);
  }
  void noEntryIf() {
    code.put(W_IF), code.put(W_VOID);
    i64c(NoEntry), code.put(W_RETURN);
    code.put(W_END);
  }
  // An object's address is on the wasm stack. Produces the slot address.
  void slotAddress(const SlotInfo& slot) {
    if (slot.dynamic) load32(OffSlots());
    i32c(int32_t(slot.offset)), code.put(W_I32ADD);
  }
  void constantEntryGuards() {
    // Reject aliases of every constant holder before mutations. A head object
    // with the expected shape can still be the global/Math holder itself.
    for (uint32_t v = 0; v < nvars; v++) {
      if (!objectWrites[v]) continue;
      for (uint32_t i = 0; i < nguards; i++) {
        lget(varLocal(v)), i32c(int32_t(guards[i].holder.pointer));
        code.put(W_I32EQ), noEntryIf();
      }
    }
    for (uint32_t i = 0; i < nguards; i++) {
      auto& g = guards[i];
      i32c(int32_t(g.holder.pointer)), load32(OffShape());
      i32c(int32_t(g.holder.shape)), code.put(W_I32NE);
      noEntryIf();
      if (!g.hasSlot) continue;
      i32c(int32_t(g.holder.pointer)), slotAddress(g.slot);
      code.put(W_I64LOAD), code.uleb(3), code.uleb(0);
      i64c(int64_t(g.slot.bits)), code.put(W_I64NE);
      noEntryIf();
    }
  }
  bool getGlobal(jsbytecode* pc) {
    ObjectInfo lexical, global, holder;
    SlotInfo slot;
    if (!GlobalSlot(cx, script, pc, lexical, global, holder, slot))
      return reject("global binding", pc);
    // Guard lexical absence as well as the global mapping/value: adding a
    // lexical binding can shadow a global while preserving the global shape.
    if (!addGuard(lexical, nullptr, pc) || !addGuard(global, nullptr, pc) ||
        !addGuard(holder, &slot, pc)) return false;
    Ty t = TyOfTag(uint32_t(slot.bits >> 32));
    if (uint32_t(slot.bits >> 32) == kTagObject) {
      int index = addConstant(uint32_t(slot.bits), pc);
      if (index < 0 || !push(ConstTy(uint32_t(index)), pc)) return false;
      i32c(int32_t(uint32_t(slot.bits))), lset(slotLocal(st.depth - 1));
      return true;
    }
    if (!IsNum(t)) return reject("global type", pc);
    if (!push(t, pc)) return false;
    if (t == Ty::Int) i32c(int32_t(slot.bits)), lset(slotLocal(st.depth - 1));
    else {
      double value; memcpy(&value, &slot.bits, 8);
      f64c(value), lset(fl(slotLocal(st.depth - 1)));
    }
    return true;
  }
  bool objectFor(Ty t, ObjectInfo& object) {
    if (IsObj(t)) { object = objects[ObjVar(t)]; return true; }
    if (IsConst(t)) { object = constants[ConstIndex(t)].object; return true; }
    return false;
  }
  // The boxed value is in tmp64. Check it and place the number in f64 local
  // `dest`. The interpreter stack stays untouched until the guard succeeds.
  void unboxNumber(uint32_t dest, jsbytecode* pc) {
    lget(tmp64()), i64c(32), code.put(W_I64SHRU), code.put(W_I32WRAP);
    code.put(W_LTEE), code.uleb(tmp32());
    i32c(int32_t(TagOf(Ty::Int))), code.put(W_I32EQ);
    code.put(W_IF), code.put(W_VOID);
    lget(tmp64()), code.put(W_I32WRAP), code.put(W_F64CONVI32S), lset(dest);
    code.put(W_ELSE);
    lget(tmp32()), i32c(int32_t(kTagClear)), code.put(W_I32GTU);
    bailIf(pc);
    lget(tmp64()), code.put(W_F64REINTI64), lset(dest);
    code.put(W_END);
  }
  bool getProperty(jsbytecode* pc) {
    if (st.depth < 1) return reject("underflow", pc);
    uint32_t s = st.depth - 1;
    Ty receiver = st.stack[s];
    ObjectInfo object;
    SlotInfo slot;
    if (!objectFor(receiver, object) || !LookupSlot(object.pointer, script, pc, slot))
      return reject("own data property", pc);
    if (IsConst(receiver) && uint32_t(slot.bits >> 32) == kTagObject) {
      if (!addGuard(object, &slot, pc)) return false;
      int index = addConstant(uint32_t(slot.bits), pc);
      if (index < 0) return false;
      i32c(int32_t(uint32_t(slot.bits))), lset(slotLocal(s));
      st.stack[s] = ConstTy(uint32_t(index));
      return true;
    }
    if (!IsNum(TyOfTag(uint32_t(slot.bits >> 32))))
      return reject("property type", pc);
    lget(slotLocal(s)), slotAddress(slot);
    code.put(W_I64LOAD), code.uleb(3), code.uleb(0);
    lset(tmp64());
    unboxNumber(fl(slotLocal(s)), pc);
    st.stack[s] = Ty::Double;
    return true;
  }
  bool setProperty(jsbytecode* pc) {
    if (st.depth < 2) return reject("underflow", pc);
    uint32_t s = st.depth - 2;
    Ty receiver = st.stack[s], value = st.stack[s + 1];
    ObjectInfo object;
    SlotInfo slot;
    if (!IsObj(receiver) || !IsNum(value) || !objectFor(receiver, object) ||
        !object.canWrite || !LookupSlot(object.pointer, script, pc, slot) ||
        !slot.writable) return reject("writable own property", pc);
    if (!IsNum(TyOfTag(uint32_t(slot.bits >> 32))))
      return reject("property type", pc);
    objectWrites[ObjVar(receiver)] = true;
    // Only overwrite a number, so no pre-barrier or post-barrier is needed.
    // This test executes before the store and bails with the original operands.
    lget(slotLocal(s)), slotAddress(slot);
    code.put(W_I64LOAD), code.uleb(3), code.uleb(0);
    lset(tmp64());
    lget(tmp64()), i64c(32), code.put(W_I64SHRU), code.put(W_I32WRAP);
    code.put(W_LTEE), code.uleb(tmp32());
    i32c(int32_t(kTagClear)), code.put(W_I32GTU);
    lget(tmp32()), i32c(int32_t(TagOf(Ty::Int))), code.put(W_I32NE);
    code.put(W_I32AND), bailIf(pc);
    lget(slotLocal(s)), slotAddress(slot);
    boxStore(slotLocal(s + 1), value);
    move(slotLocal(s + 1), slotLocal(s), value);
    st.depth--;
    st.stack[s] = value;
    return true;
  }
  bool mathCall(jsbytecode* pc) {
    uint32_t argc = GET_ARGC(pc);
    if (argc + 2 > st.depth) return reject("underflow", pc);
    uint32_t s = st.depth - argc - 2;
    if (!IsConst(st.stack[s])) return reject("constant callee", pc);
    MathOp math = constants[ConstIndex(st.stack[s])].math;
    if (math == MathOp::None) return reject("Math native", pc);
    // Every argument must already be a number; no ToNumber can invoke JS.
    for (uint32_t i = s + 2; i < st.depth; i++)
      if (!IsNum(st.stack[i])) return reject("Math argument", pc);
    uint32_t result = fl(slotLocal(s));
    if (math == MathOp::Max || math == MathOp::Min) {
      f64c(math == MathOp::Max ? -__builtin_inf() : __builtin_inf());
      for (uint32_t i = s + 2; i < st.depth; i++) {
        getNum(slotLocal(i), st.stack[i]);
        code.put(math == MathOp::Max ? W_F64MAX : W_F64MIN);
      }
      lset(result);
    } else {
      if (argc) getNum(slotLocal(s + 2), st.stack[s + 2]);
      else f64c(__builtin_nan(""));
      switch (math) {
        case MathOp::Abs: code.put(W_F64ABS); break;
        case MathOp::Floor: code.put(W_F64FLOOR); break;
        case MathOp::Ceil: code.put(W_F64CEIL); break;
        case MathOp::Sqrt: code.put(W_F64SQRT); break;
        case MathOp::Trunc: code.put(W_F64TRUNC); break;
        case MathOp::Round: {
          // floor(x+0.5) loses precision just below a tie and for large x.
          // Use the fraction of floor(x), preserve -0 with copysign, and keep
          // all |x|>=2^52 (including Infinity) unchanged.
          lset(result);
          lget(result), code.put(W_F64ABS), f64c(4503599627370496.0), code.put(W_F64LT);
          code.put(W_IF), code.put(W_VOID);
          lget(result), code.put(W_F64FLOOR), lset(fl(tmp32()));
          lget(result), lget(fl(tmp32())), code.put(W_F64SUB), f64c(0.5), code.put(W_F64GE);
          code.put(W_IF), code.put(W_VOID);
          lget(fl(tmp32())), f64c(1.0), code.put(W_F64ADD), lset(fl(tmp32()));
          code.put(W_END);
          lget(fl(tmp32())), lget(result), code.put(W_F64COPYSIGN), lset(result);
          code.put(W_END);
          break;
        }
        default: MOZ_CRASH("pbljit math");
      }
      if (math != MathOp::Round) lset(result);
    }
    st.depth = s + 1;
    st.stack[s] = Ty::Double;
    return true;
  }

  // Pass 3: translate. Loop labels follow the natural-loop tree, and
  // forward-target blocks open in the closest enclosing loop.
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
      if (IsObject(headTy[v])) {
        // Objects are guarded before the loop makes any mutations.
        i32c(int32_t(kTagObject)), code.put(W_I32NE);
        code.put(W_IF), code.put(W_VOID);
        i64c(NoEntry), code.put(W_RETURN);
        code.put(W_END);
        lget(tmp64()), code.put(W_I32WRAP), code.put(W_LTEE), code.uleb(varLocal(v));
        load32(OffShape());
        if (IsArr(headTy[v])) {
          load32(OffBase()), load32(OffClasp());
          i32c(int32_t(ArrayClasp()));
        } else {
          i32c(int32_t(objects[v].shape));
        }
        code.put(W_I32NE);
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
    guardInsertion = code.n;
    if (!beginLoop(0, head)) return false;

    headIc = uint32_t(GET_INT32(head));
    icIndex = headIc;
    jsbytecode* pc = head + JSOpLength_LoopHead;
    while (pc < end) {
      if (!closeLoops(pc)) return false;
      if (firstOpen < ntargets && targetPc[firstOpen] <= pc) {
        if (targetPc[firstOpen] != pc) return reject("jump target", pc);
        if (st.live && !edge(firstOpen, pc)) return false;  // fallthrough edge
        if (!nlabels || labels[nlabels - 1].loop || labels[nlabels - 1].index != firstOpen)
          return reject("target label", pc);
        code.put(W_END);
        nlabels--;
        st = targetSt[firstOpen++];
      }
      JSOp op = JSOp(*pc);
      jsbytecode* next = pc + GetBytecodeLength(pc);
      if (op == JSOp::LoopHead) {
        int i = findLoop(pc);
        if (i < 0 || !beginLoop(uint32_t(i), pc)) return false;
      }
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
        case JSOp::ToPropertyKey:
          if (st.depth < 1) return reject("underflow", pc);
          // SpiderMonkey keeps Int32 property keys as numbers. Dense element
          // access checks the index separately; other conversions may call JS.
          if (st.stack[top] != Ty::Int) return reject("operand type", pc);
          icIndex++;  // JOF_IC, even though the Int32 fast path is a no-op
          break;
        case JSOp::DebugLeaveLexicalEnv:  // no-op: OnLoopHead excludes debuggee frames
          break;
        case JSOp::LoopHead:
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
          if (nloops > 1 && !IsNum(t)) return reject("nested variable type", pc);
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
          if (t == Ty::Int || t == Ty::Double || t == Ty::Bool || IsObject(t)) {
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
        case JSOp::GetGName:
          if (!getGlobal(pc)) return false;
          icIndex++;
          break;
        case JSOp::GetProp:
          if (st.depth && IsArr(st.stack[top])) {
            if (!AtomIsLength(script, pc)) return reject("GetProp", pc);
            if (!getLength(pc)) return false;
          } else if (!getProperty(pc)) return false;
          icIndex++;
          break;
        case JSOp::SetProp:
        case JSOp::StrictSetProp:
          if (!setProperty(pc)) return false;
          icIndex++;
          break;
        case JSOp::Call:
        case JSOp::CallIgnoresRv:
          if (!mathCall(pc)) return false;
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
    if (!closeLoops(end)) return false;
    if (nlabels || nactive) return reject("region labels", end);
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
    // All constant identity/shape guards are emitted at entry, including ones
    // discovered late in translation. None can run after a property store.
    Buf saved;
    saved.p = code.p; saved.n = code.n; saved.cap = code.cap;
    code.p = nullptr; code.n = code.cap = 0;
    constantEntryGuards();
    if (code.oom) return reject("oom", head);
    body.putn(saved.p, guardInsertion);
    body.putn(code.p, code.n);
    body.putn(saved.p + guardInsertion, saved.n - guardInsertion);
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
    // Each retry adds a widening bit. Bound nested convergence as well as
    // bytecode size; failure leaves interpretation in control.
    uint32_t maxAttempts = c->nloops > 1 ? kMaxVars + kMaxLoops : 4;
    if (!grown || uint32_t(attempt + 1) >= maxAttempts) return c;
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

void FreeNative(uint32_t fn, uint32_t slot, JSContext* cx,
                const char* cause, bool gcEviction = false) {
  long rc = syscall(SYS_jit_free, long(fn), 1L);
  const int syscallErrno = errno;
  cacheobs::Released(slot, fn, MajorGC(cx), cause, rc,
                     rc == -1 ? syscallErrno : 0, gcEviction,
                     [&](const cacheobs::Record& old) {
    ObserveLocation(old.file, old.line, old.off, cx, "gc-evict", old.fn);
  });
  errno = syscallErrno;
}

void Evict(Entry* e, uint32_t slot, JSContext* cx, const char* cause,
           bool gcEviction = false) {
  if (e->fn) FreeNative(e->fn, slot, cx, cause, gcEviction);
  free(e->bytes);
  memset(e, 0, sizeof *e);
}

bool Install(JSScript* script, jsbytecode* pc, Entry* e, Compiler& c, Buf& m,
             JSContext* cx, uint32_t slot) {
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
  if (cacheobs::CaptureEnabled()) {
    cacheobs::Installed(script->filename(), script->lineno(),
                        unsigned(pc - script->code()), slot, idx[0], e->majorGC,
                        uintptr_t(script), uintptr_t(pc));
  }
  size_t len = size_t(c.end - pc);
  e->bytes = static_cast<uint8_t*>(malloc(len));
  if (!e->bytes) {
    FreeNative(idx[0], slot, cx, "install-allocation-failure");
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
            "wasm=%zu idx=%u attempts=%u gcEpoch=%llu\n",
            n, script->filename() ? script->filename() : "?", script->lineno(),
            unsigned(pc - script->code()), len, c.nops, c.nvars, c.maxDepth,
            m.n, idx[0], c.attempts, static_cast<unsigned long long>(e->majorGC));
  }
  if ((n & (n - 1)) == 0 && gLogEnabled.load(std::memory_order_relaxed)) {
    fprintf(stderr,
            "PBLJIT stats compiles=%u rejects=%u runs=%u bails=%u\n", n,
            gRejects.load(std::memory_order_relaxed),
            gRuns.load(std::memory_order_relaxed),
            gBails.load(std::memory_order_relaxed));
  }
  return true;
}

bool Compile(JSScript* script, jit::BaselineFrame* frame, jsbytecode* pc,
             Entry* e, JSContext* cx, uint32_t slot) {
  if (gInstalls.load(std::memory_order_relaxed) >= kMaxInstalls) return false;
  Buf m;
  Compiler* cp = TranslateLoop(
      [&](Compiler& k) {
        k.script = script;
        k.cx = cx;
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
  bool ok = Install(script, pc, e, *cp, m, cx, slot);
  FreeCompiler(cp);
  return ok;
}

}  // namespace

typedef int64_t (*JitFn)(void* frame, void* sp, void* intr, void* out,
                         void* argv);

// Diagnostic-only bounded observer. Owned source filter preserves budget.
bool ObserverActive() {
  static const bool enabled = [] {
    const char* v = getenv("PBLJIT_OBSERVE");
    return v && strcmp(v, "1") == 0;
  }();
  return enabled;
}

bool ObserverFilenameEnabled(const char* filename) {
  if (!ObserverActive()) return false;
  static constexpr char prefix[] = "file:///home/admin/nightly-jit-safety/";
  return filename && strncmp(filename, prefix, sizeof(prefix) - 1) == 0;
}

bool ObserverEnabled(JSScript* script) {
  return ObserverActive() && ObserverFilenameEnabled(script->filename());
}

void ObserveLocation(const char* filename, unsigned line, unsigned off, JSContext* cx,
                     const char* event, uint32_t fn, int64_t kind,
                     uint32_t sp, int32_t delta, uint32_t ic) {
  if (!ObserverFilenameEnabled(filename)) return;
  static std::atomic<int> remaining{4096};
  int observationRemaining = remaining.fetch_sub(1, std::memory_order_relaxed);
  if (observationRemaining <= 0) {
    if (observationRemaining == 0)
      PrintObservation("PBLJIT_OBS_EXHAUSTED reason=emission-failed\n", "PBLJIT_OBS_EXHAUSTED budget=4096\n");
    return;
  }
  PrintObservation("PBLJIT_OBS_EXHAUSTED reason=emission-failed\n", "PBLJIT_OBS event=%s file=%s line=%u off=%u tid=%ld pthread=%lu tls=%p epoch=%llu fn=%u kind=%lld sp=%u pcDelta=%d ic=%u\n",
          event, filename, line, off,
          syscall(SYS_gettid), static_cast<unsigned long>((uintptr_t)pthread_self()), static_cast<void*>(&tCache),
          static_cast<unsigned long long>(MajorGC(cx)), fn,
          static_cast<long long>(kind), sp, delta, ic);
}

void Observe(JSScript* script, jsbytecode* pc, JSContext* cx,
             const char* event, uint32_t fn = 0, int64_t kind = -1,
             uint32_t sp = 0, int32_t delta = 0, uint32_t ic = 0) {
  if (!ObserverEnabled(script)) return;
  ObserveLocation(script->filename(), script->lineno(), unsigned(pc - script->code()),
                  cx, event, fn, kind, sp, delta, ic);
}

void ObserveSkip(JSScript* script, jsbytecode* pc, JSContext* cx,
                 const char* reason) {
  if (!ObserverEnabled(script)) return;
  // Deduplicate repeated heads. Fixed TLS storage; no heap or runtime calls.
  struct Seen { JSScript* script; const char* reason; uint64_t epoch; };
  static thread_local Seen seen[32]{};
  uint64_t epoch = MajorGC(cx);
  for (auto& entry : seen) {
    if (entry.script == script && entry.reason == reason && entry.epoch == epoch)
      return;
  }
  static thread_local unsigned next = 0;
  seen[next++ % 32] = {script, reason, epoch};
  Observe(script, pc, cx, reason);
}

void ObservePolicy(JSScript* script, JSContext* cx) {
  if (!ObserverEnabled(script)) return;
  // Called only at the existing rejection point, before disabling baseline.
  // Read the actual source policy without changing admission or allocating.
  for (const auto& note : script->trynotes()) {
    if (note.kind() == TryNoteKind::Catch) {
      ObserveSkip(script, script->code(), cx, "policy-catch");
      return;
    }
    if (note.kind() == TryNoteKind::Finally) {
      ObserveSkip(script, script->code(), cx, "policy-finally");
      return;
    }
  }
  for (jsbytecode* pc = script->code(); pc < script->codeEnd();
       pc += GetBytecodeLength(pc)) {
    JSOp op = JSOp(*pc);
    if (op == JSOp::Throw || op == JSOp::ThrowWithStack) {
      ObserveSkip(script, pc, cx,
                  op == JSOp::Throw ? "policy-throw" : "policy-throw-stack");
      return;
    }
  }
}

bool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,
                jsbytecode* pc, JSContext* cx, Exit* exit) {
  // The generated module contains untraced shape/object constants. Never
  // dereference them while incremental GC is active or after any major GC.
  if (IncrementalGC(cx)) {
    ObserveSkip(script, pc, cx, "skip-incremental");
    return false;
  }
  uint64_t gc = MajorGC(cx);
  Entry* cache = tCache;
  if (MOZ_UNLIKELY(!cache)) {
    if (!Enabled()) return false;
    cache = static_cast<Entry*>(calloc(size_t(1) << kCacheBits, sizeof(Entry)));
    if (!cache) return false;
    tCache = cache;
  }
  uint32_t h = CacheIndex(script, pc);
  Entry* e = &cache[h];
  if (MOZ_UNLIKELY(e->pc != pc || e->script != script || e->majorGC != gc)) {
    if (e->state == 1 && e->majorGC != gc && TakeLog()) {
      fprintf(stderr, "PBLJIT GC evict oldEpoch=%llu newEpoch=%llu\n",
              static_cast<unsigned long long>(e->majorGC),
              static_cast<unsigned long long>(gc));
    }
    Evict(e, h, cx,
          cacheobs::ReplacementCause(e->pc == pc && e->script == script, e->majorGC == gc),
          e->state == 1 && e->majorGC != gc);
    e->pc = pc;
    e->script = script;
    e->majorGC = gc;
    e->global = CurrentGlobal(cx);
  }
  if (e->global != CurrentGlobal(cx)) return false;
  if (e->state != 1) {
    if (e->state == 2 || ++e->hits < kCompileHits) return false;
    e->state = Compile(script, frame, pc, e, cx, h) ? 1 : 2;
    if (e->state != 1) { ObserveSkip(script, pc, cx, "reject"); return false; }
    Observe(script, pc, cx, "install", e->fn);
  }
  // Same pc pointer, possibly a different (re-allocated) script: compare.
  if (MOZ_UNLIKELY(pc + e->len > script->codeEnd() ||
                   memcmp(pc, e->bytes, e->len) != 0)) {
    Evict(e, h, cx, "bytes");
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
  // emitExit writes all three output fields for Normal, Bail and Interrupt.
  // Direct NoEntry returns and unexpected kinds have no valid output storage.
  bool observedOutputValid = kind == Normal || kind == Bail || kind == Interrupt;
  Observe(script, pc, cx, kind == NoEntry ? "noentry" : kind == Bail ? "bail" :
          kind == Interrupt ? "interrupt" : kind == Normal ? "run" : "invalid-kind",
          e->fn, kind, observedOutputValid ? out.sp : 0,
          observedOutputValid ? out.pcDelta : 0,
          observedOutputValid ? out.icIndex : 0);
  if (kind == NoEntry || kind == Bail) {
    gBails.fetch_add(1, std::memory_order_relaxed);
    if (++e->bails >= kMaxBails) {
      FreeNative(e->fn, h, cx, "bail-limit");
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
