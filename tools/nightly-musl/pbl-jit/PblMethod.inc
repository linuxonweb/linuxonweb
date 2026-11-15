/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
// PblMethod: whole-script bytecode -> wasm compiler for the Portable Baseline
// Interpreter (adapter source, #included after PblIc.inc in a copy of
// PortableBaselineInterpret.cpp; upstream files are unchanged).
//
// A script whose interpreter hook has run kHits times (function entries, loop
// iterations and returns into it) is translated into one wasm function with
// the fpcast-emu signature (23 x i64) -> i64 and installed thread-privately
// with the jit_install syscall. The function keeps the interpreter's frame
// layout and value stack in memory: it is entered at any op (a br_table over
// one block per op) with the interpreter's sp, runs ops inline with the
// interpreter's exact fast-path semantics, calls the script's IC chains for
// the IC ops exactly like INVOKE_IC, and returns to the interpreter at the
// first op it does not handle inline (scripted calls, returns, environment ops, slow
// paths). The interpreter runs that op and re-enters at its next DISPATCH.
//
// Interpreter state at an exit is exactly the state the interpreter would
// have before that op: sp, pc and the IC entry (from the static IC index, which
// the hook checks against the interpreter's own cursor on entry).
//
// Environment: PBLBC=0 disables it (it also follows PBLIC=0), PBLBC_HITS=n
// sets the hook threshold, PBLBC_IC=0 makes IC ops exits, PBLBC_LOOPEXIT=1
// leaves every LoopHead to the interpreter (and its loop compiler), and
// PBLBC_LOG=n limits log lines (default 40), PBLBC_LOOPJIT=0 stops offering
// loop heads to the PBLJIT loop compiler. PBLBC_COVA=0 makes GetAliasedVar,
// StrictConstantEq/Ne, IsConstructing, String, GetFrameArg,
// CheckAliasedLexical, Hole and Uninitialized exits again. PBLBC_COVB=<mask>
// (atoi; unset = 30, 0 = all off) adds coverage per bit: 1 non-number
// Add/Sub/Mul/Div/Mod -> BinaryArith IC (off by default: hangs in the guest
// covB test, cause not found yet), 2 string/BigInt StrictEq/StrictNe ->
// Compare IC (magic exits), 4 non-trivial ToBool operands (JumpIfFalse/
// JumpIfTrue/And/Or/Not) -> ToBool IC, 8 ToString of a string is a no-op,
// 16 TypeofEq of a primitive inline (objects/magic exit). Bits off stay
// exits. Bits 2|4|8|16 passed the covB differential, covA and the 19-workload
// suite on 2026-11-15. PBLBC_DIRECT=1 (default off) makes
// a compiled Call/CallIgnoresRv whose callee is a plain scripted function with
// compiled code call CallScripted, which pushes the callee frame exactly like
// the interpreter's Call fast path and reports a frame switch: the compiled
// function returns kFrameSwitch, Hook returns kRanNewFrame and the
// interpreter's bc_hook reloads all per-frame state for the callee frame
// (round 1: the callee then starts in the interpreter at pc 0).
//
// At a LoopHead the code calls LoopHook, which runs pbljit::OnLoopHead just
// like the interpreter's LoopHead does; a compiled loop returns the state at
// its exit, and the code continues at that op. A loop head that PBLJIT has
// not taken for kLoopSkipMisses consecutive visits is not offered again.

namespace pblbc {
using namespace pblic;

static_assert(sizeof(ICEntry) == sizeof(void*));

enum : uint8_t {
  OP_UNREACH = 0x00,
  OP_LOOP = 0x03,
  OP_BRTABLE = 0x0e,
  OP_I64LTU = 0x54,
  OP_I64GTU = 0x56,
  OP_I64GEU = 0x5a,
  OP_I32REMS = 0x6f,
  OP_F64NEG = 0x9a,
};
constexpr uint8_t T_I32 = 0x7f, T_I64 = 0x7e, T_F64 = 0x7c;

// Parameters (all i64 under fpcast-emu).
constexpr uint32_t P_FRAME = 0, P_SP = 1, P_OP = 2, P_ICE = 3, P_CTX = 4,
                   P_IO = 5, P_ARGV = 6, P_FLAGS = 7, P_GLEX = 8, P_IRQ = 9,
                   P_EPC = 10, P_CX = 11;
constexpr uint32_t kNParams = 23;
// Locals.
constexpr uint32_t L_A = kNParams, L_B = L_A + 1, L_C = L_A + 2, L_R = L_A + 3;
constexpr uint32_t kNI64 = 4;
constexpr uint32_t L_FR = kNParams + kNI64, L_SP = L_FR + 1, L_ST = L_FR + 2,
                   L_ICE = L_FR + 3, L_CTX = L_FR + 4, L_IO = L_FR + 5,
                   L_X = L_FR + 6, L_LB = L_FR + 7, L_AV = L_FR + 8,
                   L_FLG = L_FR + 9, L_EPC = L_FR + 10;
constexpr uint32_t kNI32 = 11;
constexpr uint32_t L_D0 = L_FR + kNI32, L_D1 = L_D0 + 1;
constexpr uint32_t kNF64 = 2;

// Exit kinds (high word of the result; low word is the op's pc offset).
// Diagnostic reason changes no interpreter continuation or result semantics.
enum : uint32_t {
  kExit = 0,
  kIcError = 1,
  kObservedIrqExit = 2,
  kFrameSwitch = 3  // PBLBC_DIRECT: a callee frame was pushed (see tSwitch)
};
// Flags parameter bits.
enum : uint32_t { kFlagArgsAliased = 1 };

constexpr uint32_t kMaxScriptOps = 4000;
constexpr uint32_t kMaxSwitchCases = 1024;
constexpr uint32_t kMaxEntries = 8192;
constexpr uint32_t kTableBits = 13;
constexpr uint32_t kProbe = 16;

std::atomic<int> gEnabled{-1};
std::atomic<int> gLogBudget{0};
std::atomic<bool> gLogEnabled{false};
std::atomic<uint32_t> gCompiles{0};
std::atomic<uint32_t> gRejects{0};
uint32_t gHits = 50;
bool gIcInline = true;
bool gLoopExit = false;
bool gLoopJit = true;
bool gDirect = false;
// PBLBC_COVA=0: GetAliasedVar, StrictConstantEq/Ne, IsConstructing, String,
// GetFrameArg, CheckAliasedLexical, Hole and Uninitialized become exits.
bool gCova = true;
// PBLBC_COVB bitmask: see the header comment.
enum : unsigned { kCovbArith = 1, kCovbStrictEq = 2, kCovbToBool = 4,
                  kCovbToString = 8, kCovbTypeofEq = 16 };
constexpr unsigned kCovbDefault = kCovbStrictEq | kCovbToBool |
                                  kCovbToString | kCovbTypeofEq;
unsigned gCovb = kCovbDefault;
constexpr uint32_t kLoopSkip = 0x80000000u, kLoopSkipMisses = 1500;
int64_t LoopHook(int64_t frame, int64_t sp, int64_t pcOff, int64_t cx,
                 int64_t entry);
int64_t CallScripted(int64_t frame, int64_t sp, int64_t pc, int64_t icEntry,
                     int64_t ctx);
uint32_t gRuns, gIcExits, gMismatch, gLoopRuns, gDirectPushes;
// PBLBC_DIRECT outcome counters (CallScripted), printed at exit as one
// "PBLBC direct:" line on stderr when PBLBC_LOG > 0 or PBLBC_HITS is set.
enum DirectStat : uint32_t {
  kDsNotCall, kDsCallerDebuggee, kDsNotFunction, kDsNotInterpreted,
  kDsClassCtor, kDsNoBytecode, kDsNoJitScript, kDsRealm, kDsUnderflow,
  kDsStack, kDsEnvObjects, kDsCalleeDebuggee, kDsCounts, kDsInterrupt,
  kDsCalleeStack, kDsNotCompiled, kDsEntryExit,
  kDsInline, kDsInlineRetRval0, kDsSwDepth, kDsSwIcCursor, kDsSwNested,
  kDsSwIcError, kDsSwDebug, kDsSwExitOp, kDsCount
};
uint32_t gDs[kDsCount];
inline int64_t Refuse(DirectStat s) {
  gDs[s]++;
  return 0;
}
void PrintDirectStats() {
  const uint32_t* s = gDs;
  uint32_t ref = 0;
  for (uint32_t i = 0; i < kDsInline; i++) ref += s[i];
  fprintf(stderr,
          "PBLBC direct: pushes=%u inline=%u inline_retrval0=%u "
          "switch_depth=%u switch_iccursor=%u switch_nested=%u "
          "switch_icerror=%u switch_debug=%u switch_exitop=%u refused=%u "
          "(notcall=%u callerdbg=%u notfunc=%u notinterp=%u classctor=%u "
          "nobytecode=%u nojitscript=%u realm=%u underflow=%u stack=%u "
          "envobj=%u calleedbg=%u counts=%u interrupt=%u calleestack=%u "
          "notcompiled=%u entryexit=%u)\n",
          gDirectPushes, s[kDsInline], s[kDsInlineRetRval0], s[kDsSwDepth],
          s[kDsSwIcCursor], s[kDsSwNested], s[kDsSwIcError], s[kDsSwDebug],
          s[kDsSwExitOp], ref, s[kDsNotCall], s[kDsCallerDebuggee],
          s[kDsNotFunction], s[kDsNotInterpreted], s[kDsClassCtor],
          s[kDsNoBytecode], s[kDsNoJitScript], s[kDsRealm], s[kDsUnderflow],
          s[kDsStack], s[kDsEnvObjects], s[kDsCalleeDebuggee], s[kDsCounts],
          s[kDsInterrupt], s[kDsCalleeStack], s[kDsNotCompiled],
          s[kDsEntryExit]);
}

// PBLBC_EXITSTAT=1: runtime exit histogram (Hook only, not generated wasm).
// Counts every return of compiled code to the interpreter by [exit kind]
// [JSOp at the exit pc] (for kFrameSwitch: the op where the innermost callee
// stopped), plus Hook entries, compiles and rejects by reason. Plain counters
// like gDs; printed at exit as "PBLBC exitstat:" lines on stderr.
bool gExitStat = false;
constexpr uint32_t kEsKinds = 4, kEsReasons = 32;
uint64_t gEsExit[kEsKinds][256];
uint64_t gEsEntries, gEsCompiled, gEsRejected, gEsSwitches;
const char* gEsReason[kEsReasons];
uint64_t gEsReasonCount[kEsReasons];
void ExitStatReject(const char* why) {
  gEsRejected++;
  if (!why) why = "?";
  for (uint32_t i = 0; i < kEsReasons; i++) {
    if (!gEsReason[i]) gEsReason[i] = why;
    if (gEsReason[i] == why || !strcmp(gEsReason[i], why)) {
      gEsReasonCount[i]++;
      return;
    }
  }
}
void PrintExitStats() {
  uint64_t total = 0, perKind[kEsKinds] = {};
  for (uint32_t k = 0; k < kEsKinds; k++)
    for (uint32_t o = 0; o < 256; o++) perKind[k] += gEsExit[k][o];
  for (uint32_t k = 0; k < kEsKinds; k++) total += perKind[k];
  fprintf(stderr,
          "PBLBC exitstat: entries=%llu exits=%llu kind0_exit=%llu "
          "kind1_icerror=%llu kind2_irq=%llu kind3_frameswitch=%llu "
          "compiled=%llu rejected=%llu frame_switches=%llu "
          "direct_pushes=%u\n",
          (unsigned long long)gEsEntries, (unsigned long long)total,
          (unsigned long long)perKind[0], (unsigned long long)perKind[1],
          (unsigned long long)perKind[2], (unsigned long long)perKind[3],
          (unsigned long long)gEsCompiled, (unsigned long long)gEsRejected,
          (unsigned long long)gEsSwitches, gDirectPushes);
  for (uint32_t i = 0; i < kEsReasons && gEsReason[i]; i++) {
    fprintf(stderr, "PBLBC exitstat: reject reason=\"%s\" count=%llu\n",
            gEsReason[i], (unsigned long long)gEsReasonCount[i]);
  }
  for (uint32_t n = 0; n < 40; n++) {
    uint32_t bk = 0, bo = 0;
    uint64_t best = 0;
    for (uint32_t k = 0; k < kEsKinds; k++)
      for (uint32_t o = 0; o < 256; o++)
        if (gEsExit[k][o] > best) {
          best = gEsExit[k][o];
          bk = k;
          bo = o;
        }
    if (!best) break;
    const char* name =
        bo < uint32_t(JSOP_LIMIT) ? CodeName(JSOp(bo)) : nullptr;
    char num[16];
    if (!name) {
      snprintf(num, sizeof num, "%u", bo);
      name = num;
    }
    fprintf(stderr, "PBLBC exitstat: op=%s kind=%u count=%llu pct=%.1f\n",
            name, bk, (unsigned long long)best,
            total ? 100.0 * double(best) / double(total) : 0.0);
    gEsExit[bk][bo] = 0;  // printed once at exit; consume for ordering
  }
}

bool Enabled() {
  int e = gEnabled.load(std::memory_order_relaxed);
  if (e < 0) {
    const char* v = getenv("PBLBC");
    e = (v && v[0] == '0') || !pblic::Enabled() ? 0 : 1;
    const char* h = getenv("PBLBC_HITS");
    if (h && atoi(h) > 0) gHits = uint32_t(atoi(h));
    const char* ic = getenv("PBLBC_IC");
    gIcInline = !(ic && ic[0] == '0');
    const char* le = getenv("PBLBC_LOOPEXIT");
    gLoopExit = le && le[0] == '1';
    const char* lj = getenv("PBLBC_LOOPJIT");
    gLoopJit = !(lj && lj[0] == '0');
    const char* cv = getenv("PBLBC_COVA");
    gCova = !(cv && cv[0] == '0');
    const char* cb = getenv("PBLBC_COVB");
    gCovb = cb ? unsigned(atoi(cb)) : kCovbDefault;
    const char* dc = getenv("PBLBC_DIRECT");
    gDirect = dc && dc[0] == '1';
    const char* l = getenv("PBLBC_LOG");
    const int logBudget = l ? atoi(l) : 40;
    gLogBudget.store(logBudget, std::memory_order_relaxed);
    gLogEnabled.store(logBudget > 0, std::memory_order_relaxed);
    gEnabled.store(e, std::memory_order_relaxed);
    if (logBudget > 0) {
      fprintf(stderr, "PBLBC %s (threshold=%u ic=%d loopexit=%d loopjit=%d)\n",
              e ? "enabled" : "disabled", gHits, int(gIcInline), int(gLoopExit),
              int(gLoopJit));
      if (gDirect) fprintf(stderr, "PBLBC direct scripted calls enabled\n");
    }
    if (gDirect && (logBudget > 0 || (h && h[0]))) atexit(PrintDirectStats);
    const char* xs = getenv("PBLBC_EXITSTAT");
    if (xs && xs[0] == '1') {
      gExitStat = true;
      atexit(PrintExitStats);
    }
  }
  return e != 0;
}

bool TakeLog() {
  return gLogEnabled.load(std::memory_order_relaxed) &&
         gLogBudget.fetch_sub(1, std::memory_order_relaxed) > 0;
}

// Frame field offsets from the BaselineFrame* (the frame pointer is
// frame + Size(); reverse offsets are relative to it).
int32_t FrameOff(int reverse) {
  return int32_t(BaselineFrame::Size()) + reverse;
}

struct OpInfo {
  uint32_t pcOff;
  uint32_t icIdx;  // static IC index before the op runs
  JSOp op;
  bool exit;  // never handled inline
};

struct MT {
  const jsbytecode* code;
  uint32_t codeLen;
  const uint32_t* resumeOffsets;
  uint32_t nfixed;
  OpInfo* ops = nullptr;
  uint32_t n = 0;
  uint16_t* opAt = nullptr;  // pc offset -> op index (0xffff: none)
  void* entry = nullptr;     // cache entry (constant in the code)
  uint32_t* loopState = nullptr;  // per op: LoopHook misses | kLoopSkip
  Buf b;
  uint32_t lvl = 0;  // blocks open inside the current op's code
  uint32_t cur = 0;  // current op index
  uint32_t nInline = 0, nIc = 0, nExit = 0;
  const char* reason = nullptr;

