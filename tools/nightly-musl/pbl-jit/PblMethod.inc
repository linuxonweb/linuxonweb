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
// suite on 2026-11-15. PBLBC_COVC=<mask> (atoi; unset = 7, 0 = all off)
// replaces exits by VM-helper calls that do exactly what the interpreter's
// case does: 1 non-number Add -> AddHelper (CASE(Add) HybridICs slow path:
// exit frame at sp, AddOperation on the operands in place, an error takes
// the interpreter's error path via kIcError), 2 InitElemArray ->
// InitElemArrayHelper, 4 SetAliasedVar -> SetAliasedVarHelper (pre/post
// barriers via setAliasedBinding). PBLBC_DIRECT (default on; =0 off) makes
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

// Defined after this file in PortableBaselineInterpret.cpp (CASE(GetAliasedVar)/
// CASE(SetAliasedVar)); used by SetAliasedVarHelper.
static EnvironmentObject& getEnvironmentFromCoordinate(
    BaselineFrame* frame, EnvironmentCoordinate ec);

namespace pblbc {
using namespace pblic;

static_assert(sizeof(ICEntry) == sizeof(void*));

enum : uint8_t {
  OP_UNREACH = 0x00,
  OP_LOOP = 0x03,
  OP_CALL = 0x10,
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
                   P_IO = 5, P_ARGV = 6, P_FLAGS = 7, P_GLEX = 8 /* 0 */, P_IRQ = 9,
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
                     int64_t ctx, int64_t site);
int64_t CallScriptedHit(int64_t frame, int64_t sp, int64_t pc,
                        int64_t icEntry, int64_t ctx, int64_t site);
// PBLBC_FUNCALL (default on; value starting with 0: off). At a non-
// constructing Call/CallIgnoresRv/CallContent whose callee is a native
// JSFunction whose native is js::fun_call (inline pointer check in the
// generated code, re-checked in CallFunCall), of the current realm, with a
// scripted non-class-constructor JSFunction as |this|: the operand stack is
// rewritten in place to an ordinary call (callee = |this|, this = first arg
// or undefined, remaining args, argc - 1; the values move up one slot so the
// return sequence, which pops numActualArgs + 2, still pops the original
// argc + 2 values) and CallScripted's checks/direct path run with that argc
// and no call site (the site cache is untouched). Any refusal restores the
// original operands (no GC can happen between the rewrite and a
// non-constructing refusal) and the IC runs as before.
int64_t CallFunCall(int64_t frame, int64_t sp, int64_t pc, int64_t icEntry,
                    int64_t ctx, int64_t site);
bool gFunCall = true;
uint32_t gFcDirect, gFcRefused, gFcOverRec;  // racy stats
// PBLBC_FUNAPPLY (default on; value starting with 0: off). The same for a
// callee whose native is js::fun_apply with argc <= 2: the second argument
// must be null/undefined/absent (no args), an ArgumentsObject passing
// CacheIR's FunApplyArgsObj guards (no overridden/deleted element, no
// forwarded arg, no overridden length) or a packed ArrayObject (CacheIR's
// FunApplyArray), with at most JIT_ARGS_LENGTH_MAX elements. The argc + 2
// operands are replaced by [target, thisArg, elements...] ending at the same
// top (sp + argc + 2), growing the operand area downwards when there are more
// than argc elements (checked against the stack limit first), so the return
// sequence (numActualArgs + 2) pops exactly the original operands. Nothing
// can GC between reading the elements and CallScriptedA's last refusal; any
// refusal restores the original operands and the IC runs as before.
int64_t CallFunApply(int64_t frame, int64_t sp, int64_t pc, int64_t icEntry,
                     int64_t ctx, int64_t site);
bool gFunApply = true;
uint32_t gFaDirect, gFaRefused, gFaOverRec;  // racy stats
// PBLBC_GETTER (default on; value starting with 0: off). Compiled GetProp
// sets ctx.getterReq around its IC call; a CallScriptedGetterResult stub
// that passed all its guards and checks (ICInterpretOps, or the PblIc step
// of a stub's last op, whose result the compiled stub returns as is) then
// returns PBL_GETTER_SENTINEL() with getter/receiver/stub in ctx instead of
// running the getter nested. CallGetter pushes [getter, receiver] (argc 0)
// and takes CallScriptedA's checks and direct path (the interpreter's
// return fix-up after a frame switch pops numActualArgs + 2 = 2 and advances
// JSOpLength_GetProp at a GetProp; one IC entry like Call). A refusal
// pops them and runs ScriptedGetterNested (the stub's own nested run);
// stack space refusal: DirectOverRecursed.
int64_t CallGetter(int64_t frame, int64_t sp, int64_t pc, int64_t icEntry,
                   int64_t ctx, int64_t site);
// The compiled GetProp's out-of-line sentinel path: CallGetter with the
// pc/ICEntry its invokeIC stored in the frame; returns the getter's value
// bits (popped again: the op pushes L_R), IC_ERROR_SENTINEL (ctx.error is
// set) or PBL_GETTER_SENTINEL() for a frame switch.
int64_t GetterCallOOL(int64_t frame, int64_t sp, int64_t ctx);
// ctx.getterReq after a getter frame switch in a compiled GetProp: its
// kIcError exit is a kFrameSwitch (see emitGetterHelper).
constexpr uint32_t kGetterSwitch = 2;
static MOZ_ALWAYS_INLINE uint64_t FixGetterSwitch(uint64_t r, ICCtx& ctx) {
  if (MOZ_UNLIKELY(ctx.getterReq == kGetterSwitch)) {
    MOZ_ASSERT((r >> 32) == kIcError);
    ctx.getterReq = 0;
    r = (uint64_t(kFrameSwitch) << 32) | uint32_t(r);
  }
  return r;
}
bool gGetter = true;
uint32_t gGtDirect, gGtRefused, gGtOverRec;  // racy stats
// Over-recursion in CallFunCall/CallFunApply: when the rewritten call was
// refused only for portable-baseline stack space (CallScriptedA's two stack
// checks, or CallFunApply's operand growth; all Stack::checkJS, which leaves
// PblStackReserve() free), the IC must not run: native fun_call/fun_apply ->
// js::Call -> EnterJit would nest a run inside the reserve kept for genuine
// native->JS entries (or, past it, fail PortablebaselineInterpreterStackCheck
// and fall back to a nested C++ js::Interpret whose browser wasm stack use
// neither tPblNest nor tDirectDepth sees). Instead the original operands are
// restored and over-recursion is reported like the interpreter's callee
// stack check (CASE(Call) step 7: exit frame, ReportOverRecursed,
// GOTO_ERROR), at the Call op in the caller frame (kFrameSwitch with
// icError, like CallScriptedA's CreateThis failure).
struct Entry;
// PBLBC_SITECACHE (default on; 0: generated code and CallScripted exactly as
// without it). One CallSite per compiled direct-call op (Call/CallIgnoresRv/
// CallContent/CallIter/CallContentIter/New/NewContent), owned by the caller
// script's Entry (allocated with the compiled code, never moved or freed while
// the Entry exists; Entries are never removed). Zero-initialised = empty.
// The generated code compares the callee Value's 64 bits with calleeBits:
// equal -> CallScriptedHit (re-validates only what can change while the
// callee function object stays the same), else the inline callee pre-checks
// and CallScripted (full checks; fills the site when every precondition
// passed). Raw untraced pointers: nothing but calleeBits/epoch/gen is trusted
// unless epoch == GcEpoch (no minor/major GC since the fill: the function
// object did not move or die, no script/JitScript/Entry data was swept) and
// gen == tEntryGen (no Entry created or changed state).
struct CallSite {
  uint64_t calleeBits;  // raw boxed callee Value; 0 = empty
  uint64_t epoch;       // GcEpoch at fill (never 0 for a filled site)
  uint32_t gen;         // tEntryGen at fill
  uint32_t j0;          // callee Entry opAt[0]
  JSFunction* func;
  JSScript* script;
  JS::Realm* realm;     // callee realm (cx->realm() must equal it)
  const ImmutableScriptData* isd;
  Entry* e;
  jsbytecode* code;
  uint32_t fn;          // e->fn
  uint32_t icIdx0;      // e->icIdx[j0]
  uint32_t nfixed;
  uint32_t argc;
  uint32_t undefArgs;
  uint32_t totalArgs;
  uint32_t stackBytes;  // callee stack check (dominates the caller check)
  bool constructing;
  bool needEnv;
  bool retRval0;
  bool aliased;         // argsObjAliasesFormals
  bool thisCacheOk;     // gThisCache && !constructorNeedsUninitializedThis
  bool superCall;       // SuperCall site (newTarget may differ from callee)
  bool uninitThis;      // callee constructorNeedsUninitializedThis
  uint32_t refills;     // fills replacing a different live callee
};
bool gSiteCache = true;
// A site whose callee keeps changing (e.g. a fresh closure per iteration) is
// no longer refilled after this many replacements (the fill costs more than
// it saves); it keeps its last callee.
constexpr uint32_t kSiteMaxRefills = 16;
uint32_t gSiteFills, gSiteStale, gSiteRecheck;  // racy stats
// PBLBC_COVC helpers (frame, sp, pc, ctx): see the header comment.
enum : unsigned { kCovcAdd = 1, kCovcInitElemArray = 2, kCovcSetAliased = 4 };
constexpr unsigned kCovcDefault = kCovcAdd | kCovcInitElemArray |
                                  kCovcSetAliased;
unsigned gCovc = kCovcDefault;
// PBLBC_COVD bitmask: 1 CallContent/CallIter/CallContentIter like Call (also
// direct scripted calls), 4 NewObject/NewArray (NewObjectHelper /
// NewArrayHelper: the HybridICs path), 8 MoreIter/IsNoIter/EndIter
// (IterHelper), 2 direct scripted calls to callees that need function
// environment objects (CallScripted runs InitFunctionEnvironmentObjects),
// 16 New/NewContent through the Call IC (native constructors; scripted callees
// exit unless 64), 32 FunctionThis slow path and Callee in helpers, 64 (with
// 16) direct scripted constructing calls for New/NewContent through
// CallScripted (CreateThis; newTarget must be the callee itself).
// 0 = all of them exit. Default 127.
enum : unsigned {
  kCovdCall = 1,
  kCovdEnv = 2,
  kCovdNewObj = 4,
  kCovdIter = 8,
  kCovdNew = 16,   // New/NewContent through the Call IC (scripted: exit)
  kCovdThis = 32,  // FunctionThis slow path and Callee in helpers
  kCovdNewScripted = 64,  // with kCovdNew: scripted New/NewContent direct
};
constexpr unsigned kCovdDefault =
    kCovdCall | kCovdEnv | kCovdNewObj | kCovdIter | kCovdNew | kCovdThis |
    kCovdNewScripted;
unsigned gCovd = kCovdDefault;
int64_t NewObjectHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t NewArrayHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t IterHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t FunctionThisHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t CalleeHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
// PBLBC_COVG bitmask: 1 Try/TryDestructuring (no-op, as in the interpreter:
// handlers are found through try notes when an error unwinds in PBL), 2
// DebugLeaveLexicalEnv (no-op unless the frame is a debuggee, which exits),
// 4 CheckIsObj (object: continue; else exit, the interpreter throws), 8
// Lambda (LambdaHelper: CASE(Lambda) HybridICs path), 16 PushLexicalEnv /
// PopLexicalEnv / FreshenLexicalEnv / RecreateLexicalEnv / InitAliasedLexical
// (LexEnvHelper; a debuggee frame exits). 0 = all of them exit. Default 31.
enum : unsigned {
  kCovgTry = 1,
  kCovgDebugLeave = 2,
  kCovgCheckIsObj = 4,
  kCovgLambda = 8,
  kCovgLexEnv = 16,
};
constexpr unsigned kCovgDefault = kCovgTry | kCovgDebugLeave |
                                  kCovgCheckIsObj | kCovgLambda | kCovgLexEnv;
unsigned gCovg = kCovgDefault;
// PBLBC_ALLOC bitmask (0 = the plain VM paths below, exactly as before):
// 1 NewObject tries a NoGC nursery allocation without an exit frame (NewInit
// is accepted but always takes the slow path),
// 2 NewArray likewise (fixed elements only), 4 InitElemArray without an exit
// frame (InitElemArrayOperation cannot GC, fail or report).
enum : unsigned {
  kAllocObj = 1,
  kAllocArr = 2,
  kAllocInitElem = 4,
};
constexpr unsigned kAllocDefault = kAllocObj | kAllocArr | kAllocInitElem;
unsigned gAlloc = kAllocDefault;
int64_t LambdaHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t LexEnvHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
// PBLBC_INL (default on; 0 = off): inline the site's first CacheIR stub body
// (pblic::EmitInline) at IC call sites, guarded at run time by
// firstStub->code == K (the stub's PBLIC function index, which identifies its
// CacheIR content). A guard failure inside the body continues with
// firstStub->next exactly like the standalone function; any other first stub
// takes the normal call. PBLBC_INLOPS=n caps CacheIR ops per site (default
// 32); at most kInlBudget inline bytes per method function. PBLBC_INLSTAT=1
// adds run-time hit counters (code only emitted then).
bool gInl = true;
bool gInlStat = false;
uint32_t gInlOps = 32;
constexpr uint32_t kInlBudget = 48 * 1024;
enum : uint32_t { kInlSites, kInlInlined, kInlFallback, kInlRejected,
                  kInlOverBudget, kInlCount };
uint32_t gInlSite[kInlCount];
enum : uint32_t { kInlHitEnter, kInlHitSlow, kInlHitFail, kInlHitCount };
uint32_t gInlHits[kInlHitCount];  // bumped by generated code (PBLBC_INLSTAT=1)
void PrintInlineStats() {
  fprintf(stderr,
          "PBLBC inline: sites=%u inlined=%u fallbackstub=%u rejected=%u "
          "overbudget=%u\n",
          gInlSite[kInlSites], gInlSite[kInlInlined], gInlSite[kInlFallback],
          gInlSite[kInlRejected], gInlSite[kInlOverBudget]);
  if (gInlStat) {
    fprintf(stderr, "PBLBC inline: hits_inline=%u hits_slow=%u hits_fail=%u\n",
            gInlHits[kInlHitEnter] - gInlHits[kInlHitFail],
            gInlHits[kInlHitSlow], gInlHits[kInlHitFail]);
  }
}
// Helper results.
enum : int64_t { kHelperOk = 0, kHelperNotHandled = 1, kHelperError = 2 };
int64_t AddHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t InitElemArrayHelper(int64_t frame, int64_t sp, int64_t pc,
                            int64_t ctx);
int64_t SetAliasedVarHelper(int64_t frame, int64_t sp, int64_t pc,
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
  kDsSwIcError, kDsSwDebug, kDsSwExitOp, kDsSwEntryExit, kDsCtorError,
  kDsCtorChanged,
  kDsCount
};
uint32_t gDs[kDsCount];
// Callees whose op 0 is an exit op, by that op (index 256: no op entry);
// counted where CallScripted looks the callee up (call-cache and site-cache
// hits are not counted), printed with the "PBLBC direct:" line.
uint32_t gEntryExitOp[257];
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
          "switch_icerror=%u switch_debug=%u switch_exitop=%u "
          "switch_entryexit=%u refused=%u "
          "(notcall=%u callerdbg=%u notfunc=%u notinterp=%u classctor=%u "
          "nobytecode=%u nojitscript=%u realm=%u underflow=%u stack=%u "
          "envobj=%u calleedbg=%u counts=%u interrupt=%u calleestack=%u "
          "notcompiled=%u entryexit=%u) ctor_error=%u ctor_changed=%u\n",
          gDirectPushes, s[kDsInline], s[kDsInlineRetRval0], s[kDsSwDepth],
          s[kDsSwIcCursor], s[kDsSwNested], s[kDsSwIcError], s[kDsSwDebug],
          s[kDsSwExitOp], s[kDsSwEntryExit], ref, s[kDsNotCall],
          s[kDsCallerDebuggee],
          s[kDsNotFunction], s[kDsNotInterpreted], s[kDsClassCtor],
          s[kDsNoBytecode], s[kDsNoJitScript], s[kDsRealm], s[kDsUnderflow],
          s[kDsStack], s[kDsEnvObjects], s[kDsCalleeDebuggee], s[kDsCounts],
          s[kDsInterrupt], s[kDsCalleeStack], s[kDsNotCompiled],
          s[kDsEntryExit], s[kDsCtorError], s[kDsCtorChanged]);
  for (int i = 0; i < 257; i++)
    if (gEntryExitOp[i])
      fprintf(stderr, "PBLBC entryexitop: %s %u\n",
              i == 256 ? "j0none" : CodeName(JSOp(i)), gEntryExitOp[i]);
  if (gSiteCache)
    fprintf(stderr, "PBLBC sitecache: fills=%u stale=%u recheck_fail=%u\n",
            gSiteFills, gSiteStale, gSiteRecheck);
  if (gFunCall || gFunApply || gGetter)
    fprintf(stderr,
            "PBLBC funcall: direct=%u refused=%u apply_direct=%u "
            "apply_refused=%u overrecursed=%u apply_overrecursed=%u "
            "getter_direct=%u getter_refused=%u getter_overrecursed=%u\n",
            gFcDirect, gFcRefused, gFaDirect, gFaRefused, gFcOverRec,
            gFaOverRec, gGtDirect, gGtRefused, gGtOverRec);
}

