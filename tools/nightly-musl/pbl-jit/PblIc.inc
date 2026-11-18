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
const uint32_t kCtxExtraArgs =
    uint32_t(offsetof(ICCtx, icregs) + offsetof(ICRegs, extraArgs));
const uint32_t kCtxSp = uint32_t(offsetof(ICCtx, sp_));
// VMFrameManager is {cx, frame} (standard layout), so cx is at its offset 0.
static_assert(std::is_standard_layout_v<VMFrameManager>);
static_assert(sizeof(VMFrameManager) == 2 * sizeof(void*));
const uint32_t kCtxCx = uint32_t(offsetof(ICCtx, frameMgr));
const uint32_t kCtxArg2 = uint32_t(offsetof(ICCtx, arg2));
const uint32_t kCtxGetterReq = uint32_t(offsetof(ICCtx, getterReq));
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
std::atomic<bool> gLogEnabled{false};
std::atomic<int> gEnabled{-1};
uint32_t gNextStatSteps = 1u << 20;
// PBLIC_DYNSTAT=1: dynamic accounting of whole-stub ICInterpretOps runs by
// reason (per stub info) and of stepped ops, printed at exit.
bool gDynStat = false;
uint64_t gStepOps64[size_t(CacheOp::NumOpcodes)];
void PrintDynStat();

bool Enabled() {
  int e = gEnabled.load(std::memory_order_relaxed);
  if (e < 0) {
    const char* v = getenv("PBLIC");
    e = (v && v[0] == '0') ? 0 : 1;
    const char* l = getenv("PBLIC_LOG");
    const int logBudget = l ? atoi(l) : 40;
    gLogBudget.store(logBudget, std::memory_order_relaxed);
    gLogEnabled.store(logBudget > 0, std::memory_order_relaxed);
    gEnabled.store(e, std::memory_order_relaxed);
    const char* ds = getenv("PBLIC_DYNSTAT");
    if (ds && ds[0] == '1') {
      gDynStat = true;
      atexit(PrintDynStat);
    }
    if (logBudget > 0) {
      fprintf(stderr, "PBLIC %s (threshold=%u)\n", e ? "enabled" : "disabled",
              kHits);
    }
  }
  return e != 0;
}

bool TakeLog() {
  return gLogEnabled.load(std::memory_order_relaxed) &&
         gLogBudget.fetch_sub(1, std::memory_order_relaxed) > 0;
}