  ~MT() {
    free(ops);
    free(opAt);
    free(loopState);
  }
  bool reject(const char* why) {
    reason = why;
    return false;
  }

  // ---- emit helpers ----
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
  void load32(uint32_t off) {
    b.put(OP_I32LOAD);
    b.uleb(2);
    b.uleb(off);
  }
  void store32(uint32_t off) {
    b.put(OP_I32STORE);
    b.uleb(2);
    b.uleb(off);
  }
  void load64(uint32_t off) {
    b.put(OP_I64LOAD);
    b.uleb(3);
    b.uleb(off);
  }
  void store64(uint32_t off) {
    b.put(OP_I64STORE);
    b.uleb(3);
    b.uleb(off);
  }
  void block(uint8_t type = OP_VOID) {
    b.put(OP_BLOCK);
    b.put(type);
    lvl++;
  }
  void ifThen(uint8_t type = OP_VOID) {
    b.put(OP_IF);
    b.put(type);
    lvl++;
  }
  void elseThen() { b.put(OP_ELSE); }
  void end() {
    b.put(OP_END);
    lvl--;
  }
  void br(uint32_t depth) {
    b.put(OP_BR);
    b.uleb(depth);
  }
  void brIf(uint32_t depth) {
    b.put(OP_BRIF);
    b.uleb(depth);
  }

  // sp[k] (i64) on the wasm stack.
  void ld(uint32_t k) {
    lget(L_SP);
    load64(8 * k);
  }
  // sp[k] = local l.
  void stLocal(uint32_t k, uint32_t l) {
    lget(L_SP);
    lget(l);
    store64(8 * k);
  }
  void spAdd(int32_t slots) {
    lget(L_SP);
    i32c(8 * slots);
    op(OP_I32ADD);
    lset(L_SP);
  }
  // Push local l.
  void pushLocal(uint32_t l) {
    spAdd(-1);
    stLocal(0, l);
  }
  // Pop into local l.
  void popLocal(uint32_t l) {
    ld(0);
    lset(l);
    spAdd(1);
  }

  // Return to the interpreter before op `at` (state: SP).
  void exitAt(uint32_t at, uint32_t kind = kExit) {
    lget(L_IO);
    lget(L_SP);
    store32(0);
    i64c(int64_t((uint64_t(kind) << 32) | ops[at].pcOff));
    op(OP_RETURN);
  }
  void exitHere() { exitAt(cur); }

  // Jump to op k from inside op cur's code.
  void jumpTo(uint32_t k) {
    if (k > cur) {
      br(k - (cur + 1) + lvl);
    } else {
      i32c(int32_t(k));
      lset(L_ST);
      br(n - 1 - cur + lvl);
    }
  }
  bool target(int32_t delta, uint32_t* k) {
    int64_t t = int64_t(ops[cur].pcOff) + delta;
    if (t < 0 || t >= int64_t(codeLen) || opAt[t] == 0xffff) return false;
    *k = opAt[t];
    return true;
  }

  // Tag tests on local l -> i32.
  void tagIs(uint32_t l, JSValueTag tag) {
    lget(l);
    i64c(32);
    op(OP_I64SHRU);
    i64c(int64_t(uint32_t(tag)));
    op(OP_I64EQ);
  }
  void isNumber(uint32_t l) {
    lget(l);
    i64c(ShiftedTag(JSVAL_TAG_BOOLEAN));
    op(OP_I64LTU);
  }
  void isDouble(uint32_t l) {
    lget(l);
    i64c(ShiftedTag(JSVAL_TAG_CLEAR));
    op(OP_I64LTU);
  }
  // Number in local l -> f64.
  void toF64(uint32_t l) {
    tagIs(l, JSVAL_TAG_INT32);
    ifThen(T_F64);
    lget(l);
    op(OP_I32WRAP);
    op(OP_F64CONVI32S);
    elseThen();
    lget(l);
    op(OP_F64REINTI64);
    end();
  }
  // i32 on the stack -> boxed value of the tag.
  void boxI32(JSValueTag tag) {
    op(OP_I64EXTU);
    i64c(ShiftedTag(tag));
    op(OP_I64OR);
  }
  // f64 on the stack -> NumberValue(d) bits (int32 when exact, else the
  // double with NaN canonicalized).
  void boxNumber() {
    lset(L_D0);
    lget(L_D0);
    b.put(OP_PREFIX_FC);
    b.uleb(2);  // i32.trunc_sat_f64_s
    ltee(L_X);
    boxI32(JSVAL_TAG_INT32);
    lget(L_D0);
    op(OP_I64REINTF64);
    i64c(int64_t(0x7FF8000000000000LL));
    lget(L_D0);
    lget(L_D0);
    op(OP_F64EQ);
    op(OP_SELECT);
    // isInt = f64(X) == D0 && !(X == 0 && signbit(D0))
    lget(L_X);
    op(OP_F64CONVI32S);
    lget(L_D0);
    op(OP_F64EQ);
    lget(L_X);
    op(OP_I32EQZ);
    lget(L_D0);
    op(OP_I64REINTF64);
    i64c(0);
    op(OP_I64LTS);
    op(OP_I32AND);
    op(OP_I32EQZ);
    op(OP_I32AND);
    op(OP_SELECT);
  }
  // ToBoolean of local l for booleans, int32, undefined, null and doubles;
  // otherwise returns to the interpreter. Leaves i32.
  void toBoolOrExit(uint32_t l) {
    block(T_I32);
    lget(l);
    op(OP_I32WRAP);
    tagIs(l, JSVAL_TAG_BOOLEAN);
    brIf(0);
    op(OP_DROP);
    lget(l);
    op(OP_I32WRAP);
    i32c(0);
    op(OP_I32NE);
    tagIs(l, JSVAL_TAG_INT32);
    brIf(0);
    op(OP_DROP);
    i32c(0);
    tagIs(l, JSVAL_TAG_UNDEFINED);
    tagIs(l, JSVAL_TAG_NULL);
    op(OP_I32OR);
    brIf(0);
    op(OP_DROP);
    lget(l);
    op(OP_F64REINTI64);
    lset(L_D0);
    lget(L_D0);
    b.put(OP_I64CONST);
    b.sleb(0);
    op(OP_F64REINTI64);
    op(OP_F64NE);
    lget(L_D0);
    lget(L_D0);
    op(OP_F64EQ);
    op(OP_I32AND);
    isDouble(l);
    brIf(0);
    op(OP_DROP);
    if ((gCovb & kCovbToBool) && gIcInline) {
      // PBL's non-hybrid path: INVOKE_IC(ToBool) with the operand, which
      // stays in its frame slot (sp unchanged) across the call. ToBoolean
      // runs no script, so no debuggee check is needed.
      invokeIC(l, ~0u, ~0u, false);
      lget(L_R);
      op(OP_I32WRAP);
    } else {
      exitHere();
    }
    end();
  }

