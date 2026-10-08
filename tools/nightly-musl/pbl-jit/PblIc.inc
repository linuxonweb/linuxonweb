/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
// PblIc: CacheIR stub -> wasm compiler for the Portable Baseline IC
// interpreter (adapter source, #included at the end of a copy of
// PortableBaselineInterpret.cpp; upstream files are unchanged).
//
// GetICInterpreter() hands new stubs the counting entry PblIcEntry. After
// kHits entries for one CacheIRStubInfo, its CacheIR is translated into one
// wasm function with the IC stub signature (fpcast-emu: (23 x i64) -> i64,
// args arg0, arg1, stub, ctx) and installed thread-privately with the
// jit_install syscall; the stub's code pointer is then replaced by it.
// Stub fields are read from the stub at run time, so the function serves
// every stub sharing that stub info.
//
// IC registers live in wasm locals (value and tag words, exactly as
// ICRegs stores them). The ops in Translate() are translated inline with the
// interpreter's exact semantics (including how each op widens a pointer or
// int32 into a register word). Every other op is "stepped": dirty registers
// are spilled to ctx.icregs and ICInterpretOps runs just that op (ctx.stepOff
// .. ctx.stepEnd, retValue carried in ctx.stepRet). After a clean step
// (ctx.stepDone == 1 and no error sentinel) the compiled code reloads the
// registers the op names and continues; otherwise the step's result (next
// stub's result after a guard failure, or the error sentinel) is returned
// as is. A failed inline guard calls stub->next's code exactly like
// CallNextIC.
//
// Environment: PBLIC=0 disables compilation (stubs run ICInterpretOps), and
// PBLIC_LOG=n limits log lines (default 40). Stats lines report compiles,
// rejects, compiled entries, inline guard failures and stepped ops.

// Included inside namespace js::pbl; <atomic>, <sys/syscall.h> and
// <unistd.h> are included at the top of the file.
#include "PblIcOps.h"