void PrintStats(const char* why) {
  if (!gLogEnabled.load(std::memory_order_relaxed)) return;
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
  if (op < uint32_t(CacheOp::NumOpcodes)) {
    gStepOps[op]++;
    if (gDynStat) gStepOps64[op]++;
  }
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

// PBLIC_OPS2: bitmask of the ops translated since the dynamic step census
// (default all on; 0 steps them through ICInterpretOps as before):
// 1 MathImulResult, 2 TruncateDoubleToUInt32, 4 LoadInstanceOfObjectResult,
// 8 CompareNullUndefinedResult, 16 LoadObjectTruthyResult,
// 32 AddAndStoreFixedSlot, 64 GuardArrayIsPacked, 128 GuardFuse,
// 256 HasClassResult, 512 IsCallableResult, 1024 LoadArgumentsObjectLength
// (Result), 2048 LoadArgumentsObjectArgResult, 4096 LoadStringCharCodeResult,
// 8192 ArrayPush (helper), 16384 StoreDenseElementHole (helper),
// 32768 CallSubstringKernelResult (helper), 65536
// RegExpSearcherLastLimitResult, 131072 MegamorphicLoadSlotResult (helper),
// 262144 CallNativeFunction (helper).
uint32_t Ops2() {
  static const uint32_t m = [] {
    const char* v = getenv("PBLIC_OPS2");
    return v ? uint32_t(strtoul(v, nullptr, 0)) : 0xffffffffu;
  }();
  return m;
}

// TruncateDoubleToUInt32 slow path (|d| >= 2^63 or NaN): JS::ToInt32,
// returned sign-extended as WRITE_REG stores an int32.
uint64_t TruncToInt32Slow(uint64_t dbits) {
  double d = mozilla::BitwiseCast<double>(dbits);
  return uint64_t(int64_t(JS::ToInt32(d)));
}
// AddAndStoreFixedSlot (preserveWrapper == false): the interpreter's exact
// barriered shape change (JSObject::setShape pre-barriers the old shape) and
// slot init (post-barrier).
uint64_t AddAndStoreFixedSlotHelper(uintptr_t obj, uint32_t offset,
                                    uint64_t bits, uintptr_t shape) {
  JSObject* o = reinterpret_cast<JSObject*>(obj);
  o->setShape(reinterpret_cast<Shape*>(shape));
  reinterpret_cast<GCPtr<Value>*>(obj + offset)->init(Value::fromRawBits(bits));
  return 0;
}

// LoadStringCharCodeResult for a non-linear string: the interpreter's exact
// str->getChar(nullptr, index, &c) (preceded by LinearizeForCharAccess).
uint64_t StringCharHelper(uintptr_t str, uint32_t index) {
  char16_t c;
  MOZ_ALWAYS_TRUE(
      reinterpret_cast<JSString*>(str)->getChar(nullptr, index, &c));
  return c;
}
// ArrayPush: the CACHEOP_CASE body; returns Int32Value(initLength + 1) bits,
// or 0 (never a valid Int32 Value) where it does FAIL_IC (before mutating).
uint64_t ArrayPushHelper(uintptr_t ctxp, uintptr_t obj, uint64_t rhsBits) {
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(ctxp);
  Value rhs = Value::fromRawBits(rhsBits);
  ArrayObject* aobj = &reinterpret_cast<JSObject*>(obj)->as<ArrayObject>();
  uint32_t initLength = aobj->getDenseInitializedLength();
  if (aobj->length() != initLength) {
    return 0;
  }
  if (initLength >= aobj->getDenseCapacity()) {
    if (!NativeObject::addDenseElementPure(ctx.frameMgr.cxForLocalUseOnly(),
                                           aobj)) {
      return 0;
    }
  }
  aobj->setDenseInitializedLength(initLength + 1);
  aobj->setLengthToInitializedLength();
  aobj->initDenseElement(initLength, rhs);
  return Int32Value(initLength + 1).asRawBits();
}
// StoreDenseElementHole: the CACHEOP_CASE body; 1 on success, 0 for FAIL_IC
// (before mutating).
uint64_t StoreDenseElementHoleHelper(uintptr_t ctxp, uintptr_t obj,
                                     uint32_t index, uint64_t rhsBits,
                                     uint32_t handleAdd) {
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(ctxp);
  Value rhs = Value::fromRawBits(rhsBits);
  NativeObject* nobj = &reinterpret_cast<JSObject*>(obj)->as<NativeObject>();
  uint32_t initLength = nobj->getDenseInitializedLength();
  if (index < initLength) {
    nobj->setDenseElement(index, rhs);
  } else if (!handleAdd || index > initLength) {
    return 0;
  } else {
    if (index >= nobj->getDenseCapacity()) {
      if (!NativeObject::addDenseElementPure(ctx.frameMgr.cxForLocalUseOnly(),
                                             nobj)) {
        return 0;
      }
    }
    nobj->setDenseInitializedLength(initLength + 1);
    if (nobj->is<ArrayObject>()) {
      ArrayObject* aobj = &nobj->as<ArrayObject>();
      uint32_t len = aobj->length();
      if (len <= index) {
        aobj->setLength(ctx.frameMgr.cxForLocalUseOnly(), len + 1);
      }
    }
    nobj->initDenseElement(index, rhs);
  }
  return 1;
}

// Helpers that can GC or throw copy their CACHEOP_CASE body including its
// PUSH_IC_FRAME exit frame and ReservedRooted roots; on error they set
// ctx.error and return IC_ERROR_SENTINEL, which the stub returns as is
// (exactly what a stepped op's ICInterpretOps call returns). No other IC
// register is rooted, as when stepped (ctx.icregs is not traced either).

// CallSubstringKernelResult: string Value bits or IC_ERROR_SENTINEL.
uint64_t SubstringKernelHelper(uintptr_t ctxp, uintptr_t strp, uint32_t begin,
                               uint32_t length) {
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(ctxp);
  JSString* str = reinterpret_cast<JSString*>(strp);
  PUSH_IC_FRAME();
  ReservedRooted<JSString*> str0(&ctx.state.str0, str);
  auto* result = SubstringKernel(cx, str0, int32_t(begin), int32_t(length));
  if (!result) {
    ctx.error = PBIResult::Error;
    return IC_ERROR_SENTINEL();
  }
  return StringValue(result).asRawBits();
}
// MegamorphicLoadSlotResult (cannot GC): 1 with the result in ctx.stepRet
// (any Value, including bits 0), 0 where the case does FAIL_IC.
uint64_t MegamorphicLoadSlotHelper(uintptr_t ctxp, uintptr_t objp,
                                   uintptr_t nameBits) {
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(ctxp);
  JSObject* obj = reinterpret_cast<JSObject*>(objp);
  jsid name = jsid::fromRawBits(nameBits);
  if (!obj->shape()->isNative()) {
    return 0;
  }
  Value result;
  if (!GetNativeDataPropertyPureWithCacheLookup(
          ctx.frameMgr.cxForLocalUseOnly(), obj, name, nullptr, &result)) {
    return 0;
  }
  ctx.stepRet = result.asRawBits();
  return 1;
}
// CallNativeFunction (same-realm, Standard arg format: checked statically by
// the translator, which steps the op otherwise). mode bit 0 isConstructing,
// bit 1 ignoresRv. The ICInterpretOps case body for isNative == true:
// 0 where it does FAIL_IC (before any side effect), 1 with the result in
// ctx.stepRet, IC_ERROR_SENTINEL with ctx.error = Error on overrecursion or
// a failed native.
uint64_t CallNativeHelper(uintptr_t ctxp, uintptr_t stubp, uintptr_t calleep,
                          uint32_t argc, uint32_t mode) {
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(ctxp);
  ICCacheIRStub* cstub = reinterpret_cast<ICCacheIRStub*>(stubp);
  JSFunction* callee = reinterpret_cast<JSFunction*>(calleep);
  const bool isConstructing = mode & 1;
  const bool ignoresRv = mode & 2;
  if (isConstructing && !callee->isConstructor()) {
    return 0;
  }
  uint32_t extra = 1 + isConstructing + 1;
  uint32_t totalArgs = argc + extra;
  StackVal* origArgs = ctx.sp();
  uint64_t retValue;
  {
    PUSH_IC_FRAME();
    if (!ctx.stack.check(sp, sizeof(StackVal) * (totalArgs + 6))) {
      ReportOverRecursed(ctx.frameMgr.cxForLocalUseOnly());
      ctx.error = PBIResult::Error;
      return IC_ERROR_SENTINEL();
    }
    AutoKeepJitScripts keepJitScripts(cx);
    POPNNATIVE(1);
    PUSHNATIVE(StackValNative(cstub));
    if (isConstructing) {
      PUSH(origArgs[0]);
      origArgs++;
    }
    for (uint32_t i = 0; i < argc + 1 + 1; i++) {
      PUSH(origArgs[i]);
    }
    Value* args = reinterpret_cast<Value*>(sp);
    PUSHNATIVE(StackValNative(argc));
    PUSHNATIVE(StackValNative(MakeFrameDescriptor(FrameType::BaselineStub)));
    StackVal* trampolinePrevFP = ctx.stack.fp;
    PUSHNATIVE(StackValNative(nullptr));  // fake return address.
    PUSHNATIVE(StackValNative(ctx.stack.fp));
    ctx.stack.fp = sp;
    PUSHNATIVE(StackValNative(uint32_t(
        isConstructing ? ExitFrameType::ConstructNative
                       : ExitFrameType::CallNative)));
    cx.getCx()->activation()->asJit()->setJSExitFP(
        reinterpret_cast<uint8_t*>(ctx.stack.fp));
    cx.getCx()->portableBaselineStack().top = reinterpret_cast<void*>(sp);
    JSNative native = ignoresRv ? callee->jitInfo()->ignoresReturnValueMethod
                                : callee->native();
    bool success = native(cx, argc, args);
    ctx.stack.fp = trampolinePrevFP;
    POPNNATIVE(4);
    if (!success) {
      ctx.error = PBIResult::Error;
      return IC_ERROR_SENTINEL();
    }
    retValue = args[0].asRawBits();
  }
  ctx.stepRet = retValue;
  return 1;
}

// PBLBC_GETTER refusal: exactly the remainder of ICInterpretOps'
// CallScriptedGetterResult case after its checks (the nested run), for the
// getter, receiver and stub it stored in ctx. Called by the compiled GetProp
// op right after the IC returned PBL_GETTER_SENTINEL() (ctx.sp() and the
// frame's interpreterPC/ICEntry are still the IC call's). Returns the value
// bits or IC_ERROR_SENTINEL with ctx.error set.
uint64_t ScriptedGetterNested(ICCtx& ctx, JSFunction* callee, Value receiver,
                              ICCacheIRStub* cstub) {
  uint64_t retValue;
  {
    PUSH_IC_FRAME();
    if (!ctx.stack.check(sp, sizeof(StackVal) * 8)) {
      ReportOverRecursed(ctx.frameMgr.cxForLocalUseOnly());
      ctx.error = PBIResult::Error;
      return IC_ERROR_SENTINEL();
    }
    POPNNATIVE(1);
    PUSHNATIVE(StackValNative(cstub));
    PUSH(StackVal(receiver));
    PUSHNATIVE(StackValNative(
        CalleeToToken(callee, /* isConstructing = */ false)));
    PUSHNATIVE(StackValNative(
        MakeFrameDescriptorForJitCall(FrameType::BaselineStub, /* argc = */ 0)));
    JSScript* script = callee->nonLazyScript();
    jsbytecode* pc = script->code();
    ImmutableScriptData* isd = script->immutableScriptData();
    Value ret;
    PBIResult result = PortableBaselineInterpret<false, kHybridICsInterp>(
        cx, ctx.state, ctx.stack, sp, /* envChain = */ nullptr, &ret, pc, isd,
        nullptr, nullptr, nullptr, PBIResult::Ok);
    if (result != PBIResult::Ok) {
      ctx.error = result;
      return IC_ERROR_SENTINEL();
    }
    retValue = ret.asRawBits();
  }
  return retValue;
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
  OP_LOOP = 0x03,
  OP_F64CONST = 0x44,
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
  OP_I32LOAD8U = 0x2d,
  OP_I32LOAD16U = 0x2f,
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
// Append the diagnostic i64 local after all original local groups.
constexpr uint32_t L_OBSERVATION = L_D1 + 1;

// Inline mode scratch locals (see EmitInline below).
constexpr uint32_t kInlineI64Locals = 35;  // V[16] T[16] RET A B
constexpr uint32_t kInlineI32Locals = 3;   // X Y Z
constexpr uint32_t kInlineF64Locals = 2;   // D0 D1
constexpr uint32_t kInlineLocals =
    kInlineI64Locals + kInlineI32Locals + kInlineF64Locals;

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
  uint32_t nInline = 0, nStep = 0, nOps = 0;
  pbltier::IcDescriptor* observation = nullptr;
  // Local indices, type/table indices and fail-branch base. The defaults are
  // the standalone layout (shadowing the namespace constants above), so the
  // standalone function is byte-identical; EmitInline() remaps them.
  uint32_t L_V = pblic::L_V, L_T = pblic::L_T, L_RET = pblic::L_RET,
           L_A = pblic::L_A, L_B = pblic::L_B, L_STUB = pblic::L_STUB,
           L_CTX = pblic::L_CTX, L_X = pblic::L_X, L_Y = pblic::L_Y,
           L_Z = pblic::L_Z, L_D0 = pblic::L_D0, L_D1 = pblic::L_D1;
  uint32_t typeIdx = 0, tableIdx = 0;
  uint32_t failBase = 0;    // extra depth from the op body to the fail label
  bool inlineMode = false;  // no stepping, no observation, no returns
  uint32_t inlResult = 0, inlDone = 0;  // runInline's result / doneDepth

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
    b.uleb(depth + failBase);
  }
  void fail() {
    b.put(OP_BR);
    b.uleb(depth + failBase);
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
    b.uleb(typeIdx);
    b.uleb(tableIdx);
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

  // The original result is already on the stack; the helper returns it
  // unchanged. No callbacks or extra locals are emitted in observation-off mode.
  void observeReturn() {
    if (!observation) return;
    i64c(int64_t(uintptr_t(observation)));
    lget(3);  // ICCtx, not an assumed current bytecode PC.
    lget(L_OBSERVATION);
    padArgs();
    i32c(int32_t(uintptr_t(&pbltier::IcReturn)));
    b.put(OP_CALLIND);
    b.uleb(0);
    b.uleb(0);
  }
  void returnValue() {
    observeReturn();
    op(OP_RETURN);
  }

  // The i64 in L_A (a helper's result): when it is IC_ERROR_SENTINEL, end
  // the stub with it now, as a stepped op's error result does (standalone:
  // return it; inline: it is the sequence's result, branch to done).
  void returnIfErrorSentinel() {
    lget(L_A);
    i64c(int64_t(IC_ERROR_SENTINEL()));
    op(OP_I64EQ);
    ifThen();
    lget(L_A);
    if (inlineMode) {
      lset(inlResult);
      b.put(OP_BR);
      b.uleb(depth + inlDone);
    } else {
      returnValue();
    }
    endIf();
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
      returnValue();
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
    returnValue();
    b.put(OP_END);
    lget(L_A);
    lset(L_RET);
    reload(ids);
  }

  bool translateOp(CacheOp cop, const uint8_t* a);
  bool validate();
  bool run();
  bool runStandalone();
  bool runInlineTest();
  bool inlineTest = false;
  bool runInline(uint32_t arg0, uint32_t arg1, uint32_t result,
                 uint32_t doneDepth);
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
    case CacheOp::LoadDenseElementResult:
    case CacheOp::LoadDenseElementExistsResult:
    case CacheOp::StoreDenseElement: {
      bool exists = cop == CacheOp::LoadDenseElementExistsResult;
      bool storing = cop == CacheOp::StoreDenseElement;
      bool packed = !exists && a[storing ? 3 : 2] != 0;
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
      lset(storing ? L_B : L_RET);
      if (!packed) {
        lget(storing ? L_B : L_RET);
        tagIs(JSVAL_TAG_MAGIC);
        failIf();
      }
      if (storing) {
        const int32_t gcTag =
            int32_t(uint32_t(JS::detail::ValueLowerInclGCThingTag));
        readValue(a[2]);
        lset(L_A);
        lget(L_B);
        hi();
        i32c(gcTag);
        op(OP_I32GEU);
        lget(L_A);
        hi();
        i32c(gcTag);
        op(OP_I32GEU);
        op(OP_I32OR);
        failIf();
        lget(L_Y);
        lget(L_X);
        i32c(3);
        op(OP_I32SHL);
        op(OP_I32ADD);
        lget(L_A);
        store64(0);
      }
      if (exists) {
        i32c(1);
        boxBool();
        lset(L_RET);
      }
      return true;
    }
    case CacheOp::LoadStringLengthResult:
      readReg32(a[0]);
      load32(uint32_t(JSString::offsetOfLength()));
      ltee(L_X);
      i32c(0);
      op(OP_I32LTS);
      failIf();
      lget(L_X);
      RET_INT32_FROM_I32();
      return true;
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
    case CacheOp::CompareStringResult: {
      const JSOp comparison = JSOp(a[0]);
      const bool equal = comparison == JSOp::Eq || comparison == JSOp::StrictEq;
      const bool notEqual =
          comparison == JSOp::Ne || comparison == JSOp::StrictNe;
      if (!equal && !notEqual && comparison != JSOp::Lt &&
          comparison != JSOp::Le && comparison != JSOp::Gt &&
          comparison != JSOp::Ge) {
        return false;
      }
      readReg32(a[1]);
      readReg32(a[2]);
      op(OP_I32EQ);
      ifThen();
      i32c(equal || comparison == JSOp::Le || comparison == JSOp::Ge);
      boxBool();
      lset(L_RET);
      elseThen();
      if (equal || notEqual) {
        readReg32(a[1]);
        load32(uint32_t(JSString::offsetOfFlags()));
        readReg32(a[2]);
        load32(uint32_t(JSString::offsetOfFlags()));
        op(OP_I32AND);
        i32c(int32_t(StringFlags::ATOM_BIT));
        op(OP_I32AND);
        readReg32(a[1]);
        load32(uint32_t(JSString::offsetOfLength()));
        readReg32(a[2]);
        load32(uint32_t(JSString::offsetOfLength()));
        op(OP_I32NE);
        op(OP_I32OR);
        op(OP_I32EQZ);
        failIf();
        i32c(notEqual);
        boxBool();
        lset(L_RET);
      } else {
        fail();
      }
      endIf();
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
      readReg32(a[0]);
      classOf();
      ltee(L_X);
      if (a[1]) {
        lget(L_X);
        load32(uint32_t(offsetof(JSClass, flags)));
        i32c(int32_t(JSCLASS_IS_PROXY));
        op(OP_I32AND);
        failIf();
      }
      i32c(int32_t(uintptr_t(std::begin(TypedArrayObject::fixedLengthClasses))));
      op(OP_I32GEU);
      lget(L_X);
      i32c(int32_t(uintptr_t(std::end(TypedArrayObject::resizableClasses))));
      op(OP_I32LTU);
      op(OP_I32AND);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::MathImulResult:
      if (!(Ops2() & 1)) return false;
      readReg32(a[0]);
      readReg32(a[1]);
      op(OP_I32MUL);
      boxPayload(JSVAL_TAG_INT32);
      lset(L_RET);
      return true;
    case CacheOp::TruncateDoubleToUInt32: {
      // JS::ToInt32(toNumber()): |d| < 2^63 -> i64.trunc_sat_f64_s then
      // wrap (exact modular result); NaN/large -> TruncToInt32Slow.
      if (!(Ops2() & 2)) return false;
      readValue(a[0]);
      toNumber();
      ltee(L_D0);
      op(OP_F64ABS);
      b.put(OP_F64CONST);
      {
        double lim = 9223372036854775808.0;
        uint64_t bits = mozilla::BitwiseCast<uint64_t>(lim);
        for (int i = 0; i < 8; i++) b.put(uint8_t(bits >> (8 * i)));
      }
      op(OP_F64LT);
      b.put(OP_IF);
      b.put(0x7e);
      lget(L_D0);
      b.put(OP_PREFIX_FC);
      b.uleb(6);  // i64.trunc_sat_f64_s
      op(OP_I32WRAP);
      op(OP_I64EXTS);
      b.put(OP_ELSE);
      lget(L_D0);
      op(OP_I64REINTF64);
      callHelper(uintptr_t(&TruncToInt32Slow), 1);
      b.put(OP_END);
      writeReg(a[1], JSVAL_TAG_INT32);
      return true;
    }
    case CacheOp::LoadInstanceOfObjectResult: {
      // Walk lhs's proto chain: lazy proto (1) fails, null -> false,
      // rhsProto -> true; non-object lhs -> false.
      if (!(Ops2() & 4)) return false;
      i32c(0);
      lset(L_Z);
      readReg32(a[1]);
      lset(L_Y);
      readValue(a[0]);
      ltee(L_A);
      tagIs(JSVAL_TAG_OBJECT);
      ifThen();
      lget(L_A);
      op(OP_I32WRAP);
      lset(L_X);
      b.put(OP_BLOCK);
      b.put(OP_VOID);
      depth++;
      b.put(OP_LOOP);
      b.put(OP_VOID);
      depth++;
      lget(L_X);
      protoOf();
      ltee(L_X);
      i32c(1);
      op(OP_I32EQ);
      failIf();
      lget(L_X);
      op(OP_I32EQZ);
      b.put(OP_BRIF);
      b.uleb(1);  // $out, result false
      lget(L_X);
      lget(L_Y);
      op(OP_I32EQ);
      ltee(L_Z);
      b.put(OP_BRIF);
      b.uleb(1);  // $out, result true
      b.put(OP_BR);
      b.uleb(0);  // loop
      b.put(OP_END);
      depth--;
      b.put(OP_END);
      depth--;
      endIf();
      lget(L_Z);
      boxBool();
      lset(L_RET);
      return true;
    }
    case CacheOp::CompareNullUndefinedResult: {
      // a: jsop, isUndefined, inputId. Proxy objects fail for every op.
      if (!(Ops2() & 8)) return false;
      JSOp jop = JSOp(a[0]);
      bool isUndef = a[1] != 0;
      if (jop != JSOp::Eq && jop != JSOp::Ne && jop != JSOp::StrictEq &&
          jop != JSOp::StrictNe) {
        return false;
      }
      i32c(0);
      lset(L_Z);  // emulatesUndefined
      readValue(a[2]);
      ltee(L_A);
      tagIs(JSVAL_TAG_OBJECT);
      ifThen();
      lget(L_A);
      op(OP_I32WRAP);
      classOf();
      load32(uint32_t(offsetof(JSClass, flags)));
      ltee(L_X);
      i32c(int32_t(JSCLASS_IS_PROXY));
      op(OP_I32AND);
      failIf();
      lget(L_X);
      i32c(int32_t(JSCLASS_EMULATES_UNDEFINED));
      op(OP_I32AND);
      op(OP_I32EQZ);
      op(OP_I32EQZ);
      lset(L_Z);
      endIf();
      if (jop == JSOp::Eq || jop == JSOp::Ne) {
        lget(L_A);
        tagIs(JSVAL_TAG_UNDEFINED);
        lget(L_A);
        tagIs(JSVAL_TAG_NULL);
        op(OP_I32OR);
        lget(L_Z);
        op(OP_I32OR);
        if (jop == JSOp::Ne) op(OP_I32EQZ);
      } else {
        lget(L_A);
        tagIs(isUndef ? JSVAL_TAG_UNDEFINED : JSVAL_TAG_NULL);
        if (jop == JSOp::StrictNe) op(OP_I32EQZ);
      }
      boxBool();
      lset(L_RET);
      return true;
    }
    case CacheOp::LoadObjectTruthyResult:
      if (!(Ops2() & 16)) return false;
      readReg32(a[0]);
      classOf();
      load32(uint32_t(offsetof(JSClass, flags)));
      ltee(L_X);
      i32c(int32_t(JSCLASS_IS_PROXY));
      op(OP_I32AND);
      failIf();
      lget(L_X);
      i32c(int32_t(JSCLASS_EMULATES_UNDEFINED));
      op(OP_I32AND);
      op(OP_I32EQZ);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::AddAndStoreFixedSlot:
      // a: objId, offsetOffset, rhsId, newShapeOffset, preserveWrapper.
      if (!(Ops2() & 32) || a[4]) return false;
      readReg(a[0]);
      field32(fieldOff(1));
      op(OP_I64EXTU);
      readValue(a[2]);
      field32(fieldOff(3));
      op(OP_I64EXTU);
      callHelper(uintptr_t(&AddAndStoreFixedSlotHelper), 4);
      op(OP_DROP);
      return true;
    case CacheOp::GuardArrayIsPacked:
      // IsPackedArray: ArrayObject, initializedLength == length, !NON_PACKED.
      if (!(Ops2() & 64)) return false;
      readReg32(a[0]);
      ltee(L_X);
      classOf();
      i32c(int32_t(uintptr_t(&ArrayObject::class_)));
      op(OP_I32NE);
      failIf();
      lget(L_X);
      load32(uint32_t(NativeObject::offsetOfElements()));
      lset(L_Y);
      lget(L_Y);
      i32c(ObjectElements::offsetOfInitializedLength());
      op(OP_I32ADD);
      load32(0);
      lget(L_Y);
      i32c(ObjectElements::offsetOfLength());
      op(OP_I32ADD);
      load32(0);
      op(OP_I32NE);
      failIf();
      lget(L_Y);
      i32c(ObjectElements::offsetOfFlags());
      op(OP_I32ADD);
      load32(0);
      i32c(int32_t(ObjectElements::NON_PACKED));
      op(OP_I32AND);
      failIf();
      return true;
    case CacheOp::GuardFuse: {
      // cx->realm()->realmFuses.getFuseByIndex(i)->intact(): fuse word == 0.
      if (!(Ops2() & 128)) return false;
      if (a[0] >= uint32_t(RealmFuses::FuseIndex::LastFuseIndex)) return false;
      int32_t fuseOff = RealmFuses::offsetOfFuseWordRelativeToRealm(
          RealmFuses::FuseIndex(a[0]));
      if (fuseOff < 0) return false;
      lget(L_CTX);
      load32(kCtxCx);
      load32(uint32_t(JSContext::offsetOfRealm()));
      load32(uint32_t(fuseOff));
      failIf();
      return true;
    }
    case CacheOp::HasClassResult:
      if (!(Ops2() & 256)) return false;
      readReg32(a[0]);
      classOf();
      field32(fieldOff(1));
      op(OP_I32EQ);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::IsCallableResult:
      // Non-object false; proxy fails; JSFunction or clasp->getCall().
      if (!(Ops2() & 512)) return false;
      i32c(0);
      lset(L_Z);
      readValue(a[0]);
      ltee(L_A);
      tagIs(JSVAL_TAG_OBJECT);
      ifThen();
      lget(L_A);
      op(OP_I32WRAP);
      classOf();
      ltee(L_X);
      load32(uint32_t(offsetof(JSClass, flags)));
      i32c(int32_t(JSCLASS_IS_PROXY));
      op(OP_I32AND);
      failIf();
      lget(L_X);
      i32c(int32_t(uintptr_t(js::FunctionClassPtr)));
      op(OP_I32EQ);
      lget(L_X);
      i32c(int32_t(uintptr_t(js::FunctionExtendedClassPtr)));
      op(OP_I32EQ);
      op(OP_I32OR);
      ltee(L_Z);
      op(OP_I32EQZ);
      ifThen();
      lget(L_X);
      load32(uint32_t(offsetof(JSClass, cOps)));
      ltee(L_Y);
      ifThen();
      lget(L_Y);
      load32(uint32_t(offsetof(JSClassOps, call)));
      op(OP_I32EQZ);
      op(OP_I32EQZ);
      lset(L_Z);
      endIf();
      endIf();
      endIf();
      lget(L_Z);
      boxBool();
      lset(L_RET);
      return true;
    case CacheOp::LoadArgumentsObjectLengthResult:
    case CacheOp::LoadArgumentsObjectLength:
      if (!(Ops2() & 1024)) return false;
      readReg32(a[0]);
      load32(uint32_t(ArgumentsObject::getInitialLengthSlotOffset()));
      ltee(L_X);
      i32c(int32_t(ArgumentsObject::LENGTH_OVERRIDDEN_BIT));
      op(OP_I32AND);
      failIf();
      lget(L_X);
      i32c(int32_t(ArgumentsObject::PACKED_BITS_COUNT));
      op(OP_I32SHRU);
      if (cop == CacheOp::LoadArgumentsObjectLength) {
        op(OP_I64EXTU);
        writeReg(a[1], JSVAL_TAG_INT32);
      } else {
        RET_INT32_FROM_I32();
      }
      return true;
    case CacheOp::LoadArgumentsObjectArgResult:
      // index >= initialLength or overridden element fails; forwarded args
      // (magic scope slot) fail. Other magic values (the interpreter's
      // MOZ_RELEASE_ASSERT in arg()) fail too, as in the JIT.
      if (!(Ops2() & 2048)) return false;
      readReg32(a[0]);
      ltee(L_Y);
      load32(uint32_t(ArgumentsObject::getInitialLengthSlotOffset()));
      ltee(L_X);
      i32c(int32_t(ArgumentsObject::ELEMENT_OVERRIDDEN_BIT));
      op(OP_I32AND);
      failIf();
      readReg32(a[1]);
      ltee(L_Z);
      lget(L_X);
      i32c(int32_t(ArgumentsObject::PACKED_BITS_COUNT));
      op(OP_I32SHRU);
      op(OP_I32GEU);
      failIf();
      lget(L_Y);
      load32(uint32_t(ArgumentsObject::getDataSlotOffset()));
      lget(L_Z);
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32ADD);
      load64(uint32_t(ArgumentsData::offsetOfArgs()));
      ltee(L_A);
      tagIs(JSVAL_TAG_MAGIC);
      failIf();
      lget(L_A);
      lset(L_RET);
      return true;
    case CacheOp::LoadStringCharCodeResult: {
      // a: strId, indexId, handleOOB. Linear strings inline; others use the
      // interpreter's getChar through StringCharHelper.
      if (!(Ops2() & 4096)) return false;
      bool handleOOB = a[2] != 0;
      readReg32(a[0]);
      lset(L_Y);
      readReg32(a[1]);
      lset(L_X);
      lget(L_X);
      lget(L_Y);
      load32(uint32_t(JSString::offsetOfLength()));
      op(OP_I32GEU);  // unsigned: also index < 0
      if (handleOOB) {
        ifThen();
        i64c(int64_t(JS::NaNValue().asRawBits()));
        lset(L_RET);
        elseThen();
      } else {
        failIf();
      }
      const uint32_t inl =
          uint32_t(offsetof(JS::shadow::String, inlineStorageLatin1));
      const uint32_t noninl =
          uint32_t(offsetof(JS::shadow::String, nonInlineCharsLatin1));
      auto chars = [&] {
        lget(L_Z);
        i32c(int32_t(JS::shadow::String::INLINE_CHARS_BIT));
        op(OP_I32AND);
        b.put(OP_IF);
        b.put(0x7f);
        lget(L_Y);
        i32c(int32_t(inl));
        op(OP_I32ADD);
        b.put(OP_ELSE);
        lget(L_Y);
        load32(noninl);
        b.put(OP_END);
      };
      lget(L_Y);
      load32(uint32_t(JSString::offsetOfFlags()));
      ltee(L_Z);
      i32c(int32_t(JS::shadow::String::LINEAR_BIT));
      op(OP_I32AND);
      op(OP_I32EQZ);
      ifThen();
      lget(L_Y);
      op(OP_I64EXTU);
      lget(L_X);
      op(OP_I64EXTU);
      callHelper(uintptr_t(&StringCharHelper), 2);
      op(OP_I32WRAP);
      lset(L_Z);
      elseThen();
      lget(L_Z);
      i32c(int32_t(JS::shadow::String::LATIN1_CHARS_BIT));
      op(OP_I32AND);
      b.put(OP_IF);
      b.put(0x7f);
      chars();
      lget(L_X);
      op(OP_I32ADD);
      b.put(OP_I32LOAD8U);
      b.uleb(0);
      b.uleb(0);
      b.put(OP_ELSE);
      chars();
      lget(L_X);
      i32c(1);
      op(OP_I32SHL);
      op(OP_I32ADD);
      b.put(OP_I32LOAD16U);
      b.uleb(1);
      b.uleb(0);
      b.put(OP_END);
      lset(L_Z);
      endIf();
      lget(L_Z);
      RET_INT32_FROM_I32();
      if (handleOOB) endIf();
      return true;
    }
    case CacheOp::ArrayPush:
      // a: objId, rhsId. ArrayPushHelper returns 0 where the case fails.
      if (!(Ops2() & 8192)) return false;
      lget(L_CTX);
      op(OP_I64EXTU);
      readReg(a[0]);
      readValue(a[1]);
      callHelper(uintptr_t(&ArrayPushHelper), 3);
      ltee(L_A);
      op(OP_I64EQZ);
      failIf();
      lget(L_A);
      lset(L_RET);
      return true;
    case CacheOp::StoreDenseElementHole:
      // a: objId, indexId, rhsId, handleAdd. Helper returns 0 for FAIL_IC.
      if (!(Ops2() & 16384)) return false;
      lget(L_CTX);
      op(OP_I64EXTU);
      readReg(a[0]);
      readReg(a[1]);
      readValue(a[2]);
      i64c(a[3] ? 1 : 0);
      callHelper(uintptr_t(&StoreDenseElementHoleHelper), 5);
      op(OP_I64EQZ);
      failIf();
      return true;
    case CacheOp::CallSubstringKernelResult:
      // a: strId, beginId, lengthId.
      if (!(Ops2() & 32768)) return false;
      lget(L_CTX);
      op(OP_I64EXTU);
      readReg(a[0]);
      readReg(a[1]);
      readReg(a[2]);
      callHelper(uintptr_t(&SubstringKernelHelper), 4);
      lset(L_A);
      returnIfErrorSentinel();
      lget(L_A);
      lset(L_RET);
      return true;
    case CacheOp::RegExpSearcherLastLimitResult:
      // Int32Value(cx->regExpSearcherLastLimit) (read only, as the case).
      if (!(Ops2() & 65536)) return false;
      lget(L_CTX);
      load32(kCtxCx);
      load32(uint32_t(JSContext::offsetOfRegExpSearcherLastLimit()));
      RET_INT32_FROM_I32();
      return true;
    case CacheOp::MegamorphicLoadSlotResult:
      // a: objId, nameOffset. Helper: 0 = FAIL_IC, else result in stepRet.
      if (!(Ops2() & 131072)) return false;
      lget(L_CTX);
      op(OP_I64EXTU);
      readReg(a[0]);
      field32(fieldOff(1));
      op(OP_I64EXTU);
      callHelper(uintptr_t(&MegamorphicLoadSlotHelper), 3);
      op(OP_I64EQZ);
      failIf();
      lget(L_CTX);
      load64(kCtxStepRet);
      lset(L_RET);
      return true;
    case CacheOp::CallNativeFunction: {
      // a: calleeId, argcId, flags, argcFixed (u32), ignoresRv. Other realms
      // and non-Standard formats FAIL_IC in the case: left stepped.
      if (!(Ops2() & 262144)) return false;
      CacheIRReader r(a, a + kIcOpInfo[uint32_t(cop)].len);
      (void)r.objOperandId();
      (void)r.int32OperandId();
      CallFlags flags = r.callFlags();
      (void)r.uint32Immediate();
      bool ignoresRv = r.readBool();
      if (!flags.isSameRealm() ||
          flags.getArgFormat() != CallFlags::Standard) {
        return false;
      }
      lget(L_CTX);
      op(OP_I64EXTU);
      lget(L_STUB);
      op(OP_I64EXTU);
      readReg(a[0]);
      readReg(a[1]);
      i64c((flags.isConstructing() ? 1 : 0) | (ignoresRv ? 2 : 0));
      callHelper(uintptr_t(&CallNativeHelper), 5);
      ltee(L_A);
      op(OP_I64EQZ);
      failIf();
      returnIfErrorSentinel();
      lget(L_CTX);
      load64(kCtxStepRet);
      lset(L_RET);
      return true;
    }
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
    case CacheOp::StoreFixedSlotUndefinedResult:
      // StoreFixedSlot (same barriered store) + undefined result, as
      // CacheIRCompiler::emitStoreFixedSlotUndefinedResult.
      if (!PblForOfIcOn()) return false;
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
      i64c(int64_t(UndefinedValue().asRawBits()));
      lset(L_RET);
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
  if (!validate()) return false;
  return runStandalone();
}

bool Translator::validate() {
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
    // These hot memory operations are currently interpreted one op at a
    // time through the fpcast ABI. Keep their complete IC chain in the
    // native interpreter until typed-array operations can be compiled inline.
    // Compile() negatively caches rejection and PblIcEntry installs the
    // interpreter pointer, so hot entries do not retry compilation.
    if (o == uint32_t(CacheOp::LoadTypedArrayElementResult) ||
        o == uint32_t(CacheOp::StoreTypedArrayElement)) {
      return reject("typed-array mixed IC");
    }
    pos += 2 + n;
    if (++nops > kMaxOps) return reject("too many ops");
  }
  nOps = nops;
  return true;
}