  // INVOKE_IC for op cur with args in i64 locals (or zero when ~0u). The
  // result is left in L_R; an error result returns kIcError at this op.
  void invokeIC(uint32_t a0, uint32_t a1, uint32_t a2, bool hasArg2) {
    const OpInfo& o = ops[cur];
    lget(L_CTX);
    lget(L_SP);
    store32(kCtxSp);
    lget(L_FR);
    lget(L_EPC);
    i32c(int32_t(o.pcOff));
    op(OP_I32ADD);
    store32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfInterpreterPC())));
    lget(L_FR);
    lget(L_ICE);
    i32c(int32_t(o.icIdx * sizeof(ICEntry)));
    op(OP_I32ADD);
    store32(
        uint32_t(FrameOff(BaselineFrame::reverseOffsetOfInterpreterICEntry())));
    lget(L_CTX);
    if (hasArg2 && a2 != ~0u) {
      lget(a2);
    } else {
      i64c(0);
    }
    store64(kCtxArg2);
    lget(L_ICE);
    load32(uint32_t(o.icIdx * sizeof(ICEntry) + ICEntry::offsetOfFirstStub()));
    lset(L_X);
    if (a0 != ~0u) {
      lget(a0);
    } else {
      i64c(0);
    }
    if (a1 != ~0u) {
      lget(a1);
    } else {
      i64c(0);
    }
    lget(L_X);
    op(OP_I64EXTU);
    lget(L_CTX);
    op(OP_I64EXTU);
    for (uint32_t i = 4; i < kNParams; i++) i64c(0);
    lget(L_X);
    load32(uint32_t(ICStub::offsetOfStubCode()));
    b.put(OP_CALLIND);
    b.uleb(0);
    b.uleb(0);
    ltee(L_R);
    i64c(int64_t(IC_ERROR_SENTINEL()));
    op(OP_I64EQ);
    ifThen();
    exitAt(cur, kIcError);
    end();
    nIc++;
  }
  // After an IC call: a frame that became a debuggee continues in the
  // interpreter (whose DISPATCH checks for debug traps) at the next op.
  void debugCheckNext() {
    if (cur + 1 >= n) {
      reject("ic op at end");
      return;
    }
    lget(L_FR);
    load32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfFlags())));
    i32c(int32_t(BaselineFrame::DEBUGGEE));
    op(OP_I32AND);
    ifThen();
    exitAt(cur + 1);
    end();
    lget(L_FR);
    load32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfInterpreterScript())));
    load32(uint32_t(JSScript::offsetOfMutableFlags()));
    i32c(int32_t(MutableScriptFlagsEnum::HasScriptCounts));
    op(OP_I32AND);
    ifThen();
    exitAt(cur + 1);
    end();
  }

  bool scan();
  bool translateOp();
  bool run();
  bool assemble(Buf& m);
  bool binaryArith(JSOp jop);
  bool compare(JSOp jop);
  bool unary(JSOp jop);
  bool generic(uint32_t nargs);
  bool nativeCall();
};

// ---- scan: op table, static IC indexes, eligibility ------------------------

bool IsInlineOp(JSOp op) {
  switch (op) {
    case JSOp::Nop:
    case JSOp::NopDestructuring:
    case JSOp::NopIsAssignOp:
    case JSOp::Undefined:
    case JSOp::Null:
    case JSOp::True:
    case JSOp::False:
    case JSOp::Zero:
    case JSOp::One:
    case JSOp::Int8:
    case JSOp::Uint16:
    case JSOp::Uint24:
    case JSOp::Int32:
    case JSOp::Double:
    case JSOp::Void:
    case JSOp::Pop:
    case JSOp::PopN:
    case JSOp::Dup:
    case JSOp::Dup2:
    case JSOp::DupAt:
    case JSOp::Swap:
    case JSOp::Pick:
    case JSOp::Unpick:
    case JSOp::GetLocal:
    case JSOp::SetLocal:
    case JSOp::InitLexical:
    case JSOp::CheckLexical:
    case JSOp::GetArg:
    case JSOp::SetArg:
    case JSOp::FunctionThis:
    case JSOp::JumpTarget:
    case JSOp::LoopHead:
    case JSOp::Goto:
    case JSOp::JumpIfFalse:
    case JSOp::JumpIfTrue:
    case JSOp::And:
    case JSOp::Or:
    case JSOp::Not:
    case JSOp::Coalesce:
    case JSOp::Case:
    case JSOp::Default:
    case JSOp::TableSwitch:
    case JSOp::IsNullOrUndefined:
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
    case JSOp::Eq:
    case JSOp::Ne:
    case JSOp::Lt:
    case JSOp::Le:
    case JSOp::Gt:
    case JSOp::Ge:
    case JSOp::StrictEq:
    case JSOp::StrictNe:
    case JSOp::Pos:
    case JSOp::Neg:
    case JSOp::Inc:
    case JSOp::Dec:
    case JSOp::BitNot:
    case JSOp::ToNumeric:
    case JSOp::SetRval:
      return true;
    case JSOp::GetAliasedVar:
    case JSOp::StrictConstantEq:
    case JSOp::StrictConstantNe:
    case JSOp::IsConstructing:
    case JSOp::String:
    case JSOp::GetFrameArg:
    case JSOp::CheckAliasedLexical:
    case JSOp::Hole:
    case JSOp::Uninitialized:
      return gCova;
    case JSOp::ToString:
      return gCovb & kCovbToString;
    case JSOp::TypeofEq:
      return gCovb & kCovbTypeofEq;
    default:
      return false;
  }
}

bool IsIcCallOp(JSOp op) {
  switch (op) {
    case JSOp::Call:
    case JSOp::CallIgnoresRv:
    case JSOp::GetProp:
    case JSOp::GetBoundName:
    case JSOp::GetElem:
    case JSOp::SetProp:
    case JSOp::StrictSetProp:
    case JSOp::SetName:
    case JSOp::StrictSetName:
    case JSOp::SetGName:
    case JSOp::StrictSetGName:
    case JSOp::InitProp:
    case JSOp::InitHiddenProp:
    case JSOp::InitLockedProp:
    case JSOp::InitElem:
    case JSOp::InitHiddenElem:
    case JSOp::InitLockedElem:
    case JSOp::InitElemInc:
    case JSOp::SetElem:
    case JSOp::StrictSetElem:
    case JSOp::GetGName:
    case JSOp::BindUnqualifiedGName:
    case JSOp::GetName:
    case JSOp::BindName:
    case JSOp::In:
    case JSOp::HasOwn:
    case JSOp::Instanceof:
    case JSOp::GetIntrinsic:
    case JSOp::GetImport:
    case JSOp::ToPropertyKey:
    case JSOp::OptimizeSpreadCall:
    case JSOp::GetPropSuper:
      return true;
    default:
      return false;
  }
}

bool MT::scan() {
  if (codeLen >= 0xffff) return reject("too long");
  opAt = static_cast<uint16_t*>(malloc(codeLen * sizeof(uint16_t)));
  ops = static_cast<OpInfo*>(malloc(kMaxScriptOps * sizeof(OpInfo)));
  if (!opAt || !ops) return reject("oom");
  memset(opAt, 0xff, codeLen * sizeof(uint16_t));
  uint32_t ic = 0;
  for (uint32_t off = 0; off < codeLen;) {
    if (n == kMaxScriptOps) return reject("too many ops");
    const jsbytecode* pc = code + off;
    JSOp jop = JSOp(*pc);
    switch (jop) {
      case JSOp::Generator:
      case JSOp::InitialYield:
      case JSOp::Yield:
      case JSOp::Await:
      case JSOp::AfterYield:
      case JSOp::FinalYieldRval:
      case JSOp::Resume:
        return reject("generator");
      default:
        break;
    }
    if (jop == JSOp::JumpTarget || jop == JSOp::LoopHead) {
      ic = uint32_t(GET_INT32(pc));
    }
    uint32_t len = GetBytecodeLength(pc);
    if (!len || off + len > codeLen) return reject("bad length");
    bool inl = IsInlineOp(jop) || (gIcInline && IsIcCallOp(jop));
    if (jop == JSOp::LoopHead && gLoopExit) inl = false;
    ops[n] = OpInfo{off, ic, jop, !inl};
    opAt[off] = uint16_t(n);
    n++;
    if (BytecodeOpHasIC(jop)) ic++;
    off += len;
  }
  if (!n) return reject("empty");
  return true;
}

// ---- per-op translation ----------------------------------------------------

bool MT::nativeCall() {
  if (cur + 1 >= n) return reject("call at end");
  const uint32_t argc = GET_ARGC(code + ops[cur].pcOff);
  ld(argc + 1);
  lset(L_A);
  tagIs(L_A, JSVAL_TAG_OBJECT);
  op(OP_I32EQZ);
  ifThen();
  exitHere();
  end();
  lget(L_A);
  op(OP_I32WRAP);
  load32(uint32_t(kShapeOffset));
  load32(uint32_t(Shape::offsetOfBaseShape()));
  load32(uint32_t(BaseShape::offsetOfClasp()));
  ltee(L_X);
  i32c(int32_t(uintptr_t(js::FunctionClassPtr)));
  op(OP_I32NE);
  lget(L_X);
  i32c(int32_t(uintptr_t(js::FunctionExtendedClassPtr)));
  op(OP_I32NE);
  op(OP_I32AND);
  ifThen();
  exitHere();
  end();
  lget(L_A);
  op(OP_I32WRAP);
  load32(uint32_t(JSFunction::offsetOfFlagsAndArgCount()));
  i32c(int32_t(FunctionFlags::BASESCRIPT | FunctionFlags::SELFHOSTLAZY));
  op(OP_I32AND);
  ifThen();
  if (gDirect) {
    // r = CallScripted(frame, sp, pc, icEntry, ctx); r == 1: the callee
    // frame is pushed, return to the interpreter in it (Hook: kRanNewFrame).
    // r == 0: nothing changed, exit at the Call op as without PBLBC_DIRECT.
    const OpInfo& o = ops[cur];
    lget(P_FRAME);
    lget(L_SP);
    op(OP_I64EXTU);
    lget(L_EPC);
    i32c(int32_t(o.pcOff));
    op(OP_I32ADD);
    op(OP_I64EXTU);
    lget(L_ICE);
    i32c(int32_t(o.icIdx * sizeof(ICEntry)));
    op(OP_I32ADD);
    op(OP_I64EXTU);
    lget(P_CTX);
    for (uint32_t i = 5; i < kNParams; i++) i64c(0);
    i32c(int32_t(uintptr_t(&CallScripted)));
    b.put(OP_CALLIND);
    b.uleb(0);
    b.uleb(0);
    ltee(L_R);
    i64c(1);
    op(OP_I64EQ);
    ifThen();
    i64c(int64_t((uint64_t(kFrameSwitch) << 32) | o.pcOff));
    op(OP_RETURN);
    end();
    // r > 1: the call completed inline; r is the sp after it.
    i64c(1);
    lget(L_R);
    op(OP_I64LTU);
    ifThen();
    lget(L_R);
    op(OP_I32WRAP);
    lset(L_SP);
    debugCheckNext();
    jumpTo(cur + 1);
    end();
  }
  exitHere();
  end();
  lget(L_CTX);
  i32c(2);
  store32(kCtxExtraArgs);
  i64c(argc);
  lset(L_A);
  invokeIC(L_A, ~0u, ~0u, false);
  spAdd(int32_t(argc + 2));
  pushLocal(L_R);
  debugCheckNext();
  return true;
}