// PBLBC_EXITSTAT=1: runtime exit histogram (Hook only, not generated wasm).
// Counts every return of compiled code to the interpreter by [exit kind]
// [JSOp at the exit pc] (for kFrameSwitch: the op where the innermost callee
// stopped), plus Hook entries, compiles and rejects by reason. Plain counters
// like gDs; printed at exit as "PBLBC exitstat:" lines on stderr.
bool gExitStat = false;
// PBLBC_CALLCACHE=0 disables the CallScripted callee cache (default on).
bool gCallCache = true;
// PBLBC_THISCACHE=0 disables the CallScripted constructing |this| shape cache
// (default on).
bool gThisCache = true;
// PBLBC_SUPERCALL=0: SuperCall stays an exit op (the interpreter's CASE(Call)
// constructing fast path). Default: compiled like a scripted New (direct
// call, CallScripted/CallScriptedHit), with newTarget = the frame's
// new.target (see SuperNewTargetOk); anything refused exits as before.
bool gSuperCall = true;
// PBLBC_PADARGS (default on; a value starting with '0' disables it) lets
// CallScripted push a non-constructing callee with argc < nargs, padding the
// missing formals with undefined like the interpreter's scripted-call IC
// (descriptor keeps the actual argc).
bool gPadArgs = true;
// PBLBC_VSTACK (default on): virtual operand stack in the method tier; 0
// emits exactly the code without it.
bool gVstack = true;
// PBLBC_ENTRYSWITCH (default on; a value starting with '0' disables it): a
// compiled callee whose op 0 is an exit op is pushed directly by
// CallScripted and the interpreter continues in the callee frame at pc 0
// (the same frame switch as the depth/IC-cursor switch in CallTail), instead
// of refusing (entryexit) and taking the IC fallback / RunScript route.
bool gEntrySwitch = true;
// PBLBC_ARGSOP (default on; a value starting with '0' makes it an exit op):
// compile JSOp::Arguments through ArgumentsHelper, exactly CASE(Arguments):
// exit frame at sp with interpreterPC = pc, jit::NewArgumentsObject (which
// creates the mapped/unmapped object and stores it in the frame via
// initArgsObj), result pushed.
bool gArgsOp = true;
int64_t ArgumentsHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
// PBLBC_CHECKOPS (default on; a value starting with '0' restores the old
// exits): CheckObjCoercible, CheckThis, CheckThisReinit and CheckReturn take
// their no-throw paths in generated code (anything else exits at the op, so
// the interpreter throws); Typeof/TypeofExpr and TypeofEq of objects run
// js::TypeOfOperation / js::TypeOfValue in a non-GC helper; Mod of two
// numbers outside the int32 lhs>0 && rhs>0 path runs CASE(Mod)'s
// DoubleValue(NumberMod(lhs, rhs)) in a non-GC helper.
bool gCheckOps = true;
int64_t TypeofExprHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t TypeofEqHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t ModNumberHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
// PBLBC_ITEROPS (default on; a value starting with '0' restores the old
// exits): OptimizeGetIterator and Iter call their ICs (OptimizeGetIterator /
// GetIterator) from generated code with the interpreter's argument order;
// NewTarget, SuperBase and SuperFun run CASE(...)'s non-GC operations
// (frame->newTarget(), HomeObjectSuperBase, SuperFunOperation) in helpers.
bool gIterOps = true;
int64_t NewTargetHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t SuperBaseHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
int64_t SuperFunHelper(int64_t frame, int64_t sp, int64_t pc, int64_t ctx);
// PBLBC_TRAMPENTRY (default on; a value starting with '0' restores the old
// path): a PortableBaselineInterpret run that starts at op 0 of a script
// whose Entry is already compiled (state 1, op 0 enterable) calls Hook at op
// 0 after the run's own prologue (frame push, recursion and stack checks,
// nfixed init, environment objects, debug prologue, coverage, interrupt
// check), instead of interpreting op 0 and calling Hook at op 1. Exits,
// frame switches and errors take the normal bc_hook continuation; a
// Return/RetRval exit returns through the interpreter's own return sequence.
bool gTrampEntry = true;
uint64_t gTeDirect, gTeFallback;
// PBLBC_NATENTRY (default on; '0' restores the old path): a
// PortableBaselineTrampoline call of a script that PBLBC_TRAMPENTRY would
// enter at op 0 runs the interpreter prologue in the small PblNatEnter
// instead of a full PortableBaselineInterpret run and calls Hook directly. A
// Return/RetRval exit of the entry frame completes there; every other
// outcome continues in a restart-mode interpreter run (see PblNatEnter).
bool gNatEntry = true;
uint64_t gNeDirect, gNeFallback;
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
          "direct_pushes=%u tramp_direct=%llu tramp_fallback=%llu "
          "nat_direct=%llu nat_fallback=%llu\n",
          (unsigned long long)gEsEntries, (unsigned long long)total,
          (unsigned long long)perKind[0], (unsigned long long)perKind[1],
          (unsigned long long)perKind[2], (unsigned long long)perKind[3],
          (unsigned long long)gEsCompiled, (unsigned long long)gEsRejected,
          (unsigned long long)gEsSwitches, gDirectPushes,
          (unsigned long long)gTeDirect, (unsigned long long)gTeFallback,
          (unsigned long long)gNeDirect, (unsigned long long)gNeFallback);
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