// Inline body (see EmitInline). Registers 0..2 = arg0, arg1, ctx.arg2; every
// op must translate inline; success stores L_RET into result and branches to
// doneDepth; guards branch to failBase. No side effects precede a failed
// guard (ops write only wasm locals before their guards, as standalone).
bool Translator::runInline(uint32_t arg0, uint32_t arg1, uint32_t result,
                           uint32_t doneDepth) {
  if (!validate()) return false;
  if (observation) return reject("inline: observation");
  inlResult = result;
  inlDone = doneDepth;
  lget(arg0);
  writeValueReg(0);
  lget(arg1);
  writeValueReg(1);
  lget(L_CTX);
  load64(kCtxArg2);
  writeValueReg(2);
  i64c(0);
  lset(L_RET);
  for (uint32_t pos = 0; pos < len;) {
    uint32_t o = uint32_t(code[pos]) | (uint32_t(code[pos + 1]) << 8);
    uint32_t n = kIcOpInfo[o].len;
    const uint8_t* a = code + pos + 2;
    uint32_t savedDepth = depth;
    if (!translateOp(CacheOp(o), a)) {
      if (!reason) {
        nStep++;
        reason = "inline: stepped op";
      }
      return false;
    }
    nInline++;
    if (depth != savedDepth) return reject("internal depth");
    pos += 2 + n;
  }
  lget(L_RET);
  lset(result);
  b.put(OP_BR);
  b.uleb(doneDepth);
  return !b.oom || reject("oom");
}