// Add/Sub/Mul/Div/Mod: the interpreter's HybridICs fast paths; anything else
// (strings, objects, double Mod) is left to the interpreter.
bool MT::binaryArith(JSOp jop) {
  ld(0);
  lset(L_A);  // rhs
  ld(1);
  lset(L_B);  // lhs
  block();    // $done
  if (jop != JSOp::Div) {
    tagIs(L_A, JSVAL_TAG_INT32);
    tagIs(L_B, JSVAL_TAG_INT32);
    op(OP_I32AND);
    ifThen();
    if (jop == JSOp::Mod) {
      // lhs > 0 && rhs > 0
      lget(L_B);
      op(OP_I32WRAP);
      i32c(0);
      op(OP_I32GTS);
      lget(L_A);
      op(OP_I32WRAP);
      i32c(0);
      op(OP_I32GTS);
      op(OP_I32AND);
      ifThen();
      lget(L_B);
      op(OP_I32WRAP);
      lget(L_A);
      op(OP_I32WRAP);
      op(OP_I32REMS);
      boxI32(JSVAL_TAG_INT32);
      lset(L_R);
      spAdd(1);
      stLocal(0, L_R);
      br(2);
      end();
    } else {
      lget(L_B);
      op(OP_I32WRAP);
      op(OP_I64EXTS);
      lget(L_A);
      op(OP_I32WRAP);
      op(OP_I64EXTS);
      op(jop == JSOp::Add ? OP_I64ADD : jop == JSOp::Sub ? OP_I64SUB
                                                         : OP_I64MUL);
      lset(L_R);
      // fits in int32
      lget(L_R);
      op(OP_I32WRAP);
      op(OP_I64EXTS);
      lget(L_R);
      op(OP_I64EQ);
      if (jop == JSOp::Mul) {
        // product != 0 || !((lhs < 0) ^ (rhs < 0))
        lget(L_R);
        i64c(0);
        op(OP_I64NE);
        lget(L_B);
        lget(L_A);
        op(OP_I64XOR);
        op(OP_I32WRAP);
        i32c(0);
        op(OP_I32GES);
        op(OP_I32OR);
        op(OP_I32AND);
      }
      ifThen();
      lget(L_R);
      op(OP_I32WRAP);
      boxI32(JSVAL_TAG_INT32);
      lset(L_R);
      spAdd(1);
      stLocal(0, L_R);
      br(2);
      end();
    }
    end();
  }
  if (jop != JSOp::Mod) {
    isNumber(L_A);
    isNumber(L_B);
    op(OP_I32AND);
    ifThen();
    toF64(L_B);
    toF64(L_A);
    op(jop == JSOp::Add   ? OP_F64ADD
       : jop == JSOp::Sub ? OP_F64SUB
       : jop == JSOp::Mul ? OP_F64MUL
                          : OP_F64DIV);
    boxNumber();
    lset(L_R);
    spAdd(1);
    stLocal(0, L_R);
    br(1);
    end();
  }
  if (gCovb & kCovbArith) {
    // PBL generic_binary: BinaryArith IC (strings, objects, BigInt, ...).
    if (!generic(2)) return false;
  } else {
    exitHere();
  }
  end();
  return true;
}

// Eq/Ne/Lt/Le/Gt/Ge: int32 and number fast paths, else the Compare IC
// (generic_cmp). StrictEq/StrictNe: StrictlyEqual for non-strings.
bool MT::compare(JSOp jop) {
  ld(0);
  lset(L_A);  // rhs
  ld(1);
  lset(L_B);  // lhs
  block();    // $done
  if (jop == JSOp::StrictEq || jop == JSOp::StrictNe) {
    bool eq = jop == JSOp::StrictEq;
    isNumber(L_A);
    isNumber(L_B);
    op(OP_I32AND);
    ifThen();
    toF64(L_B);
    toF64(L_A);
    op(eq ? OP_F64EQ : OP_F64NE);
    boxI32(JSVAL_TAG_BOOLEAN);
    lset(L_R);
    spAdd(1);
    stLocal(0, L_R);
    br(1);
    end();
    // Strings, BigInts and magic values go to the interpreter.
    tagIs(L_A, JSVAL_TAG_STRING);
    tagIs(L_B, JSVAL_TAG_STRING);
    op(OP_I32OR);
    tagIs(L_A, JSVAL_TAG_BIGINT);
    op(OP_I32OR);
    tagIs(L_B, JSVAL_TAG_BIGINT);
    op(OP_I32OR);
    tagIs(L_A, JSVAL_TAG_MAGIC);
    op(OP_I32OR);
    tagIs(L_B, JSVAL_TAG_MAGIC);
    op(OP_I32OR);
    op(OP_I32EQZ);
    ifThen();
    // Same type compares bits; different types (not both numbers) differ.
    lget(L_A);
    lget(L_B);
    op(eq ? OP_I64EQ : OP_I64NE);
    boxI32(JSVAL_TAG_BOOLEAN);
    lset(L_R);
    spAdd(1);
    stLocal(0, L_R);
    br(1);
    end();
    if (gCovb & kCovbStrictEq) {
      // Strings/BigInts: PBL generic_cmp (Compare IC); magic still exits.
      tagIs(L_A, JSVAL_TAG_MAGIC);
      tagIs(L_B, JSVAL_TAG_MAGIC);
      op(OP_I32OR);
      ifThen();
      exitHere();
      end();
      if (!generic(2)) return false;
    } else {
      exitHere();
    }
    end();
    return true;
  }
  uint8_t i32op, f64op;
  switch (jop) {
    case JSOp::Eq:
      i32op = OP_I32EQ;
      f64op = OP_F64EQ;
      break;
    case JSOp::Ne:
      i32op = OP_I32NE;
      f64op = OP_F64NE;
      break;
    case JSOp::Lt:
      i32op = OP_I32LTS;
      f64op = OP_F64LT;
      break;
    case JSOp::Le:
      i32op = OP_I32LES;
      f64op = OP_F64LE;
      break;
    case JSOp::Gt:
      i32op = OP_I32GTS;
      f64op = OP_F64GT;
      break;
    default:
      i32op = OP_I32GES;
      f64op = OP_F64GE;
      break;
  }
  tagIs(L_A, JSVAL_TAG_INT32);
  tagIs(L_B, JSVAL_TAG_INT32);
  op(OP_I32AND);
  ifThen();
  lget(L_B);
  op(OP_I32WRAP);
  lget(L_A);
  op(OP_I32WRAP);
  op(i32op);
  boxI32(JSVAL_TAG_BOOLEAN);
  lset(L_R);
  spAdd(1);
  stLocal(0, L_R);
  br(1);
  end();
  // Wasm f64 compares are false on NaN except ne, like the interpreter.
  isNumber(L_A);
  isNumber(L_B);
  op(OP_I32AND);
  ifThen();
  toF64(L_B);
  toF64(L_A);
  op(f64op);
  boxI32(JSVAL_TAG_BOOLEAN);
  lset(L_R);
  spAdd(1);
  stLocal(0, L_R);
  br(1);
  end();
  if (!generic(2)) return false;
  end();
  return true;
}

// generic_binary / generic_cmp (nargs 2) and generic_unary (nargs 1): pop the
// args, call the IC, push its result. Without inline ICs: exit.
bool MT::generic(uint32_t nargs) {
  if (!gIcInline) {
    exitHere();
    return true;
  }
  if (nargs == 2) {
    popLocal(L_B);
    popLocal(L_A);
    invokeIC(L_A, L_B, ~0u, false);
  } else {
    popLocal(L_A);
    invokeIC(L_A, ~0u, ~0u, false);
  }
  pushLocal(L_R);
  debugCheckNext();
  return true;
}

bool MT::unary(JSOp jop) {
  ld(0);
  lset(L_A);
  block();  // $done
  switch (jop) {
    case JSOp::Pos:
      isNumber(L_A);
      brIf(0);
      break;
    case JSOp::ToNumeric:
      isNumber(L_A);
      tagIs(L_A, JSVAL_TAG_BIGINT);
      op(OP_I32OR);
      brIf(0);
      exitHere();  // ToNumeric (HybridICs) runs in the interpreter
      end();
      return true;
    case JSOp::BitNot:
      tagIs(L_A, JSVAL_TAG_INT32);
      ifThen();
      lget(L_A);
      op(OP_I32WRAP);
      i32c(-1);
      op(OP_I32XOR);
      boxI32(JSVAL_TAG_INT32);
      lset(L_R);
      stLocal(0, L_R);
      br(1);
      end();
      break;
    default: {
      // Neg: i != 0 && i != INT32_MIN; Inc: i != INT32_MAX; Dec: != INT32_MIN.
      tagIs(L_A, JSVAL_TAG_INT32);
      ifThen();
      lget(L_A);
      op(OP_I32WRAP);
      lset(L_X);
      if (jop == JSOp::Neg) {
        lget(L_X);
        i32c(0);
        op(OP_I32NE);
        lget(L_X);
        i32c(INT32_MIN);
        op(OP_I32NE);
        op(OP_I32AND);
      } else {
        lget(L_X);
        i32c(jop == JSOp::Inc ? INT32_MAX : INT32_MIN);
        op(OP_I32NE);
      }
      ifThen();
      if (jop == JSOp::Neg) {
        i32c(0);
        lget(L_X);
        op(OP_I32SUB);
      } else {
        lget(L_X);
        i32c(jop == JSOp::Inc ? 1 : -1);
        op(OP_I32ADD);
      }
      boxI32(JSVAL_TAG_INT32);
      lset(L_R);
      stLocal(0, L_R);
      br(2);
      end();
      end();
      isNumber(L_A);
      ifThen();
      toF64(L_A);
      if (jop == JSOp::Neg) {
        op(OP_F64NEG);
      } else {
        b.put(OP_I64CONST);
        b.sleb(int64_t(mozilla::BitwiseCast<uint64_t>(1.0)));
        op(OP_F64REINTI64);
        op(jop == JSOp::Inc ? OP_F64ADD : OP_F64SUB);
      }
      boxNumber();
      lset(L_R);
      stLocal(0, L_R);
      br(1);
      end();
      break;
    }
  }
  if (!generic(1)) return false;
  end();
  return true;
}