// One-time env init. Main thread and DOM workers can reach Enabled()
// concurrently: exactly one thread (CAS on gInitState) writes the plain
// configuration globals, then publishes gEnabled with release; every reader
// loads gEnabled with acquire, so it sees the complete configuration. Losers
// wait for the winner (init is a few getenv calls).
std::atomic<int> gInitState{0};  // 0 not started, 1 running, 2 done
MOZ_NEVER_INLINE bool EnabledSlow();
// Hot (every interpreter run): one acquire load once initialized.
MOZ_ALWAYS_INLINE bool Enabled() {
  int e = gEnabled.load(std::memory_order_acquire);
  if (MOZ_LIKELY(e >= 0)) return e != 0;
  return EnabledSlow();
}
MOZ_NEVER_INLINE bool EnabledSlow() {
  int e = gEnabled.load(std::memory_order_acquire);
  if (MOZ_UNLIKELY(e < 0)) {
    int expected = 0;
    if (!gInitState.compare_exchange_strong(expected, 1,
                                            std::memory_order_acq_rel)) {
      while ((e = gEnabled.load(std::memory_order_acquire)) < 0) {
        sched_yield();
      }
      return e != 0;
    }
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
    const char* cc = getenv("PBLBC_COVC");
    gCovc = cc ? unsigned(atoi(cc)) : kCovcDefault;
    const char* cd = getenv("PBLBC_COVD");
    gCovd = cd ? unsigned(atoi(cd)) : kCovdDefault;
    const char* cg = getenv("PBLBC_COVG");
    gCovg = cg ? unsigned(atoi(cg)) : kCovgDefault;
    const char* al = getenv("PBLBC_ALLOC");
    gAlloc = al ? unsigned(atoi(al)) : kAllocDefault;
    const char* dc = getenv("PBLBC_DIRECT");
    // Default on; PBLBC_DIRECT=0 (any explicit value other than 1) turns it off.
    gDirect = !dc || dc[0] == '1';
    const char* in = getenv("PBLBC_INL");
    gInl = !(in && in[0] == '0');
    const char* io = getenv("PBLBC_INLOPS");
    if (io && atoi(io) >= 0) gInlOps = uint32_t(atoi(io));
    const char* is = getenv("PBLBC_INLSTAT");
    gInlStat = gInl && is && is[0] == '1';
    const char* l = getenv("PBLBC_LOG");
    const int logBudget = l ? atoi(l) : 40;
    gLogBudget.store(logBudget, std::memory_order_relaxed);
    gLogEnabled.store(logBudget > 0, std::memory_order_relaxed);
    if (logBudget > 0) {
      fprintf(stderr, "PBLBC %s (threshold=%u ic=%d loopexit=%d loopjit=%d)\n",
              e ? "enabled" : "disabled", gHits, int(gIcInline), int(gLoopExit),
              int(gLoopJit));
      if (gDirect) fprintf(stderr, "PBLBC direct scripted calls enabled\n");
    }
    if (gDirect && (logBudget > 0 || (h && h[0]))) atexit(PrintDirectStats);
    if (gInl && (logBudget > 0 || gInlStat)) atexit(PrintInlineStats);
    const char* ccv = getenv("PBLBC_CALLCACHE");
    if (ccv && ccv[0] == '0') gCallCache = false;
    const char* scv = getenv("PBLBC_SITECACHE");
    if (scv && scv[0] == '0') gSiteCache = false;
    const char* fcv = getenv("PBLBC_FUNCALL");
    if (fcv && fcv[0] == '0') gFunCall = false;
    const char* fav = getenv("PBLBC_FUNAPPLY");
    if (fav && fav[0] == '0') gFunApply = false;
    const char* gtv = getenv("PBLBC_GETTER");
    if (gtv && gtv[0] == '0') gGetter = false;
    const char* tcv = getenv("PBLBC_THISCACHE");
    if (tcv && tcv[0] == '0') gThisCache = false;
    const char* supv = getenv("PBLBC_SUPERCALL");
    if (supv && supv[0] == '0') gSuperCall = false;
    const char* pav = getenv("PBLBC_PADARGS");
    if (pav && pav[0] == '0') gPadArgs = false;
    const char* vsv = getenv("PBLBC_VSTACK");
    if (vsv && vsv[0] == '0') gVstack = false;
    const char* esv = getenv("PBLBC_ENTRYSWITCH");
    if (esv && esv[0] == '0') gEntrySwitch = false;
    const char* aov = getenv("PBLBC_ARGSOP");
    if (aov && aov[0] == '0') gArgsOp = false;
    const char* cov = getenv("PBLBC_CHECKOPS");
    if (cov && cov[0] == '0') gCheckOps = false;
    const char* iov = getenv("PBLBC_ITEROPS");
    if (iov && iov[0] == '0') gIterOps = false;
    const char* tev = getenv("PBLBC_TRAMPENTRY");
    if (tev && tev[0] == '0') gTrampEntry = false;
    const char* nev = getenv("PBLBC_NATENTRY");
    if (nev && nev[0] == '0') gNatEntry = false;
    const char* xs = getenv("PBLBC_EXITSTAT");
    if (xs && xs[0] == '1') {
      gExitStat = true;
      atexit(PrintExitStats);
    }
    // Publish last: all configuration globals above are complete.
    gEnabled.store(e, std::memory_order_release);
    gInitState.store(2, std::memory_order_release);
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
  bool noEntry = false;  // PBLBC_VSTACK: virtual entries live at op start
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
  CallSite* sites = nullptr;  // PBLBC_SITECACHE: one per direct-call op
  uint32_t nSites = 0, capSites = 0;
  Buf b;
  uint32_t lvl = 0;  // blocks open inside the current op's code
  uint32_t cur = 0;  // current op index
  uint32_t nInline = 0, nIc = 0, nExit = 0;
  const char* reason = nullptr;
  // PBLBC_INL: the IC entries this compile sees (Hook's icEntries) and the
  // ICCtx for pblic::EnsureCompiled; null/0 disables inlining.
  ICEntry* icEntries = nullptr;
  uint32_t nIcEntries = 0;
  ICCtx* ictx = nullptr;
  bool inlUsed = false;     // scratch locals declared (some site inlined)
  bool gpUsed = false;      // PBLBC_GETTER helper function 1 emitted
  uint32_t inlBytes = 0;    // inline body bytes in this function
  uint32_t inlSite[kInlCount] = {};
  // Scratch locals after the existing ones: kInlineI64Locals i64,
  // kInlineI32Locals i32, kInlineF64Locals f64, then one never-written i64
  // (zero) standing in for absent IC operands.
  static constexpr uint32_t kInlBase = kNParams + kNI64 + kNI32 + kNF64;
  static constexpr uint32_t kInlZero = kInlBase + kInlineLocals;

  ~MT() {
    free(ops);
    free(opAt);
    free(loopState);
    free(sites);
    free(isTgt);
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
    if (k <= cur && ops[k].noEntry) {
      reject("vstack jump target");
      return;
    }
    if (vsN) {
      reject("vstack live at jump");
      return;
    }
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
    if (isTgt) isTgt[*k] = 1;
    return true;
  }

  // ---- PBLBC_VSTACK: virtual operand stack ----
  // vs[0..vsN) are the topmost operand-stack values (vs[vsN-1] on top) that
  // are not in memory; L_SP does not count them. Each is a constant (boxed
  // bits) or a pool i64 local. flush() stores them and moves L_SP once. The
  // model is empty at every op boundary that can be entered or jumped to,
  // at every jump and before every call/exit (vsExitHere spills first).
  enum : uint8_t { VT_UNK = 0, VT_I32, VT_BOOL, VT_UNDNULL };
  struct VEnt {
    bool isConst;
    uint8_t type;
    uint32_t loc;
    uint64_t bits;
  };
  static constexpr uint32_t kVsPool = 16;
  static constexpr uint32_t kVsMax = 32;
  static constexpr uint32_t kVsBase = kInlZero + 1;
  VEnt vs[kVsMax];
  uint32_t vsN = 0;
  uint32_t vsFree = (1u << kVsPool) - 1;
  bool vsUsed = false;
  uint8_t* isTgt = nullptr;  // per op: some jump targets it

  int vsAlloc() {
    if (!vsFree) return -1;
    int i = __builtin_ctz(vsFree);
    vsFree &= ~(1u << i);
    vsUsed = true;
    return int(kVsBase) + i;
  }
  void vsRelease(const VEnt& e) {
    if (!e.isConst) vsFree |= 1u << (e.loc - kVsBase);
  }
  void vsValue(const VEnt& e) {
    if (e.isConst) {
      i64c(int64_t(e.bits));
    } else {
      lget(e.loc);
    }
  }
  // i32 payload of an entry.
  void vsI32(const VEnt& e) {
    if (e.isConst) {
      i32c(int32_t(uint32_t(e.bits)));
    } else {
      lget(e.loc);
      op(OP_I32WRAP);
    }
  }
  // Emit: store vs[0..m) below L_SP and lower L_SP by m (model unchanged).
  void vsEmitStore(uint32_t m) {
    if (!m) return;
    spAdd(-int32_t(m));
    for (uint32_t i = 0; i < m; i++) {
      lget(L_SP);
      vsValue(vs[i]);
      store64(8 * (m - 1 - i));
    }
  }
  // Flush all but the top `keep` entries.
  void vsFlushBelow(uint32_t keep) {
    if (vsN <= keep) return;
    uint32_t m = vsN - keep;
    vsEmitStore(m);
    for (uint32_t i = 0; i < m; i++) vsRelease(vs[i]);
    memmove(vs, vs + m, keep * sizeof(VEnt));
    vsN = keep;
  }
  void flush() { vsFlushBelow(0); }
  // Exit at op cur from inside a branch of an aware op (the branch returns,
  // so the compile-time model stays as it is for the other path).
  void vsExitHere() {
    vsEmitStore(vsN);
    exitHere();
  }
  void vsPushConst(uint64_t bits, uint8_t type) {
    if (vsN == kVsMax) flush();
    vs[vsN++] = VEnt{true, type, 0, bits};
  }
  // A fresh pool local for a new top entry (flushes when exhausted).
  uint32_t vsFreshLocal() {
    if (vsN == kVsMax) flush();
    int l = vsAlloc();
    if (l < 0) {
      flush();
      l = vsAlloc();
    }
    return uint32_t(l);
  }
  void vsPushLocal(uint32_t l, uint8_t type) {
    vs[vsN++] = VEnt{false, type, l, 0};
  }
  // Make the top m stack values virtual (pulling them from memory).
  void vsMaterialize(uint32_t m) {
    if (vsN >= m) return;
    uint32_t k = m - vsN;
    if (uint32_t(__builtin_popcount(vsFree)) < k || vsN + k > kVsMax) {
      flush();
      k = m;
    }
    memmove(vs + k, vs, vsN * sizeof(VEnt));
    for (uint32_t i = 0; i < k; i++) {
      int l = vsAlloc();
      ld(k - 1 - i);
      lset(uint32_t(l));
      vs[i] = VEnt{false, VT_UNK, uint32_t(l), 0};
    }
    spAdd(int32_t(k));
    vsN += k;
  }
  bool vsAware(JSOp jop) const {
    switch (jop) {
      case JSOp::Undefined: case JSOp::Null: case JSOp::True:
      case JSOp::False: case JSOp::Zero: case JSOp::One: case JSOp::Int8:
      case JSOp::Uint16: case JSOp::Uint24: case JSOp::Int32:
      case JSOp::Double: case JSOp::GetLocal: case JSOp::GetArg:
      case JSOp::SetLocal: case JSOp::InitLexical: case JSOp::Pop:
      case JSOp::Dup: case JSOp::Dup2: case JSOp::Swap: case JSOp::Add:
      case JSOp::Sub: case JSOp::Mul: case JSOp::BitOr: case JSOp::BitAnd:
      case JSOp::BitXor: case JSOp::Lsh: case JSOp::Rsh: case JSOp::Ursh:
      case JSOp::Inc: case JSOp::Dec: case JSOp::Eq: case JSOp::Ne:
      case JSOp::Lt: case JSOp::Le: case JSOp::Gt: case JSOp::Ge:
      case JSOp::StrictEq: case JSOp::StrictNe: case JSOp::Not:
      case JSOp::JumpIfFalse: case JSOp::JumpIfTrue:
        return true;
      default:
        return false;
    }
  }
  int vsOp(const OpInfo& o, const jsbytecode* pc);
  bool vsArith(JSOp jop);
  bool bitArith(JSOp jop);

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

  // i64 = cx->realm()->activeGlobal()->data().lexicalEnvironment (wasm32,
  // JS_NUNBOX32: the GlobalObjectData* PrivateValue payload is the low word).
#if !defined(JS_NUNBOX32)
#  error "loadGlobalLexical assumes the JS_NUNBOX32 PrivateValue layout"
#endif
  void loadGlobalLexical() {
    static_assert(sizeof(void*) == 4, "wasm32 pointers");
    lget(P_CX);
    op(OP_I32WRAP);
    load32(uint32_t(JSContext::offsetOfRealm()));
    load32(uint32_t(JS::Realm::offsetOfActiveGlobal()));
    load32(uint32_t(GlobalObject::offsetOfGlobalDataSlot()));
    load32(uint32_t(GlobalObjectData::offsetOfLexicalEnvironment()));
    op(OP_I64EXTU);
  }
  // INVOKE_IC for op cur with args in i64 locals (or zero when ~0u). The
  // result is left in L_R; an error result returns kIcError at this op.
  void invokeIC(uint32_t a0, uint32_t a1, uint32_t a2, bool hasArg2,
                bool getterReq = false) {
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
    Buf inl;
    uint32_t k = inlineCandidate(o, a0, a1, inl);
    if (k) {
      // block $done { block $slow { L_X->code != K -> $slow;
      //   block $fail { body } L_X = L_X->next } L_R = call L_X->code }
      block();  // $done
      block();  // $slow
      lget(L_X);
      load32(uint32_t(ICStub::offsetOfStubCode()));
      i32c(int32_t(k));
      op(OP_I32NE);
      if (gInlStat) {
        ifThen();
        bumpInlHit(kInlHitSlow);
        br(1);  // $slow
        end();
        bumpInlHit(kInlHitEnter);
      } else {
        brIf(0);  // $slow
      }
      block();  // $fail: body depths fail=0, slow=1, done=2
      b.putn(inl.p, inl.n);
      end();  // $fail
      if (gInlStat) bumpInlHit(kInlHitFail);
      lget(L_X);
      load32(uint32_t(ICCacheIRStub::offsetOfNext()));
      lset(L_X);
      end();  // $slow
    }
    // PBLBC_GETTER: only the out-of-line IC call carries the request (an
    // inlined stub hit never returns the sentinel and pays nothing). The
    // whole out-of-line call is the module's helper function 1 (see
    // emitGetterHelper): L_R = $gp(a0, L_X, frame, sp, ctx).
    if (getterReq) {
      lget(a0);
      lget(L_X);
      lget(P_FRAME);
      lget(L_SP);
      lget(P_CTX);
      b.put(OP_CALL);
      b.uleb(1);
      gpUsed = true;
    } else {
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
    }
    if (k) {
      lset(L_R);
      end();  // $done
      lget(L_R);
    } else {
      ltee(L_R);
    }
    i64c(int64_t(IC_ERROR_SENTINEL()));
    op(OP_I64EQ);
    ifThen();
    exitAt(cur, kIcError);
    end();
    nIc++;
  }
  // PBLBC_GETTER: body of the module's function 1, type
  // (a0 i64, stub i32, frame i64, sp i32, ctx i64) -> i64, called by each
  // compiled GetProp instead of its out-of-line IC call: sets ctx.getterReq,
  // calls stub->code like invokeIC, clears the request; on
  // PBL_GETTER_SENTINEL() returns GetterCallOOL(frame, sp, ctx) (the value
  // bits or IC_ERROR_SENTINEL). A frame switch (GetterCallOOL returned the
  // sentinel again) returns IC_ERROR_SENTINEL with ctx.getterReq =
  // kGetterSwitch: the GetProp's error exit then returns kIcError at its pc
  // and the module's caller turns that into kFrameSwitch (FixGetterSwitch).
  static void emitGetterHelper(Buf& h) {
    auto lg = [&](uint32_t l) { h.put(OP_LGET); h.uleb(l); };
    auto setReq = [&](int32_t v) {
      lg(4);
      h.put(OP_I32WRAP);
      h.put(OP_I32CONST);
      h.sleb(v);
      h.put(OP_I32STORE);
      h.uleb(2);
      h.uleb(kCtxGetterReq);
    };
    auto zeros = [&](uint32_t from) {
      for (uint32_t i = from; i < kNParams; i++) {
        h.put(OP_I64CONST);
        h.sleb(0);
      }
    };
    h.uleb(1);  // locals: r (5)
    h.uleb(1);
    h.put(T_I64);
    setReq(1);
    lg(0);
    h.put(OP_I64CONST);
    h.sleb(0);
    lg(1);
    h.put(OP_I64EXTU);
    lg(4);
    zeros(4);
    lg(1);
    h.put(OP_I32LOAD);
    h.uleb(2);
    h.uleb(uint32_t(ICStub::offsetOfStubCode()));
    h.put(OP_CALLIND);
    h.uleb(0);
    h.uleb(0);
    h.put(OP_LSET);
    h.uleb(5);
    setReq(0);
    h.put(OP_BLOCK);
    h.put(OP_VOID);
    lg(5);
    h.put(OP_I64CONST);
    h.sleb(int64_t(PBL_GETTER_SENTINEL()));
    h.put(OP_I64NE);
    h.put(OP_BRIF);
    h.uleb(0);
    lg(2);
    lg(3);
    h.put(OP_I64EXTU);
    lg(4);
    zeros(3);
    h.put(OP_I32CONST);
    h.sleb(int32_t(uintptr_t(&GetterCallOOL)));
    h.put(OP_CALLIND);
    h.uleb(0);
    h.uleb(0);
    h.put(OP_LTEE);
    h.uleb(5);
    h.put(OP_I64CONST);
    h.sleb(int64_t(PBL_GETTER_SENTINEL()));
    h.put(OP_I64NE);
    h.put(OP_BRIF);
    h.uleb(0);
    setReq(int32_t(kGetterSwitch));
    h.put(OP_I64CONST);
    h.sleb(int64_t(IC_ERROR_SENTINEL()));
    h.put(OP_LSET);
    h.uleb(5);
    h.put(OP_END);
    lg(5);
    h.put(OP_END);
  }
  void bumpInlHit(uint32_t which) {
    i32c(int32_t(uintptr_t(&gInlHits[which])));
    i32c(int32_t(uintptr_t(&gInlHits[which])));
    load32(0);
    i32c(1);
    op(OP_I32ADD);
    store32(0);
  }
  // PBLBC_INL: K (> 0) and the inline body in `out` when op o's site can be
  // inlined now; 0 otherwise (today's code is emitted). The body reads the
  // stub through L_X (the current first stub) at run time.
  uint32_t inlineCandidate(const OpInfo& o, uint32_t a0, uint32_t a1,
                           Buf& out) {
    if (!gInl || !icEntries || !ictx) return 0;
    inlSite[kInlSites]++;
    if (o.icIdx >= nIcEntries) {
      inlSite[kInlRejected]++;
      return 0;
    }
    ICStub* first = icEntries[o.icIdx].firstStub();
    if (!first || first->isFallback()) {
      inlSite[kInlFallback]++;
      return 0;
    }
    if (inlBytes >= kInlBudget) {
      inlSite[kInlOverBudget]++;
      return 0;
    }
    ICCacheIRStub* stub = first->toCacheIRStub();
    InlineEnv env;
    env.arg0Local = a0 != ~0u ? a0 : kInlZero;
    env.arg1Local = a1 != ~0u ? a1 : kInlZero;
    env.stubLocal = L_X;
    env.ctxLocal = L_CTX;
    env.localBase = kInlBase;
    env.resultLocal = L_R;
    env.doneDepth = 2;
    env.failDepth = 0;
    uint32_t nops = 0;
    if (!EmitInline(stub->stubInfo(), out, env, &nops)) {
      out.n = 0;
      out.oom = false;
      inlSite[kInlRejected]++;
      return 0;
    }
    if (nops > gInlOps || inlBytes + out.n > kInlBudget) {
      out.n = 0;
      inlSite[kInlOverBudget]++;
      return 0;
    }
    uint32_t k = EnsureCompiled(stub, *ictx);
    if (!k) {
      out.n = 0;
      inlSite[kInlRejected]++;
      return 0;
    }
    inlBytes += uint32_t(out.n);
    inlUsed = true;
    inlSite[kInlInlined]++;
    return k;
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

  // r = fn(frame, sp, pc of op cur, ctx) -> L_R; kHelperError returns
  // kIcError at op cur (ctx.error is set: the interpreter takes ic_fail ->
  // its error path, like the op's own GOTO_ERROR); kHelperNotHandled exits
  // at op cur (the interpreter runs the op itself).
  void callHelper(int64_t (*fn)(int64_t, int64_t, int64_t, int64_t)) {
    lget(P_FRAME);
    lget(L_SP);
    op(OP_I64EXTU);
    lget(L_EPC);
    i32c(int32_t(ops[cur].pcOff));
    op(OP_I32ADD);
    op(OP_I64EXTU);
    lget(P_CTX);
    for (uint32_t i = 4; i < kNParams; i++) i64c(0);
    i32c(int32_t(uintptr_t(fn)));
    b.put(OP_CALLIND);
    b.uleb(0);
    b.uleb(0);
    ltee(L_R);
    i64c(kHelperOk);
    op(OP_I64NE);
    ifThen();
    lget(L_R);
    i64c(kHelperError);
    op(OP_I64EQ);
    ifThen();
    exitAt(cur, kIcError);
    end();
    exitHere();
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
    case JSOp::InitElemArray:
      return gCovc & kCovcInitElemArray;
    case JSOp::SetAliasedVar:
      return gCovc & kCovcSetAliased;
    case JSOp::TypeofEq:
      return gCovb & kCovbTypeofEq;
    case JSOp::NewObject:
    case JSOp::NewArray:
      return gCovd & kCovdNewObj;
    case JSOp::MoreIter:
    case JSOp::IsNoIter:
    case JSOp::EndIter:
      return gCovd & kCovdIter;
    case JSOp::Callee:
      return gCovd & kCovdThis;
    case JSOp::Arguments:
      return gArgsOp;
    case JSOp::CheckObjCoercible:
    case JSOp::CheckThis:
    case JSOp::CheckThisReinit:
    case JSOp::CheckReturn:
    case JSOp::Typeof:
    case JSOp::TypeofExpr:
      return gCheckOps;
    case JSOp::NewTarget:
    case JSOp::SuperBase:
    case JSOp::SuperFun:
      return gIterOps;
    case JSOp::Try:
    case JSOp::TryDestructuring:
      return gCovg & kCovgTry;
    case JSOp::DebugLeaveLexicalEnv:
      return gCovg & kCovgDebugLeave;
    case JSOp::CheckIsObj:
      return gCovg & kCovgCheckIsObj;
    case JSOp::Lambda:
      return gCovg & kCovgLambda;
    case JSOp::PushLexicalEnv:
    case JSOp::PopLexicalEnv:
    case JSOp::FreshenLexicalEnv:
    case JSOp::RecreateLexicalEnv:
    case JSOp::InitAliasedLexical:
      return gCovg & kCovgLexEnv;
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
    case JSOp::OptimizeGetIterator:
    case JSOp::Iter:
      return gIterOps;
    case JSOp::CallContent:
    case JSOp::CallIter:
    case JSOp::CallContentIter:
      return gCovd & kCovdCall;
    case JSOp::New:
    case JSOp::NewContent:
      return gCovd & kCovdNew;
    case JSOp::SuperCall:
      return gSuperCall && gDirect && (gCovd & kCovdNew) &&
             (gCovd & kCovdNewScripted);
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
    ops[n] = OpInfo{off, ic, jop, !inl, false};
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
  // CASE(Call) with constructing = New/NewContent: callee at sp[argc + 1 +
  // constructing], newTarget at sp[0]; the IC gets extraArgs 2 + constructing.
  const bool isSuper = ops[cur].op == JSOp::SuperCall;
  const uint32_t ctor = (ops[cur].op == JSOp::New ||
                         ops[cur].op == JSOp::NewContent || isSuper)
                            ? 1
                            : 0;
  const bool direct =
      gDirect && (!ctor || ((gCovd & kCovdNewScripted) && (gCovd & kCovdNew)));
  // r = helper(frame, sp, pc, icEntry, ctx, site); r == 1: the callee frame
  // is pushed, return to the interpreter in it (Hook: kRanNewFrame). r == 0:
  // nothing changed, falls through (the caller emits the exit at the op).
  auto directCall = [&](int64_t (*helper)(int64_t, int64_t, int64_t, int64_t,
                                          int64_t, int64_t),
                        CallSite* site) {
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
    uint32_t i = 5;
    if (site) {
      i64c(int64_t(uintptr_t(site)));
      i++;
    }
    for (; i < kNParams; i++) i64c(0);
    i32c(int32_t(uintptr_t(helper)));
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
  };
  CallSite* site = nullptr;
  if (direct && gSiteCache) {
    if (!sites) {
      for (uint32_t k = 0; k < n; k++) {
        switch (ops[k].op) {
          case JSOp::Call: case JSOp::CallIgnoresRv: case JSOp::CallContent:
          case JSOp::CallIter: case JSOp::CallContentIter: case JSOp::New:
          case JSOp::NewContent: case JSOp::SuperCall:
            capSites++;
            break;
          default:
            break;
        }
      }
      sites = static_cast<CallSite*>(calloc(capSites, sizeof(CallSite)));
      if (!sites) return reject("oom");
    }
    if (nSites >= capSites) return reject("call sites");
    site = &sites[nSites++];
  }
  ld(argc + 1 + ctor);
  lset(L_A);
  if (site) {
    // Site hit: the callee is exactly the function object the site was filled
    // for; the tag/class/flags pre-checks below are skipped.
    lget(L_A);
    i32c(int32_t(uintptr_t(site)));
    load64(uint32_t(offsetof(CallSite, calleeBits)));
    op(OP_I64EQ);
    ifThen();
    directCall(&CallScriptedHit, site);
    exitHere();
    end();
  }
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
  if (direct) {
    directCall(&CallScripted, site);
  }
  exitHere();
  end();
  if (isSuper) {
    // SuperCall: only the direct scripted path is compiled; any other callee
    // exits to the interpreter (CASE(Call) + its Call IC) as before.
    exitHere();
    return true;
  }
  if (direct && gFunCall && !ctor &&
      (ops[cur].op == JSOp::Call || ops[cur].op == JSOp::CallIgnoresRv ||
       ops[cur].op == JSOp::CallContent)) {
    // PBLBC_FUNCALL: native callee whose native is js::fun_call (the low
    // word of the native slot's PrivateValue); r == 0 falls through to the IC.
    lget(L_A);
    op(OP_I32WRAP);
    load32(uint32_t(JSFunction::offsetOfNativeOrEnv()));
    i32c(int32_t(uintptr_t(&js::fun_call)));
    op(OP_I32EQ);
    ifThen();
    directCall(&CallFunCall, nullptr);
    end();
  }
  if (direct && gFunApply && !ctor && argc <= 2 &&
      (ops[cur].op == JSOp::Call || ops[cur].op == JSOp::CallIgnoresRv ||
       ops[cur].op == JSOp::CallContent)) {
    // PBLBC_FUNAPPLY: the same for js::fun_apply.
    lget(L_A);
    op(OP_I32WRAP);
    load32(uint32_t(JSFunction::offsetOfNativeOrEnv()));
    i32c(int32_t(uintptr_t(&js::fun_apply)));
    op(OP_I32EQ);
    ifThen();
    directCall(&CallFunApply, nullptr);
    end();
  }
  lget(L_CTX);
  i32c(int32_t(2 + ctor));
  store32(kCtxExtraArgs);
  i64c(argc);
  lset(L_A);
  invokeIC(L_A, ~0u, ~0u, false);
  spAdd(int32_t(argc + 2 + ctor));
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
  if (jop == JSOp::Mod && gCheckOps) {
    // CASE(Mod) number path: DoubleValue(NumberMod(lhs, rhs)) at sp[1].
    isNumber(L_A);
    isNumber(L_B);
    op(OP_I32AND);
    ifThen();
    callHelper(ModNumberHelper);
    spAdd(1);
    br(1);
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
  if (jop == JSOp::Add && (gCovc & kCovcAdd)) {
    // CASE(Add) HybridICs slow path in AddHelper; the result replaces lhs.
    callHelper(AddHelper);
    spAdd(1);
    debugCheckNext();
  } else if (gCovb & kCovbArith) {
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
bool MT::bitArith(JSOp jop) {
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
  if (jop == JSOp::Lsh || jop == JSOp::Rsh || jop == JSOp::Ursh) {
    i32c(31);
    op(OP_I32AND);
  }
  switch (jop) {
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
  if (jop == JSOp::Ursh) {
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

// ---- PBLBC_VSTACK op translation -------------------------------------------

// Int32 arithmetic / bitwise / compare with the operands (and result)
// virtual. Entries below the operands are flushed first. Fast arm: int32
// payloads straight from the locals/constants (tag tests skipped when the
// type is known). Slow arm: operands stored to memory with L_SP exactly as
// the existing code expects, the existing code unchanged (it may call ICs,
// helpers or exit; nothing else is virtual then), result reloaded into the
// same local and L_SP restored, so both arms merge in the same state.
bool MT::vsArith(JSOp jop) {
  const bool un = jop == JSOp::Inc || jop == JSOp::Dec;
  const uint32_t nin = un ? 1 : 2;
  const bool cmp = jop == JSOp::Eq || jop == JSOp::Ne || jop == JSOp::Lt ||
                   jop == JSOp::Le || jop == JSOp::Gt || jop == JSOp::Ge ||
                   jop == JSOp::StrictEq || jop == JSOp::StrictNe;
  const bool bit = jop == JSOp::BitOr || jop == JSOp::BitAnd ||
                   jop == JSOp::BitXor || jop == JSOp::Lsh ||
                   jop == JSOp::Rsh || jop == JSOp::Ursh;
  vsMaterialize(nin);
  vsFlushBelow(nin);
  const VEnt lhs = vs[0];
  const VEnt rhs =
      un ? VEnt{true, VT_I32, 0, Int32Value(1).asRawBits()} : vs[1];
  const bool known = lhs.type == VT_I32 && rhs.type == VT_I32;
  // A constant that is not an int32 never takes the int32 arm.
  const bool fast = known || ((!lhs.isConst || lhs.type == VT_I32) &&
                              (!rhs.isConst || rhs.type == VT_I32));
  int rvi = vsAlloc();  // at most two pool locals are in use here
  if (rvi < 0) return reject("vstack pool");
  const uint32_t rv = uint32_t(rvi);
  bool needSlow = true;
  block();  // $done
  const uint32_t done = lvl;
  if (fast) {
    if (!known) {
      bool any = false;
      if (lhs.type != VT_I32) {
        tagIs(lhs.loc, JSVAL_TAG_INT32);
        any = true;
      }
      if (rhs.type != VT_I32) {
        tagIs(rhs.loc, JSVAL_TAG_INT32);
        if (any) op(OP_I32AND);
      }
      ifThen();
    }
    if (cmp) {
      uint8_t i32op;
      switch (jop) {
        case JSOp::Eq: case JSOp::StrictEq: i32op = OP_I32EQ; break;
        case JSOp::Ne: case JSOp::StrictNe: i32op = OP_I32NE; break;
        case JSOp::Lt: i32op = OP_I32LTS; break;
        case JSOp::Le: i32op = OP_I32LES; break;
        case JSOp::Gt: i32op = OP_I32GTS; break;
        default: i32op = OP_I32GES; break;
      }
      vsI32(lhs);
      vsI32(rhs);
      op(i32op);
      boxI32(JSVAL_TAG_BOOLEAN);
      lset(rv);
      br(lvl - done);
      if (known) needSlow = false;
    } else if (bit) {
      vsI32(lhs);
      vsI32(rhs);
      if (jop == JSOp::Lsh || jop == JSOp::Rsh || jop == JSOp::Ursh) {
        i32c(31);
        op(OP_I32AND);
      }
      switch (jop) {
        case JSOp::BitOr: op(OP_I32OR); break;
        case JSOp::BitAnd: op(OP_I32AND); break;
        case JSOp::BitXor: op(OP_I32XOR); break;
        case JSOp::Lsh: op(OP_I32SHL); break;
        case JSOp::Rsh: op(OP_I32SHRS); break;
        default: op(OP_I32SHRU); break;
      }
      if (jop == JSOp::Ursh) {
        // Results >= 2^31 are doubles: the slow arm computes them.
        lset(L_X);
        lget(L_X);
        i32c(0);
        op(OP_I32GES);
        ifThen();
        lget(L_X);
        boxI32(JSVAL_TAG_INT32);
        lset(rv);
        br(lvl - done);
        end();
      } else {
        boxI32(JSVAL_TAG_INT32);
        lset(rv);
        br(lvl - done);
        if (known) needSlow = false;
      }
    } else {
      vsI32(lhs);
      op(OP_I64EXTS);
      vsI32(rhs);
      op(OP_I64EXTS);
      op(jop == JSOp::Add || jop == JSOp::Inc   ? OP_I64ADD
         : jop == JSOp::Sub || jop == JSOp::Dec ? OP_I64SUB
                                                : OP_I64MUL);
      lset(L_R);
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
        vsI32(lhs);
        vsI32(rhs);
        op(OP_I32XOR);
        i32c(0);
        op(OP_I32GES);
        op(OP_I32OR);
        op(OP_I32AND);
      }
      ifThen();
      lget(L_R);
      op(OP_I32WRAP);
      boxI32(JSVAL_TAG_INT32);
      lset(rv);
      br(lvl - done);
      end();
    }
    if (!known) end();
  }
  if (needSlow) {
    vsEmitStore(nin);
    bool ok = un    ? unary(jop)
              : cmp ? compare(jop)
              : bit ? bitArith(jop)
                    : binaryArith(jop);
    if (!ok) return false;
    ld(0);
    lset(rv);
    spAdd(1);
  }
  end();  // $done
  for (uint32_t i = 0; i < nin; i++) vsRelease(vs[i]);
  vsN = 0;
  vsPushLocal(rv, cmp ? VT_BOOL
                  : (bit && known && jop != JSOp::Ursh) ? VT_I32
                                                        : VT_UNK);
  return true;
}

// 1: handled with the model; 0: run the existing code (model flushed by the
// caller); -1: rejected.
int MT::vsOp(const OpInfo& o, const jsbytecode* pc) {
  switch (o.op) {
    case JSOp::Undefined:
      vsPushConst(UndefinedValue().asRawBits(), VT_UNDNULL);
      return 1;
    case JSOp::Null:
      vsPushConst(NullValue().asRawBits(), VT_UNDNULL);
      return 1;
    case JSOp::True:
    case JSOp::False:
      vsPushConst(BooleanValue(o.op == JSOp::True).asRawBits(), VT_BOOL);
      return 1;
    case JSOp::Zero:
    case JSOp::One:
    case JSOp::Int8:
    case JSOp::Uint16:
    case JSOp::Uint24:
    case JSOp::Int32: {
      int32_t i = o.op == JSOp::Zero    ? 0
                  : o.op == JSOp::One   ? 1
                  : o.op == JSOp::Int8  ? int32_t(GET_INT8(pc))
                  : o.op == JSOp::Uint16 ? int32_t(GET_UINT16(pc))
                  : o.op == JSOp::Uint24 ? int32_t(GET_UINT24(pc))
                                         : int32_t(GET_INT32(pc));
      vsPushConst(Int32Value(i).asRawBits(), VT_I32);
      return 1;
    }
    case JSOp::Double:
      vsPushConst(GET_INLINE_VALUE(pc).asRawBits(), VT_UNK);
      return 1;
    case JSOp::GetLocal: {
      uint32_t i = GET_LOCALNO(pc);
      if (i >= nfixed) return reject("local index") ? 1 : -1;
      uint32_t l = vsFreshLocal();
      lget(L_LB);
      load64(8 * (nfixed - 1 - i));
      lset(l);
      vsPushLocal(l, VT_UNK);
      return 1;
    }
    case JSOp::GetArg: {
      uint32_t i = GET_ARGNO(pc);
      uint32_t l = vsFreshLocal();
      lget(L_FLG);
      i32c(kFlagArgsAliased);
      op(OP_I32AND);
      ifThen();
      vsExitHere();
      end();
      lget(L_AV);
      load64(8 * i);
      lset(l);
      vsPushLocal(l, VT_UNK);
      return 1;
    }
    case JSOp::SetLocal:
    case JSOp::InitLexical: {
      if (!vsN) return 0;
      uint32_t i = GET_LOCALNO(pc);
      if (i >= nfixed) return reject("local index") ? 1 : -1;
      lget(L_LB);
      vsValue(vs[vsN - 1]);
      store64(8 * (nfixed - 1 - i));
      return 1;
    }
    case JSOp::Pop:
      if (!vsN) return 0;
      vsRelease(vs[vsN - 1]);
      vsN--;
      return 1;
    case JSOp::Dup:
    case JSOp::Dup2: {
      uint32_t m = o.op == JSOp::Dup ? 1 : 2;
      vsMaterialize(m);
      if (vsN + m > kVsMax || uint32_t(__builtin_popcount(vsFree)) < m) {
        flush();
        return 0;
      }
      uint32_t base = vsN - m;
      for (uint32_t j = 0; j < m; j++) {
        VEnt e = vs[base + j];
        if (e.isConst) {
          vsPushConst(e.bits, e.type);
        } else {
          uint32_t l = uint32_t(vsAlloc());
          lget(e.loc);
          lset(l);
          vsPushLocal(l, e.type);
        }
      }
      return 1;
    }
    case JSOp::Swap: {
      vsMaterialize(2);
      VEnt e = vs[vsN - 1];
      vs[vsN - 1] = vs[vsN - 2];
      vs[vsN - 2] = e;
      return 1;
    }
    case JSOp::Add: case JSOp::Sub: case JSOp::Mul: case JSOp::BitOr:
    case JSOp::BitAnd: case JSOp::BitXor: case JSOp::Lsh: case JSOp::Rsh:
    case JSOp::Ursh: case JSOp::Inc: case JSOp::Dec: case JSOp::Eq:
    case JSOp::Ne: case JSOp::Lt: case JSOp::Le: case JSOp::Gt:
    case JSOp::Ge: case JSOp::StrictEq: case JSOp::StrictNe:
      // Operands already in memory (e.g. GetElem/IC results): the model
      // would load them, fail the int32 arm for doubles and store them back
      // for the existing code (navier-stokes +80%). Run the existing code.
      if (vsN < ((o.op == JSOp::Inc || o.op == JSOp::Dec) ? 1u : 2u))
        return 0;
      return vsArith(o.op) ? 1 : -1;
    case JSOp::Not: {
      if (!vsN || (vs[vsN - 1].type != VT_I32 && vs[vsN - 1].type != VT_BOOL))
        return 0;
      VEnt& e = vs[vsN - 1];
      if (e.isConst) {
        e.bits = BooleanValue(uint32_t(e.bits) == 0).asRawBits();
      } else {
        lget(e.loc);
        op(OP_I32WRAP);
        op(OP_I32EQZ);
        boxI32(JSVAL_TAG_BOOLEAN);
        lset(e.loc);
      }
      e.type = VT_BOOL;
      return 1;
    }
    case JSOp::JumpIfFalse:
    case JSOp::JumpIfTrue: {
      // Known booleans / int32 test the payload; anything else runs the
      // existing ToBoolean code (which may call the ToBool IC) on memory.
      if (!vsN || (vs[vsN - 1].type != VT_I32 && vs[vsN - 1].type != VT_BOOL))
        return 0;
      uint32_t k;
      if (!target(GET_JUMP_OFFSET(const_cast<jsbytecode*>(pc)), &k))
        return reject("jump target") ? 1 : -1;
      vsFlushBelow(1);
      VEnt e = vs[0];
      vsI32(e);
      vsRelease(e);
      vsN = 0;
      if (o.op == JSOp::JumpIfFalse) op(OP_I32EQZ);
      ifThen();
      jumpTo(k);
      end();
      return 1;
    }
    default:
      return 0;
  }
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
  if (gVstack && vsAware(o.op)) {
    int r = vsOp(o, pc);
    if (r != 0) return r > 0;
  }
  if (vsN) flush();
  switch (o.op) {
    case JSOp::Call:
    case JSOp::CallIgnoresRv:
      return nativeCall();
    case JSOp::CallContent:
    case JSOp::CallIter:
    case JSOp::CallContentIter:
      // CASE(Call) shares one path for all five ops (constructing == false).
      if (!(gCovd & kCovdCall)) {
        exitHere();
        return true;
      }
      return nativeCall();
    case JSOp::New:
    case JSOp::NewContent:
      // Same CASE(Call) path, constructing == true. Scripted callees exit
      // (the interpreter's constructing fast path); others use the Call IC.
      if (!(gCovd & kCovdNew)) {
        exitHere();
        return true;
      }
      return nativeCall();
    case JSOp::SuperCall:
      // CASE(Call), constructing == true: [callee (SuperFun), this
      // (IsConstructing magic), args, newTarget (NewTarget)]. Only reached
      // when IsInlineOp(SuperCall) (PBLBC_SUPERCALL, direct calls on).
      return nativeCall();
    case JSOp::Callee:
      // CASE(Callee): push frame->calleev() (helper stores it at sp[-1]).
      if (!(gCovd & kCovdThis)) {
        exitHere();
        return true;
      }
      callHelper(CalleeHelper);
      spAdd(-1);
      return true;
    case JSOp::Arguments:
      // CASE(Arguments) in ArgumentsHelper (result at sp[-1]).
      if (!gArgsOp) {
        exitHere();
        return true;
      }
      callHelper(ArgumentsHelper);
      spAdd(-1);
      return true;
    case JSOp::Try:
    case JSOp::TryDestructuring:
      // CASE(Try): no-op (catch/finally are found via try notes on unwind,
      // which happens in the interpreter after an error exit).
      if (!(gCovg & kCovgTry)) {
        exitHere();
        return true;
      }
      return true;
    case JSOp::DebugLeaveLexicalEnv:
      // CASE(DebugLeaveLexicalEnv): nothing unless frame->isDebuggee(); a
      // debuggee frame exits (the interpreter runs the op).
      if (!(gCovg & kCovgDebugLeave)) {
        exitHere();
        return true;
      }
      lget(L_FR);
      load32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfFlags())));
      i32c(int32_t(BaselineFrame::DEBUGGEE));
      op(OP_I32AND);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::CheckIsObj:
      // CASE(CheckIsObj): an object continues; anything else exits (the
      // interpreter throws).
      if (!(gCovg & kCovgCheckIsObj)) {
        exitHere();
        return true;
      }
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_OBJECT);
      op(OP_I32EQZ);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::Lambda:
      // CASE(Lambda) HybridICs path in LambdaHelper (result at sp[-1]).
      if (!(gCovg & kCovgLambda)) {
        exitHere();
        return true;
      }
      callHelper(LambdaHelper);
      spAdd(-1);
      return true;
    case JSOp::PushLexicalEnv:
    case JSOp::PopLexicalEnv:
    case JSOp::FreshenLexicalEnv:
    case JSOp::RecreateLexicalEnv:
    case JSOp::InitAliasedLexical:
      // CASE(...) in LexEnvHelper; the stack is unchanged (InitAliasedLexical
      // keeps the value on the stack).
      if (!(gCovg & kCovgLexEnv)) {
        exitHere();
        return true;
      }
      callHelper(LexEnvHelper);
      return true;
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
    case JSOp::NewObject:
    case JSOp::NewArray:
      // CASE(NewObject)/CASE(NewArray), HybridICs path, in the helper, which
      // stores the new object at sp[-1]: => obj.
      if (!(gCovd & kCovdNewObj)) {
        exitHere();
        return true;
      }
      callHelper(o.op == JSOp::NewObject ? NewObjectHelper : NewArrayHelper);
      spAdd(-1);
      return true;
    case JSOp::MoreIter:
    case JSOp::IsNoIter:
    case JSOp::EndIter:
      // CASE(MoreIter) iter => iter, name; CASE(IsNoIter) iter => iter, bool
      // (both store at sp[-1]); CASE(EndIter) iter, interval =>.
      if (!(gCovd & kCovdIter)) {
        exitHere();
        return true;
      }
      callHelper(IterHelper);
      spAdd(o.op == JSOp::EndIter ? 2 : -1);
      return true;
    case JSOp::InitElemArray:
      // CASE(InitElemArray) in InitElemArrayHelper: array, val => array.
      callHelper(InitElemArrayHelper);
      spAdd(1);
      return true;
    case JSOp::SetAliasedVar:
      // CASE(SetAliasedVar) in SetAliasedVarHelper (value stays on the stack).
      callHelper(SetAliasedVarHelper);
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
      block();  // $done
      if (gCheckOps) {
        // Objects: js::TypeOfValue in TypeofEqHelper (stores the boolean).
        tagIs(L_A, JSVAL_TAG_OBJECT);
        ifThen();
        callHelper(TypeofEqHelper);
        br(1);
        end();
      }
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
      end();
      return true;
    }
    case JSOp::CheckObjCoercible:
      // CASE(CheckObjCoercible): null/undefined exit (the interpreter
      // throws); anything else is a no-op.
      if (!gCheckOps) {
        exitHere();
        return true;
      }
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_UNDEFINED);
      tagIs(L_A, JSVAL_TAG_NULL);
      op(OP_I32OR);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::CheckThis:
      // CASE(CheckThis): any magic exits (the interpreter throws for the
      // uninitialized lexical); anything else is a no-op.
      if (!gCheckOps) {
        exitHere();
        return true;
      }
      ld(0);
      lset(L_A);
      tagIs(L_A, JSVAL_TAG_MAGIC);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::CheckThisReinit:
      // CASE(CheckThisReinit): exactly MagicValue(JS_UNINITIALIZED_LEXICAL)
      // is a no-op; anything else exits (the interpreter throws).
      if (!gCheckOps) {
        exitHere();
        return true;
      }
      ld(0);
      i64c(int64_t(MagicValue(JS_UNINITIALIZED_LEXICAL).asRawBits()));
      op(OP_I64NE);
      ifThen();
      exitHere();
      end();
      return true;
    case JSOp::CheckReturn: {
      // CASE(CheckReturn): thisval => result. frame->returnValue() first
      // (without HAS_RVAL the slot is set to undefined, as there); an object
      // return value replaces thisval; undefined with a non-magic thisval
      // leaves thisval; anything else exits (the interpreter throws).
      if (!gCheckOps) {
        exitHere();
        return true;
      }
      const uint32_t rvOff =
          uint32_t(FrameOff(BaselineFrame::reverseOffsetOfReturnValue()));
      lget(L_FR);
      load32(uint32_t(FrameOff(BaselineFrame::reverseOffsetOfFlags())));
      i32c(int32_t(BaselineFrame::HAS_RVAL));
      op(OP_I32AND);
      op(OP_I32EQZ);
      ifThen();
      lget(L_FR);
      i64c(int64_t(UndefinedValue().asRawBits()));
      store64(rvOff);
      end();
      lget(L_FR);
      load64(rvOff);
      lset(L_B);
      ld(0);
      lset(L_A);
      block();  // $done
      tagIs(L_B, JSVAL_TAG_OBJECT);
      ifThen();
      stLocal(0, L_B);
      br(1);
      end();
      tagIs(L_B, JSVAL_TAG_UNDEFINED);
      tagIs(L_A, JSVAL_TAG_MAGIC);
      op(OP_I32EQZ);
      op(OP_I32AND);
      brIf(0);
      exitHere();
      end();
      return true;
    }
    case JSOp::NewTarget:
      // CASE(NewTarget): frame->newTarget() at sp[-1] (helper), pushed.
      if (!gIterOps) {
        exitHere();
        return true;
      }
      callHelper(NewTargetHelper);
      spAdd(-1);
      return true;
    case JSOp::SuperBase:
      // CASE(SuperBase): HomeObjectSuperBase of the callee's home object
      // replaces sp[0] (helper).
      if (!gIterOps) {
        exitHere();
        return true;
      }
      callHelper(SuperBaseHelper);
      return true;
    case JSOp::SuperFun:
      // CASE(SuperFun): SuperFunOperation(callee) replaces sp[0] (helper).
      if (!gIterOps) {
        exitHere();
        return true;
      }
      callHelper(SuperFunHelper);
      return true;
    case JSOp::Typeof:
    case JSOp::TypeofExpr:
      // CASE(Typeof/TypeofExpr) (HybridICs): TypeOfOperation in the helper.
      if (!gCheckOps) {
        exitHere();
        return true;
      }
      callHelper(TypeofExprHelper);
      return true;
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
      if (gCovd & kCovdThis) {
        // Not an object: CASE(FunctionThis)'s GetFunctionThis in the helper
        // (strictness checked at run time), result at sp[-1].
        callHelper(FunctionThisHelper);
        spAdd(-1);
        ld(0);
        lset(L_A);
        spAdd(1);
      } else {
        exitHere();
      }
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
        if (gVstack) {
          // LoopHook exits at an op that starts with live virtual entries
          // (never a dispatch entry): high word 0x80000000 | pc offset;
          // return to the interpreter there.
          lget(L_R);
          i64c(0);
          op(OP_I64LTS);
          ifThen();
          lget(L_IO);
          lget(L_SP);
          store32(0);
          lget(L_R);
          i64c(32);
          op(OP_I64SHRU);
          i64c(0x7fffffff);
          op(OP_I64AND);
          op(OP_RETURN);
          end();
        }
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
      return bitArith(o.op);
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
      if (gGetter && gDirect) {
        popLocal(L_A);
        invokeIC(L_A, ~0u, ~0u, false, /* getterReq = */ true);
        pushLocal(L_R);
        debugCheckNext();
        return true;
      }
      [[fallthrough]];
    case JSOp::GetBoundName:
    case JSOp::ToPropertyKey:
    case JSOp::OptimizeSpreadCall:
    case JSOp::OptimizeGetIterator:  // gIterOps (see IsIcCallOp)
    case JSOp::Iter:                 // gIterOps: the GetIterator IC
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
      // CASE(GetGName): &cx->global()->lexicalEnvironment(), read at the op.
      // Never cache it across the activation: a compacting GC (shrinking GC,
      // e.g. relazifyFunctions or a last-ditch GC) can relocate the global
      // lexical environment object while this frame is on the stack, and a
      // pointer taken at entry would then name its forwarded old cell.
      // Same chain as MacroAssembler::loadGlobalObjectData (no read barrier
      // for the context's active global, as in JIT code).
      loadGlobalLexical();
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
  if (gVstack) {
    isTgt = static_cast<uint8_t*>(calloc(n, 1));
    if (!isTgt) return reject("oom");
  }
  for (cur = 0; cur < n; cur++) {
    // PBLBC_VSTACK: a jump target, an op the model cannot carry into, or the
    // end of the function gets an empty model (stores at the end of op
    // cur-1's code, before B_cur ends); ops starting with a non-empty model
    // are never entered by Hook/LoopHook (Entry::exitOp == 2).
    lvl = 0;
    if (vsN && (ops[cur].exit || isTgt[cur] || !vsAware(ops[cur].op))) {
      flush();
    }
    ops[cur].noEntry = vsN != 0;
    b.put(OP_END);  // B_cur
    lvl = 0;
    if (!translateOp() || reason) return false;
    if (lvl != 0) return reject("unbalanced blocks");
    if (b.oom) return reject("oom");
  }
  if (vsN) flush();
  b.put(OP_END);  // loop
  b.put(OP_UNREACH);
  b.put(OP_END);  // function
  return !b.oom || reject("oom");
}

bool MT::assemble(Buf& m) {
  Buf c;
  Buf body;
  // PBLBC_VSTACK pool after the PBLBC_INL scratch (declared with it).
  body.uleb((inlUsed || vsUsed) ? (vsUsed ? 8 : 7) : 3);
  body.uleb(kNI64);
  body.put(T_I64);
  body.uleb(kNI32);
  body.put(T_I32);
  body.uleb(kNF64);
  body.put(T_F64);
  if (inlUsed || vsUsed) {  // PBLBC_INL scratch at kInlBase, zero i64
    body.uleb(kInlineI64Locals);
    body.put(T_I64);
    body.uleb(kInlineI32Locals);
    body.put(T_I32);
    body.uleb(kInlineF64Locals);
    body.put(T_F64);
    body.uleb(1);
    body.put(T_I64);
  }
  if (vsUsed) {
    body.uleb(kVsPool);
    body.put(T_I64);
  }
  body.putn(b.p, b.n);

  m.putn("\0asm\1\0\0\0", 8);
  Buf gh;  // PBLBC_GETTER helper body (function 1, type 1)
  if (gpUsed) emitGetterHelper(gh);
  const uint32_t nfn = gpUsed ? 2 : 1;
  c.uleb(nfn);
  c.put(0x60);
  c.uleb(kNParams);
  for (uint32_t i = 0; i < kNParams; i++) c.put(T_I64);
  c.uleb(1);
  c.put(T_I64);
  if (gpUsed) {
    c.put(0x60);
    c.uleb(5);
    c.put(T_I64);
    c.put(T_I32);
    c.put(T_I64);
    c.put(T_I32);
    c.put(T_I64);
    c.uleb(1);
    c.put(T_I64);
  }
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
  c.uleb(nfn);
  c.uleb(0);
  if (gpUsed) c.uleb(1);
  m.section(3, c);
  c.uleb(1);
  c.name("f0");
  c.put(0);
  c.uleb(0);
  m.section(7, c);
  c.uleb(nfn);
  c.uleb(uint32_t(body.n));
  c.putn(body.p, body.n);
  if (gpUsed) {
    c.uleb(uint32_t(gh.n));
    c.putn(gh.p, gh.n);
  }
  m.section(10, c);
  if (m.oom || c.oom || body.oom || gh.oom) return reject("oom");
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
  CallSite* sites;      // PBLBC_SITECACHE call sites (constants in the code)
  uint8_t state;    // 0 counting, 1 compiled, 2 rejected
};

thread_local Entry* tTable;
thread_local Entry* tLast;
thread_local uint32_t tEntries;
// Entry-table generation: bumped whenever an Entry is created or changes
// state (entries are never removed and the table is never reallocated).
// CallScripted's callee cache entries are only used when it is unchanged.
thread_local uint32_t tEntryGen;

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
      tEntryGen++;
      return tLast = c;
    }
  }
  return nullptr;
}