bool Translator::runStandalone() {
  // Prologue: STUB, CTX; regs 0..2 = arg0, arg1, ctx.arg2 (WRITE_VALUE_REG).
  if (observation) {
    i64c(int64_t(uintptr_t(observation)));
    lget(3);
    for (uint32_t i = 2; i < kParams; i++) i64c(0);
    i32c(int32_t(uintptr_t(&pbltier::IcEnter)));
    b.put(OP_CALLIND);
    b.uleb(0);
    b.uleb(0);
    lset(L_OBSERVATION);
  }
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
  returnValue();
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
  observeReturn();  // Implicit return after the actual next-stub call.
  b.put(OP_END);  // function
  return !b.oom || reject("oom");
}

bool Translator::assemble(Buf& m) {
  Buf c;
  Buf body;
  // Locals: i64, i32 and f64 groups.
  if (inlineTest) {  // scratch at kParams, then STUB CTX (runInlineTest)
    body.uleb(4);
    body.uleb(kInlineI64Locals);
    body.put(0x7e);
    body.uleb(kInlineI32Locals);
    body.put(0x7f);
    body.uleb(kInlineF64Locals);
    body.put(0x7c);
    body.uleb(2);
    body.put(0x7f);
  } else {
  body.uleb(observation ? 4 : 3);
  body.uleb(kI64Locals);
  body.put(0x7e);
  body.uleb(kI32Locals);
  body.put(0x7f);
  body.uleb(kF64Locals);
  body.put(0x7c);
  if (observation) {
    body.uleb(1);
    body.put(0x7e);
  }
  }
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

// ---- inline mode (for the method tier) --------------------------------------
//
// EmitInline(info, out, env, &numOps) appends to `out` a wasm instruction
// sequence with net operand-stack effect zero that runs the stub's CacheIR
// with the standalone function's semantics:
//  - inputs: env.arg0Local / env.arg1Local (i64 IC operands, as passed to
//    the stub function), env.stubLocal (i32 ICCacheIRStub*), env.ctxLocal
//    (i32 ICCtx*). Register 2 is read from ctx.arg2 as in the standalone
//    prologue, so the caller must first do MT::invokeIC's ctx/frame stores
//    (sp, pc, icEntry, arg2).
//  - scratch: locals env.localBase .. + kInlineLocals - 1, declared by the
//    caller in this order: kInlineI64Locals i64, kInlineI32Locals i32,
//    kInlineF64Locals f64. Contents on entry are irrelevant (registers are
//    written before read; RET is zeroed by the sequence).
//  - success: the i64 IC result is in env.resultLocal (any i64 local, may
//    be outside the scratch range) and control branches to env.doneDepth.
//  - guard failure: branches to env.failDepth with no side effects done
//    (no stats counted either); the caller then calls stub->next's code
//    with the same (arg0, arg1, next, ctx) as CallNextIC.
//  - depths are relative to the start of the sequence; the sequence never
//    falls through. Helper calls use call_indirect env.typeIndex
//    (must be (23 x i64) -> i64) on env.tableIndex (the shared function
//    table holding the helper/function indices).
//  - returns false and leaves `out` unchanged when any op would be stepped
//    through ICInterpretOps, on validation rejects (typed-array ops, too many
//    ops, ids >= 16) or when IC observation (pbltier) is enabled.
//  numOps (optional) receives the CacheIR op count on success.
// EnsureCompiled(stub, ctx) returns the installed standalone function index
// for the stub's CacheIR content (compiling now if still counting, ignoring
// kHits, honouring kMaxInstalls and content reuse), sets the stub's code to
// it, and returns 0 if PBLIC is disabled or the content is rejected (the
// stub's code is then left unchanged).
// The inline body equals the standalone body iff firstStub->code == K.

struct InlineEnv {
  uint32_t arg0Local, arg1Local;  // i64
  uint32_t stubLocal, ctxLocal;   // i32
  uint32_t localBase;             // first of kInlineLocals scratch locals
  uint32_t resultLocal;           // i64
  uint32_t doneDepth, failDepth;  // relative to the sequence start
  uint32_t typeIndex = 0, tableIndex = 0;
};

uint32_t gInlineVia, gInlineFallback, gInlineTotal;  // PBLIC_INLINETEST

void SetInlineLocals(Translator& t, const InlineEnv& env) {
  uint32_t i = env.localBase;
  t.L_V = i;
  t.L_T = i + 16;
  t.L_RET = i + 32;
  t.L_A = i + 33;
  t.L_B = i + 34;
  i += kInlineI64Locals;
  t.L_X = i;
  t.L_Y = i + 1;
  t.L_Z = i + 2;
  i += kInlineI32Locals;
  t.L_D0 = i;
  t.L_D1 = i + 1;
  t.L_STUB = env.stubLocal;
  t.L_CTX = env.ctxLocal;
  t.typeIdx = env.typeIndex;
  t.tableIdx = env.tableIndex;
  t.failBase = env.failDepth;
  t.inlineMode = true;
}

bool EmitInline(const CacheIRStubInfo* info, Buf& out, const InlineEnv& env,
                uint32_t* numOps) {
  Translator t;
  t.info = info;
  t.code = info->code();
  t.len = info->codeLength();
  SetInlineLocals(t, env);
  if (!t.runInline(env.arg0Local, env.arg1Local, env.resultLocal,
                   env.doneDepth)) {
    return false;
  }
  out.putn(t.b.p, t.b.n);
  if (out.oom) return false;
  if (numOps) *numOps = t.nOps;
  return true;
}

bool InlineTestEnabled() {
  static int e = -1;
  if (e < 0) {
    const char* v = getenv("PBLIC_INLINETEST");
    e = (v && v[0] == '1') ? 1 : 0;
    if (e) {
      atexit([] {
        fprintf(stderr,
                "PBLIC inlinetest: via_inline=%u fallback=%u total=%u\n",
                gInlineVia, gInlineFallback, gInlineTotal);
      });
    }
  }
  return e != 0;
}

// PBLIC_INLINETEST=1: the standalone function built through EmitInline.
// Locals: 23 params, 35 i64, 3 i32, 2 f64 (= scratch at kParams), then
// STUB CTX i32. Same entry/fail stats and fail path as runStandalone().
bool Translator::runInlineTest() {
  const uint32_t stubL = kParams + kInlineLocals, ctxL = stubL + 1;
  lget(2);
  op(OP_I32WRAP);
  lset(stubL);
  lget(3);
  op(OP_I32WRAP);
  lset(ctxL);
  i32c(int32_t(uintptr_t(&gStats[kStatEntries])));
  lset(kParams + kInlineI64Locals);
  lget(kParams + kInlineI64Locals);
  lget(kParams + kInlineI64Locals);
  load32(0);
  i32c(1);
  op(OP_I32ADD);
  store32(0);
  b.put(OP_BLOCK);
  b.put(OP_VOID);  // $done
  b.put(OP_BLOCK);
  b.put(OP_VOID);  // $fail
  InlineEnv env;
  env.arg0Local = 0;
  env.arg1Local = 1;
  env.stubLocal = stubL;
  env.ctxLocal = ctxL;
  env.localBase = kParams;
  env.resultLocal = kParams + 32;
  env.doneDepth = 1;
  env.failDepth = 0;
  Buf body;
  if (!EmitInline(info, body, env, &nOps)) return reject("inline fallback");
  nInline = nOps;
  b.putn(body.p, body.n);
  b.put(OP_END);  // $fail
  i32c(int32_t(uintptr_t(&gStats[kStatFails])));
  lset(kParams + kInlineI64Locals);
  lget(kParams + kInlineI64Locals);
  lget(kParams + kInlineI64Locals);
  load32(0);
  i32c(1);
  op(OP_I32ADD);
  store32(0);
  lget(stubL);
  load32(uint32_t(ICCacheIRStub::offsetOfNext()));
  lset(kParams + kInlineI64Locals + 1);
  lget(0);
  lget(1);
  lget(kParams + kInlineI64Locals + 1);
  op(OP_I64EXTU);
  lget(3);
  padArgs();
  lget(kParams + kInlineI64Locals + 1);
  load32(uint32_t(ICStub::offsetOfStubCode()));
  b.put(OP_CALLIND);
  b.uleb(0);
  b.uleb(0);
  op(OP_RETURN);
  b.put(OP_END);  // $done
  lget(kParams + 32);
  b.put(OP_END);  // function
  return !b.oom || reject("oom");
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
  const char* why;  // reject reason (PBLIC_DYNSTAT)
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

void Compile(Entry* e, const CacheIRStubInfo* info, ICCtx& ctx) {
  if (gInstalls.load(std::memory_order_relaxed) >= kMaxInstalls) {
    e->state = 2;
    e->why = "max installs";
    return;
  }
  Translator t;
  if (pbltier::Enabled()) t.observation = pbltier::NewIcDescriptor();
  t.info = info;
  t.code = info->code();
  t.len = info->codeLength();
  Buf m;
  bool ok;
  if (InlineTestEnabled() && !t.observation) {
    gInlineTotal++;
    Translator ti;
    ti.info = info;
    ti.code = t.code;
    ti.len = t.len;
    ti.inlineTest = true;
    if (ti.runInlineTest() && ti.assemble(m)) {
      gInlineVia++;
      t.nInline = ti.nInline;
      ok = true;
    } else {
      gInlineFallback++;
      m.n = 0;
      m.oom = false;
      ok = t.run() && t.assemble(m);
    }
  } else {
    ok = t.run() && t.assemble(m);
  }
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
    e->why = t.reason ? t.reason : "?";
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
  // Fill the stable generated-code identity before publishing callable code.
  if (t.observation) t.observation->fn = idx[0];
  e->fn = idx[0];
  e->state = 1;
  if (t.observation) pbltier::IcInstall(t.observation, ctx);
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
// Finds or (re)initializes the table entry for info; null without a table.
Entry* Lookup(const CacheIRStubInfo* info) {
  if (!tTable) {
    tTable =
        static_cast<Entry*>(calloc(size_t(1) << kTableBits, sizeof(Entry)));
    if (!tTable) return nullptr;
  }
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
  return e;
}

uint8_t* Enter(ICCacheIRStub* stub, ICCtx& ctx) {
  uint8_t* interp = reinterpret_cast<uint8_t*>(&ICInterpretOps);
  if (!Enabled()) return interp;
  const CacheIRStubInfo* info = stub->stubInfo();
  Entry* e = Lookup(info);
  if (!e) return interp;
  if (e->state == 0 && ++e->hits >= kHits) Compile(e, info, ctx);
  if (e->state == 1) return reinterpret_cast<uint8_t*>(uintptr_t(e->fn));
  if (e->state == 2) return interp;
  return nullptr;
}

// PBLIC_DYNSTAT: whole-stub interpreter runs keyed by stub info.
struct DynEnt {
  const CacheIRStubInfo* info;
  uint64_t n;
  const char* why;
};
constexpr uint32_t kDynBits = 14;
DynEnt* gDyn;
uint64_t gDynWhole, gDynLost;

void CountInterp(ICCacheIRStub* stub) {
  const CacheIRStubInfo* info = stub->stubInfo();
  gDynWhole++;
  if (!gDyn) {
    gDyn = static_cast<DynEnt*>(calloc(size_t(1) << kDynBits, sizeof(DynEnt)));
    if (!gDyn) return;
  }
  const char* why = "no table entry";
  if (!Enabled()) {
    why = "PBLIC disabled";
  } else if (tTable) {
    uint32_t h = Hash(info);
    for (uint32_t i = 0; i < kProbe; i++) {
      Entry* c = &tTable[(h + i) & ((1u << kTableBits) - 1)];
      if (c->info == info) {
        why = c->state == 0   ? "counting (below kHits)"
              : c->state == 2 ? (c->why ? c->why : "rejected")
                              : "compiled entry but interp code";
        break;
      }
    }
  }
  uint32_t h = (uint32_t(uintptr_t(info)) * 2654435761u) >> (32 - kDynBits);
  for (uint32_t i = 0; i < 64; i++) {
    DynEnt* d = &gDyn[(h + i) & ((1u << kDynBits) - 1)];
    if (d->info == info || !d->info) {
      d->info = info;
      d->n++;
      d->why = why;
      return;
    }
  }
  gDynLost++;
}

void PrintDynStat() {
  fprintf(stderr, "PBLIC dynstat: whole_interp=%llu lost=%llu entries=%u fails=%u steps=%u\n",
          (unsigned long long)gDynWhole, (unsigned long long)gDynLost,
          gStats[kStatEntries], gStats[kStatFails], gStats[kStatSteps]);
  // Stepped ops, top 30.
  for (uint32_t k = 0; k < 30; k++) {
    uint32_t best = 0;
    uint64_t bn = 0;
    for (uint32_t i = 0; i < uint32_t(CacheOp::NumOpcodes); i++) {
      if (gStepOps64[i] > bn) bn = gStepOps64[i], best = i;
    }
    if (!bn) break;
    fprintf(stderr, "PBLIC dynstat: step op=%s n=%llu\n", CacheIROpNames[best],
            (unsigned long long)bn);
    gStepOps64[best] = 0;
  }
  if (!gDyn) return;
  // Whole-stub runs by reason (aggregate), then top 40 stub infos.
  const char* rs[32];
  uint64_t rn[32];
  uint32_t nr = 0;
  for (uint32_t i = 0; i < (1u << kDynBits); i++) {
    DynEnt* d = &gDyn[i];
    if (!d->info) continue;
    uint32_t k = 0;
    while (k < nr && strcmp(rs[k], d->why)) k++;
    if (k == nr && nr < 32) rs[nr] = d->why, rn[nr++] = 0;
    if (k < nr) rn[k] += d->n;
  }
  for (uint32_t k = 0; k < nr; k++) {
    fprintf(stderr, "PBLIC dynstat: whole reason=\"%s\" n=%llu\n", rs[k],
            (unsigned long long)rn[k]);
  }
  for (uint32_t k = 0; k < 40; k++) {
    DynEnt* best = nullptr;
    for (uint32_t i = 0; i < (1u << kDynBits); i++) {
      DynEnt* d = &gDyn[i];
      if (d->info && d->n && (!best || d->n > best->n)) best = d;
    }
    if (!best) break;
    char buf[600];
    int len = 0;
    const uint8_t* code = best->info->code();
    uint32_t clen = best->info->codeLength();
    for (uint32_t pos = 0; pos + 2 <= clen && len < 520;) {
      uint32_t o = uint32_t(code[pos]) | (uint32_t(code[pos + 1]) << 8);
      if (o >= uint32_t(CacheOp::NumOpcodes)) break;
      len += snprintf(buf + len, sizeof buf - len, " %s", CacheIROpNames[o]);
      pos += 2 + kIcOpInfo[o].len;
    }
    buf[len] = 0;
    fprintf(stderr, "PBLIC dynstat: stub n=%llu why=\"%s\" ops:%s\n",
            (unsigned long long)best->n, best->why, buf);
    best->n = 0;
  }
}

// See the inline-mode comment block above EmitInline.
uint32_t EnsureCompiled(ICCacheIRStub* stub, ICCtx& ctx) {
  if (!Enabled()) return 0;
  const CacheIRStubInfo* info = stub->stubInfo();
  Entry* e = Lookup(info);
  if (!e) return 0;
  if (e->state == 0) Compile(e, info, ctx);
  if (e->state != 1) return 0;
  stub->updateRawJitCode(reinterpret_cast<uint8_t*>(uintptr_t(e->fn)));
  return e->fn;
}

}  // namespace pblic

static uint64_t PblIcEntry(uint64_t arg0, uint64_t arg1, ICStub* stub,
                           ICCtx& ctx) {
  uint8_t* code = pblic::Enter(stub->toCacheIRStub(), ctx);
  if (!code) return ICInterpretOps(arg0, arg1, stub, ctx);
  stub->updateRawJitCode(code);
  ICStubFunc func = reinterpret_cast<ICStubFunc>(code);
  return func(arg0, arg1, stub, ctx);
}