bool MT::translateOp() {
  const OpInfo& o = ops[cur];
  jsbytecode* pc = const_cast<jsbytecode*>(code + o.pcOff);
  if (o.exit) {
    nExit++;
    exitHere();
    return true;
  }
  nInline++;
  switch (o.op) {
    case JSOp::Call:
    case JSOp::CallIgnoresRv:
      return nativeCall();
    case JSOp::Nop:
    case JSOp::NopDestructuring:
    case JSOp::NopIsAssignOp:
    case JSOp::JumpTarget:
      return true;
    case JSOp::Undefined:
    case JSOp::Null:
    case JSOp::True:
    case JSOp::False:
    case JSOp::Zero:
    case JSOp::One:
    case JSOp::Int8:
    case JSOp::Uint16:
    case JSOp::Uint24:
    case JSOp::Int32:
    case JSOp::Double: {
      Value v;
      switch (o.op) {
        case JSOp::Undefined:
          v = UndefinedValue();
          break;
        case JSOp::Null:
          v = NullValue();
          break;
        case JSOp::True:
          v = BooleanValue(true);
          break;
        case JSOp::False:
          v = BooleanValue(false);
          break;
        case JSOp::Zero:
          v = Int32Value(0);
          break;
        case JSOp::One:
          v = Int32Value(1);
          break;
        case JSOp::Int8:
          v = Int32Value(GET_INT8(pc));
          break;
        case JSOp::Uint16:
          v = Int32Value(GET_UINT16(pc));
          break;
        case JSOp::Uint24:
          v = Int32Value(GET_UINT24(pc));
          break;
        case JSOp::Int32:
          v = Int32Value(GET_INT32(pc));
          break;
        default:
          v = GET_INLINE_VALUE(pc);
          break;
      }
      spAdd(-1);
      lget(L_SP);
      i64c(int64_t(v.asRawBits()));
      store64(0);
      return true;
    }
    case JSOp::Void:
      lget(L_SP);
      i64c(int64_t(UndefinedValue().asRawBits()));
      store64(0);
      return true;
    case JSOp::Pop:
      spAdd(1);
      return true;
    case JSOp::PopN:
      spAdd(int32_t(GET_UINT16(pc)));
      return true;
    case JSOp::Dup:
      ld(0);
      lset(L_A);
      pushLocal(L_A);
      return true;
    case JSOp::Dup2:
      ld(0);
      lset(L_A);
      ld(1);
      lset(L_B);
      spAdd(-2);
      stLocal(1, L_B);
      stLocal(0, L_A);
      return true;
    case JSOp::DupAt:
      ld(GET_UINT24(pc));
      lset(L_A);
      pushLocal(L_A);
      return true;
    case JSOp::Swap:
      ld(0);
      lset(L_A);
      ld(1);
      lset(L_B);
      stLocal(0, L_B);
      stLocal(1, L_A);
      return true;
    case JSOp::Pick: {
      uint32_t i = GET_UINT8(pc);
      ld(i);
      lset(L_A);
      for (uint32_t k = i; k > 0; k--) {
        lget(L_SP);
        ld(k - 1);
        store64(8 * k);
      }
      stLocal(0, L_A);
      return true;
    }
    case JSOp::Unpick: {
      uint32_t i = GET_UINT8(pc);
      ld(0);
      lset(L_A);
      for (uint32_t k = 0; k < i; k++) {
        lget(L_SP);
        ld(k + 1);
        store64(8 * k);
      }
      stLocal(i, L_A);
      return true;
    }
    case JSOp::GetLocal: {
      uint32_t i = GET_LOCALNO(pc);
      if (i >= nfixed) return reject("local index");
      lget(L_LB);
      load64(8 * (nfixed - 1 - i));
      lset(L_A);
      pushLocal(L_A);
      return true;
    }
    case JSOp::SetLocal:
    case JSOp::InitLexical: {
      uint32_t i = GET_LOCALNO(pc);
      if (i >= nfixed) return reject("local index");
      lget(L_LB);
      ld(0);
      store64(8 * (nfixed - 1 - i));
      return true;
    }
    case JSOp::CheckLexical:
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_MAGIC);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::ToString:
      // CASE(ToString): a string is left as is; anything else exits.
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_STRING);
      op(OP_I32EQZ);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::TypeofEq: {
      // CASE(TypeofEq) (HybridICs): js::TypeOfValue(v) == operand.type()
      // for primitives (null is "object"); objects and magic exit.
      TypeofEqOperand operand = TypeofEqOperand::fromRawValue(GET_UINT8(pc));
      JSType t = operand.type();
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_OBJECT);
      tagIs(L_A, JSVAL_TAG_MAGIC);
      op(OP_I32OR);
      ifThen();
      exitHere();
      end();
      switch (t) {
        case JSTYPE_UNDEFINED:
          tagIs(L_A, JSVAL_TAG_UNDEFINED);
          break;
        case JSTYPE_OBJECT:
          tagIs(L_A, JSVAL_TAG_NULL);
          break;
        case JSTYPE_FUNCTION:
          i32c(0);
          break;
        case JSTYPE_STRING:
          tagIs(L_A, JSVAL_TAG_STRING);
          break;
        case JSTYPE_NUMBER:
          isNumber(L_A);
          break;
        case JSTYPE_BOOLEAN:
          tagIs(L_A, JSVAL_TAG_BOOLEAN);
          break;
        case JSTYPE_SYMBOL:
          tagIs(L_A, JSVAL_TAG_SYMBOL);
          break;
        case JSTYPE_BIGINT:
          tagIs(L_A, JSVAL_TAG_BIGINT);
          break;
        default:
          return reject("typeofeq type");
      }
      if (operand.compareOp() == JSOp::Ne) op(OP_I32EQZ);
      boxI32(JSVAL_TAG_BOOLEAN);
      lset(L_R);
      stLocal(0, L_R);
      return true;
    }
    case JSOp::IsConstructing:
    case JSOp::Hole:
    case JSOp::Uninitialized: {
      // CASE(IsConstructing/Hole/Uninitialized): push a magic constant.
      JSWhyMagic why = o.op == JSOp::IsConstructing ? JS_IS_CONSTRUCTING
                       : o.op == JSOp::Hole         ? JS_ELEMENTS_HOLE
                                                    : JS_UNINITIALIZED_LEXICAL;
      spAdd(-1);
      lget(L_SP);
      i64c(int64_t(MagicValue(why).asRawBits()));
      store64(0);
      return true;
    }
    case JSOp::CheckAliasedLexical:
      // CASE(CheckAliasedLexical): only the uninitialized magic throws; any
      // magic exits (the interpreter then decides), anything else is a no-op.
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_MAGIC);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::GetFrameArg:
      // CASE(GetFrameArg): push frame->argv()[i] (no aliasing check there).
      lget(L_AV);
      load64(8 * GET_ARGNO(pc));
      lset(L_A);
      pushLocal(L_A);
      return true;
    case JSOp::String: {
      // CASE(String): StringValue(frame->script()->getString(pc)). The script
      // is read at run time from the frame's interpreterScript_ (set by
      // pushFrame's setInterpreterFieldsForPrologue, traced by the GC), then
      // the GCCellPtr in its PrivateScriptData gcthings (String kind tag 2,
      // removed with xor exactly like BaselineCodeGen::loadScriptGCThing).
      static_assert(uintptr_t(JS::TraceKind::String) == 2);
      static_assert(sizeof(JS::GCCellPtr) == 4);
      uint32_t idx = GET_GCTHING_INDEX(pc);
      lget(L_FR);
      load32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfInterpreterScript())));
      load32(uint32_t(JSScript::offsetOfPrivateData()));
      load32(uint32_t(PrivateScriptData::offsetOfGCThings() + 4 * idx));
      i32c(2);
      op(OP_I32XOR);
      boxI32(JSVAL_TAG_STRING);
      lset(L_A);
      pushLocal(L_A);
      return true;
    }
    case JSOp::StrictConstantEq:
    case JSOp::StrictConstantNe: {
      // CASE(StrictConstantEq/Ne) with js::ConstantStrictEqual: the operand
      // is decoded here at compile time, the value compared at run time.
      ConstantCompareOperand c =
          ConstantCompareOperand::fromRawValue(GET_UINT16(pc));
      ld(0);
      lset(L_A);
      switch (c.type()) {
        case ConstantCompareOperand::EncodedType::Int32:
          // val.isNumber() && val.toNumber() == double(int32)
          tagIs(L_A, JSVAL_TAG_INT32);
          ifThen(T_I32);
          lget(L_A);
          op(OP_I32WRAP);
          i32c(c.toInt32());
          op(OP_I32EQ);
          elseThen();
          isDouble(L_A);
          ifThen(T_I32);
          lget(L_A);
          op(OP_F64REINTI64);
          i32c(c.toInt32());
          op(OP_F64CONVI32S);
          op(OP_F64EQ);
          elseThen();
          i32c(0);
          end();
          end();
          break;
        case ConstantCompareOperand::EncodedType::Boolean:
          lget(L_A);
          i64c(int64_t(BooleanValue(c.toBoolean()).asRawBits()));
          op(OP_I64EQ);
          break;
        case ConstantCompareOperand::EncodedType::Undefined:
          tagIs(L_A, JSVAL_TAG_UNDEFINED);
          break;
        case ConstantCompareOperand::EncodedType::Null:
          tagIs(L_A, JSVAL_TAG_NULL);
          break;
        default:
          return reject("constant compare operand");
      }
      if (o.op == JSOp::StrictConstantNe) op(OP_I32EQZ);
      boxI32(JSVAL_TAG_BOOLEAN);
      lset(L_A);
      stLocal(0, L_A);
      return true;
    }
    case JSOp::GetAliasedVar: {
      // CASE(GetAliasedVar) / getEnvironmentFromCoordinate: walk hops
      // enclosing environments from frame->environmentChain(), then
      // obj.aliasedBinding(ec) == getSlot(ec.slot()). Any proxy on the walk
      // (DebugEnvironmentProxy, the only non-EnvironmentObject the
      // interpreter allows there) exits. The fixed-slot count is read from
      // the object's shape at run time.
      EnvironmentCoordinate ec(pc);
      uint32_t hops = ec.hops(), slot = ec.slot();
      auto proxyExit = [&]() {
        lget(L_X);
        load32(uint32_t(offsetof(JS::shadow::Object, shape)));
        load32(uint32_t(Shape::offsetOfBaseShape()));
        load32(uint32_t(BaseShape::offsetOfClasp()));
        load32(uint32_t(JSClass::offsetOfFlags()));
        i32c(int32_t(JSCLASS_IS_PROXY));
        op(OP_I32AND);
        ifThen();
        exitHere();
        end();
      };
      lget(L_FR);
      load32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfEnvironmentChain())));
      lset(L_X);
      for (uint32_t h = 0; h < hops; h++) {
        proxyExit();
        lget(L_X);
        load32(uint32_t(EnvironmentObject::offsetOfEnclosingEnvironment()));
        lset(L_X);
      }
      proxyExit();
      // nfixed = shape->numFixedSlots()
      lget(L_X);
      load32(uint32_t(offsetof(JS::shadow::Object, shape)));
      load32(uint32_t(Shape::offsetOfImmutableFlags()));
      i32c(int32_t(NativeShape::fixedSlotsShift()));
      op(OP_I32SHRU);
      i32c(int32_t(NativeShape::fixedSlotsMask() >> NativeShape::fixedSlotsShift()));
      op(OP_I32AND);
      op(OP_I64EXTU);
      lset(L_B);
      lget(L_B);
      i64c(int64_t(slot));
      op(OP_I64GTU);
      ifThen(T_I64);
      lget(L_X);
      load64(uint32_t(NativeObject::getFixedSlotOffset(slot)));
      elseThen();
      // slots_[slot - nfixed]
      lget(L_X);
      load32(uint32_t(NativeObject::offsetOfSlots()));
      i32c(int32_t(8 * slot));
      op(OP_I32ADD);
      lget(L_B);
      op(OP_I32WRAP);
      i32c(3);
      op(OP_I32SHL);
      op(OP_I32SUB);
      load64(0);
      end();
      lset(L_A);
      pushLocal(L_A);
      return true;
    }
    case JSOp::GetArg:
    case JSOp::SetArg: {
      uint32_t i = GET_ARGNO(pc);
      lget(L_FLG);
      i32c(kFlagArgsAliased);
      op(OP_I32AND);
      ifThen();
      exitHere();
      end();
      if (o.op == JSOp::GetArg) {
        lget(L_AV);
        load64(8 * i);
        lset(L_A);
        pushLocal(L_A);
      } else {
        lget(L_AV);
        ld(0);
        store64(8 * i);
      }
      return true;
    }
    case JSOp::FunctionThis:
      // GetFunctionThis' first case: an object |this| (thisArgument(), the
      // slot before argv) is pushed as is. Any other value (strict or not)
      // exits: the interpreter boxes primitives / substitutes the global
      // |this|, and strictness is not keyed per entry (entries are per
      // ImmutableScriptData, which scripts may share). Not an IC op.
      lget(L_AV);
      i32c(8);
      op(OP_I32SUB);
      load64(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_OBJECT);
      op(OP_I32EQZ);
      ifThen();
      exitHere();
      end();
      pushLocal(L_A);
      return true;
    case JSOp::LoopHead:
      // Pending interrupts are handled by the interpreter's LoopHead.
      // The diagnostic reason originates only in this executed IRQ branch.
      // With observation disabled, emit the exact original exit constant.
      lget(P_IRQ);
      op(OP_I32WRAP);
      load32(0);
      ifThen();
      exitAt(cur, pbltier::Enabled() ? kObservedIrqExit : kExit);
      end();
      if (gLoopJit) {
        // if (!(loopState[cur] & kLoopSkip)) {
        //   r = LoopHook(frame, sp, pcOff, cx, entry);
        //   if (r) { SP = r; ST = (r >> 32) - 1; continue at op ST; } }
        i32c(int32_t(uintptr_t(loopState + cur)));
        load32(0);
        i32c(int32_t(kLoopSkip));
        op(OP_I32AND);
        op(OP_I32EQZ);
        ifThen();
        lget(P_FRAME);
        lget(L_SP);
        op(OP_I64EXTU);
        i64c(int64_t(ops[cur].pcOff));
        lget(P_CX);
        i64c(int64_t(uintptr_t(entry)));
        for (uint32_t i = 5; i < kNParams; i++) i64c(0);
        i32c(int32_t(uintptr_t(&LoopHook)));
        b.put(OP_CALLIND);
        b.uleb(0);
        b.uleb(0);
        ltee(L_R);
        op(OP_I64EQZ);
        op(OP_I32EQZ);
        ifThen();
        lget(L_R);
        op(OP_I32WRAP);
        lset(L_SP);
        lget(L_R);
        i64c(32);
        op(OP_I64SHRU);
        op(OP_I32WRAP);
        i32c(1);
        op(OP_I32SUB);
        lset(L_ST);
        br(n - 1 - cur + lvl);
        end();
        end();
      }
      return true;
    case JSOp::Goto: {
      uint32_t k;
      if (!target(GET_JUMP_OFFSET(pc), &k)) return reject("jump target");
      jumpTo(k);
      return true;
    }
    case JSOp::JumpIfFalse:
    case JSOp::JumpIfTrue:
    case JSOp::And:
    case JSOp::Or: {
      uint32_t k;
      if (!target(GET_JUMP_OFFSET(pc), &k)) return reject("jump target");
      ld(0);
      lset(L_A);
      toBoolOrExit(L_A);
      lset(L_X);
      if (o.op == JSOp::JumpIfFalse || o.op == JSOp::JumpIfTrue) spAdd(1);
      lget(L_X);
      if (o.op == JSOp::JumpIfFalse || o.op == JSOp::And) op(OP_I32EQZ);
      ifThen();
      jumpTo(k);
      end();
      return true;
    }
    case JSOp::Not:
      ld(0);
      lset(L_A);
      toBoolOrExit(L_A);
      op(OP_I32EQZ);
      boxI32(JSVAL_TAG_BOOLEAN);
      lset(L_R);
      stLocal(0, L_R);
      return true;
    case JSOp::Coalesce: {
      uint32_t k;
      if (!target(GET_JUMP_OFFSET(pc), &k)) return reject("jump target");
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_UNDEFINED);
      tagIs(L_A, JSVAL_TAG_NULL);
      op(OP_I32OR);
      op(OP_I32EQZ);
      ifThen();
      jumpTo(k);
      end();
      return true;
    }
    case JSOp::Case: {
      uint32_t k;
      if (!target(GET_JUMP_OFFSET(pc), &k)) return reject("jump target");
      // The condition is always a boolean (StrictEq result).
      ld(0);
      op(OP_I32WRAP);
      lset(L_X);
      spAdd(1);
      lget(L_X);
      ifThen();
      spAdd(1);
      jumpTo(k);
      end();
      return true;
    }
    case JSOp::Default: {
      uint32_t k;
      if (!target(GET_JUMP_OFFSET(pc), &k)) return reject("jump target");
      spAdd(1);
      jumpTo(k);
      return true;
    }
    case JSOp::TableSwitch: {
      int32_t len = GET_JUMP_OFFSET(pc);
      int32_t low = GET_JUMP_OFFSET(pc + 1 * JUMP_OFFSET_LEN);
      int32_t high = GET_JUMP_OFFSET(pc + 2 * JUMP_OFFSET_LEN);
      uint32_t first = GET_RESUMEINDEX(pc + 3 * JUMP_OFFSET_LEN);
      uint32_t kDefault;
      if (!target(len, &kDefault)) return reject("jump target");
      if (high < low || uint64_t(int64_t(high) - low) >= kMaxSwitchCases) {
        return reject("switch size");
      }
      uint32_t ncases = uint32_t(high - low) + 1;
      ld(0);
      lset(L_A);
      // Doubles (NumberEqualsInt32) are left to the interpreter.
      isDouble(L_A);
      ifThen();
      exitHere();
      end();
      spAdd(1);
      tagIs(L_A, JSVAL_TAG_INT32);
      op(OP_I32EQZ);
      ifThen();
      jumpTo(kDefault);
      end();
      // idx = i - low (unsigned); out of range -> default
      for (uint32_t c = 0; c <= ncases; c++) block();
      lget(L_A);
      op(OP_I32WRAP);
      i32c(low);
      op(OP_I32SUB);
      b.put(OP_BRTABLE);
      b.uleb(ncases);
      for (uint32_t c = 0; c < ncases; c++) b.uleb(c);
      b.uleb(ncases);
      for (uint32_t c = 0; c <= ncases; c++) {
        end();
        uint32_t k;
        if (c < ncases) {
          int64_t t = int64_t(resumeOffsets[first + c]) - int64_t(o.pcOff);
          if (!target(int32_t(t), &k)) return reject("switch target");
        } else {
          k = kDefault;
        }
        jumpTo(k);
      }
      return true;
    }
    case JSOp::IsNullOrUndefined:
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_UNDEFINED);
      tagIs(L_A, JSVAL_TAG_NULL);
      op(OP_I32OR);
      boxI32(JSVAL_TAG_BOOLEAN);
      lset(L_R);
      pushLocal(L_R);
      return true;
    case JSOp::Add:
    case JSOp::Sub:
    case JSOp::Mul:
    case JSOp::Div:
    case JSOp::Mod:
      return binaryArith(o.op);
    case JSOp::BitOr:
    case JSOp::BitAnd:
    case JSOp::BitXor:
    case JSOp::Lsh:
    case JSOp::Rsh:
    case JSOp::Ursh: {
      ld(0);
      lset(L_A);
      ld(1);
      lset(L_B);
      block();
      tagIs(L_A, JSVAL_TAG_INT32);
      tagIs(L_B, JSVAL_TAG_INT32);
      op(OP_I32AND);
      ifThen();
      lget(L_B);
      op(OP_I32WRAP);
      lget(L_A);
      op(OP_I32WRAP);
      if (o.op == JSOp::Lsh || o.op == JSOp::Rsh || o.op == JSOp::Ursh) {
        i32c(31);
        op(OP_I32AND);
      }
      switch (o.op) {
        case JSOp::BitOr:
          op(OP_I32OR);
          break;
        case JSOp::BitAnd:
          op(OP_I32AND);
          break;
        case JSOp::BitXor:
          op(OP_I32XOR);
          break;
        case JSOp::Lsh:
          op(OP_I32SHL);
          break;
        case JSOp::Rsh:
          op(OP_I32SHRS);
          break;
        default:
          op(OP_I32SHRU);
          break;
      }
      if (o.op == JSOp::Ursh) {
        lset(L_X);
        lget(L_X);
        i32c(0);
        op(OP_I32GES);
        ifThen(T_I64);
        lget(L_X);
        boxI32(JSVAL_TAG_INT32);
        elseThen();
        lget(L_X);
        op(OP_F64CONVI32U);
        op(OP_I64REINTF64);
        end();
      } else {
        boxI32(JSVAL_TAG_INT32);
      }
      lset(L_R);
      spAdd(1);
      stLocal(0, L_R);
      br(1);
      end();
      if (!generic(2)) return false;
      end();
      return true;
    }
    case JSOp::Eq:
    case JSOp::Ne:
    case JSOp::Lt:
    case JSOp::Le:
    case JSOp::Gt:
    case JSOp::Ge:
    case JSOp::StrictEq:
    case JSOp::StrictNe:
      return compare(o.op);
    case JSOp::Pos:
    case JSOp::Neg:
    case JSOp::Inc:
    case JSOp::Dec:
    case JSOp::BitNot:
    case JSOp::ToNumeric:
      return unary(o.op);
    case JSOp::SetRval:
      lget(L_FR);
      ld(0);
      store64(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfReturnValue())));
      lget(L_FR);
      lget(L_FR);
      load32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfFlags())));
      i32c(int32_t(BaselineFrame::HAS_RVAL));
      op(OP_I32OR);
      store32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfFlags())));
      spAdd(1);
      return true;

    // ---- IC ops (INVOKE_IC with the interpreter's argument order) ----
    case JSOp::GetProp:
    case JSOp::GetBoundName:
    case JSOp::ToPropertyKey:
    case JSOp::OptimizeSpreadCall:
      popLocal(L_A);
      invokeIC(L_A, ~0u, ~0u, false);
      pushLocal(L_R);
      debugCheckNext();
      return true;
    case JSOp::GetElem:
      // String receivers take the interpreter's static-string fast path.
      ld(1);
      lset(L_B);
      tagIs(L_B, JSVAL_TAG_STRING);
      ifThen();
      exitHere();
      end();
      [[fallthrough]];
    case JSOp::In:
    case JSOp::HasOwn:
    case JSOp::Instanceof:
      popLocal(L_B);
      popLocal(L_A);
      invokeIC(L_A, L_B, ~0u, false);
      pushLocal(L_R);
      debugCheckNext();
      return true;
    case JSOp::GetPropSuper:
      popLocal(L_A);
      popLocal(L_B);
      invokeIC(L_A, L_B, ~0u, false);
      pushLocal(L_R);
      debugCheckNext();
      return true;
    case JSOp::SetProp:
    case JSOp::StrictSetProp:
    case JSOp::SetName:
    case JSOp::StrictSetName:
    case JSOp::SetGName:
    case JSOp::StrictSetGName:
      popLocal(L_B);
      popLocal(L_A);
      pushLocal(L_B);
      invokeIC(L_A, L_B, ~0u, false);
      debugCheckNext();
      return true;
    case JSOp::InitProp:
    case JSOp::InitHiddenProp:
    case JSOp::InitLockedProp:
      popLocal(L_B);
      ld(0);
      lset(L_A);
      invokeIC(L_A, L_B, ~0u, false);
      debugCheckNext();
      return true;
    case JSOp::InitElem:
    case JSOp::InitHiddenElem:
    case JSOp::InitLockedElem:
    case JSOp::InitElemInc:
    case JSOp::SetElem:
    case JSOp::StrictSetElem:
      popLocal(L_C);
      popLocal(L_B);
      ld(0);
      lset(L_A);
      if (o.op == JSOp::SetElem || o.op == JSOp::StrictSetElem) {
        stLocal(0, L_C);
      }
      invokeIC(L_A, L_B, L_C, true);
      if (o.op == JSOp::InitElemInc) {
        lget(L_B);
        op(OP_I32WRAP);
        i32c(1);
        op(OP_I32ADD);
        boxI32(JSVAL_TAG_INT32);
        lset(L_R);
        pushLocal(L_R);
      }
      debugCheckNext();
      return true;
    case JSOp::GetGName:
    case JSOp::BindUnqualifiedGName:
      lget(P_GLEX);
      lset(L_A);
      invokeIC(L_A, ~0u, ~0u, false);
      pushLocal(L_R);
      debugCheckNext();
      return true;
    case JSOp::GetName:
    case JSOp::BindName:
      lget(L_FR);
      load32(uint32_t(
          FrameOff(BaselineFrame::reverseOffsetOfEnvironmentChain())));
      op(OP_I64EXTU);
      lset(L_A);
      invokeIC(L_A, ~0u, ~0u, false);
      pushLocal(L_R);
      debugCheckNext();
      return true;
    case JSOp::GetIntrinsic:
    case JSOp::GetImport:
      invokeIC(~0u, ~0u, ~0u, false);
      pushLocal(L_R);
      debugCheckNext();
      return true;
    default:
      return reject("unhandled inline op");
  }
}