void Compile(Entry* e, JSScript* script, JSContext* cx, ICCtx& ctx,
             ICEntry* icEntries, uint32_t nIcEntries) {
  MT t;
  t.entry = e;
  t.icEntries = icEntries;
  t.nIcEntries = nIcEntries;
  t.ictx = &ctx;
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
    tEntryGen++;
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
    e->exitOp[j] = t.ops[j].exit ? 1 : t.ops[j].noEntry ? 2 : 0;
  }
  e->opAt = t.opAt;
  t.opAt = nullptr;
  e->loopState = t.loopState;
  t.loopState = nullptr;
  e->sites = t.sites;
  t.sites = nullptr;
  e->nops = t.n;
  e->fn = idx[0];
  e->shared = script->sharedData();
  e->shared->AddRef();
  e->state = 1;
  tEntryGen++;
  for (uint32_t i = 0; i < kInlCount; i++) gInlSite[i] += t.inlSite[i];
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

// CallScripted callee cache (PBLBC_CALLCACHE, default on): direct-mapped,
// keyed by the callee's BaseScript*, holding values that are functions of the
// script / its compiled Entry. Raw untraced pointers: an entry is only used
// when its GC epoch (gcNumber + minorGCCount, both monotonic: changes on every
// major slice and every minor GC) and the entry-table generation both equal
// the current ones, and the script's ImmutableScriptData is still the cached
// one. Nothing is read from a stale entry except key/epoch/gen.
struct CallCacheEntry {
  const void* key;  // BaseScript*
  uint64_t epoch;
  uint32_t gen;
  uint32_t j0;
  JSScript* script;
  JS::Realm* realm;
  const ImmutableScriptData* isd;
  Entry* e;
  jsbytecode* code;
  uint32_t nfixed;
  uint32_t nslots;
  bool needEnv;
  bool retRval0;
};
constexpr uint32_t kCallCacheBits = 6;
thread_local CallCacheEntry tCallCache[1u << kCallCacheBits];
// gcNumber/minorGCCount are per runtime and restart at 0 in a new runtime,
// while tCallCache/tThisCache are per thread. A thread can host several
// runtimes over its lifetime (a worker runtime destroyed, a new one created on
// the same thread, possibly at the same address and with recycled GC heap
// addresses): entries filled under the old runtime must never match. The high
// 16 bits carry a per-thread runtime serial, bumped whenever the runtime's
// identity (address + GC statistics creation timestamp) changes; the GC counts
// stay far below 2^48.
thread_local const JSRuntime* tEpochRt;
thread_local mozilla::TimeStamp tEpochRtBirth;
thread_local uint64_t tEpochRtSerial;
inline uint64_t GcEpoch(JSContext* cx) {
  JSRuntime* rt = cx->runtime();
  const js::gc::GCRuntime& gc = rt->gc;
  const mozilla::TimeStamp birth = gc.stats().creationTime();
  if (MOZ_UNLIKELY(rt != tEpochRt || birth != tEpochRtBirth)) {
    tEpochRt = rt;
    tEpochRtBirth = birth;
    tEpochRtSerial++;
  }
  return (tEpochRtSerial << 48) + gc.gcNumber() + gc.minorGCCount();
}
constexpr uint64_t kEpochLowMask = (uint64_t(1) << 48) - 1;
inline uint64_t GcEpochLow(JSContext* cx) {
  const js::gc::GCRuntime& gc = cx->runtime()->gc;
  return gc.gcNumber() + gc.minorGCCount();
}