namespace pblic {

static_assert(size_t(CacheOp::NumOpcodes) == 465);
static_assert(sizeof(void*) == 4, "PblIc requires wasm32");
static_assert(sizeof(StackVal) == 8);
static_assert(uint32_t(JSVAL_TAG_CLEAR) == 0xFFFFFF80u);
static_assert(ICRegs::kMaxICVals == 16);

constexpr long SYS_jit_install = 0x6a490001;
constexpr long kInstallPrivate = 1;
constexpr uint32_t kHits = 200;
constexpr uint32_t kMaxOps = 96;
constexpr uint32_t kMaxInstalls = 20000;
constexpr uint32_t kTableBits = 12;
constexpr uint32_t kProbe = 16;

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Winvalid-offsetof"
const uint32_t kCtxRegVals =
    uint32_t(offsetof(ICCtx, icregs) + offsetof(ICRegs, icVals));
const uint32_t kCtxRegTags =
    uint32_t(offsetof(ICCtx, icregs) + offsetof(ICRegs, icTags));
const uint32_t kCtxSp = uint32_t(offsetof(ICCtx, sp_));
const uint32_t kCtxArg2 = uint32_t(offsetof(ICCtx, arg2));
const uint32_t kCtxStepOff = uint32_t(offsetof(ICCtx, stepOff));
const uint32_t kCtxStepEnd = uint32_t(offsetof(ICCtx, stepEnd));
const uint32_t kCtxStepDone = uint32_t(offsetof(ICCtx, stepDone));
const uint32_t kCtxStepRet = uint32_t(offsetof(ICCtx, stepRet));
#pragma clang diagnostic pop

// Stats (relaxed; compiled code bumps kStatEntries/kStatFails non-atomically).
enum : uint32_t { kStatEntries, kStatFails, kStatSteps, kStatCount };
uint32_t gStats[kStatCount];
uint32_t gStepOps[size_t(CacheOp::NumOpcodes)];
std::atomic<uint32_t> gCompiles{0};
std::atomic<uint32_t> gRejects{0};
std::atomic<uint32_t> gInstalls{0};
std::atomic<int> gLogBudget{0};
std::atomic<int> gEnabled{-1};
uint32_t gNextStatSteps = 1u << 20;

bool Enabled() {
  int e = gEnabled.load(std::memory_order_relaxed);
  if (e < 0) {
    const char* v = getenv("PBLIC");
    e = (v && v[0] == '0') ? 0 : 1;
    const char* l = getenv("PBLIC_LOG");
    gLogBudget.store(l ? atoi(l) : 40, std::memory_order_relaxed);
    gEnabled.store(e, std::memory_order_relaxed);
    fprintf(stderr, "PBLIC %s (threshold=%u)\n", e ? "enabled" : "disabled",
            kHits);
  }
  return e != 0;
}

bool TakeLog() {
  return gLogBudget.fetch_sub(1, std::memory_order_relaxed) > 0;
}

void PrintStats(const char* why) {
  // Top stepped ops show which ops are worth translating inline next.
  uint32_t top[8];
  uint32_t ntop = 0;
  for (uint32_t i = 0; i < uint32_t(CacheOp::NumOpcodes); i++) {
    if (!gStepOps[i]) continue;
    uint32_t k = ntop < 8 ? ntop++ : 8;
    while (k > 0 && gStepOps[top[k - 1]] < gStepOps[i]) {
      if (k < 8) top[k] = top[k - 1];
      k--;
    }
    if (k < 8) top[k] = i;
  }
  char buf[512];
  int len = 0;
  for (uint32_t k = 0; k < ntop && len < 400; k++) {
    len += snprintf(buf + len, sizeof buf - len, " %s=%u",
                    CacheIROpNames[top[k]], gStepOps[top[k]]);
  }
  buf[len] = 0;
  fprintf(stderr,
          "PBLIC stats(%s) compiles=%u rejects=%u installs=%u entries=%u "
          "fails=%u steps=%u top:%s\n",
          why, gCompiles.load(std::memory_order_relaxed),
          gRejects.load(std::memory_order_relaxed),
          gInstalls.load(std::memory_order_relaxed), gStats[kStatEntries],
          gStats[kStatFails], gStats[kStatSteps], buf);
}

// Called by ICInterpretOps when it starts a step.
void CountStep(const uint8_t* at) {
  uint32_t op = uint32_t(at[0]) | (uint32_t(at[1]) << 8);
  if (op < uint32_t(CacheOp::NumOpcodes)) gStepOps[op]++;
  if (++gStats[kStatSteps] == gNextStatSteps) {
    gNextStatSteps *= 4;
    PrintStats("steps");
  }
}

// Slot stores that may need GC barriers, called from compiled code by table
// index (fpcast-emu signature); each is the interpreter's exact store.
uint64_t StoreFixedSlotBarriered(uintptr_t slot, uint64_t bits) {
  reinterpret_cast<GCPtr<Value>*>(slot)->set(Value::fromRawBits(bits));
  return 0;
}
uint64_t StoreDynamicSlotBarriered(uintptr_t obj, uint32_t offset,
                                   uint64_t bits) {
  NativeObject* nobj = reinterpret_cast<NativeObject*>(obj);
  HeapSlot* slots = nobj->getSlotsUnchecked();
  size_t dynSlot = offset / sizeof(Value);
  size_t slot = dynSlot + nobj->numFixedSlots();
  slots[dynSlot].set(nobj, HeapSlot::Slot, slot, Value::fromRawBits(bits));
  return 0;
}

// ---- wasm emitter ---------------------------------------------------------

struct Buf {
  uint8_t* p = nullptr;
  size_t n = 0, cap = 0;
  bool oom = false;
  Buf() = default;
  Buf(const Buf&) = delete;
  ~Buf() { free(p); }
  void put(uint8_t v) {
    if (n == cap) {
      size_t ncap = cap ? cap * 2 : 1024;
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

enum : uint8_t {
  OP_BLOCK = 0x02,
  OP_IF = 0x04,
  OP_ELSE = 0x05,
  OP_END = 0x0b,
  OP_BR = 0x0c,
  OP_BRIF = 0x0d,
  OP_RETURN = 0x0f,
  OP_CALLIND = 0x11,
  OP_DROP = 0x1a,
  OP_SELECT = 0x1b,
  OP_LGET = 0x20,
  OP_LSET = 0x21,
  OP_LTEE = 0x22,
  OP_I32LOAD = 0x28,
  OP_I64LOAD = 0x29,
  OP_I32STORE = 0x36,
  OP_I64STORE = 0x37,
  OP_I32CONST = 0x41,
  OP_I64CONST = 0x42,
  OP_I32EQZ = 0x45,
  OP_I32EQ = 0x46,
  OP_I32NE = 0x47,
  OP_I32LTS = 0x48,
  OP_I32LTU = 0x49,
  OP_I32GTS = 0x4a,
  OP_I32GTU = 0x4b,
  OP_I32LES = 0x4c,
  OP_I32LEU = 0x4d,
  OP_I32GES = 0x4e,
  OP_I32GEU = 0x4f,
  OP_I64EQZ = 0x50,
  OP_I64EQ = 0x51,
  OP_I64NE = 0x52,
  OP_I64LTS = 0x53,
  OP_I64GTS = 0x55,
  OP_F64EQ = 0x61,
  OP_F64NE = 0x62,
  OP_F64LT = 0x63,
  OP_F64GT = 0x64,
  OP_F64LE = 0x65,
  OP_F64GE = 0x66,
  OP_I32ADD = 0x6a,
  OP_I32SUB = 0x6b,
  OP_I32MUL = 0x6c,
  OP_I32AND = 0x71,
  OP_I32OR = 0x72,
  OP_I32XOR = 0x73,
  OP_I32SHL = 0x74,
  OP_I32SHRS = 0x75,
  OP_I32SHRU = 0x76,
  OP_I64ADD = 0x7c,
  OP_I64SUB = 0x7d,
  OP_I64MUL = 0x7e,
  OP_I64DIVS = 0x7f,
  OP_I64REMS = 0x81,
  OP_I64AND = 0x83,
  OP_I64OR = 0x84,
  OP_I64XOR = 0x85,
  OP_I64SHL = 0x86,
  OP_I64SHRU = 0x88,
  OP_F64ABS = 0x99,
  OP_F64CEIL = 0x9b,
  OP_F64FLOOR = 0x9c,
  OP_F64SQRT = 0x9f,
  OP_F64ADD = 0xa0,
  OP_F64SUB = 0xa1,
  OP_F64MUL = 0xa2,
  OP_F64DIV = 0xa3,
  OP_I32WRAP = 0xa7,
  OP_I64EXTS = 0xac,
  OP_I64EXTU = 0xad,
  OP_F64CONVI32S = 0xb7,
  OP_F64CONVI32U = 0xb8,
  OP_I64REINTF64 = 0xbd,
  OP_F64REINTI64 = 0xbf,
  OP_PREFIX_FC = 0xfc,
  OP_VOID = 0x40,
};

// Locals: 23 i64 params, then V[16] T[16] RET A B (i64), STUB CTX X Y Z (i32),
// D0 D1 (f64).
constexpr uint32_t kParams = 23;
constexpr uint32_t L_V = kParams, L_T = kParams + 16, L_RET = kParams + 32,
                   L_A = L_RET + 1, L_B = L_RET + 2;
constexpr uint32_t kI64Locals = 35;
constexpr uint32_t L_STUB = kParams + kI64Locals, L_CTX = L_STUB + 1,
                   L_X = L_STUB + 2, L_Y = L_STUB + 3, L_Z = L_STUB + 4;
constexpr uint32_t kI32Locals = 5;
constexpr uint32_t L_D0 = L_STUB + kI32Locals, L_D1 = L_D0 + 1;
constexpr uint32_t kF64Locals = 2;

// JSObject::offsetOfShape() is reserved for MacroAssembler.
constexpr uint32_t kShapeOffset = uint32_t(JSObject::offsetOfHeaderPtr());

constexpr int64_t ShiftedTag(JSValueTag tag) {
  return int64_t(uint64_t(uint32_t(tag)) << 32);
}

struct Translator {
  const CacheIRStubInfo* info;
  const uint8_t* code;
  uint32_t len;
  Buf b;
  uint32_t depth = 0;  // blocks open inside the outer $fail block
  uint32_t dirty = 0;  // registers whose locals are newer than ctx.icregs
  uint32_t sdo;        // stub data offset
  const char* reason = nullptr;
  uint32_t nInline = 0, nStep = 0;

  bool reject(const char* why) {
    reason = why;
    return false;
  }
  void op(uint8_t o) { b.put(o); }
  void lget(uint32_t l) {
    b.put(OP_LGET);
    b.uleb(l);
  }
  void lset(uint32_t l) {
    b.put(OP_LSET);
    b.uleb(l);
  }
  void ltee(uint32_t l) {
    b.put(OP_LTEE);
    b.uleb(l);
  }
  void i32c(int32_t v) {
    b.put(OP_I32CONST);
    b.sleb(v);
  }
  void i64c(int64_t v) {
    b.put(OP_I64CONST);
    b.sleb(v);
  }
  void f64zero() {
    b.put(0x44);
    for (int i = 0; i < 8; i++) b.put(0);
  }
  void load32(uint32_t off) {
    b.put(OP_I32LOAD);
    b.uleb(2);
    b.uleb(off);
  }
  void load64(uint32_t off) {
    b.put(OP_I64LOAD);
    b.uleb(3);
    b.uleb(off);
  }
  void store32(uint32_t off) {
    b.put(OP_I32STORE);
    b.uleb(2);
    b.uleb(off);
  }
  void store64(uint32_t off) {
    b.put(OP_I64STORE);
    b.uleb(3);
    b.uleb(off);
  }
  // Branch to the stub's failure path when the i32 on the stack is nonzero.
  void failIf() {
    b.put(OP_BRIF);
    b.uleb(depth);
  }
  void fail() {
    b.put(OP_BR);
    b.uleb(depth);
  }
  void ifThen() {
    b.put(OP_IF);
    b.put(OP_VOID);
    depth++;
  }
  void elseThen() { b.put(OP_ELSE); }
  void endIf() {
    b.put(OP_END);
    depth--;
  }

  // Register access, mirroring READ_REG / READ_VALUE_REG / WRITE_*.
  void readReg(uint32_t id) { lget(L_V + id); }
  void readReg32(uint32_t id) {
    lget(L_V + id);
    op(OP_I32WRAP);
  }
  void readValue(uint32_t id) {
    lget(L_V + id);
    lget(L_T + id);
    op(OP_I64OR);
  }
  // value word (i64) is on the stack
  void writeReg(uint32_t id, JSValueTag tag) {
    lset(L_V + id);
    i64c(ShiftedTag(tag));
    lset(L_T + id);
    dirty |= 1u << id;
  }
  void writeValueReg(uint32_t id) {
    lset(L_V + id);
    i64c(0);
    lset(L_T + id);
    dirty |= 1u << id;
  }
  // stub field address (i32) + loads
  void field32(uint32_t off) {
    lget(L_STUB);
    load32(sdo + off);
  }
  void field64(uint32_t off) {
    lget(L_STUB);
    load64(sdo + off);
  }

  // high word (tag) of the i64 on the stack, as i32
  void hi() {
    i64c(32);
    op(OP_I64SHRU);
    op(OP_I32WRAP);
  }
  // i64 value on stack -> i32: 1 when its tag == tag
  void tagIs(JSValueTag tag) {
    hi();
    i32c(int32_t(uint32_t(tag)));
    op(OP_I32EQ);
  }
  void tagIsNot(JSValueTag tag) {
    hi();
    i32c(int32_t(uint32_t(tag)));
    op(OP_I32NE);
  }
  // Boxed value with tag from a 32-bit payload (i32 on stack).
  void boxPayload(JSValueTag tag) {
    op(OP_I64EXTU);
    i64c(ShiftedTag(tag));
    op(OP_I64OR);
  }
  void boxBool() { boxPayload(JSVAL_TAG_BOOLEAN); }  // i32 0/1 on stack
  // f64 on the stack -> Value bits of DoubleValue(d) (NaN canonicalized).
  void boxDouble() {
    ltee(L_D0);
    lget(L_D0);
    op(OP_F64NE);
    b.put(OP_IF);
    b.put(0x7e);  // result i64
    i64c(int64_t(JS::detail::CanonicalizedNaNBits));
    b.put(OP_ELSE);
    lget(L_D0);
    op(OP_I64REINTF64);
    b.put(OP_END);
  }
  // Value bits (i64) on stack -> f64 of Value::toNumber().
  void toNumber() {
    ltee(L_A);
    hi();
    i32c(int32_t(uint32_t(JSVAL_TAG_CLEAR)));
    op(OP_I32LEU);
    b.put(OP_IF);
    b.put(0x7c);  // result f64
    lget(L_A);
    op(OP_F64REINTI64);
    b.put(OP_ELSE);
    lget(L_A);
    op(OP_I32WRAP);
    op(OP_F64CONVI32S);
    b.put(OP_END);
  }
  // f64 on the stack -> Value bits of NumberValue(d).
  void boxNumber() {
    lset(L_D1);
    // i = trunc_sat(d); int32 iff double(i) == d and not -0.
    lget(L_D1);
    b.put(OP_PREFIX_FC);
    b.uleb(2);
    lset(L_X);
    lget(L_X);
    op(OP_F64CONVI32S);
    lget(L_D1);
    op(OP_F64EQ);
    // -0: d == 0 with the sign bit set
    lget(L_D1);
    op(OP_I64REINTF64);
    i64c(INT64_MIN);
    op(OP_I64EQ);
    op(OP_I32EQZ);
    op(OP_I32AND);
    b.put(OP_IF);
    b.put(0x7e);
    lget(L_X);
    boxPayload(JSVAL_TAG_INT32);
    b.put(OP_ELSE);
    lget(L_D1);
    boxDouble();
    b.put(OP_END);
  }
  // Object (i32 on stack) -> its shape's BaseShape proto word.
  void protoOf() {
    load32(uint32_t(kShapeOffset));
    load32(uint32_t(Shape::offsetOfBaseShape()));
    load32(uint32_t(BaseShape::offsetOfProto()));
  }
  // Object (i32 on stack) -> its JSClass* (shape -> base shape -> clasp).
  void classOf() {
    load32(uint32_t(kShapeOffset));
    load32(uint32_t(Shape::offsetOfBaseShape()));
    load32(uint32_t(BaseShape::offsetOfClasp()));
  }
  // Calls fn with the nargs i64 arguments on the stack; leaves its i64.
  void callHelper(uintptr_t fn, uint32_t nargs) {
    for (uint32_t i = nargs; i < kParams; i++) i64c(0);
    i32c(int32_t(fn));
    b.put(OP_CALLIND);
    b.uleb(0);
    b.uleb(0);
  }
  // Stores the value in L_A at the slot address in L_X. A plain store when
  // neither the old nor the new value is a GC thing (no barrier applies),
  // otherwise the slow path (helper call, i64 on the stack -> dropped).
  template <typename SlowArgs>
  void storeSlot(uintptr_t slow, uint32_t nargs, SlowArgs slowArgs) {
    const int32_t gcTag = int32_t(uint32_t(JS::detail::ValueLowerInclGCThingTag));
    lget(L_X);
    load64(0);
    hi();
    i32c(gcTag);
    op(OP_I32LTU);
    lget(L_A);
    hi();
    i32c(gcTag);
    op(OP_I32LTU);
    op(OP_I32AND);
    ifThen();
    lget(L_X);
    lget(L_A);
    store64(0);
    b.put(OP_ELSE);
    slowArgs();
    callHelper(slow, nargs);
    op(OP_DROP);
    endIf();
  }
  // NativeObject (i32) -> elements header field at a negative offset.
  void elementsField(int off) {
    load32(uint32_t(NativeObject::offsetOfElements()));
    i32c(off);
    op(OP_I32ADD);
    load32(0);
  }

  void spill() {
    for (uint32_t i = 0; i < 16; i++) {
      if (!(dirty & (1u << i))) continue;
      lget(L_CTX);
      lget(L_V + i);
      store64(kCtxRegVals + 8 * i);
      lget(L_CTX);
      lget(L_T + i);
      store64(kCtxRegTags + 8 * i);
    }
    dirty = 0;
  }
  void reload(uint32_t mask) {
    for (uint32_t i = 0; i < 16; i++) {
      if (!(mask & (1u << i))) continue;
      lget(L_CTX);
      load64(kCtxRegVals + 8 * i);
      lset(L_V + i);
      lget(L_CTX);
      load64(kCtxRegTags + 8 * i);
      lset(L_T + i);
    }
  }
  // After arg0, arg1, stub, ctx: zero the remaining fpcast-emu params.
  void padArgs() {
    for (uint32_t i = 4; i < kParams; i++) i64c(0);
  }

  // Run [start, end) in ICInterpretOps.
  void step(uint32_t start, uint32_t end, bool last, uint32_t ids) {
    nStep++;
    spill();
    lget(L_CTX);
    i32c(int32_t(start));
    store32(kCtxStepOff);
    lget(L_CTX);
    i32c(int32_t(end));
    store32(kCtxStepEnd);
    lget(L_CTX);
    lget(L_RET);
    store64(kCtxStepRet);
    lget(0);
    lget(1);
    lget(2);
    lget(3);
    padArgs();
    i32c(int32_t(uintptr_t(&ICInterpretOps)));
    b.put(OP_CALLIND);
    b.uleb(0);
    b.uleb(0);
    if (last) {
      op(OP_RETURN);
      return;
    }
    lset(L_A);
    lget(L_CTX);
    load32(kCtxStepDone);
    i32c(1);
    op(OP_I32NE);
    lget(L_A);
    i64c(int64_t(IC_ERROR_SENTINEL()));
    op(OP_I64EQ);
    op(OP_I32OR);
    b.put(OP_IF);
    b.put(OP_VOID);
    lget(L_A);
    op(OP_RETURN);
    b.put(OP_END);
    lget(L_A);
    lset(L_RET);
    reload(ids);
  }

  bool translateOp(CacheOp cop, const uint8_t* a);
  bool run();
  bool assemble(Buf& m);
};

#define RET_INT32_FROM_I32()   \
  boxPayload(JSVAL_TAG_INT32); \
  lset(L_RET)

bool Translator::translateOp(CacheOp cop, const uint8_t* a) {
  auto fieldOff = [&](uint32_t i) {
    return uint32_t(a[i]) * uint32_t(sizeof(uintptr_t));
  };
  auto imm32 = [&](uint32_t i) {
    return int32_t(uint32_t(a[i]) | (uint32_t(a[i + 1]) << 8) |
                   (uint32_t(a[i + 2]) << 16) | (uint32_t(a[i + 3]) << 24));
  };
  switch (cop) {
    // ---- value guards ----
    case CacheOp::GuardToObject:
    case CacheOp::GuardToString:
    case CacheOp::GuardToSymbol:
    case CacheOp::GuardToBigInt: {
      JSValueTag tag = cop == CacheOp::GuardToObject   ? JSVAL_TAG_OBJECT
                       : cop == CacheOp::GuardToString ? JSVAL_TAG_STRING
                       : cop == CacheOp::GuardToSymbol ? JSVAL_TAG_SYMBOL
                                                       : JSVAL_TAG_BIGINT;
      uint32_t id = a[0];
      readValue(id);
      ltee(L_A);
      tagIsNot(tag);
      failIf();
      // WRITE_REG(id, reinterpret_cast<uint64_t>(ptr), TAG): zero-extended
      lget(L_A);
      op(OP_I32WRAP);
      op(OP_I64EXTU);
      writeReg(id, tag);
      return true;
    }
    case CacheOp::GuardToBoolean: {
      uint32_t id = a[0];
      readValue(id);
      ltee(L_A);
      tagIsNot(JSVAL_TAG_BOOLEAN);
      failIf();
      lget(L_A);
      op(OP_I32WRAP);
      op(OP_I32EQZ);
      op(OP_I32EQZ);
      op(OP_I64EXTU);
      writeReg(id, JSVAL_TAG_BOOLEAN);
      return true;
    }
    case CacheOp::GuardIsNumber:
      readValue(a[0]);
      hi();
      i32c(int32_t(uint32_t(JSVAL_TAG_INT32)));
      op(OP_I32GTU);
      failIf();
      return true;
    case CacheOp::GuardToInt32:
      readValue(a[0]);
      tagIsNot(JSVAL_TAG_INT32);
      failIf();
      return true;
    case CacheOp::GuardIsNull:
      readValue(a[0]);
      tagIsNot(JSVAL_TAG_NULL);
      failIf();
      return true;
    case CacheOp::GuardIsUndefined:
      readValue(a[0]);
      tagIsNot(JSVAL_TAG_UNDEFINED);
      failIf();
      return true;
    case CacheOp::GuardIsNullOrUndefined:
      readValue(a[0]);
      hi();
      i32c(int32_t(uint32_t(JSVAL_TAG_UNDEFINED)));
      op(OP_I32SUB);
      i32c(1);
      op(OP_I32GTU);
      failIf();
      static_assert(uint32_t(JSVAL_TAG_NULL) ==
                    uint32_t(JSVAL_TAG_UNDEFINED) + 1);
      return true;
    case CacheOp::GuardIsNotUninitializedLexical:
      readValue(a[0]);
      i64c(int64_t(MagicValue(JS_UNINITIALIZED_LEXICAL).asRawBits()));
      op(OP_I64EQ);
      failIf();
      return true;
    case CacheOp::GuardNonDoubleType: {
      JSValueTag tag;
      switch (ValueType(a[1])) {
        case ValueType::String:
          tag = JSVAL_TAG_STRING;
          break;
        case ValueType::Symbol:
          tag = JSVAL_TAG_SYMBOL;
          break;
        case ValueType::BigInt:
          tag = JSVAL_TAG_BIGINT;
          break;
        case ValueType::Int32:
          tag = JSVAL_TAG_INT32;
          break;
        case ValueType::Boolean:
          tag = JSVAL_TAG_BOOLEAN;
          break;
        case ValueType::Undefined:
          tag = JSVAL_TAG_UNDEFINED;
          break;
        case ValueType::Null:
          tag = JSVAL_TAG_NULL;
          break;
        default:
          reason = "GuardNonDoubleType type";
          return false;
      }
      readValue(a[0]);
      tagIsNot(tag);
      failIf();
      return true;
    }
    case CacheOp::GuardBooleanToInt32: {
      readValue(a[0]);
      ltee(L_A);
      tagIsNot(JSVAL_TAG_BOOLEAN);
      failIf();
      lget(L_A);
      op(OP_I32WRAP);
      op(OP_I32EQZ);
      op(OP_I32EQZ);
      op(OP_I64EXTU);
      writeReg(a[1], JSVAL_TAG_INT32);
      return true;
    }
    case CacheOp::GuardToInt32Index: {
      // int32: WRITE_REG(res, int32 (sign-extended)); double d: pass when
      // int32_t(d) == d (clang lowers the conversion to trunc_sat).
      readValue(a[0]);
      ltee(L_A);
      tagIs(JSVAL_TAG_INT32);
      ifThen();
      lget(L_A);
      op(OP_I32WRAP);
      op(OP_I64EXTS);
      lset(L_B);
      elseThen();
      lget(L_A);
      hi();
      i32c(int32_t(uint32_t(JSVAL_TAG_CLEAR)));
      op(OP_I32GTU);
      failIf();
      lget(L_A);
      op(OP_F64REINTI64);
      ltee(L_D0);
      b.put(OP_PREFIX_FC);
      b.uleb(2);
      ltee(L_X);
      op(OP_F64CONVI32S);
      lget(L_D0);
      op(OP_F64NE);
      failIf();
      lget(L_X);
      op(OP_I64EXTS);
      lset(L_B);
      endIf();
      lget(L_B);
      writeReg(a[1], JSVAL_TAG_INT32);
      return true;
    }

    // ---- object guards ----
    case CacheOp::GuardShape:
      readReg32(a[0]);
      load32(uint32_t(kShapeOffset));
      field32(fieldOff(1));
      op(OP_I32NE);
      failIf();
      return true;
    case CacheOp::GuardProto:
      readReg32(a[0]);
      protoOf();
      field32(fieldOff(1));
      op(OP_I32NE);
      failIf();
      return true;
    case CacheOp::GuardNullProto:
      readReg32(a[0]);
      protoOf();
      failIf();
      return true;
    case CacheOp::GuardSpecificObject:
      readReg32(a[0]);
      field32(fieldOff(1));
      op(OP_I32NE);
      failIf();
      return true;
    case CacheOp::GuardSpecificFunction:
    case CacheOp::GuardSpecificAtom:
    case CacheOp::GuardSpecificSymbol:
      // uintptr_t expected != uint64 register word
      field32(fieldOff(1));
      op(OP_I64EXTU);
      readReg(a[0]);
      op(OP_I64NE);
      failIf();
      return true;
    case CacheOp::GuardSpecificInt32:
      readReg32(a[0]);
      i32c(imm32(1));
      op(OP_I32NE);
      failIf();
      return true;
    case CacheOp::GuardNoDenseElements:
      readReg32(a[0]);
      elementsField(ObjectElements::offsetOfInitializedLength());
      failIf();
      return true;
    case CacheOp::GuardGlobalGeneration:
      field32(fieldOff(1));
      load32(0);
      field32(fieldOff(0));
      op(OP_I32NE);
      failIf();
      return true;
    case CacheOp::GuardFixedSlotValue:
      readReg32(a[0]);
      field32(fieldOff(1));
      op(OP_I32ADD);
      load64(0);
      field64(fieldOff(2));
      op(OP_I64NE);
      failIf();
      return true;
    case CacheOp::GuardDynamicSlotValue:
      readReg32(a[0]);
      load32(uint32_t(NativeObject::offsetOfSlots()));
      field32(fieldOff(1));
      i32c(3);
      op(OP_I32SHRU);
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      load64(0);
      field64(fieldOff(2));
      op(OP_I64NE);
      failIf();
      return true;
    case CacheOp::GuardDynamicSlotIsSpecificObject:
      readReg32(a[0]);
      load32(uint32_t(NativeObject::offsetOfSlots()));
      field32(fieldOff(2));
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      load64(0);
      readReg32(a[1]);
      boxPayload(JSVAL_TAG_OBJECT);
      op(OP_I64NE);
      failIf();
      return true;

    // ---- register loads ----
    case CacheOp::LoadObject:
      // intptr_t -> uint64: sign-extended
      field32(fieldOff(1));
      op(OP_I64EXTS);
      writeReg(a[0], JSVAL_TAG_OBJECT);
      return true;
    case CacheOp::LoadProto:
      readReg32(a[0]);
      protoOf();
      op(OP_I64EXTU);
      writeReg(a[1], JSVAL_TAG_OBJECT);
      return true;
    case CacheOp::LoadEnclosingEnvironment:
      readReg32(a[0]);
      load32(uint32_t(EnvironmentObject::offsetOfEnclosingEnvironment()));
      op(OP_I64EXTU);
      writeReg(a[1], JSVAL_TAG_OBJECT);
      return true;
    case CacheOp::LoadFixedSlot:
      readReg32(a[1]);
      field32(fieldOff(2));
      op(OP_I32ADD);
      load64(0);
      writeValueReg(a[0]);
      return true;
    case CacheOp::LoadDynamicSlot:
      readReg32(a[1]);
      load32(uint32_t(NativeObject::offsetOfSlots()));
      field32(fieldOff(2));
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      load64(0);
      writeValueReg(a[0]);
      return true;
    case CacheOp::LoadInt32Constant:
      // uint32_t value -> zero-extended
      field32(fieldOff(0));
      op(OP_I64EXTU);
      writeReg(a[1], JSVAL_TAG_INT32);
      return true;
    case CacheOp::LoadConstantString:
      field32(fieldOff(0));
      op(OP_I64EXTU);
      writeReg(a[1], JSVAL_TAG_STRING);
      return true;
    case CacheOp::LoadArgumentFixedSlot:
      lget(L_CTX);
      load32(kCtxSp);
      load64(uint32_t(a[1]) * 8);
      writeValueReg(a[0]);
      return true;
    case CacheOp::LoadArgumentDynamicSlot:
      lget(L_CTX);
      load32(kCtxSp);
      readReg32(a[1]);
      i32c(a[2]);
      op(OP_I32ADD);
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      load64(0);
      writeValueReg(a[0]);
      return true;

    // ---- results ----
    case CacheOp::LoadFixedSlotResult:
    case CacheOp::LoadFixedSlotTypedResult:
      readReg32(a[0]);
      field32(fieldOff(1));
      op(OP_I32ADD);
      load64(0);
      lset(L_RET);
      return true;
    case CacheOp::LoadDynamicSlotResult:
      readReg32(a[0]);
      load32(uint32_t(NativeObject::offsetOfSlots()));
      field32(fieldOff(1));
      i32c(3);
      op(OP_I32SHRU);
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      load64(0);
      lset(L_RET);
      return true;
    case CacheOp::LoadDenseElementResult: {
      bool packed = a[2] != 0;
      readReg32(a[0]);
      load32(uint32_t(NativeObject::offsetOfElements()));
      lset(L_Y);
      readReg32(a[1]);
      lset(L_X);
      lget(L_X);
      i32c(0);
      op(OP_I32LTS);
      failIf();
      lget(L_X);
      lget(L_Y);
      i32c(ObjectElements::offsetOfInitializedLength());
      op(OP_I32ADD);
      load32(0);
      op(OP_I32GEU);
      failIf();
      if (packed) {
        lget(L_Y);
        i32c(ObjectElements::offsetOfFlags());
        op(OP_I32ADD);
        load32(0);
        i32c(int32_t(ObjectElements::NON_PACKED));
        op(OP_I32AND);
        failIf();
      }
      lget(L_Y);
      lget(L_X);
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      load64(0);
      lset(L_RET);
      if (!packed) {
        lget(L_RET);
        tagIs(JSVAL_TAG_MAGIC);
        failIf();
      }
      return true;
    }
    case CacheOp::LoadInt32ArrayLengthResult:
    case CacheOp::LoadInt32ArrayLength:
      readReg32(a[0]);
      elementsField(ObjectElements::offsetOfLength());
      ltee(L_X);
      i32c(0);
      op(OP_I32LTS);
      failIf();
      lget(L_X);
      if (cop == CacheOp::LoadInt32ArrayLength) {
        op(OP_I64EXTU);
        writeReg(a[1], JSVAL_TAG_INT32);
      } else {
        RET_INT32_FROM_I32();
      }
      return true;
    case CacheOp::LoadObjectResult:
      readReg32(a[0]);
      boxPayload(JSVAL_TAG_OBJECT);
      lset(L_RET);
      return true;
    case CacheOp::LoadStringResult:
      readReg32(a[0]);
      boxPayload(JSVAL_TAG_STRING);
      lset(L_RET);
      return true;
    case CacheOp::LoadInt32Result:
      readReg32(a[0]);
      RET_INT32_FROM_I32();
      return true;
    case CacheOp::LoadDoubleResult:
      readValue(a[0]);
      ltee(L_A);
      tagIs(JSVAL_TAG_INT32);
      b.put(OP_IF);
      b.put(0x7e);
      lget(L_A);
      op(OP_I32WRAP);
      op(OP_F64CONVI32S);
      op(OP_I64REINTF64);
      b.put(OP_ELSE);
      lget(L_A);
      b.put(OP_END);
      lset(L_RET);
      return true;
    case CacheOp::LoadBooleanResult:
      i64c(int64_t(BooleanValue(a[0] != 0).asRawBits()));
      lset(L_RET);
      return true;
    case CacheOp::LoadValueResult:
      field64(fieldOff(0));
      lset(L_RET);
      return true;
    case CacheOp::LoadOperandResult:
      readReg(a[0]);
      lset(L_RET);
      return true;
    case CacheOp::LoadUndefinedResult:
      i64c(int64_t(UndefinedValue().asRawBits()));
      lset(L_RET);
      return true;
    case CacheOp::LoadConstantStringResult:
      field32(fieldOff(0));
      boxPayload(JSVAL_TAG_STRING);
      lset(L_RET);
      return true;
    case CacheOp::LoadInt32TruthyResult:
      readReg32(a[0]);
      op(OP_I32EQZ);
      op(OP_I32EQZ);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::LoadDoubleTruthyResult:
      // input != 0.0 && !isnan(input)  ==  input != 0 && input == input
      readValue(a[0]);
      toNumber();
      ltee(L_D0);
      f64zero();
      op(OP_F64NE);
      lget(L_D0);
      lget(L_D0);
      op(OP_F64EQ);
      op(OP_I32AND);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::LoadStringTruthyResult:
      readReg32(a[0]);
      load32(uint32_t(JSString::offsetOfLength()));
      op(OP_I32EQZ);
      op(OP_I32EQZ);
      boxBool();
      lset(L_RET);
      return true;

    // ---- arithmetic ----
    case CacheOp::DoubleAddResult:
    case CacheOp::DoubleSubResult:
    case CacheOp::DoubleMulResult:
    case CacheOp::DoubleDivResult:
      readValue(a[0]);
      toNumber();
      readValue(a[1]);
      toNumber();
      op(cop == CacheOp::DoubleAddResult   ? OP_F64ADD
         : cop == CacheOp::DoubleSubResult ? OP_F64SUB
         : cop == CacheOp::DoubleMulResult ? OP_F64MUL
                                           : OP_F64DIV);
      boxDouble();
      lset(L_RET);
      return true;
    case CacheOp::Int32AddResult:
    case CacheOp::Int32SubResult:
    case CacheOp::Int32MulResult:
    case CacheOp::Int32DivResult:
    case CacheOp::Int32ModResult:
    case CacheOp::Int32BitOrResult:
    case CacheOp::Int32BitXorResult:
    case CacheOp::Int32BitAndResult: {
      // int64 lhs/rhs, extra checks, result must fit int32 (INT32_OP).
      readReg32(a[0]);
      op(OP_I64EXTS);
      lset(L_A);
      readReg32(a[1]);
      op(OP_I64EXTS);
      lset(L_B);
      if (cop == CacheOp::Int32MulResult) {
        lget(L_A);
        lget(L_B);
        op(OP_I64MUL);
        op(OP_I64EQZ);
        lget(L_B);
        i64c(0);
        op(OP_I64LTS);
        lget(L_A);
        i64c(0);
        op(OP_I64LTS);
        op(OP_I32XOR);
        op(OP_I32AND);
        failIf();
      }
      if (cop == CacheOp::Int32DivResult || cop == CacheOp::Int32ModResult) {
        lget(L_B);
        op(OP_I64EQZ);
        failIf();
        lget(L_A);
        i64c(INT32_MIN);
        op(OP_I64EQ);
        lget(L_B);
        i64c(-1);
        op(OP_I64EQ);
        op(OP_I32AND);
        failIf();
      }
      if (cop == CacheOp::Int32DivResult) {
        lget(L_A);
        op(OP_I64EQZ);
        lget(L_B);
        i64c(0);
        op(OP_I64LTS);
        op(OP_I32AND);
        failIf();
        lget(L_A);
        lget(L_B);
        op(OP_I64REMS);
        op(OP_I64EQZ);
        op(OP_I32EQZ);
        failIf();
      }
      if (cop == CacheOp::Int32ModResult) {
        lget(L_A);
        lget(L_B);
        op(OP_I64REMS);
        op(OP_I64EQZ);
        lget(L_A);
        i64c(0);
        op(OP_I64LTS);
        op(OP_I32AND);
        failIf();
      }
      lget(L_A);
      lget(L_B);
      switch (cop) {
        case CacheOp::Int32AddResult:
          op(OP_I64ADD);
          break;
        case CacheOp::Int32SubResult:
          op(OP_I64SUB);
          break;
        case CacheOp::Int32MulResult:
          op(OP_I64MUL);
          break;
        case CacheOp::Int32DivResult:
          op(OP_I64DIVS);
          break;
        case CacheOp::Int32ModResult:
          op(OP_I64REMS);
          break;
        case CacheOp::Int32BitOrResult:
          op(OP_I64OR);
          break;
        case CacheOp::Int32BitXorResult:
          op(OP_I64XOR);
          break;
        default:
          op(OP_I64AND);
          break;
      }
      ltee(L_A);
      op(OP_I32WRAP);
      op(OP_I64EXTS);
      lget(L_A);
      op(OP_I64NE);
      failIf();
      lget(L_A);
      op(OP_I32WRAP);
      RET_INT32_FROM_I32();
      return true;
    }
    case CacheOp::Int32LeftShiftResult:
    case CacheOp::Int32RightShiftResult:
      readReg32(a[0]);
      readReg32(a[1]);
      i32c(0x1f);
      op(OP_I32AND);
      op(cop == CacheOp::Int32LeftShiftResult ? OP_I32SHL : OP_I32SHRS);
      RET_INT32_FROM_I32();
      return true;
    case CacheOp::Int32URightShiftResult:
      readReg32(a[0]);
      readReg32(a[1]);
      i32c(0x1f);
      op(OP_I32AND);
      op(OP_I32SHRU);
      ltee(L_X);
      i32c(0);
      op(OP_I32LTS);
      b.put(OP_IF);
      b.put(0x7e);
      lget(L_X);
      op(OP_F64CONVI32U);
      op(OP_I64REINTF64);
      b.put(OP_ELSE);
      lget(L_X);
      boxPayload(JSVAL_TAG_INT32);
      b.put(OP_END);
      lset(L_RET);
      return true;
    case CacheOp::Int32NotResult:
      readReg32(a[0]);
      i32c(-1);
      op(OP_I32XOR);
      RET_INT32_FROM_I32();
      return true;
    case CacheOp::Int32IncResult:
      readReg32(a[0]);
      ltee(L_X);
      i32c(INT32_MAX);
      op(OP_I32EQ);
      failIf();
      lget(L_X);
      i32c(1);
      op(OP_I32ADD);
      RET_INT32_FROM_I32();
      return true;
    case CacheOp::Int32MinMax: {
      // ((lhs > rhs) ^ isMax) ? rhs : lhs; WRITE_REG of int32: sign-extended
      bool isMax = a[0] != 0;
      readReg32(a[2]);
      readReg32(a[1]);
      readReg32(a[1]);
      readReg32(a[2]);
      op(OP_I32GTS);
      i32c(isMax ? 1 : 0);
      op(OP_I32XOR);
      op(OP_SELECT);
      op(OP_I64EXTS);
      writeReg(a[3], JSVAL_TAG_INT32);
      return true;
    }
    case CacheOp::CompareInt32Result:
    case CacheOp::CompareDoubleResult: {
      bool isInt = cop == CacheOp::CompareInt32Result;
      uint8_t cmp;
      switch (JSOp(a[0])) {
        case JSOp::Eq:
        case JSOp::StrictEq:
          cmp = isInt ? OP_I32EQ : OP_F64EQ;
          break;
        case JSOp::Ne:
        case JSOp::StrictNe:
          cmp = isInt ? OP_I32NE : OP_F64NE;
          break;
        case JSOp::Lt:
          cmp = isInt ? OP_I32LTS : OP_F64LT;
          break;
        case JSOp::Le:
          cmp = isInt ? OP_I32LES : OP_F64LE;
          break;
        case JSOp::Gt:
          cmp = isInt ? OP_I32GTS : OP_F64GT;
          break;
        case JSOp::Ge:
          cmp = isInt ? OP_I32GES : OP_F64GE;
          break;
        default:
          reason = "compare op";
          return false;
      }
      if (isInt) {
        readReg32(a[1]);
        readReg32(a[2]);
      } else {
        readValue(a[1]);
        toNumber();
        readValue(a[2]);
        toNumber();
      }
      op(cmp);
      boxBool();
      lset(L_RET);
      return true;
    }
    case CacheOp::MathAbsNumberResult:
    case CacheOp::MathFloorNumberResult:
    case CacheOp::MathCeilNumberResult:
      readValue(a[0]);
      toNumber();
      op(cop == CacheOp::MathAbsNumberResult     ? OP_F64ABS
         : cop == CacheOp::MathFloorNumberResult ? OP_F64FLOOR
                                                 : OP_F64CEIL);
      boxDouble();
      lset(L_RET);
      return true;
    case CacheOp::MathSqrtNumberResult:
      readValue(a[0]);
      toNumber();
      op(OP_F64SQRT);
      boxNumber();
      lset(L_RET);
      return true;
    case CacheOp::IsObjectResult:
      readValue(a[0]);
      tagIs(JSVAL_TAG_OBJECT);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::LoadProtoObject:
      // intptr_t -> uint64: sign-extended (WRITE_REG)
      field32(fieldOff(1));
      op(OP_I64EXTS);
      writeReg(a[0], JSVAL_TAG_OBJECT);
      return true;
    case CacheOp::GuardAnyClass:
      readReg32(a[0]);
      classOf();
      field32(fieldOff(1));
      op(OP_I32NE);
      failIf();
      return true;
    case CacheOp::GuardClass: {
      const JSClass* c1 = nullptr;
      const JSClass* c2 = nullptr;
      switch (GuardClassKind(a[1])) {
        case GuardClassKind::Array:
        case GuardClassKind::PlainObject:
        case GuardClassKind::FixedLengthArrayBuffer:
        case GuardClassKind::ImmutableArrayBuffer:
        case GuardClassKind::ResizableArrayBuffer:
        case GuardClassKind::FixedLengthSharedArrayBuffer:
        case GuardClassKind::GrowableSharedArrayBuffer:
        case GuardClassKind::FixedLengthDataView:
        case GuardClassKind::ImmutableDataView:
        case GuardClassKind::ResizableDataView:
        case GuardClassKind::MappedArguments:
        case GuardClassKind::UnmappedArguments:
        case GuardClassKind::Set:
        case GuardClassKind::Map:
        case GuardClassKind::BoundFunction:
        case GuardClassKind::Date:
        case GuardClassKind::Duration:
        case GuardClassKind::PlainTime:
        case GuardClassKind::PlainDateTime:
        case GuardClassKind::Instant:
        case GuardClassKind::ZonedDateTime:
        case GuardClassKind::WeakMap:
        case GuardClassKind::WeakSet:
          c1 = c2 = jit::ClassFor(GuardClassKind(a[1]));
          break;
        case GuardClassKind::JSFunction:
          // object->is<JSFunction>()
          c1 = js::FunctionClassPtr;
          c2 = js::FunctionExtendedClassPtr;
          break;
        default:
          return false;  // WindowProxy (runtime lookup) or unknown: step
      }
      readReg32(a[0]);
      classOf();
      ltee(L_X);
      i32c(int32_t(uintptr_t(c1)));
      op(OP_I32NE);
      lget(L_X);
      i32c(int32_t(uintptr_t(c2)));
      op(OP_I32NE);
      op(OP_I32AND);
      failIf();
      return true;
    }
    case CacheOp::IsTypedArrayResult:
      // Possibly wrapped objects may need IsPossiblyWrappedTypedArray: step.
      if (a[1]) return false;
      readReg32(a[0]);
      classOf();
      ltee(L_X);
      i32c(int32_t(uintptr_t(std::begin(TypedArrayObject::fixedLengthClasses))));
      op(OP_I32GEU);
      lget(L_X);
      i32c(int32_t(uintptr_t(std::end(TypedArrayObject::resizableClasses))));
      op(OP_I32LTU);
      op(OP_I32AND);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::StoreFixedSlot:
      readReg32(a[0]);
      field32(fieldOff(1));
      op(OP_I32ADD);
      lset(L_X);
      readValue(a[2]);
      lset(L_A);
      storeSlot(uintptr_t(&StoreFixedSlotBarriered), 2, [&] {
        lget(L_X);
        op(OP_I64EXTU);
        lget(L_A);
      });
      return true;
    case CacheOp::StoreDynamicSlot:
      // slots[offset / sizeof(Value)]
      readReg32(a[0]);
      load32(uint32_t(NativeObject::offsetOfSlots()));
      field32(fieldOff(1));
      i32c(3);
      op(OP_I32SHRU);
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      lset(L_X);
      readValue(a[2]);
      lset(L_A);
      storeSlot(uintptr_t(&StoreDynamicSlotBarriered), 3, [&] {
        readReg(a[0]);
        field32(fieldOff(1));
        op(OP_I64EXTU);
        lget(L_A);
      });
      return true;
    default:
      return false;
  }
}

bool Translator::run() {
  sdo = info->stubDataOffset();
  // Validate: known ops, operand ids within ICRegs.
  uint32_t nops = 0;
  for (uint32_t pos = 0; pos < len;) {
    if (pos + 2 > len) return reject("truncated");
    uint32_t o = uint32_t(code[pos]) | (uint32_t(code[pos + 1]) << 8);
    if (o >= uint32_t(CacheOp::NumOpcodes)) return reject("bad op");
    uint32_t n = kIcOpInfo[o].len;
    if (pos + 2 + n > len) return reject("truncated args");
    for (uint32_t i = 0; i < n && i < 32; i++) {
      if ((kIcOpInfo[o].idMask & (1u << i)) && code[pos + 2 + i] >= 16) {
        return reject("operand id >= 16");
      }
    }
    pos += 2 + n;
    if (++nops > kMaxOps) return reject("too many ops");
  }

  // Prologue: STUB, CTX; regs 0..2 = arg0, arg1, ctx.arg2 (WRITE_VALUE_REG).
  lget(2);
  op(OP_I32WRAP);
  lset(L_STUB);
  lget(3);
  op(OP_I32WRAP);
  lset(L_CTX);
  i32c(int32_t(uintptr_t(&gStats[kStatEntries])));
  ltee(L_X);
  lget(L_X);
  load32(0);
  i32c(1);
  op(OP_I32ADD);
  store32(0);
  lget(0);
  writeValueReg(0);
  lget(1);
  writeValueReg(1);
  lget(L_CTX);
  load64(kCtxArg2);
  writeValueReg(2);
  i64c(0);
  lset(L_RET);

  b.put(OP_BLOCK);
  b.put(OP_VOID);  // $fail
  for (uint32_t pos = 0; pos < len;) {
    uint32_t o = uint32_t(code[pos]) | (uint32_t(code[pos + 1]) << 8);
    uint32_t n = kIcOpInfo[o].len;
    const uint8_t* a = code + pos + 2;
    uint32_t end = pos + 2 + n;
    bool last = end == len;
    uint32_t savedDepth = depth;
    if (translateOp(CacheOp(o), a)) {
      nInline++;
    } else {
      if (reason) return false;
      uint32_t ids = 0;
      for (uint32_t i = 0; i < n && i < 32; i++) {
        if (kIcOpInfo[o].idMask & (1u << i)) ids |= 1u << a[i];
      }
      step(pos, end, last, ids);
    }
    if (depth != savedDepth) return reject("internal depth");
    pos = end;
  }
  lget(L_RET);
  op(OP_RETURN);
  b.put(OP_END);  // $fail
  // Failure: count it, then call stub->next's code like CallNextIC.
  i32c(int32_t(uintptr_t(&gStats[kStatFails])));
  ltee(L_X);
  lget(L_X);
  load32(0);
  i32c(1);
  op(OP_I32ADD);
  store32(0);
  lget(L_STUB);
  load32(uint32_t(ICCacheIRStub::offsetOfNext()));
  lset(L_Y);
  lget(0);
  lget(1);
  lget(L_Y);
  op(OP_I64EXTU);
  lget(3);
  padArgs();
  lget(L_Y);
  load32(uint32_t(ICStub::offsetOfStubCode()));
  b.put(OP_CALLIND);
  b.uleb(0);
  b.uleb(0);
  b.put(OP_END);  // function
  return !b.oom || reject("oom");
}

bool Translator::assemble(Buf& m) {
  Buf c;
  Buf body;
  // Locals: i64, i32 and f64 groups.
  body.uleb(3);
  body.uleb(kI64Locals);
  body.put(0x7e);
  body.uleb(kI32Locals);
  body.put(0x7f);
  body.uleb(kF64Locals);
  body.put(0x7c);
  body.putn(b.p, b.n);

  m.putn("\0asm\1\0\0\0", 8);
  // Type 0: (23 x i64) -> i64, the fpcast-emu signature of every IC stub.
  c.uleb(1);
  c.put(0x60);
  c.uleb(kParams);
  for (uint32_t i = 0; i < kParams; i++) c.put(0x7e);
  c.uleb(1);
  c.put(0x7e);
  m.section(1, c);
  // Imports: env.table (funcref) and the shared env.memory.
  c.uleb(2);
  c.name("env");
  c.name("table");
  c.put(0x01);
  c.put(0x70);
  c.put(0x00);
  c.uleb(0);
  c.name("env");
  c.name("memory");
  c.put(0x02);
  c.put(0x03);
  c.uleb(1);
  c.uleb(65536);
  m.section(2, c);
  c.uleb(1);
  c.uleb(0);
  m.section(3, c);
  c.uleb(1);
  c.name("f0");
  c.put(0);
  c.uleb(0);
  m.section(7, c);
  c.uleb(1);
  c.uleb(uint32_t(body.n));
  c.putn(body.p, body.n);
  m.section(10, c);
  if (m.oom || c.oom || body.oom) return reject("oom");
  return true;
}

// ---- per-thread cache keyed by stub info ------------------------------------

struct Entry {
  const CacheIRStubInfo* info;
  uint8_t* copy;  // code bytes when compiled (content check on reuse)
  uint32_t len;
  uint32_t hits;
  uint32_t fn;
  uint8_t sdo;
  uint8_t state;  // 0 counting, 1 compiled, 2 rejected
};

thread_local Entry* tTable;

uint32_t Hash(const void* p) {
  uint32_t h = uint32_t(uintptr_t(p)) * 2654435761u;
  h ^= h >> 15;
  return h >> (32 - kTableBits);
}

bool SameContent(const Entry* e, const CacheIRStubInfo* info) {
  return e->len == info->codeLength() && e->sdo == info->stubDataOffset() &&
         memcmp(e->copy, info->code(), e->len) == 0;
}

void Compile(Entry* e, const CacheIRStubInfo* info) {
  if (gInstalls.load(std::memory_order_relaxed) >= kMaxInstalls) {
    e->state = 2;
    return;
  }
  Translator t;
  t.info = info;
  t.code = info->code();
  t.len = info->codeLength();
  Buf m;
  bool ok = t.run() && t.assemble(m);
  uint32_t idx[1] = {0};
  long rc = 0;
  if (ok) {
    rc = syscall(SYS_jit_install, long(uintptr_t(m.p)), long(m.n),
                 kInstallPrivate, long(uintptr_t(idx)));
    if (rc != 0 || !idx[0]) {
      ok = false;
      t.reason = "install failed";
    }
  }
  if (ok) {
    e->copy = static_cast<uint8_t*>(malloc(t.len ? t.len : 1));
    if (!e->copy) {
      ok = false;
      t.reason = "oom";
    }
  }
  if (!ok) {
    e->state = 2;
    gRejects.fetch_add(1, std::memory_order_relaxed);
    if (TakeLog()) {
      fprintf(stderr, "PBLIC reject len=%u reason=%s rc=%ld bytes=%zu\n", t.len,
              t.reason ? t.reason : "?", rc, m.n);
    }
    return;
  }
  memcpy(e->copy, t.code, t.len);
  e->len = t.len;
  e->sdo = uint8_t(info->stubDataOffset());
  e->fn = idx[0];
  e->state = 1;
  gInstalls.fetch_add(1, std::memory_order_relaxed);
  uint32_t n = gCompiles.fetch_add(1, std::memory_order_relaxed) + 1;
  if (TakeLog()) {
    fprintf(stderr,
            "PBLIC compile #%u len=%u inline=%u step=%u wasm=%zu idx=%u\n", n,
            t.len, t.nInline, t.nStep, m.n, idx[0]);
  }
  if ((n & (n - 1)) == 0) PrintStats("compiles");
}

// Returns the code this stub should use from now on, or null to keep
// counting through PblIcEntry.
uint8_t* Enter(ICCacheIRStub* stub) {
  uint8_t* interp = reinterpret_cast<uint8_t*>(&ICInterpretOps);
  if (!Enabled()) return interp;
  if (!tTable) {
    tTable =
        static_cast<Entry*>(calloc(size_t(1) << kTableBits, sizeof(Entry)));
    if (!tTable) return interp;
  }
  const CacheIRStubInfo* info = stub->stubInfo();
  uint32_t h = Hash(info);
  Entry* e = nullptr;
  for (uint32_t i = 0; i < kProbe; i++) {
    Entry* c = &tTable[(h + i) & ((1u << kTableBits) - 1)];
    if (c->info == info) {
      e = c;
      break;
    }
    if (!c->info && !e) e = c;
  }
  if (!e) {
    // Neighbourhood full: reuse the home slot.
    e = &tTable[h];
    free(e->copy);
    memset(e, 0, sizeof *e);
  }
  if (e->info != info) {
    free(e->copy);
    memset(e, 0, sizeof *e);
    e->info = info;
  } else if (e->state == 1 && !SameContent(e, info)) {
    // The stub info memory was reused for other CacheIR: start again.
    free(e->copy);
    memset(e, 0, sizeof *e);
    e->info = info;
  }
  if (e->state == 0 && ++e->hits >= kHits) Compile(e, info);
  if (e->state == 1) return reinterpret_cast<uint8_t*>(uintptr_t(e->fn));
  if (e->state == 2) return interp;
  return nullptr;
}

}  // namespace pblic

static uint64_t PblIcEntry(uint64_t arg0, uint64_t arg1, ICStub* stub,
                           ICCtx& ctx) {
  uint8_t* code = pblic::Enter(stub->toCacheIRStub());
  if (!code) return ICInterpretOps(arg0, arg1, stub, ctx);
  stub->updateRawJitCode(code);
  ICStubFunc func = reinterpret_cast<ICStubFunc>(code);
  return func(arg0, arg1, stub, ctx);
}