bool MT::run() {
  if (!scan()) return false;
  loopState = static_cast<uint32_t*>(calloc(n, sizeof(uint32_t)));
  if (!loopState) return reject("oom");
  // Prologue: i32 views of the parameters.
  auto p32 = [&](uint32_t p, uint32_t l) {
    lget(p);
    op(OP_I32WRAP);
    lset(l);
  };
  p32(P_FRAME, L_FR);
  p32(P_SP, L_SP);
  p32(P_OP, L_ST);
  p32(P_ICE, L_ICE);
  p32(P_CTX, L_CTX);
  p32(P_IO, L_IO);
  p32(P_ARGV, L_AV);
  p32(P_FLAGS, L_FLG);
  p32(P_EPC, L_EPC);
  lget(L_FR);
  i32c(int32_t(8 * nfixed));
  op(OP_I32SUB);
  lset(L_LB);
  // loop $top { block B_{n-1} ... block B_0 { br_table ST } op_0 } ... op_{n-1}
  b.put(OP_LOOP);
  b.put(OP_VOID);
  for (uint32_t j = 0; j < n; j++) {
    b.put(OP_BLOCK);
    b.put(OP_VOID);
  }
  lget(L_ST);
  b.put(OP_BRTABLE);
  b.uleb(n);
  for (uint32_t j = 0; j < n; j++) b.uleb(j);
  b.uleb(n - 1);
  for (cur = 0; cur < n; cur++) {
    b.put(OP_END);  // B_cur
    lvl = 0;
    if (!translateOp() || reason) return false;
    if (lvl != 0) return reject("unbalanced blocks");
    if (b.oom) return reject("oom");
  }
  b.put(OP_END);  // loop
  b.put(OP_UNREACH);
  b.put(OP_END);  // function
  return !b.oom || reject("oom");
}