// Conditions under which the CanGC allocation paths would do more than
// Nursery::tryAllocateCell (+ object init): allocation metadata builder
// (also covers Debugger allocation tracking / SavedStacks) which runs
// SetNewObjectMetadata, GC zeal (PreAllocGCChecks runs debug GCs and
// MaybeGenerateMissingAllocSite substitutes sites), or object nursery
// allocation disabled / pretenured zone-wide (minHeapToTenure), where the
// NoGC path would go straight to the tenured heap without the CanGC path's
// MajorGCIfRequested.
static inline bool PblNoGCAllocOk(JSContext* cx) {
  if (MOZ_UNLIKELY(cx->realm()->hasAllocationMetadataBuilder())) {
    return false;
  }
#ifdef JS_GC_ZEAL
  if (MOZ_UNLIKELY(*cx->runtime()->gc.addressOfZealModeBits() != 0)) {
    return false;
  }
#endif
  JS::Zone* zone = cx->zone();
  return zone->allocKindInNursery(JS::TraceKind::Object) &&
         gc::Heap::Default < zone->minHeapToTenure(JS::TraceKind::Object);
}

// CallScripted constructing |this| cache (PBLBC_THISCACHE, default on):
// direct-mapped, keyed by the callee JSFunction*, holding the shape
// js::CreateThis(cx, F, newTarget = F, GenericObject) produced, filled right
// after a successful slow-path CreateThis. Raw untraced pointers, trusted only
// while the GC epoch is unchanged (no minor/major GC: nothing moved, no shape
// table/script swept). The result of CreateThis is a pure function of:
//  - F->constructorNeedsUninitializedThis() (refused; fixed per function);
//  - Get(F, "prototype"): F's shape is the cached one, a non-dictionary shape
//    in which "prototype" is a non-configurable own data property (checked at
//    fill, like CacheIR's hasNonConfigurablePrototypeDataProperty + guardShape)
//    in slot |slot|, so the get reads that slot with no resolve hook, getter or
//    proxy involved; the slot value is the cached object (protoIsObj), or any
//    non-object (!protoIsObj: default proto of F's realm == cx->realm());
//  - the alloc kind (F's script's ImmutableScriptData::propertyCountEstimate:
//    the ISD pointer is cached and compared);
//  - getInitialShape(PlainObject, cx->realm(), proto, nfixed) or the global's
//    default-proto shape: same realm (CallScripted requires cx->realm() ==
//    callee realm) and, without a GC, the same table entry / global slot.
struct ThisCacheEntry {
  const JSFunction* key;
  uint64_t epoch;
  const Shape* funShape;
  const ImmutableScriptData* isd;
  const JSObject* proto;  // slot value when protoIsObj
  SharedShape* thisShape;
  uint32_t slot;
  bool protoIsObj;
};
constexpr uint32_t kThisCacheBits = 5;
thread_local ThisCacheEntry tThisCache[1u << kThisCacheBits];
inline ThisCacheEntry* ThisCacheSlot(const JSFunction* f) {
  return &tThisCache[(uint32_t(uintptr_t(f)) >> 4) &
                     ((1u << kThisCacheBits) - 1)];
}
// SuperCall newTarget (the frame's new.target) accepted by the direct path:
// a non-self-hosted interpreted constructor JSFunction. Its own "prototype"
// is a non-configurable data property (ordinary functions: writable; class
// constructors: read-only), so CreateThis's GetProperty is unobservable and
// may be re-run by the interpreter after a refusal. Natives (e.g. Proxy,
// which has no own prototype), bound functions and proxies are refused.
// The constructing |this| slot holds JS_IS_CONSTRUCTING magic until CreateThis
// (Value::isMagic(why) release-asserts the reason: never test it that way).
inline bool SuperNewTargetOk(const Value& nt) {
  if (!nt.isObject() || !nt.toObject().is<JSFunction>()) return false;
  JSFunction* f = &nt.toObject().as<JSFunction>();
  return f->hasBaseScript() && f->isInterpreted() && f->isConstructor() &&
         !f->isSelfHostedBuiltin();
}
// Same environment conditions as the PBLBC_ALLOC NoGC allocation paths.
inline bool ThisCacheEnvOk(JSContext* cx) { return PblNoGCAllocOk(cx); }
// Returns the new |this| object (nursery or tenured, never GCs) or nullptr
// (miss, or the NoGC allocation failed): then the slow path runs.
inline PlainObject* ThisCacheTryCreate(JSContext* cx, JSFunction* func,
                                       JSScript* calleeScript) {
  ThisCacheEntry* c = ThisCacheSlot(func);
  if (c->key != func || c->epoch != GcEpoch(cx)) return nullptr;
  if (func->shape() != c->funShape ||
      calleeScript->immutableScriptData() != c->isd || !ThisCacheEnvOk(cx)) {
    return nullptr;
  }
  const Value& pv = func->getSlot(c->slot);
  if (c->protoIsObj ? (!pv.isObject() || &pv.toObject() != c->proto)
                    : pv.isObject()) {
    return nullptr;
  }
  // PlainObject::createWithShape(cx, shape, GenericObject) ->
  // NativeObject::create(cx, GetGCObjectKind(nfixed), Heap::Default, shape)
  // with slotSpan 0 (initial shape, checked at fill): no dynamic slots, no
  // slot init; metadata builder refused above.
  SharedShape* shape = c->thisShape;
  const JSClass* clasp = &PlainObject::class_;
  gc::AllocKind kind = gc::GetGCObjectKind(shape->numFixedSlots());
  gc::Heap heap = GetInitialHeap(GenericObject, clasp);
  NativeObject* nobj = cx->newCell<NativeObject, NoGC>(kind, heap, clasp,
                                                       nullptr);
  if (!nobj) return nullptr;
  nobj->initShape(shape);
  nobj->setEmptyElements();
  nobj->initEmptyDynamicSlots();
  js::gc::gcprobes::CreateObject(nobj);
  return &nobj->as<PlainObject>();
}
// After a successful slow-path CreateThis(func, func) (no script ran since:
// thisObj still has the shape CreateThis gave it).
inline void ThisCacheFill(JSContext* cx, JSFunction* func,
                          JSScript* calleeScript, JSObject* thisObj) {
  if (!ThisCacheEnvOk(cx) || func->constructorNeedsUninitializedThis() ||
      !thisObj->is<PlainObject>() || func->shape()->isDictionary() ||
      !func->hasNonConfigurablePrototypeDataProperty()) {
    return;
  }
  Shape* ts = thisObj->shape();
  if (ts->isDictionary() || ts->asShared().slotSpan() != 0 ||
      ts->realm() != cx->realm() ||
      NativeObject::calculateDynamicSlots(&ts->asShared()) != 0) {
    return;
  }
  mozilla::Maybe<PropertyInfo> prop =
      func->lookupPure(cx->names().prototype);
  if (prop.isNothing() || !prop->isDataProperty() || prop->configurable()) {
    return;
  }
  const Value& pv = func->getSlot(prop->slot());
  // The shape's proto must be what GetPrototypeFromConstructor returned.
  if (pv.isObject()) {
    if (ts->proto().toObjectOrNull() != &pv.toObject()) return;
  } else if (ts->proto().toObjectOrNull() !=
             cx->global()->maybeGetPrototype(JSProto_Object)) {
    return;
  }
  ThisCacheEntry* c = ThisCacheSlot(func);
  c->key = func;
  c->epoch = GcEpoch(cx);
  c->funShape = func->shape();
  c->isd = calleeScript->immutableScriptData();
  c->proto = pv.isObject() ? &pv.toObject() : nullptr;
  c->thisShape = &ts->asShared();
  c->slot = prop->slot();
  c->protoIsObj = pv.isObject();
}
// SuperCall |this| cache: CreateThis(func, nt) for a base callee func with
// newTarget nt != func (the derived class's new.target). The shape depends
// on func (getAllocKindForThis: guarded by its script data) and on nt's
// "prototype" (GetPrototypeFromConstructor(nt): guarded by nt's shape, the
// non-configurable data slot and its value), exactly like the tThisCache
// entry for func == nt. Separate table so New/NewContent are unaffected.
struct SuperThisCacheEntry {
  const JSFunction* key;
  const JSFunction* nt;
  uint64_t epoch;
  const Shape* ntShape;
  const ImmutableScriptData* isd;
  const JSObject* proto;  // nt slot value when protoIsObj
  SharedShape* thisShape;
  uint32_t slot;
  bool protoIsObj;
};
thread_local SuperThisCacheEntry tSuperThisCache[1u << kThisCacheBits];
inline SuperThisCacheEntry* SuperThisCacheSlot(const JSFunction* f,
                                               const JSFunction* nt) {
  return &tSuperThisCache[((uint32_t(uintptr_t(f)) ^
                            (uint32_t(uintptr_t(nt)) >> 3)) >> 4) &
                          ((1u << kThisCacheBits) - 1)];
}
inline PlainObject* SuperThisCacheTryCreate(JSContext* cx, JSFunction* func,
                                            JSScript* calleeScript,
                                            JSFunction* nt) {
  SuperThisCacheEntry* c = SuperThisCacheSlot(func, nt);
  if (c->key != func || c->nt != nt || c->epoch != GcEpoch(cx)) {
    return nullptr;
  }
  if (nt->shape() != c->ntShape ||
      calleeScript->immutableScriptData() != c->isd || !ThisCacheEnvOk(cx)) {
    return nullptr;
  }
  const Value& pv = nt->getSlot(c->slot);
  if (c->protoIsObj ? (!pv.isObject() || &pv.toObject() != c->proto)
                    : pv.isObject()) {
    return nullptr;
  }
  // Same NoGC allocation as ThisCacheTryCreate.
  SharedShape* shape = c->thisShape;
  const JSClass* clasp = &PlainObject::class_;
  gc::AllocKind kind = gc::GetGCObjectKind(shape->numFixedSlots());
  gc::Heap heap = GetInitialHeap(GenericObject, clasp);
  NativeObject* nobj = cx->newCell<NativeObject, NoGC>(kind, heap, clasp,
                                                       nullptr);
  if (!nobj) return nullptr;
  nobj->initShape(shape);
  nobj->setEmptyElements();
  nobj->initEmptyDynamicSlots();
  js::gc::gcprobes::CreateObject(nobj);
  return &nobj->as<PlainObject>();
}
// After a successful slow-path CreateThis(func, nt), nt != func.
inline void SuperThisCacheFill(JSContext* cx, JSFunction* func,
                               JSScript* calleeScript, JSFunction* nt,
                               JSObject* thisObj) {
  if (!ThisCacheEnvOk(cx) || func->constructorNeedsUninitializedThis() ||
      !thisObj->is<PlainObject>() || nt->shape()->isDictionary() ||
      !nt->hasNonConfigurablePrototypeDataProperty()) {
    return;
  }
  Shape* ts = thisObj->shape();
  if (ts->isDictionary() || ts->asShared().slotSpan() != 0 ||
      ts->realm() != cx->realm() ||
      NativeObject::calculateDynamicSlots(&ts->asShared()) != 0) {
    return;
  }
  mozilla::Maybe<PropertyInfo> prop = nt->lookupPure(cx->names().prototype);
  if (prop.isNothing() || !prop->isDataProperty() || prop->configurable()) {
    return;
  }
  const Value& pv = nt->getSlot(prop->slot());
  if (pv.isObject()) {
    if (ts->proto().toObjectOrNull() != &pv.toObject()) return;
  } else if (ts->proto().toObjectOrNull() !=
             cx->global()->maybeGetPrototype(JSProto_Object)) {
    return;
  }
  SuperThisCacheEntry* c = SuperThisCacheSlot(func, nt);
  c->key = func;
  c->nt = nt;
  c->epoch = GcEpoch(cx);
  c->ntShape = nt->shape();
  c->isd = calleeScript->immutableScriptData();
  c->proto = pv.isObject() ? &pv.toObject() : nullptr;
  c->thisShape = &ts->asShared();
  c->slot = prop->slot();
  c->protoIsObj = pv.isObject();
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
// Fast path steps 0-8 onwards, shared by CallScripted and CallScriptedHit.
// Every precondition has been checked by the caller (nothing below refuses).
// cScript: the callee script when it is known that no GC happened since
// |epoch| was read (the return check may then use it instead of
// newFrame->script()), else nullptr. calleePC/nfixed/aliased/icIdx0 are
// functions of the callee script (its code/ImmutableScriptData/flags) and of
// its Entry.
MOZ_ALWAYS_INLINE int64_t CallTail(ICCtx& ctx, JSContext* cx,
                                   BaselineFrame* frame, StackVal* sp,
                                   JSFunction* func, Entry* e, uint32_t j0,
                                   uint32_t icIdx0, uint32_t argc,
                                   uint32_t undefArgs, uint32_t totalArgs,
                                   bool constructing, bool needEnv,
                                   bool retRval0, bool aliased,
                                   uint32_t nfixed, jsbytecode* calleePC,
                                   JSScript* cScript, uint64_t epoch) {
  // Fast path steps 0-8 (no GC, no VM calls from here on).
  StackVal* origArgs = sp;
  StackVal* exitFP = ctx.stack.pushExitFrame(sp, frame);
  if (!exitFP) MOZ_CRASH("PBLBC: exit frame after stack check");
  sp = exitFP;
  PUSHNATIVE(StackValNative(nullptr));
  // Padding first (highest addresses: argv[argc .. nargs-1]), then the actual
  // args and this; the descriptor below keeps the actual argc.
  for (uint32_t i = 0; i < undefArgs; i++) {
    *--sp = StackVal(UndefinedValue());
  }
  for (uint32_t i = 0; i < totalArgs - undefArgs; i++) {
    *--sp = origArgs[i];
  }
  PUSHNATIVE(StackValNative(CalleeToToken(func, constructing)));
  PUSHNATIVE(StackValNative(
      MakeFrameDescriptorForJitCall(FrameType::BaselineStub, argc)));
  PUSHNATIVE(StackValNative(nullptr));
  BaselineFrame* newFrame = ctx.stack.pushFrame(sp, cx, func->environment());
  if (!newFrame) MOZ_CRASH("PBLBC: callee frame after stack check");
  ctx.frameMgr.switchToFrame(newFrame);
  ctx.frame = newFrame;
  sp = reinterpret_cast<StackVal*>(newFrame);
  for (uint32_t i = 0; i < nfixed; i++) {
    *--sp = StackVal(UndefinedValue());
  }
  gDirectPushes++;
  if (needEnv) {
    // Fast path step 9: PUSH_EXIT_FRAME in the callee frame at its pc 0,
    // InitFunctionEnvironmentObjects (can GC: func/calleeScript are reloaded
    // from the frame). On failure the interpreter takes its error path in
    // the callee frame at pc 0, exactly where the fast path's GOTO_ERROR is.
    newFrame->interpreterPC() = calleePC;
    bool ok;
    {
      VMFrame vcx(ctx.frameMgr, ctx.stack, sp);
      if (!vcx.success()) MOZ_CRASH("PBLBC: env exit frame after stack check");
      ok = js::InitFunctionEnvironmentObjects(vcx, newFrame);
    }
    JSScript* calleeScript = newFrame->script();
    cScript = nullptr;  // InitFunctionEnvironmentObjects can GC
    calleePC = calleeScript->code();
    if (!ok || cx->hasAnyPendingInterrupt()) {
      if (!ok) ctx.error = PBIResult::Error;
      gDs[kDsEnvObjects]++;
      tSwitch.frame = newFrame;
      tSwitch.sp = sp;
      tSwitch.pc = calleeScript->code();
      tSwitch.icEntry = newFrame->interpreterICEntry();
      tSwitch.icError = !ok;
      return 1;
    }
  }
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
  // Op 0 is an exit op (PBLBC_ENTRYSWITCH; CallScripted refuses such callees
  // when it is off): the interpreter performs it in the callee frame, as
  // after any switch at pc 0, and Hook re-enters compiled code after it.
  const bool entryExit = e->exitOp[j0] != 0;
  if (depthHit || entryExit ||
      (op0 != JSOp::JumpTarget && op0 != JSOp::LoopHead &&
       newFrame->icScript()->numICEntries() != 0 &&
       calleeIcEntry != calleeIcEntries + icIdx0)) {
    gDs[depthHit ? kDsSwDepth : entryExit ? kDsSwEntryExit : kDsSwIcCursor]++;
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
  // (gRuns is not counted here: it has no reader.)
  tDirectDepth++;
  // func is not used after this call (it can GC).
  uint64_t r = fn(uintptr_t(newFrame), uintptr_t(sp), j0,
                  uintptr_t(calleeIcEntries), uintptr_t(&ctx), uintptr_t(&io),
                  uintptr_t(newFrame->argv()),
                  aliased ? kFlagArgsAliased : 0,
                  0,  // P_GLEX: unused (loaded at each GetGName, can move)
                  uintptr_t(cx->addressOfInterruptBits()), uintptr_t(calleePC),
                  uintptr_t(cx));
  tDirectDepth--;
  r = FixGetterSwitch(r, ctx);
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
  // The cached script stands for newFrame->script() only if no GC happened
  // since the lookup (the callee's code can GC).
  // Only the GC counts are compared: cx (hence cx->runtime()) is fixed for
  // this activation and the per-thread runtime serial in the high bits cannot
  // change while one of its activations is on this thread's stack (see
  // GcEpochHit), so the high part of GcEpoch(cx) is still epoch's.
  JSScript* retScript =
      (cScript && GcEpochLow(cx) == (epoch & kEpochLowMask))
          ? cScript : newFrame->script();
  if (kind == kIcError || newFrame->isDebuggee() ||
      retScript->hasScriptCounts() ||
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
  // The interpreter's return fix-up for New/NewContent: a primitive return
  // value is replaced by the this slot.
  if (constructing && ret.isPrimitive()) ret = sp[nargs + 1].asValue();
  sp += nargs + 2 + (constructing ? 1 : 0);
  *--sp = StackVal(ret);
  gDs[kDsInline]++;
  return int64_t(uintptr_t(sp));
}

// argcIn: GET_ARGC(pc), or the rewritten argc (CallFunCall).
// stackFull: CallFunCall/CallFunApply only; a refusal by one of the two
// stack-space checks returns kRefuseStack (no state changed) instead of 0.
constexpr int64_t kRefuseStack = 2;  // never an sp (StackVal-aligned)
static MOZ_ALWAYS_INLINE int64_t CallScriptedA(int64_t frameA, int64_t spA,
                                               int64_t pcA, int64_t iceA,
                                               int64_t ctxA, int64_t siteA,
                                               uint32_t argcIn,
                                               bool stackFull = false,
                                               bool getterOp = false) {
  auto* site = reinterpret_cast<CallSite*>(uintptr_t(siteA));
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  auto* icEntry = reinterpret_cast<ICEntry*>(uintptr_t(iceA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  JSOp jop = JSOp(*pc);
  // kCovdNewScripted: New/NewContent (constructing) like CASE(Call) with
  // constructing == 1: callee at sp[argc + 2], this at sp[argc + 1], args,
  // newTarget at sp[0].
  const bool superCall = jop == JSOp::SuperCall && gSuperCall;
  const bool constructing =
      (jop == JSOp::New || jop == JSOp::NewContent || superCall) &&
      (gCovd & kCovdNewScripted) && (gCovd & kCovdNew);
  // getterOp (CallGetter): [getter, receiver] (argc 0) pushed at a GetProp
  // whose CallScriptedGetterResult stub passed every guard and check.
  if (!constructing && jop != JSOp::Call && jop != JSOp::CallIgnoresRv &&
      !(getterOp && jop == JSOp::GetProp) &&
      !((gCovd & kCovdCall) &&
        (jop == JSOp::CallContent || jop == JSOp::CallIter ||
         jop == JSOp::CallContentIter))) {
    return Refuse(kDsNotCall);
  }
  if (frame->isDebuggee()) return Refuse(kDsCallerDebuggee);
  // Fast-path checks (same order as the interpreter).
  const uint32_t argc = argcIn;
  StackVal* firstArg = sp + argc + (constructing ? 1 : 0) - 1;
  const Value callee = firstArg[2].asValue();
  if (!callee.isObject() || !callee.toObject().is<JSFunction>()) {
    return Refuse(kDsNotFunction);
  }
  JSFunction* func = &callee.toObject().as<JSFunction>();
  if (!func->hasBaseScript() || !func->isInterpreted()) {
    return Refuse(kDsNotInterpreted);
  }
  if (!constructing && func->isClassConstructor()) {
    return Refuse(kDsClassCtor);
  }
  if (constructing && !func->isConstructor()) return Refuse(kDsClassCtor);
  // Callee cache lookup (key, GC epoch, table generation; see above).
  BaseScript* bscript = func->baseScript();
  CallCacheEntry* ce = nullptr;
  uint64_t epoch = 0;
  if (gCallCache) {
    epoch = GcEpoch(cx);
    CallCacheEntry* c =
        &tCallCache[(uint32_t(uintptr_t(bscript)) >> 4) &
                    ((1u << kCallCacheBits) - 1)];
    if (c->key == bscript && c->epoch == epoch && c->gen == tEntryGen) ce = c;
  }
  JSScript* calleeScript;
  Entry* e;
  uint32_t j0;
  bool needEnv, retRval0;
  if (ce) {
    calleeScript = ce->script;
    // Kept per call: can change without a GC or an Entry change.
    if (!calleeScript->hasJitScript()) return Refuse(kDsNoJitScript);
    if (cx->realm() != ce->realm) return Refuse(kDsRealm);
    if (argc < func->nargs() && (constructing || !gPadArgs))
      return Refuse(kDsUnderflow);
    needEnv = ce->needEnv;
  } else {
    if (!bscript->hasBytecode()) return Refuse(kDsNoBytecode);
    calleeScript = bscript->asJSScript();
    if (!calleeScript->hasJitScript()) return Refuse(kDsNoJitScript);
    if (cx->realm() != calleeScript->realm()) return Refuse(kDsRealm);
    if (argc < func->nargs() && (constructing || !gPadArgs))
      return Refuse(kDsUnderflow);
    needEnv = func->needsFunctionEnvironmentObjects();
  }
  // Missing formals pushed as undefined (non-constructing, PBLBC_PADARGS).
  const uint32_t undefArgs =
      (!constructing && argc < func->nargs()) ? func->nargs() - argc : 0;
  // Includes newTarget when constructing (excludes the callee) and the
  // padding.
  const uint32_t totalArgs = argc + undefArgs + 1 + (constructing ? 1 : 0);
  // newTarget must be the callee itself: re-running CreateThis in the
  // interpreter (the state-changed exit below) is then unobservable (a
  // scripted function's prototype is a plain data property); an arbitrary
  // newTarget (e.g. a Proxy with a get trap) could observe it.
  // SuperCall: newTarget is the frame's new.target, normally a different
  // function; SuperNewTargetOk limits it to non-self-hosted interpreted
  // constructors, whose own "prototype" is a non-configurable data property
  // (so CreateThis's lookup is unobservable as well).
  if (constructing && (!sp[0].asValue().isObject() ||
                       (&sp[0].asValue().toObject() != func &&
                        !(superCall && SuperNewTargetOk(sp[0].asValue()))))) {
    return Refuse(kDsNotFunction);
  }
  if (!ctx.stack.checkJS(sp, sizeof(StackVal) * (totalArgs + 3))) {
    Refuse(kDsStack);
    return stackFull ? kRefuseStack : 0;
  }
  // Extra: steps 9-12 of the fast path must be no-ops, and step 7 (callee
  // stack space, which would throw over-recursion) must pass. The space for
  // the exit frame (4 words + ExitFrameType), stub slot, args, token,
  // descriptor, fake return address and saved fp is added conservatively.
  if (needEnv && !(gCovd & kCovdEnv)) return Refuse(kDsEnvObjects);
  if (calleeScript->isDebuggee()) return Refuse(kDsCalleeDebuggee);
  if (calleeScript->hasScriptCounts() || cx->realm()->collectCoverageForDebug())
    return Refuse(kDsCounts);
  if (cx->hasAnyPendingInterrupt()) return Refuse(kDsInterrupt);
  // needEnv: the second exit frame (VMFrame in the callee frame, 4 words,
  // checked without margin) is pushed below the callee's nfixed slots; it is
  // added explicitly on top of the first exit frame (4 words), stub slot,
  // args, token, descriptor, return address and saved fp (totalArgs + 8).
  const uint32_t nslots = ce ? ce->nslots : calleeScript->nslots();
  if (!ctx.stack.checkJS(sp, sizeof(StackVal) * (totalArgs + 16 +
                                                 (needEnv ? 4 : 0)) +
                                 BaselineFrame::Size() +
                                 sizeof(StackVal) * nslots)) {
    Refuse(kDsCalleeStack);
    return stackFull ? kRefuseStack : 0;
  }
  if (ce) {
    // The Entry for this script data is unchanged (generation), but the
    // script's data pointer is re-validated anyway.
    if (calleeScript->immutableScriptData() != ce->isd) {
      ce = nullptr;
      return Refuse(kDsNotCompiled);
    }
    e = ce->e;
    j0 = ce->j0;
    retRval0 = ce->retRval0;
  } else {
    // The callee must have compiled code enterable at op 0.
    e = FindExisting(calleeScript->immutableScriptData());
    if (!e || e->state != 1) return Refuse(kDsNotCompiled);
    j0 = e->opAt[0];
    // An exit op at op 0: RetRval (e.g. an empty function's whole body) is
    // performed below without entering compiled code; any other exit op is
    // pushed and switched to the interpreter at pc 0 in CallTail
    // (PBLBC_ENTRYSWITCH), or refused when that is off.
    retRval0 = JSOp(*calleeScript->code()) == JSOp::RetRval;
    if (j0 == 0xffff || (e->exitOp[j0] && !retRval0)) {
      gEntryExitOp[j0 == 0xffff ? 256 : uint8_t(*calleeScript->code())]++;
      if (j0 == 0xffff || !gEntrySwitch) return Refuse(kDsEntryExit);
    }
    if (gCallCache) {
      CallCacheEntry* c =
          &tCallCache[(uint32_t(uintptr_t(bscript)) >> 4) &
                      ((1u << kCallCacheBits) - 1)];
      c->key = bscript;
      c->epoch = epoch;
      c->gen = tEntryGen;
      c->j0 = j0;
      c->script = calleeScript;
      c->realm = calleeScript->realm();
      c->isd = calleeScript->immutableScriptData();
      c->e = e;
      c->code = calleeScript->code();
      c->nfixed = calleeScript->nfixed();
      c->nslots = calleeScript->nslots();
      c->needEnv = needEnv;
      c->retRval0 = retRval0;
    }
  }
  // Every precondition passed: fill the call site (PBLBC_SITECACHE). Nothing
  // could have GC'd since the checks above.
  if (site && (site->calleeBits == 0 || site->refills < kSiteMaxRefills)) {
    if (site->calleeBits && site->calleeBits != callee.asRawBits())
      site->refills++;
    gSiteFills++;
    site->calleeBits = callee.asRawBits();
    site->epoch = gCallCache ? epoch : GcEpoch(cx);
    site->gen = tEntryGen;
    site->j0 = j0;
    site->func = func;
    site->script = calleeScript;
    site->realm = calleeScript->realm();
    site->isd = calleeScript->immutableScriptData();
    site->e = e;
    site->code = calleeScript->code();
    site->fn = e->fn;
    site->icIdx0 = e->icIdx[j0];
    site->nfixed = calleeScript->nfixed();
    site->argc = argc;
    site->undefArgs = undefArgs;
    site->totalArgs = totalArgs;
    site->stackBytes = uint32_t(sizeof(StackVal) * (totalArgs + 16 +
                                                    (needEnv ? 4 : 0)) +
                                BaselineFrame::Size() +
                                sizeof(StackVal) * nslots);
    site->constructing = constructing;
    site->needEnv = needEnv;
    site->retRval0 = retRval0;
    site->aliased = calleeScript->argsObjAliasesFormals();
    site->thisCacheOk =
        gThisCache && !func->constructorNeedsUninitializedThis();
    site->superCall = superCall;
    site->uninitThis = func->constructorNeedsUninitializedThis();
  }
  // Copies of the cached values (the cache slot can be overwritten by nested
  // calls); only used while nothing could have GC'd (useCached).
  bool useCached = ce != nullptr;
  JSScript* cScript = useCached ? ce->script : nullptr;
  jsbytecode* cCode = useCached ? ce->code : nullptr;
  const uint32_t cNfixed = useCached ? ce->nfixed : 0;

  // Constructing: CreateThis when the this slot is not an object, like the
  // fast path (exit frame at the caller's sp, AutoKeepJitScripts). It can
  // GC (func/calleeScript/e are re-read from the rooted stack slots and
  // re-checked; if anything changed, the this slot is restored and the op
  // exits with nothing pushed) and fail: then the interpreter takes its
  // error path at the New op in the caller frame (no callee frame exists
  // yet), exactly where the fast path's GOTO_ERROR is.
  frame->interpreterPC() = pc;
  frame->interpreterICEntry() = icEntry;
  PlainObject* fastThis = nullptr;
  // superDone: SuperCall whose |this| needs no CreateThis call (derived
  // callee: the uninitialized-lexical magic, CreateThis's first step).
  bool superDone = false;
  if (MOZ_UNLIKELY(superCall)) {
    if (!firstArg[1].asValue().isObject()) {
      if (func->constructorNeedsUninitializedThis()) {
        firstArg[1] = StackVal(MagicValue(JS_UNINITIALIZED_LEXICAL));
        superDone = true;
      } else if (gThisCache) {
        JSFunction* ntf = &sp[0].asValue().toObject().as<JSFunction>();
        fastThis = ntf == func
                       ? ThisCacheTryCreate(cx, func, calleeScript)
                       : SuperThisCacheTryCreate(cx, func, calleeScript, ntf);
        if (fastThis) firstArg[1] = StackVal(ObjectValue(*fastThis));
      }
    }
  } else if (constructing && !firstArg[1].asValue().isObject() &&
             gThisCache && !func->constructorNeedsUninitializedThis()) {
    // Cache hit: allocated without GC (nothing to re-read).
    fastThis = ThisCacheTryCreate(cx, func, calleeScript);
    if (fastThis) firstArg[1] = StackVal(ObjectValue(*fastThis));
  }
  if (constructing && !superDone && !firstArg[1].asValue().isObject()) {
    const Value origThis = firstArg[1].asValue();
    bool ok;
    {
      VMFrame vcx(ctx.frameMgr, ctx.stack, sp);
      if (!vcx.success()) MOZ_CRASH("PBLBC: ctor exit frame after stack check");
      JS::Rooted<JSFunction*> rfun(vcx, func);
      JS::Rooted<JSObject*> rnt(vcx, &sp[0].asValue().toObject());
      AutoKeepJitScripts keepJitScript(vcx);
      ok = js::CreateThis(vcx, rfun, rnt, GenericObject,
                          Stack::handleMut(firstArg + 1));
    }
    if (!ok) {
      ctx.error = PBIResult::Error;
      gDs[kDsCtorError]++;
      tSwitch.frame = frame;
      tSwitch.sp = sp;
      tSwitch.pc = pc;
      tSwitch.icEntry = icEntry;
      tSwitch.icError = true;
      return 1;
    }
    // Re-read everything that can have moved or changed.
    func = &firstArg[2].asValue().toObject().as<JSFunction>();
    Entry* e2 = nullptr;
    bool same = func->hasBaseScript() && func->baseScript()->hasBytecode();
    if (same) {
      calleeScript = func->baseScript()->asJSScript();
      same = calleeScript->hasJitScript() && !cx->hasAnyPendingInterrupt() &&
             !calleeScript->isDebuggee() && !calleeScript->hasScriptCounts();
    }
    if (same) {
      e2 = FindExisting(calleeScript->immutableScriptData());
      same = e2 == e && e2->state == 1 && e2->opAt[0] == j0;
    }
    if (!same) {
      firstArg[1] = StackVal(origThis);
      return Refuse(kDsCtorChanged);
    }
    if (gThisCache && firstArg[1].asValue().isObject()) {
      JSObject* nto = &sp[0].asValue().toObject();
      if (nto == func) {
        ThisCacheFill(cx, func, calleeScript,
                      &firstArg[1].asValue().toObject());
      } else if (superCall) {
        SuperThisCacheFill(cx, func, calleeScript, &nto->as<JSFunction>(),
                           &firstArg[1].asValue().toObject());
      }
    }
    useCached = false;  // CreateThis can GC: re-derive from calleeScript
  }

  const uint32_t nfixedT = useCached ? cNfixed : calleeScript->nfixed();
  jsbytecode* calleePCT = useCached ? cCode : calleeScript->code();
  return CallTail(ctx, cx, frame, sp, func, e, j0, e->icIdx[j0], argc,
                  undefArgs, totalArgs, constructing, needEnv, retRval0,
                  calleeScript->argsObjAliasesFormals(), nfixedT, calleePCT,
                  useCached ? cScript : nullptr, epoch);
}

int64_t CallScripted(int64_t frameA, int64_t spA, int64_t pcA, int64_t iceA,
                     int64_t ctxA, int64_t siteA) {
  return CallScriptedA(frameA, spA, pcA, iceA, ctxA, siteA,
                       GET_ARGC(reinterpret_cast<jsbytecode*>(uintptr_t(pcA))));
}

// The operands at sp are the original (restored) ones. Exit frame at sp with
// interpreterPC = pc (as for the IC), ReportOverRecursed, then the
// interpreter's error path at this op (ctx.error, tSwitch with icError).
// Returns 0 (refuse: the IC runs as before) only if the exit frame cannot be
// pushed (not expected: every frame and operand growth was checked with
// kStackMargin plus the reserve).
static int64_t DirectOverRecursed(ICCtx& ctx, int64_t frameA, StackVal* sp,
                                  int64_t pcA, int64_t iceA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  auto* icEntry = reinterpret_cast<ICEntry*>(uintptr_t(iceA));
  frame->interpreterPC() = pc;
  frame->interpreterICEntry() = icEntry;
  {
    VMFrame vcx(ctx.frameMgr, ctx.stack, sp);
    if (!vcx.success()) return 0;
    ReportOverRecursed(vcx);
  }
  ctx.error = PBIResult::Error;
  tSwitch.frame = frame;
  tSwitch.sp = sp;
  tSwitch.pc = pc;
  tSwitch.icEntry = icEntry;
  tSwitch.icError = true;
  return 1;
}

int64_t CallFunCall(int64_t frameA, int64_t spA, int64_t pcA, int64_t iceA,
                    int64_t ctxA, int64_t siteA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  const JSOp jop = JSOp(*pc);
  if (jop != JSOp::Call && jop != JSOp::CallIgnoresRv &&
      jop != JSOp::CallContent) {
    return 0;
  }
  const uint32_t argc = GET_ARGC(pc);
  const Value callee = sp[argc + 1].asValue();
  if (!callee.isObject() || !callee.toObject().is<JSFunction>()) return 0;
  JSFunction* cf = &callee.toObject().as<JSFunction>();
  if (!cf->isNativeFun() || cf->native() != js::fun_call) return 0;
  if (cf->realm() != cx->realm()) {
    gFcRefused++;
    return 0;
  }
  const Value target = sp[argc].asValue();
  if (!target.isObject() || !target.toObject().is<JSFunction>()) {
    gFcRefused++;
    return 0;
  }
  JSFunction* tf = &target.toObject().as<JSFunction>();
  if (!tf->hasBaseScript() || !tf->isInterpreted() ||
      tf->isClassConstructor()) {
    gFcRefused++;
    return 0;
  }
  // Rewrite: [fun_call, f, t, a1..an] -> [f, t, a1..an] one slot up
  // (argc - 1 args), or [fun_call, f] -> [f, undefined] (argc 0 stays 0).
  const StackVal saved = sp[argc + 1];
  StackVal* nsp;
  uint32_t nargc;
  if (argc == 0) {
    sp[1] = sp[0];
    sp[0] = StackVal(UndefinedValue());
    nsp = sp;
    nargc = 0;
  } else {
    memmove(sp + 1, sp, sizeof(StackVal) * (argc + 1));
    nsp = sp + 1;
    nargc = argc - 1;
  }
  int64_t r = CallScriptedA(frameA, int64_t(uintptr_t(nsp)), pcA, iceA, ctxA,
                            0, nargc, /* stackFull = */ true);
  if (r == 0 || r == kRefuseStack) {
    // Non-constructing refusals happen before anything that can GC: the
    // saved callee Value is still valid.
    if (argc == 0) {
      sp[0] = sp[1];
    } else {
      memmove(sp, sp + 1, sizeof(StackVal) * (argc + 1));
    }
    sp[argc + 1] = saved;
    if (r == kRefuseStack) {
      gFcOverRec++;
      return DirectOverRecursed(ctx, frameA, sp, pcA, iceA);
    }
    gFcRefused++;
    return 0;
  }
  gFcDirect++;
  return r;
}

int64_t CallFunApply(int64_t frameA, int64_t spA, int64_t pcA, int64_t iceA,
                     int64_t ctxA, int64_t siteA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  const JSOp jop = JSOp(*pc);
  if (jop != JSOp::Call && jop != JSOp::CallIgnoresRv &&
      jop != JSOp::CallContent) {
    return 0;
  }
  const uint32_t argc = GET_ARGC(pc);
  if (argc > 2) return 0;
  const Value callee = sp[argc + 1].asValue();
  if (!callee.isObject() || !callee.toObject().is<JSFunction>()) return 0;
  JSFunction* cf = &callee.toObject().as<JSFunction>();
  if (!cf->isNativeFun() || cf->native() != js::fun_apply) return 0;
  if (cf->realm() != cx->realm()) {
    gFaRefused++;
    return 0;
  }
  const Value target = sp[argc].asValue();
  if (!target.isObject() || !target.toObject().is<JSFunction>()) {
    gFaRefused++;
    return 0;
  }
  JSFunction* tf = &target.toObject().as<JSFunction>();
  if (!tf->hasBaseScript() || !tf->isInterpreted() ||
      tf->isClassConstructor()) {
    gFaRefused++;
    return 0;
  }
  const Value thisv = argc >= 1 ? sp[argc - 1].asValue() : UndefinedValue();
  const Value arg = argc >= 2 ? sp[argc - 2].asValue() : UndefinedValue();
  // Raw pointers below: nothing can GC until CallScriptedA's refusals are
  // over (the elements are on the operand stack by then).
  ArgumentsObject* ao = nullptr;
  const Value* elems = nullptr;
  uint32_t n = 0;
  if (arg.isNullOrUndefined()) {
    n = 0;
  } else if (arg.isObject() && arg.toObject().is<ArgumentsObject>()) {
    ao = &arg.toObject().as<ArgumentsObject>();
    if (ao->hasOverriddenElement() || ao->anyArgIsForwarded() ||
        ao->hasOverriddenLength() ||
        ao->initialLength() > JIT_ARGS_LENGTH_MAX) {
      gFaRefused++;
      return 0;
    }
    n = ao->initialLength();
  } else if (arg.isObject() && IsPackedArray(&arg.toObject())) {
    ArrayObject* arr = &arg.toObject().as<ArrayObject>();
    if (arr->length() > JIT_ARGS_LENGTH_MAX ||
        arr->getDenseInitializedLength() != arr->length()) {
      gFaRefused++;
      return 0;
    }
    n = arr->length();
    elems = arr->getDenseElements();
  } else {
    gFaRefused++;
    return 0;
  }
  // New operands [target, thisv, e0..e(n-1)] end at sp + argc + 2.
  StackVal* nsp = sp + int32_t(argc) - int32_t(n);
  if (nsp < sp &&
      !ctx.stack.checkJS(sp, sizeof(StackVal) * size_t(sp - nsp))) {
    // Nothing rewritten yet.
    gFaOverRec++;
    return DirectOverRecursed(ctx, frameA, sp, pcA, iceA);
  }
  uint64_t saved[4];
  for (uint32_t i = 0; i < argc + 2; i++) saved[i] = sp[i].asUInt64();
  nsp[n + 1] = StackVal(target);
  nsp[n] = StackVal(thisv);
  for (uint32_t i = 0; i < n; i++) {
    // ArgumentsObject::arg: element(i) without forwarding (refused above;
    // a deleted element sets the overridden-element flag).
    nsp[n - 1 - i] = StackVal(ao ? ao->arg(i) : elems[i]);
  }
  int64_t r = CallScriptedA(frameA, int64_t(uintptr_t(nsp)), pcA, iceA, ctxA,
                            0, n, /* stackFull = */ true);
  if (r == 0 || r == kRefuseStack) {
    // Non-constructing refusals happen before anything that can GC.
    for (uint32_t i = 0; i < argc + 2; i++) sp[i] = StackVal(saved[i]);
    if (r == kRefuseStack) {
      gFaOverRec++;
      return DirectOverRecursed(ctx, frameA, sp, pcA, iceA);
    }
    gFaRefused++;
    return 0;
  }
  gFaDirect++;
  return r;
}

int64_t CallGetter(int64_t frameA, int64_t spA, int64_t pcA, int64_t iceA,
                   int64_t ctxA, int64_t siteA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  // Nothing can GC between the IC's return and the push below.
  JSFunction* fn = static_cast<JSFunction*>(ctx.getterFn);
  const Value recv = Value::fromRawBits(ctx.getterRecv);
  ICCacheIRStub* stub = static_cast<ICCacheIRStub*>(ctx.getterStub);
  ctx.getterFn = nullptr;
  ctx.getterStub = nullptr;
  StackVal* nsp = sp - 2;
  int64_t r = kRefuseStack;
  if (ctx.stack.checkJS(sp, sizeof(StackVal) * 2)) {
    nsp[1] = StackVal(ObjectValue(*fn));
    nsp[0] = StackVal(recv);
    r = CallScriptedA(frameA, int64_t(uintptr_t(nsp)), pcA, iceA, ctxA, 0, 0,
                      /* stackFull = */ true, /* getterOp = */ true);
  }
  if (r == kRefuseStack) {
    gGtOverRec++;
    // 0 only if its exit frame cannot be pushed (no GC): run nested below.
    if (int64_t o = DirectOverRecursed(ctx, frameA, sp, pcA, iceA)) return o;
  } else if (r != 0) {
    gGtDirect++;
    return r;
  } else {
    gGtRefused++;
  }
  // Non-constructing refusals happen before anything that can GC: fn, recv
  // and stub are still valid.
  uint64_t v = ScriptedGetterNested(ctx, fn, recv, stub);
  if (v == IC_ERROR_SENTINEL()) return 0;  // the op's kIcError exit
  *--sp = StackVal(Value::fromRawBits(v));
  return int64_t(uintptr_t(sp));
}

int64_t GetterCallOOL(int64_t frameA, int64_t spA, int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  int64_t pcA = int64_t(uintptr_t(frame->interpreterPC()));
  int64_t iceA = int64_t(uintptr_t(frame->interpreterICEntry()));
  int64_t r = CallGetter(frameA, spA, pcA, iceA, ctxA, 0);
  if (r == 1) return int64_t(PBL_GETTER_SENTINEL());
  if (r == 0) return int64_t(IC_ERROR_SENTINEL());
  // r: the sp after the value push; the caller's sp (spA) is r + 1.
  MOZ_ASSERT(uintptr_t(r) + sizeof(StackVal) == uintptr_t(spA));
  return int64_t(reinterpret_cast<StackVal*>(uintptr_t(r))->asUInt64());
}

// PBLBC_SITECACHE hit: the callee Value's bits equal site->calleeBits.
// Re-validates only what can change while the callee function object stays
// the same; on any failure it behaves exactly like the full path (stale site
// identity: the site is emptied first, so the generated code's own pre-checks
// run again next time; an empty site has epoch 0 which never equals GcEpoch,
// so a callee Value of +0.0 matching calleeBits == 0 also lands here).
//
// Fixed per (site, function), not re-checked here:
//  - opcode kind / constructing / argc: the site is one bytecode op (sites
//    are per Entry = per ImmutableScriptData, i.e. the same bytecode).
//  - JSObject class / isInterpreted / hasBaseScript: same object (no GC: not
//    moved or finalized); a function's BASESCRIPT flag is only cleared by
//    self-hosted relazification, which happens during GC (epoch).
//  - isClassConstructor / isConstructor / nargs: FunctionFlags bits and arg
//    count set at function creation, never changed afterwards.
//  - callee realm: the callee script's realm (script == func->baseScript()
//    re-checked). The CALLER realm is NOT fixed per site: Entries are keyed
//    by ImmutableScriptData, which is shared by identical scripts in
//    different realms, so cx->realm() == site->realm stays a per-call check.
//  - undefArgs / totalArgs: functions of argc, nargs, constructing, gPadArgs.
//  - needEnv, argsObjAliasesFormals, constructorNeedsUninitializedThis:
//    immutable script flags of the (re-checked) script.
//  - j0 / e / fn / icIdx0 / retRval0: Entry data; tEntryGen unchanged and
//    an Entry in state 1 never changes. nfixed / nslots / code: the
//    ImmutableScriptData (re-checked).
MOZ_ALWAYS_INLINE uint64_t GcEpochHit(ICCtx& ctx, JSContext* cx) {
  // Same value as GcEpoch(cx), with the runtime-identity part (high 16 bits:
  // per-thread runtime serial) computed once per interpreter activation and
  // kept in ctx.pblEpochHi (0 = not yet computed; a serial is never 0).
  // Why it cannot change during the activation: an ICCtx lives on the C++
  // stack of one PortableBaselineInterpret activation and is used only with
  // its own cx, whose runtime is fixed for the context's lifetime. The serial
  // only moves when GcEpoch runs on this thread with a different runtime
  // address or GC-statistics creation time. The runtime cannot be destroyed
  // (and a new one created at its address) while an activation of it is on
  // this thread's stack, its stats creation time is set once at
  // construction, and a thread runs a single JSContext (TlsContext), so no
  // other runtime can run GcEpoch on this thread before the activation ends.
  // Hence the high part is still the one GcEpoch(cx) would compute; the GC
  // counts are read fresh on every call.
  if (MOZ_UNLIKELY(ctx.pblEpochHi == 0)) {
    ctx.pblEpochHi = GcEpoch(cx) & ~kEpochLowMask;
  }
  return ctx.pblEpochHi + GcEpochLow(cx);
}
int64_t CallScriptedHit(int64_t frameA, int64_t spA, int64_t pcA,
                        int64_t iceA, int64_t ctxA, int64_t siteA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* site = reinterpret_cast<CallSite*>(uintptr_t(siteA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  const uint64_t epoch = GcEpochHit(ctx, cx);
  JSFunction* func = site->func;
  JSScript* calleeScript = site->script;
  if (MOZ_UNLIKELY(site->epoch != epoch || site->gen != tEntryGen ||
                   func->baseScript() != calleeScript ||
                   calleeScript->immutableScriptData() != site->isd)) {
    site->calleeBits = 0;
    gSiteStale++;
    return CallScripted(frameA, spA, pcA, iceA, ctxA, siteA);
  }
  if (MOZ_UNLIKELY(!calleeScript->hasJitScript() ||
                   cx->realm() != site->realm || frame->isDebuggee() ||
                   calleeScript->isDebuggee() ||
                   calleeScript->hasScriptCounts() ||
                   cx->realm()->collectCoverageForDebug() ||
                   cx->hasAnyPendingInterrupt() ||
                   !ctx.stack.checkJS(sp, site->stackBytes))) {
    gSiteRecheck++;
    return CallScripted(frameA, spA, pcA, iceA, ctxA, siteA);
  }
  const bool constructing = site->constructing;
  const uint32_t argc = site->argc;
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  auto* icEntry = reinterpret_cast<ICEntry*>(uintptr_t(iceA));
  if (constructing) {
    // newTarget must be the callee itself (same object <=> same bits), or
    // for SuperCall an allowed new.target (see CallScriptedA).
    StackVal* thisSlot = sp + argc + 1;  // firstArg[1] of the full path
    if (MOZ_LIKELY(sp[0].asValue().asRawBits() == site->calleeBits)) {
      if (!thisSlot->asValue().isObject()) {
        // Last check (allocates): only the NoGC |this| cache; anything else
        // takes the full path (CreateThis).
        PlainObject* fastThis =
            site->thisCacheOk ? ThisCacheTryCreate(cx, func, calleeScript)
                              : nullptr;
        if (!fastThis) {
          return CallScripted(frameA, spA, pcA, iceA, ctxA, siteA);
        }
        *thisSlot = StackVal(ObjectValue(*fastThis));
      }
    } else {
      // Only SuperCall sites reach here with an allowed newTarget.
      if (!site->superCall || !SuperNewTargetOk(sp[0].asValue())) {
        return CallScripted(frameA, spA, pcA, iceA, ctxA, siteA);
      }
      if (!thisSlot->asValue().isObject()) {
        if (site->uninitThis) {
          // Derived callee: CreateThis only stores this magic value.
          *thisSlot = StackVal(MagicValue(JS_UNINITIALIZED_LEXICAL));
        } else {
          PlainObject* fastThis =
              site->thisCacheOk
                  ? SuperThisCacheTryCreate(
                        cx, func, calleeScript,
                        &sp[0].asValue().toObject().as<JSFunction>())
                  : nullptr;
          if (!fastThis) {
            return CallScripted(frameA, spA, pcA, iceA, ctxA, siteA);
          }
          *thisSlot = StackVal(ObjectValue(*fastThis));
        }
      }
    }
  }
  frame->interpreterPC() = pc;
  frame->interpreterICEntry() = icEntry;
  return CallTail(ctx, cx, frame, sp, func, site->e, site->j0, site->icIdx0,
                  argc, site->undefArgs, site->totalArgs, constructing,
                  site->needEnv, site->retRval0, site->aliased, site->nfixed,
                  site->code, calleeScript, epoch);
}

// Called at a DISPATCH with the hook pending (not a debuggee frame).
int Hook(BaselineFrame* frame, StackVal* sp, jsbytecode* pc,
         jsbytecode* entryPC, ImmutableScriptData* isd, ICEntry* icEntries,
         ICEntry* icEntry, bool argsObjAliasesFormals, ICCtx& ctx,
         Out* out, Entry* known) {
  // known: the compiled Entry TrampEntryReady found for this frame at op 0
  // (state 1, op 0 enterable, isd matches); skips the second lookup.
  Entry* e;
  if (known) {
    MOZ_ASSERT(known->isd == isd && known->state == 1);
    e = tLast = known;
  } else {
    e = Find(isd);
  }
  if (!e || e->state == 2) return kNone;
  if (e->state == 0) {
    if (++e->hits < gHits) return kNone;
    JSScript* script = frame->script();
    if (script->hasScriptCounts() || script->immutableScriptData() != isd) {
      return kNone;
    }
    Compile(e, script, ctx.frameMgr.cxForLocalUseOnly(), ctx, icEntries,
            frame->icScript()->numICEntries());
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
                  0,  // P_GLEX: unused (loaded at each GetGName, can move)
                  uintptr_t(cx->addressOfInterruptBits()), uintptr_t(entryPC),
                  uintptr_t(cx));
  r = FixGetterSwitch(r, ctx);
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

// PBLBC_TRAMPENTRY gate, called once at the start of a (non-restart)
// interpreter run after its prologue, with pc at op 0. True when Hook would
// enter compiled code at op 0 without compiling or counting a hit: the Entry
// exists and is compiled, op 0 maps to an op index that is not an exit op,
// and the script has no script counts. Hook itself re-checks everything
// (IC cursor, debuggee via bc_hook) and may still return kPending/kNone,
// after which the interpreter runs op 0 as before. Null leaves the old
// path untouched (Hook at op 1, counting hits / compiling there); otherwise
// returns the Entry, which the caller passes to that Hook call.
Entry* TrampEntryReady(BaselineFrame* frame, jsbytecode* pc,
                       ImmutableScriptData* isd) {
  if (!gTrampEntry) return nullptr;
  JSScript* script = frame->script();
  Entry* e = FindExisting(isd);
  bool ok = e && e->state == 1 && pc == script->code() &&
            script->immutableScriptData() == isd &&
            !script->hasScriptCounts() && !frame->isDebuggee() &&
            e->opAt[0] != 0xffff && !e->exitOp[e->opAt[0]];
  if (MOZ_UNLIKELY(gExitStat)) (ok ? gTeDirect : gTeFallback)++;
  return ok ? e : nullptr;
}

// PBLBC_NATENTRY gate before any frame exists: the script-level part of
// TrampEntryReady (the frame-level checks run again after the prologue).
bool NatEntryReady(JSScript* script, ImmutableScriptData* isd) {
  if (!gNatEntry || !gTrampEntry) return false;
  Entry* e = FindExisting(isd);
  return e && e->state == 1 && script->immutableScriptData() == isd &&
         !script->hasScriptCounts() && !script->isDebuggee() &&
         e->opAt[0] != 0xffff && !e->exitOp[e->opAt[0]];
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
  if (e->exitOp[k] == 2) {  // PBLBC_VSTACK: not a dispatch entry
    return int64_t((uint64_t(0x80000000u | off)) << 32 |
                   uint32_t(uintptr_t(jx.sp)));
  }
  return int64_t((uint64_t(k) + 1) << 32 | uint32_t(uintptr_t(jx.sp)));
}

// CASE(Add), HybridICs path, after its int32/number fast paths (which the
// compiled code ran inline): root both operands in their stack slots, push the
// exit frame at sp with interpreterPC = pc (PUSH_EXIT_FRAME), AddOperation,
// pop, and the caller pops rhs. A failed AddOperation sets ctx.error like
// PUSH_IC_FRAME and returns kHelperError: the compiled code returns kIcError
// with sp unchanged, so the interpreter goes ic_fail -> RESTART -> error with
// the same sp, pc and IC cursor as the op's own GOTO_ERROR. If the exit frame
// cannot be pushed, nothing changed and the interpreter runs the op itself.
int64_t AddHelper(int64_t frameA, int64_t spA, int64_t pcA, int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  MutableHandleValue lhs = Stack::handleMut(&sp[1]);
  MutableHandleValue rhs = Stack::handleMut(&sp[0]);
  MutableHandleValue result = Stack::handleMut(&sp[1]);
  frame->interpreterPC() = pc;
  VMFrame cx(ctx.frameMgr, ctx.stack, sp);
  if (!cx.success()) return kHelperNotHandled;
  if (!AddOperation(cx, lhs, rhs, result)) {
    ctx.error = PBIResult::Error;
    return kHelperError;
  }
  return kHelperOk;
}

// CASE(InitElemArray): pop val, root it and the array in State (as the
// interpreter does), exit frame at the popped sp, InitElemArrayOperation
// (infallible). The caller pops val.
int64_t InitElemArrayHelper(int64_t frameA, int64_t spA, int64_t pcA,
                            int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  if (gAlloc & kAllocInitElem) {
    // InitElemArrayOperation (Interpreter-inl.h) only bumps the initialized
    // length (growing: prepareElementRangeForOverwrite has an empty range, no
    // pre-barrier) and does initDenseElementHole / initDenseElement (HeapSlot
    // init: post-barrier into the store buffer, whose overflow only requests
    // a minor GC through the interrupt). It cannot GC, fail or report, so no
    // exit frame or rooting is needed; the handles point at locals that stay
    // valid for the call.
    frame->interpreterPC() = pc;
    ArrayObject* arr = &sp[1].asValue().toObject().as<ArrayObject>();
    Value val = sp[0].asValue();
    InitElemArrayOperation(ctx.frameMgr.cxForLocalUseOnly(), pc,
                           Handle<ArrayObject*>::fromMarkedLocation(&arr),
                           HandleValue::fromMarkedLocation(&val));
    return kHelperOk;
  }
  {
    ReservedRooted<Value> value0(&ctx.state.value0, sp[0].asValue());
    ReservedRooted<JSObject*> obj0(&ctx.state.obj0, &sp[1].asValue().toObject());
    {
      frame->interpreterPC() = pc;
      VMFrame cx(ctx.frameMgr, ctx.stack, sp + 1);
      if (!cx.success()) return kHelperNotHandled;
      InitElemArrayOperation(cx, pc, obj0.as<ArrayObject>(), value0);
    }
  }
  return kHelperOk;
}

// CASE(SetAliasedVar): obj.setAliasedBinding(ec, sp[0]) on the environment
// getEnvironmentFromCoordinate finds (setSlot: pre- and post-barrier).
int64_t SetAliasedVarHelper(int64_t frameA, int64_t spA, int64_t pcA,
                            int64_t) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  EnvironmentCoordinate ec = EnvironmentCoordinate(pc);
  EnvironmentObject& obj = getEnvironmentFromCoordinate(frame, ec);
  MOZ_ASSERT(!IsUninitializedLexical(obj.aliasedBinding(ec)));
  obj.setAliasedBinding(ec, sp[0].asValue());
  return kHelperOk;
}

// PBLBC_ALLOC fast paths: no exit frame, cannot GC. They mirror the CanGC
// engine paths exactly and return nullptr (caller takes the unchanged slow
// path) whenever those would do anything but a default-heap nursery
// allocation with no extra work.

// Access to NativeObject::initSlots (protected) through a pointer to member
// named via a derived class; called on the real NativeObject.
struct PblNativeAccess : public NativeObject {
  static void InitSlots(NativeObject* obj, uint32_t nfixed, uint32_t span) {
    void (NativeObject::*init)(uint32_t, uint32_t) =
        &PblNativeAccess::initSlots;
    (obj->*init)(nfixed, span);
  }
};

// PlainObject::createWithShape(cx, shape, kind, GenericObject) +
// NativeObject::create(cx, kind, heap, shape, nullptr), NoGC allocation.
// Only shapes without dynamic slots (allocateInitialSlots can GC/report).
static PlainObject* PblNewPlainObjectNoGC(JSContext* cx, SharedShape* shape,
                                          gc::AllocKind kind) {
  const JSClass* clasp = &PlainObject::class_;
  MOZ_ASSERT(shape->getObjectClass() == clasp);
  MOZ_ASSERT(!IsFinalizedKind(kind));
  if (cx->realm() != shape->realm()) {
    return nullptr;
  }
  const gc::Heap heap = GetInitialHeap(GenericObject, clasp);
  if (heap != gc::Heap::Default) {
    return nullptr;
  }
  const uint32_t nfixed = shape->numFixedSlots();
  const uint32_t slotSpan = shape->slotSpan();
  if (NativeObject::calculateDynamicSlots(nfixed, slotSpan, clasp) != 0) {
    return nullptr;
  }
  NativeObject* nobj =
      cx->newCell<NativeObject, NoGC>(kind, heap, clasp, nullptr);
  if (!nobj) {
    return nullptr;
  }
  nobj->initShape(shape);
  nobj->setEmptyElements();
  nobj->initEmptyDynamicSlots();
  if (slotSpan > 0) {
    PblNativeAccess::InitSlots(nobj, nfixed, slotSpan);
  }
  // hasAllocationMetadataBuilder() is false (PblNoGCAllocOk).
  gc::gcprobes::CreateObject(nobj);
  return &nobj->as<PlainObject>();
}

// NewObjectOperation(cx, script, pc) for NewObject (script->getShape(pc),
// kind GetGCObjectKind(nfixed)). NewInit always takes the slow path
// (nullptr): NewPlainObject(cx) / NewPlainObjectWithAllocKind need the
// per-kind default shape, which may have to be created (CanGC) and has no
// public non-creating accessor, so no exact NoGC mirror exists here.
static JSObject* PblTryNewObjectNoGC(JSContext* cx, JSScript* script,
                                     jsbytecode* pc) {
  if (!PblNoGCAllocOk(cx)) {
    return nullptr;
  }
  if (JSOp(*pc) == JSOp::NewObject) {
    SharedShape* shape = script->getShape(pc);
    return PblNewPlainObjectNoGC(cx, shape,
                                 gc::GetGCObjectKind(shape->numFixedSlots()));
  }
  MOZ_ASSERT(JSOp(*pc) == JSOp::NewInit);
  return nullptr;
}

// NewArrayOperation(cx, length) = NewDenseFullyAllocatedArray(cx, length,
// GenericObject) = NewArray<UINT32_MAX> -> NewArrayWithShape ->
// ArrayObject::create + EnsureNewArrayElements, NoGC allocation. Only when
// the default array shape exists and length fits the fixed elements of
// GuessArrayGCKind(length) (EnsureNewArrayElements is then a no-op).
static ArrayObject* PblTryNewArrayNoGC(JSContext* cx, uint32_t length) {
  if (!PblNoGCAllocOk(cx)) {
    return nullptr;
  }
  SharedShape* shape = cx->global()->maybeArrayShapeWithDefaultProto();
  if (!shape) {
    return nullptr;
  }
  const gc::AllocKind kind = GuessArrayGCKind(length);
  if (length >
      gc::GetGCKindSlots(kind) - ObjectElements::VALUES_PER_HEADER) {
    return nullptr;
  }
  const JSClass* clasp = &ArrayObject::class_;
  MOZ_ASSERT(shape->getObjectClass() == clasp);
  MOZ_ASSERT(shape->numFixedSlots() == 0);
  if (shape->slotSpan() != 0) {
    return nullptr;
  }
  const gc::Heap heap = GetInitialHeap(GenericObject, clasp, nullptr);
  if (heap != gc::Heap::Default) {
    return nullptr;
  }
  ArrayObject* aobj =
      cx->newCell<ArrayObject, NoGC>(kind, heap, clasp, nullptr);
  if (!aobj) {
    return nullptr;
  }
  aobj->initShape(shape);
  aobj->initFixedElements(kind, length);
  // length <= capacity < INT32_MAX: no hasSeenArrayExceedsInt32LengthFuse.
  aobj->initEmptyDynamicSlots();
  // setObjectPendingMetadata is a no-op without a metadata builder.
  gc::gcprobes::CreateObject(aobj);
  // probes::CreateObject (vm/Probes.h) is an unconditional `return true`.
  MOZ_ASSERT(aobj->getDenseCapacity() >= length);
  return aobj;
}

// CASE(NewObject), HybridICs path: exit frame at sp with interpreterPC = pc,
// NewObjectOperation with the script rooted in State; the object is stored at
// sp[-1] (the caller pushes it; nothing can GC in between). Failure sets
// ctx.error and returns kHelperError with sp unchanged (the op's GOTO_ERROR).
int64_t NewObjectHelper(int64_t frameA, int64_t spA, int64_t pcA,
                        int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  JSObject* obj;
  if (gAlloc & kAllocObj) {
    frame->interpreterPC() = pc;
    obj = PblTryNewObjectNoGC(ctx.frameMgr.cxForLocalUseOnly(),
                              frame->script(), pc);
    if (obj) {
      sp[-1] = StackVal(ObjectValue(*obj));
      return kHelperOk;
    }
  }
  {
    frame->interpreterPC() = pc;
    VMFrame cx(ctx.frameMgr, ctx.stack, sp);
    if (!cx.success()) return kHelperNotHandled;
    ReservedRooted<JSScript*> script0(&ctx.state.script0, frame->script());
    obj = NewObjectOperation(cx, script0, pc);
    if (!obj) {
      ctx.error = PBIResult::Error;
      return kHelperError;
    }
  }
  sp[-1] = StackVal(ObjectValue(*obj));
  return kHelperOk;
}

// CASE(NewArray), HybridICs path; same conventions as NewObjectHelper.
int64_t NewArrayHelper(int64_t frameA, int64_t spA, int64_t pcA,
                       int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  ArrayObject* obj;
  if (gAlloc & kAllocArr) {
    frame->interpreterPC() = pc;
    obj = PblTryNewArrayNoGC(ctx.frameMgr.cxForLocalUseOnly(), GET_UINT32(pc));
    if (obj) {
      sp[-1] = StackVal(ObjectValue(*obj));
      return kHelperOk;
    }
  }
  {
    frame->interpreterPC() = pc;
    VMFrame cx(ctx.frameMgr, ctx.stack, sp);
    if (!cx.success()) return kHelperNotHandled;
    uint32_t length = GET_UINT32(pc);
    obj = NewArrayOperation(cx, length);
    if (!obj) {
      ctx.error = PBIResult::Error;
      return kHelperError;
    }
  }
  sp[-1] = StackVal(ObjectValue(*obj));
  return kHelperOk;
}

// CASE(MoreIter) / CASE(IsNoIter) / CASE(EndIter): IteratorMore and
// CloseIterator take no cx and cannot GC or fail. Results go to sp[-1].
int64_t IterHelper(int64_t, int64_t spA, int64_t pcA, int64_t) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  switch (JSOp(*pc)) {
    case JSOp::MoreIter:
      sp[-1] = StackVal(IteratorMore(&sp[0].asValue().toObject()));
      break;
    case JSOp::IsNoIter:
      sp[-1] = StackVal(
          BooleanValue(sp[0].asValue().isMagic(JS_NO_ITER_VALUE)));
      break;
    default:
      CloseIterator(&sp[1].asValue().toObject());
      break;
  }
  return kHelperOk;
}

// CASE(FunctionThis) slow path (|this| is not an object): PUSH_EXIT_FRAME
// at sp with interpreterPC = pc, GetFunctionThis (boxes primitives or takes
// the global |this| in sloppy functions; strict functions get |this| as is),
// result rooted in State then stored at sp[-1]. Failure sets ctx.error and
// returns kHelperError with sp unchanged (the op's GOTO_ERROR).
int64_t FunctionThisHelper(int64_t frameA, int64_t spA, int64_t pcA,
                           int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  Value v;
  {
    ReservedRooted<Value> result(&ctx.state.value0, UndefinedValue());
    {
      frame->interpreterPC() = pc;
      VMFrame cx(ctx.frameMgr, ctx.stack, sp);
      if (!cx.success()) return kHelperNotHandled;
      if (!js::GetFunctionThis(cx, frame, &result)) {
        ctx.error = PBIResult::Error;
        return kHelperError;
      }
    }
    v = result;
  }
  sp[-1] = StackVal(v);
  return kHelperOk;
}

// CASE(Typeof/TypeofExpr), HybridICs path: sp[0] = the type name atom
// (TypeOfOperation cannot GC or run script).
int64_t TypeofExprHelper(int64_t frameA, int64_t spA, int64_t pcA,
                         int64_t ctxA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  Value v = sp[0].asValue();
  sp[0] = StackVal(StringValue(TypeOfOperation(
      HandleValue::fromMarkedLocation(&v),
      ctx.frameMgr.cxForLocalUseOnly()->runtime())));
  return kHelperOk;
}

// CASE(TypeofEq), HybridICs path: sp[0] = js::TypeOfValue(v) == type,
// negated for Ne (TypeOfValue cannot GC or run script).
int64_t TypeofEqHelper(int64_t frameA, int64_t spA, int64_t pcA,
                       int64_t ctxA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  TypeofEqOperand operand = TypeofEqOperand::fromRawValue(GET_UINT8(pc));
  Value v = sp[0].asValue();
  bool result = js::TypeOfValue(v) == operand.type();
  if (operand.compareOp() == JSOp::Ne) result = !result;
  sp[0] = StackVal(BooleanValue(result));
  return kHelperOk;
}

// CASE(Mod), HybridICs number path (both operands are numbers):
// sp[1] = DoubleValue(NumberMod(lhs, rhs)); the caller pops rhs.
int64_t ModNumberHelper(int64_t frameA, int64_t spA, int64_t pcA,
                        int64_t ctxA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  double lhs = sp[1].asValue().toNumber();
  double rhs = sp[0].asValue().toNumber();
  sp[1] = StackVal(DoubleValue(NumberMod(lhs, rhs)));
  return kHelperOk;
}

// CASE(NewTarget): sp[-1] = frame->newTarget() (no GC); the caller pushes.
int64_t NewTargetHelper(int64_t frameA, int64_t spA, int64_t pcA,
                        int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  sp[-1] = StackVal(frame->newTarget());
  return kHelperOk;
}

// CASE(SuperBase): sp[0] (the super-env function) is replaced by
// ObjectOrNullValue(HomeObjectSuperBase(home object)) (no GC).
int64_t SuperBaseHelper(int64_t frameA, int64_t spA, int64_t pcA,
                        int64_t ctxA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  JSFunction& superEnvFunc = sp[0].asValue().toObject().as<JSFunction>();
  MOZ_ASSERT(superEnvFunc.allowSuperProperty());
  MOZ_ASSERT(superEnvFunc.baseScript()->needsHomeObject());
  const Value& homeObjVal =
      superEnvFunc.getExtendedSlot(FunctionExtended::METHOD_HOMEOBJECT_SLOT);
  JSObject* homeObj = &homeObjVal.toObject();
  JSObject* superBase = HomeObjectSuperBase(homeObj);
  sp[0] = StackVal(ObjectOrNullValue(superBase));
  return kHelperOk;
}

// CASE(SuperFun): sp[0] is replaced by
// ObjectOrNullValue(SuperFunOperation(callee)) (no GC).
int64_t SuperFunHelper(int64_t frameA, int64_t spA, int64_t pcA,
                       int64_t ctxA) {
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  JSObject* superEnvFunc = &sp[0].asValue().toObject();
  JSObject* superFun = SuperFunOperation(superEnvFunc);
  sp[0] = StackVal(ObjectOrNullValue(superFun));
  return kHelperOk;
}

// CASE(Arguments): PUSH_EXIT_FRAME at sp with interpreterPC = pc,
// jit::NewArgumentsObject(cx, frame, &res) (ArgumentsObject::createExpected:
// mapped or unmapped per the script, frame->initArgsObj), the object is
// stored at sp[-1] (the caller pushes it; nothing can GC in between).
// Failure sets ctx.error and returns kHelperError with sp unchanged (the op's
// GOTO_ERROR).
int64_t ArgumentsHelper(int64_t frameA, int64_t spA, int64_t pcA,
                        int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  Value v;
  {
    ReservedRooted<Value> result(&ctx.state.value0, UndefinedValue());
    {
      frame->interpreterPC() = pc;
      VMFrame cx(ctx.frameMgr, ctx.stack, sp);
      if (!cx.success()) return kHelperNotHandled;
      if (!NewArgumentsObject(cx, frame, &result)) {
        ctx.error = PBIResult::Error;
        return kHelperError;
      }
    }
    v = result;
  }
  sp[-1] = StackVal(v);
  return kHelperOk;
}

// CASE(Lambda), HybridICs path: PUSH_EXIT_FRAME at sp with interpreterPC =
// pc, function and frame->environmentChain() rooted in State, Lambda(); the
// clone is stored at sp[-1] (the caller pushes it). Failure sets ctx.error and
// returns kHelperError with sp unchanged (the op's GOTO_ERROR). A debuggee
// frame is left to the interpreter.
int64_t LambdaHelper(int64_t frameA, int64_t spA, int64_t pcA, int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  if (frame->isDebuggee()) return kHelperNotHandled;
  JSObject* clone;
  {
    frame->interpreterPC() = pc;
    VMFrame cx(ctx.frameMgr, ctx.stack, sp);
    if (!cx.success()) return kHelperNotHandled;
    ReservedRooted<JSFunction*> fun0(&ctx.state.fun0,
                                     frame->script()->getFunction(pc));
    ReservedRooted<JSObject*> obj0(&ctx.state.obj0, frame->environmentChain());
    clone = Lambda(cx, fun0, obj0);
    if (!clone) {
      ctx.error = PBIResult::Error;
      return kHelperError;
    }
  }
  sp[-1] = StackVal(ObjectValue(*clone));
  return kHelperOk;
}

// CASE(PushLexicalEnv) / CASE(PopLexicalEnv) / CASE(FreshenLexicalEnv) /
// CASE(RecreateLexicalEnv) non-debuggee paths, CASE(InitAliasedLexical).
// The frame's environment chain is updated in the frame itself (the compiled
// code always reloads it from the frame). Ops that can GC push the exit frame
// at sp with interpreterPC = pc; failure sets ctx.error and returns
// kHelperError (the op's GOTO_ERROR). A debuggee frame is left to the
// interpreter (Debug* variants).
int64_t LexEnvHelper(int64_t frameA, int64_t spA, int64_t pcA, int64_t ctxA) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  auto* pc = reinterpret_cast<jsbytecode*>(uintptr_t(pcA));
  ICCtx& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  const JSOp jop = JSOp(*pc);
  if (jop == JSOp::InitAliasedLexical) {
    EnvironmentCoordinate ec = EnvironmentCoordinate(pc);
    EnvironmentObject& obj = getEnvironmentFromCoordinate(frame, ec);
    obj.setAliasedBinding(ec, sp[0].asValue());
    return kHelperOk;
  }
  if (frame->isDebuggee()) return kHelperNotHandled;
  if (jop == JSOp::PopLexicalEnv) {
    frame->popOffEnvironmentChain<LexicalEnvironmentObject>();
    return kHelperOk;
  }
  if (jop == JSOp::PushLexicalEnv) {
    ReservedRooted<Scope*> scope0(&ctx.state.scope0,
                                  frame->script()->getScope(pc));
    {
      frame->interpreterPC() = pc;
      VMFrame cx(ctx.frameMgr, ctx.stack, sp);
      if (!cx.success()) return kHelperNotHandled;
      if (!frame->pushLexicalEnvironment(cx, scope0.as<LexicalScope>())) {
        ctx.error = PBIResult::Error;
        return kHelperError;
      }
    }
    return kHelperOk;
  }
  frame->interpreterPC() = pc;
  VMFrame cx(ctx.frameMgr, ctx.stack, sp);
  if (!cx.success()) return kHelperNotHandled;
  bool ok = jop == JSOp::FreshenLexicalEnv
                ? frame->freshenLexicalEnvironment<false>(cx)
                : frame->recreateLexicalEnvironment<false>(cx);
  if (!ok) {
    ctx.error = PBIResult::Error;
    return kHelperError;
  }
  return kHelperOk;
}

// CASE(Callee): frame->calleev() (cannot GC or fail), stored at sp[-1].
int64_t CalleeHelper(int64_t frameA, int64_t spA, int64_t, int64_t) {
  auto* frame = reinterpret_cast<BaselineFrame*>(uintptr_t(frameA));
  auto* sp = reinterpret_cast<StackVal*>(uintptr_t(spA));
  sp[-1] = StackVal(frame->calleev());
  return kHelperOk;
}

}  // namespace pblbc