bool MT::assemble(Buf& m) {
  Buf c;
  Buf body;
  body.uleb(3);
  body.uleb(kNI64);
  body.put(T_I64);
  body.uleb(kNI32);
  body.put(T_I32);
  body.uleb(kNF64);
  body.put(T_F64);
  body.putn(b.p, b.n);

  m.putn("\0asm\1\0\0\0", 8);
  c.uleb(1);
  c.put(0x60);
  c.uleb(kNParams);
  for (uint32_t i = 0; i < kNParams; i++) c.put(T_I64);
  c.uleb(1);
  c.put(T_I64);
  m.section(1, c);
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

// ---- per-thread cache keyed by ImmutableScriptData -------------------------

struct Entry {
  const ImmutableScriptData* isd;
  SharedImmutableScriptData* shared;  // held reference keeps isd unique
  uint32_t hits;
  uint32_t fn;
  uint32_t nops;
  uint16_t* opAt;
  uint32_t* icIdx;  // per op
  uint8_t* exitOp;  // per op
  uint32_t* loopState;  // per op (LoopHook)
  uint8_t state;    // 0 counting, 1 compiled, 2 rejected
};

thread_local Entry* tTable;
thread_local Entry* tLast;
thread_local uint32_t tEntries;

uint32_t Hash(const void* p) {
  uint32_t h = uint32_t(uintptr_t(p)) * 2654435761u;
  h ^= h >> 15;
  return h >> (32 - kTableBits);
}

Entry* Find(const ImmutableScriptData* isd) {
  if (tLast && tLast->isd == isd) return tLast;
  if (!tTable) {
    tTable =
        static_cast<Entry*>(calloc(size_t(1) << kTableBits, sizeof(Entry)));
    if (!tTable) return nullptr;
  }
  uint32_t h = Hash(isd);
  for (uint32_t i = 0; i < kProbe; i++) {
    Entry* c = &tTable[(h + i) & ((1u << kTableBits) - 1)];
    if (c->isd == isd) return tLast = c;
    if (!c->isd) {
      // Entries are never evicted (each holds its script data alive).
      if (tEntries >= kMaxEntries) return nullptr;
      tEntries++;
      c->isd = isd;
      return tLast = c;
    }
  }
  return nullptr;
}

void Compile(Entry* e, JSScript* script, JSContext* cx) {
  MT t;
  t.entry = e;
  t.code = script->code();
  t.codeLen = script->length();
  t.resumeOffsets = script->immutableScriptData()->resumeOffsets().data();
  t.nfixed = script->nfixed();
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
    e->icIdx = static_cast<uint32_t*>(malloc(t.n * sizeof(uint32_t)));
    e->exitOp = static_cast<uint8_t*>(malloc(t.n));
    if (!e->icIdx || !e->exitOp) {
      ok = false;
      t.reason = "oom";
    }
  }
  if (!ok) {
    e->state = 2;
    gRejects.fetch_add(1, std::memory_order_relaxed);
    if (MOZ_UNLIKELY(gExitStat)) ExitStatReject(t.reason);
    if (TakeLog()) {
      fprintf(stderr,
              "PBLBC reject %s:%u len=%u ops=%u reason=%s op=%s rc=%ld "
              "bytes=%zu\n",
              script->filename() ? script->filename() : "?",
              script->lineno(), t.codeLen, t.n, t.reason ? t.reason : "?",
              t.cur < t.n ? CodeName(t.ops[t.cur].op) : "-", rc, m.n);
    }
    return;
  }
  for (uint32_t j = 0; j < t.n; j++) {
    e->icIdx[j] = t.ops[j].icIdx;
    e->exitOp[j] = t.ops[j].exit;
  }
  e->opAt = t.opAt;
  t.opAt = nullptr;
  e->loopState = t.loopState;
  t.loopState = nullptr;
  e->nops = t.n;
  e->fn = idx[0];
  e->shared = script->sharedData();
  e->shared->AddRef();
  e->state = 1;
  if (pbltier::Enabled())
    pbltier::Guard(pbltier::kInstall, script, cx, e->fn, -1);
  uint32_t nc = gCompiles.fetch_add(1, std::memory_order_relaxed) + 1;
  if (MOZ_UNLIKELY(gExitStat)) gEsCompiled++;
  if (TakeLog()) {
    fprintf(stderr,
            "PBLBC compile #%u %s:%u ops=%u inline=%u ic=%u exit=%u wasm=%zu "
            "idx=%u\n",
            nc, script->filename() ? script->filename() : "?",
            script->lineno(), t.n, t.nInline, t.nIc, t.nExit, m.n, idx[0]);
  }
}

// Hook results.
enum : int {
  kNone = 0,
  kPending = 1,
  kRan = 2,
  kRanIcError = 3,
  kRanNewFrame = 4,  // frame is a new callee frame (PBLBC_DIRECT)
  kRanNewFrameIcError = 5
};

struct Out {
  StackVal* sp;
  jsbytecode* pc;
  ICEntry* icEntry;
  BaselineFrame* frame;  // only for kRanNewFrame*
};

// Innermost state after a PBLBC_DIRECT frame push (read by Hook when the
// compiled code returns kFrameSwitch).
struct Switch {
  BaselineFrame* frame;
  StackVal* sp;
  jsbytecode* pc;
  ICEntry* icEntry;
  bool icError;
};
thread_local Switch tSwitch;
thread_local uint32_t tDirectDepth;
constexpr uint32_t kMaxDirectDepth = 32;
uint32_t gDirectReturns;

Entry* FindExisting(const ImmutableScriptData* isd) {
  if (tLast && tLast->isd == isd) return tLast;
  if (!tTable) return nullptr;
  uint32_t h = Hash(isd);
  for (uint32_t i = 0; i < kProbe; i++) {
    Entry* c = &tTable[(h + i) & ((1u << kTableBits) - 1)];
    if (c->isd == isd) return c;
    if (!c->isd) return nullptr;
  }
  return nullptr;
}

// Called by compiled code at a Call/CallIgnoresRv whose callee has a
// BaseScript (PBLBC_DIRECT). Mirrors the interpreter's scripted Call fast path
// (CASE(Call) in PortableBaselineInterpret.cpp): returns 0 with no state
// changed when any of its preconditions (or the extra ones below, which keep
// everything that can GC, throw or call into the VM out of this helper) fails;
// otherwise pushes the exit frame, arguments, callee token, descriptor and
// callee BaselineFrame exactly like the fast path, records the callee state
// in tSwitch, then runs the callee's compiled code from op 0. Returns 1 (frame
// switch, tSwitch holds the innermost frame state) when the callee stops at
// anything but Return/RetRval, otherwise performs the interpreter's return
// sequence and returns the caller's sp after the call (value pushed).
int64_t CallScripted(int64_t frameA, int64_t spA, int64_t pcA, int64_t iceA,
                     int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  auto* icEntry = reinterpret_cast<ICEntry*>(uintptr_t(iceA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  JSOp jop = JSOp(*pc);
  if (jop != JSOp::Call && jop != JSOp::CallIgnoresRv) return Refuse(kDsNotCall);
  if (frame->isDebuggee()) return Refuse(kDsCallerDebuggee);
  // Fast-path checks (same order as the interpreter; constructing == false).
  const uint32_t argc = GET_ARGC(pc);
  StackVal* firstArg = sp + argc - 1;
  const Value callee = firstArg[2].asValue();
  if (!callee.isObject() || !callee.toObject().is<JSFunction>()) {
    return Refuse(kDsNotFunction);
  }
  JSFunction* func = &callee.toObject().as<JSFunction>();
  if (!func->hasBaseScript() || !func->isInterpreted()) {
    return Refuse(kDsNotInterpreted);
  }
  if (func->isClassConstructor()) return Refuse(kDsClassCtor);
  if (!func->baseScript()->hasBytecode()) return Refuse(kDsNoBytecode);
  JSScript* calleeScript = func->baseScript()->asJSScript();
  if (!calleeScript->hasJitScript()) return Refuse(kDsNoJitScript);
  if (cx->realm() != calleeScript->realm()) return Refuse(kDsRealm);
  if (argc < func->nargs()) return Refuse(kDsUnderflow);
  const uint32_t totalArgs = argc + 1;
  if (!ctx.stack.check(sp, sizeof(StackVal) * (totalArgs + 3))) {
    return Refuse(kDsStack);
  }
  // Extra: steps 9-12 of the fast path must be no-ops, and step 7 (callee
  // stack space, which would throw over-recursion) must pass. The space for
  // the exit frame (4 words + ExitFrameType), stub slot, args, token,
  // descriptor, fake return address and saved fp is added conservatively.
  if (func->needsFunctionEnvironmentObjects()) return Refuse(kDsEnvObjects);
  if (calleeScript->isDebuggee()) return Refuse(kDsCalleeDebuggee);
  if (calleeScript->hasScriptCounts() || cx->realm()->collectCoverageForDebug())
    return Refuse(kDsCounts);
  if (cx->hasAnyPendingInterrupt()) return Refuse(kDsInterrupt);
  if (!ctx.stack.check(sp, sizeof(StackVal) * (totalArgs + 16) +
                               BaselineFrame::Size() +
                               sizeof(StackVal) * calleeScript->nslots())) {
    return Refuse(kDsCalleeStack);
  }
  // The callee must have compiled code enterable at op 0.
  Entry* e = FindExisting(calleeScript->immutableScriptData());
  if (!e || e->state != 1) return Refuse(kDsNotCompiled);
  uint32_t j0 = e->opAt[0];
  // An exit op at op 0 is refused, except RetRval (e.g. an empty function's
  // whole body): it is performed below without entering compiled code.
  const bool retRval0 = JSOp(*calleeScript->code()) == JSOp::RetRval;
  if (j0 == 0xffff || (e->exitOp[j0] && !retRval0)) {
    return Refuse(kDsEntryExit);
  }

  // Fast path steps 0-8 (no GC, no VM calls from here on).
  StackVal* origArgs = sp;
  frame->interpreterPC() = pc;
  frame->interpreterICEntry() = icEntry;
  StackVal* exitFP = ctx.stack.pushExitFrame(sp, frame);
  if (!exitFP) MOZ_CRASH("PBLBC: exit frame after stack check");
  sp = exitFP;
  PUSHNATIVE(StackValNative(nullptr));
  for (uint32_t i = 0; i < totalArgs; i++) {
    *--sp = origArgs[i];
  }
  PUSHNATIVE(StackValNative(CalleeToToken(func, false)));
  PUSHNATIVE(StackValNative(
      MakeFrameDescriptorForJitCall(FrameType::BaselineStub, argc)));
  PUSHNATIVE(StackValNative(nullptr));
  BaselineFrame* newFrame = ctx.stack.pushFrame(sp, cx, func->environment());
  if (!newFrame) MOZ_CRASH("PBLBC: callee frame after stack check");
  ctx.frameMgr.switchToFrame(newFrame);
  ctx.frame = newFrame;
  sp = reinterpret_cast<StackVal*>(newFrame);
  const uint32_t nfixed = calleeScript->nfixed();
  for (uint32_t i = 0; i < nfixed; i++) {
    *--sp = StackVal(UndefinedValue());
  }
  gDirectPushes++;
  jsbytecode* calleePC = calleeScript->code();
  ICEntry* calleeIcEntries = newFrame->icScript()->icEntries();
  ICEntry* calleeIcEntry = newFrame->interpreterICEntry();
  // Run the callee's compiled code from op 0 like Hook does, unless the
  // native nesting bound is reached or the IC cursor does not match (then
  // the interpreter starts the callee at pc 0; Hook enters it from there).
  JSOp op0 = JSOp(*calleePC);
  uint32_t kind = kExit, exitOff = 0;
  if (retRval0) {
    // Op 0 is RetRval: nothing to run; return exactly as the interpreter's
    // RetRval would (sp is the callee's initial sp, as at its op 0).
    gDs[kDsInlineRetRval0]++;
  } else {
  const bool depthHit = tDirectDepth >= kMaxDirectDepth;
  if (depthHit ||
      (op0 != JSOp::JumpTarget && op0 != JSOp::LoopHead &&
       newFrame->icScript()->numICEntries() != 0 &&
       calleeIcEntry != calleeIcEntries + e->icIdx[j0])) {
    gDs[depthHit ? kDsSwDepth : kDsSwIcCursor]++;
    tSwitch.frame = newFrame;
    tSwitch.sp = sp;
    tSwitch.pc = calleePC;
    tSwitch.icEntry = calleeIcEntry;
    tSwitch.icError = false;
    return 1;
  }
  struct {
    uint32_t sp;
  } io;
  typedef uint64_t (*Fn)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
                         uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
                         uint64_t, uint64_t);
  Fn fn = reinterpret_cast<Fn>(uintptr_t(e->fn));
  const bool aliased = calleeScript->argsObjAliasesFormals();
  gRuns++;
  tDirectDepth++;
  // func and calleeScript are not used after this call (it can GC).
  uint64_t r = fn(uintptr_t(newFrame), uintptr_t(sp), j0,
                  uintptr_t(calleeIcEntries), uintptr_t(&ctx), uintptr_t(&io),
                  uintptr_t(newFrame->argv()),
                  aliased ? kFlagArgsAliased : 0,
                  uintptr_t(&cx->global()->lexicalEnvironment()),
                  uintptr_t(cx->addressOfInterruptBits()), uintptr_t(calleePC),
                  uintptr_t(cx));
  tDirectDepth--;
  kind = uint32_t(r >> 32);
  if (kind == kFrameSwitch) {
    gDs[kDsSwNested]++;
    return 1;  // tSwitch was set by a nested call
  }
  exitOff = uint32_t(r);
  sp = reinterpret_cast<StackVal*>(uintptr_t(io.sp));
  }
  jsbytecode* xpc = calleePC + exitOff;
  JSOp xop = JSOp(*xpc);
  if (kind == kIcError || newFrame->isDebuggee() ||
      newFrame->script()->hasScriptCounts() ||
      (xop != JSOp::Return && xop != JSOp::RetRval)) {
    gDs[kind == kIcError ? kDsSwIcError
        : (xop == JSOp::Return || xop == JSOp::RetRval) ? kDsSwDebug
                                                        : kDsSwExitOp]++;
    uint32_t k = e->opAt[exitOff];
    tSwitch.frame = newFrame;
    tSwitch.sp = sp;
    tSwitch.pc = xpc;
    tSwitch.icEntry =
        calleeIcEntries + ((xop == JSOp::JumpTarget || xop == JSOp::LoopHead)
                               ? uint32_t(GET_INT32(xpc))
                               : e->icIdx[k]);
    tSwitch.icError = kind == kIcError;
    return 1;
  }
  // The interpreter's Return / RetRval (not a debuggee, not from unwind,
  // never the entry frame) followed by its return fast path.
  if (xop == JSOp::Return) {
    newFrame->setReturnValue((*sp++).asValue());
  }
  const uint32_t nargs = newFrame->numActualArgs();
  sp = ctx.stack.popFrame();
  Value ret = newFrame->returnValue();
  sp = ctx.stack.popFrame();
  POPNNATIVE(2);
  BaselineFrame* callerFrame = reinterpret_cast<BaselineFrame*>(
      reinterpret_cast<uintptr_t>(ctx.stack.fp) - BaselineFrame::Size());
  if (callerFrame != frame) MOZ_CRASH("PBLBC: direct return frame mismatch");
  ctx.frameMgr.switchToFrame(callerFrame);
  ctx.frame = callerFrame;
  sp += nargs + 2;
  *--sp = StackVal(ret);
  gDirectReturns++;
  gDs[kDsInline]++;
  return int64_t(uintptr_t(sp));
}

// Called at a DISPATCH with the hook pending (not a debuggee frame).
int Hook(BaselineFrame* frame, StackVal* sp, jsbytecode* pc,
         jsbytecode* entryPC, ImmutableScriptData* isd, ICEntry* icEntries,
         ICEntry* icEntry, bool argsObjAliasesFormals, ICCtx& ctx,
         Out* out) {
  Entry* e = Find(isd);
  if (!e || e->state == 2) return kNone;
  if (e->state == 0) {
    if (++e->hits < gHits) return kNone;
    JSScript* script = frame->script();
    if (script->hasScriptCounts() || script->immutableScriptData() != isd) {
      return kNone;
    }
    Compile(e, script, ctx.frameMgr.cxForLocalUseOnly());
    if (e->state != 1) return kNone;
  }
  uint32_t off = uint32_t(pc - entryPC);
  uint32_t j = e->opAt[off];
  if (j == 0xffff) return kNone;
  if (e->exitOp[j]) return kPending;
  JSOp jop = JSOp(*pc);
  if (jop != JSOp::JumpTarget && jop != JSOp::LoopHead &&
      frame->icScript()->numICEntries() != 0 &&
      icEntry != icEntries + e->icIdx[j]) {
    if (gMismatch++ < 20 && gLogEnabled.load(std::memory_order_relaxed)) {
      fprintf(stderr, "PBLBC ic mismatch at %s off=%u dyn=%d static=%u\n",
              CodeName(jop), off, int(icEntry - icEntries), e->icIdx[j]);
    }
    return kPending;
  }
  if (frame->script()->hasScriptCounts()) return kNone;
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  struct {
    uint32_t sp;
  } io;
  typedef uint64_t (*Fn)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
                         uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
                         uint64_t, uint64_t);
  const uint32_t calledFn = e->fn;
  Fn fn = reinterpret_cast<Fn>(uintptr_t(calledFn));
  gRuns++;
  const bool observing = pbltier::Enabled();
  uint64_t observation = observing
      ? pbltier::Begin(frame->script(), cx, calledFn, off) : 0;
  uint64_t r = fn(uintptr_t(frame), uintptr_t(sp), j, uintptr_t(icEntries),
                  uintptr_t(&ctx), uintptr_t(&io), uintptr_t(frame->argv()),
                  argsObjAliasesFormals ? kFlagArgsAliased : 0,
                  uintptr_t(&cx->global()->lexicalEnvironment()),
                  uintptr_t(cx->addressOfInterruptBits()), uintptr_t(entryPC),
                  uintptr_t(cx));
  uint32_t exitOff = uint32_t(r);
  if (observing) {
    pbltier::End(frame->script(), cx, calledFn, observation, exitOff,
                 uint32_t(r >> 32));
    if ((r >> 32) == kObservedIrqExit)
      pbltier::Guard(pbltier::kIrqExit, frame->script(), cx, calledFn,
                     int32_t(exitOff));
  }
  if (MOZ_UNLIKELY(gExitStat)) {
    gEsEntries++;
    const uint32_t xk = uint32_t(r >> 32) < kEsKinds ? uint32_t(r >> 32) : 0;
    if (xk == kFrameSwitch) gEsSwitches++;
    const jsbytecode* xpc =
        xk == kFrameSwitch ? tSwitch.pc : entryPC + exitOff;
    gEsExit[xk][*xpc]++;
  }
  if ((r >> 32) == kFrameSwitch) {
    out->frame = tSwitch.frame;
    out->sp = tSwitch.sp;
    out->pc = tSwitch.pc;
    out->icEntry = tSwitch.icEntry;
    return tSwitch.icError ? kRanNewFrameIcError : kRanNewFrame;
  }
  out->sp = reinterpret_cast<StackVal*>(uintptr_t(io.sp));
  out->pc = entryPC + exitOff;
  uint32_t k = e->opAt[exitOff];
  JSOp xop = JSOp(*out->pc);
  out->icEntry = icEntries + ((xop == JSOp::JumpTarget || xop == JSOp::LoopHead)
                                  ? uint32_t(GET_INT32(out->pc))
                                  : e->icIdx[k]);
  if ((r >> 32) == kIcError) {
    gIcExits++;
    return kRanIcError;
  }
  return kRan;
}

// Called by compiled code at a LoopHead (see MT::translateOp). Returns 0, or
// ((op index + 1) << 32) | sp after a PBLJIT loop ran to one of its exits.
int64_t LoopHook(int64_t frameA, int64_t spA, int64_t pcOffA, int64_t cxA,
                 int64_t entryA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* e = reinterpret_cast<Entry*>(uintptr_t(entryA));
  auto* cx = reinterpret_cast<JSContext*>(uintptr_t(cxA));
  uint32_t pcOff = uint32_t(pcOffA);
  uint32_t& st = e->loopState[e->opAt[pcOff]];
  JSScript* script = frame->script();
  if (frame->isDebuggee() || script->hasScriptCounts()) return 0;
  if (cx->runtime()->gc.isIncrementalGCInProgress()) {
    if (pbltier::Enabled())
      pbltier::Guard(pbltier::kIncremental, script, cx, e->fn,
                     int32_t(pcOff));
    return 0;
  }
  js::pbljit::Exit jx;
  if (!js::pbljit::OnLoopHead(script, frame,
                              reinterpret_cast<uint64_t*>(uintptr_t(spA)),
                              script->code() + pcOff, cx, &jx)) {
    if (++st >= kLoopSkipMisses) st |= kLoopSkip;
    return 0;
  }
  st = 0;
  gLoopRuns++;
  uint32_t off = uint32_t(int64_t(pcOff) + jx.pcDelta);
  uint32_t k = off < script->length() ? e->opAt[off] : 0xffff;
  if (k == 0xffff) MOZ_CRASH("PBLBC: loop exit is not an op");
  // JumpTarget/LoopHead reset the IC cursor themselves; at other ops the
  // loop's cursor must equal the static index the compiled code uses.
  JSOp xop = JSOp(script->code()[off]);
  if (xop != JSOp::JumpTarget && xop != JSOp::LoopHead &&
      e->icIdx[k] != jx.icIndex) {
    MOZ_CRASH("PBLBC: loop exit IC index mismatch");
  }
  return int64_t((uint64_t(k) + 1) << 32 | uint32_t(uintptr_t(jx.sp)));
}

}  // namespace pblbc
