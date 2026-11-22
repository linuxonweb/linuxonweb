# GNU native Wasm forced-unwind merge — 2026-10-02

The sparse compiler and a separately scoped ordinary C++ diagnostic now build;
**forced unwind, GNU NPTL lifecycle and full libc remain unaccepted**. Evidence
is in `/mnt/p6/build/glibc-native-forced-unwind-20261002`. The preceding native
EH packet is frozen at root checkpoint `e703c924886776f72b22d3614b1fd93249caa94b`
and is used read-only. Full GNU libc, NPTL and Nightly159 → JIT → GPU remain the
objective.

## Exact architecture contract

The owned header copies GNU2.44 `sysdeps/generic/unwind.h` unchanged. The
exception record is GNU24/alignment8, not LLVM's incompatible Wasm16/alignment16
record. All compiler, GNU, libc++abi and provider consumers must rebuild against
that header. `nf_frame64/alignment16`, `nf_context40/alignment4`, `nf_forced48`,
`nf_jump36` and `nf_thread60` follow the separately owned native-frame proposal
header, SHA `6f0b34bb2c838776b12f3b62490307f7457084e35ecf9f29a341ea102877eb17`.

Normal stop contexts carry the actual compiler-owned frame pointer, its immutable
caller-entry SP as CFA, activation ID, live task epoch, exact exception and forced
epoch. Helpers restore the actual recorded activeSP, preserving dynamic alloca.
No CFA is reconstructed from a name, SP subtraction, fake PC or selected stack
walker. Metadata ancestry validates ownership; the native VM traverses frames.
Actual jump registrations disambiguate a zero-stack child's CFA equal to its
parent's saved SP. GNU `nptl/unwind.c` stays unchanged; only the owned architecture
`jmpbuf-unwind.h` changes its CFA predicate to authenticated target ancestry.

The descriptor personality must point to actual `__gxx_personality_wasm0`, not
Clang's `__gxx_wasm_personality_v0` marker. Genuine per-pad `llvm.wasm.lsda` and
landing-pad indices enter a caller-owned context. Stop-only contexts have no
language pad; attempting a language IP query on one rejects. Context versions,
module generations, canonical raw GNU TP and task/exec epoch must be admitted.

`_Unwind_CallPersonality(E, context)` is a versioned compiler/provider ABI
extension; all consumers rebuild. Forced personality actions are CLEANUP|FORCE
(10); ordinary actions retain the upstream Wasm search model. The compiler emits
one Error module flag `wasm.gnu.unwind.context.v1=1`, rejecting duplicate flags,
wrong behavior and wrong version. The old TLS selector channel is absent in this
mode.

## Concrete owned changes

The versioned `tools/glibc/native-forced-unwind/prepare-v4.py` emits changes to exactly
`WasmEHPrepare.cpp` and `WebAssemblyCFGStackify.cpp` in owned copies. It captures
the actual frame alloca through compiler metadata and verifies that the genuine
entry publication consumes that same alloca. It creates actual fixed caller-owned
40-byte guard and personality contexts. A compiler-only binding operation captures
the actual frame/context vregs and is erased by the backend; no runtime provider
for that marker is allowed.

For every original native TRY, including SjLj tries, a typed tag0 guard precedes
all original language handlers. The guard calls the genuine stop before cleanup,
then native rethrow forwards the same exception record into the original handler.
A stop-produced tag1 stays within the original enclosing SjLj try and reaches its
matching target. Scope registration precedes original depth rewriting. Prefix
END/label instructions remain before the new catch, and original EH blocks remain
in the CFG. MachineVerifier, native validation and delegate controls are mandatory;
these proposed changes have not passed them yet.

Every admitted function also gains two outer native scopes. The inner typed tag0
scope guards ordinary escape, covering functions without original EH pads. Its
may-throw stop call is enclosed by the outer restoration scope. Typed tag0, typed
tag1 and foreign catch alternatives in that outer scope authenticate and pop the
actual escaped frame, restore the actual pre-prologue SP and rethrow the same native
exception. Guard-generated tag1 therefore also reaches restoration. Real normal
return and typed fallthrough must still work. Fatal rejection has a distinct block
calling genuine abort, so no terminator is followed by an ordinary instruction in
the same machine block. Added depth0 branches have their own innermost void block;
all original depth and delegate behavior require the retained explicit audits.

`Unwind-wasm-gnu.c` implements GNU declarations, actual native tag0 raising and
same-record rethrow, per-thread bounded forced state, stop-once epoch handling,
context/personality accessors and genuine exception-cleanup calls. It authenticates
actual descriptor membership, module generation, pointer bounds, raw TP, task epoch,
frame geometry and exact E/private-word ownership. Stop callbacks and substantial
runtime helpers require real participating frame records.

Suppression is consulted, not merely incremented. Only actual descendants of the
authenticated stop anchor suppress repeated same-E delivery while that callback is
on its real call stack. The anchor clears suppression when the same E returns after
callback descendants escape. Metadata pop moves the anchor to its actual previous
record; tag1 marks that forced state pending. Registered-target reconciliation
requires exact active head, environment, activation and registration version, then
retires pending forced state/private words, clears matching frame epoch marks and
restores registered activeSP. The retained target remains published and its cleanup
runs once on later ordinary scope exit. A callback-local retained jump cannot
silently retire a force whose anchor remains outside it.

The scalar state-validator/pop/target operations are candidate primitive bridges,
not accepted primitives. Their emitted bodies must prove no linear stack, no
unsealed calls/imports/polls, no callback or reentrancy. Only the independently
verified canonical no-stack TP/thread accessors may be called. Record-bearing
helpers cannot pop their caller then return with stale head ownership. Rejection
returns 0 without metadata mutation; the compiler invokes genuine abort. Published
module tables remain writable Wasm data; immutability is an owned admission contract,
not a fabricated readonly map.

## Terminal and returning-stop limits

The compiler's root escape follows all original application cleanup pads. The
proposed terminal hook supplies an authenticated END_OF_STACK context: actions26,
no application frame, NULL CFA, zero activation and no language LSDA/IP. This is
separate from a real frame stop; an actual root CFA is never mislabeled terminal.
The state keeps the actual authenticated root record as evidence of this transition.
That timing/context interpretation still requires root review and native controls;
it is not accepted end-of-stack behavior.

GNU `unwind_stop` transfers to its registered destination without returning. A
returned terminal callback or a non-NO_REASON stop currently invokes genuine abort.
This preserves the intended GNU NPTL fatal/nonlocal route but **does not implement
the generic Itanium `_Unwind_ForcedUnwind` FATAL_PHASE2_ERROR return to its initiating
caller**: native VM traversal has already unwound that caller. No successful generic
returning-stop ABI or completed libgcc replacement is claimed. A returning terminal
stop is not an END_OF_STACK success result. Actual GNU `unwind_cleanup` must still
abort on swallowed cancellation; a fabricated stop/abort substitute is forbidden.

## Unfinished composition dependencies

The separate frame owner retains module4 Enter/Leave admission, actual activeSP
updates including LLVM's physical-SP pad restore, caller-SP capture and actual
setjmp registration producers. Its RECORDS_ONLY providers reject forced state/EH
and cannot be used for a passing forced gate. The proposed no-mutation
`__wasm_gnu_unwind_state_valid_v1(thread)` interface is ready for that owner's review.

The source consumer now verifies the actual generated matching-edge marker,
setjmp-test label/invocation, catchpad, authenticated resolver SSA and non-NULL
dominance before the version load. It calls the exact target provider, rejects
status zero through genuine abort, then restores the registered real SP with a
compiler-owned stackrestore marker. This wiring is not runtime accepted.

The coherent candidate enlarges backend storage to 64 bytes, embedding each
environment's jump36 at byte28; genuine public GNU jump storage becomes 196 bytes.
All clients must rebuild. Native tag1 carries one i32 generation-bearing handle,
not a pointer to mutable environment or reusable payload storage. Sixty-four TLS
delivery slots and a process-primary, nonresetting 26-bit atomic generation counter
authenticate exact owner, epoch, module and captured registration version before
payload loads. Exhaustion is a genuine fatal prerequisite bound. Target retirement
occurs only after complete validation of the exact caught delivery. The compiler's
nonmatching SjLj edge rethrows the original native exception unchanged.

Other unresolved inputs are real canonical thread/module publication, helper
admission and complete genuine GNU/default libc++abi object closure. Existing C++
closure/link-gap evidence is not catch/rethrow runtime acceptance. Full cancellation
also needs the separately owned kernel-boundary/restart policy and scheduler/thread
lifecycle work. Busy-loop asynchronous cancellation still requires real compiler/JIT
safepoints; the kernel supplies no interrupted native PC.

## Bounded build and runtime gates

`tools/glibc/native-forced-unwind/recipe.py` prints an exact source-stage recipe
without executing it. `logs/source-recipe-1.json` records proposed stages and
blocking inputs. Root reviews the complete composition pins before sparse build.
Only `WasmEHPrepare.cpp.o` changes in a private `libLLVMCodeGen.a`. The target
archive retains all 45 original ordered members with exact CFGStackify,
FrameLowering and TargetMachine replacements; a pinned new GNUFrames object stays
outside that archive. Private llc relinks against all genuine LLVM libraries and
the retained driver objects. No full LLVM checkout/build and no post-adapter LTO.
Every attempt gets new outputs and full commands/logs/source/object pins, a finite
300-second supervised stage, actual PID/PGID and terminal empty-group proof.
The ext4 task uses all TMP/cache variables and 8GiB launch/5GiB stop reserve.
The initial cap was 2GiB; root subsequently authorized 3GiB for this isolated
compiler packet. Original supervisor snapshots remain unchanged. Actual compiler
stages and failures are recorded below.

## Measured progress and retained failures

The ordinary personality diagnostic rebuilds every linked C++ unit with
`-fc++-abi=webassembly` on the genuine GNU/Linux target. This emits required
catchret exits; generic Linux Itanium previously produced unreachable handler
exits after genuine catch/cleanup. The earlier strict dependency failures,
baseline trap and runner's mistaken extra delete on that trap remain retained.
The old claim that selector zero necessarily misses catch-all was disproven:
the compiler's final catch-all can run despite selector zero.

Recipe7 SHA `832bcea8f69181f9649e37e1d60db0fa1265d84a9cbd32dbc3d2590644d9b81e`
pins 842 inputs. Baseline and patched modules each pass 40 native cases: 24
foreign direct/rethrow/escape cases and 16 genuine typed int catch/rethrow cases.
Actual record/object identity, cleanup exactly once, SP equality on every repeated
escape and zero fatal-import counters pass. Direct TLS selector observation is
zero in baseline and one with the minimal Wasm-only foreign selector publication
patch; native exception caching is unchanged. Root independently reread all pins
and reran all 80 cases. This is an explicitly named diagnostic using immediate-fail
fatal imports, genuine GNU allocator/TCB and supported silent-terminate release
configuration; it is not default GNU C++ closure, a Linux guest gate or cancellation
acceptance. Existing strict default/Release full links still fail on
`__syscall_cancel_arch` and remain unchanged.

Consumer6 first source compile passes WasmEHPrepare and fails CFGStackify on a
missing complete Module header (PGIDs402847/403174, terminal empty). Attempt7 is
a retained no-op include-anchor preparation, never compiled. Attempt8 adds only
`llvm/IR/Module.h`, patch
`6faef2734120f5ac0ceedd22a43488e14bcfa142c6d5958cb45d272a30f6ed13`.
Exact plan SHA `cdef2cebb752cd1414b9a585203b2f360f7b2131b235de3cfeaa7380c89264e2`
pins 3465 inputs. Its sparse two-source compile/link passes, replacing exactly one
member in LLVMCodeGen and one CFGStackify member in the peer proposal10 target
archive. The peer GNUFrames object stays unchanged outside the archive.
Private compiler SHA
`403b4eaffb9889e6d7e2a9dd170e3be15c9b13acd6845a1f5f608a6112f56fc5`;
six stage PGIDs406433/406575/407061/407257/407379/407461 exit0 with empty groups.

The first O0 flags-off controls are byte-identical to the peer compiler. Its flagged
controls fail before execution: actual setjmp admission pointer users are mistaken
for setjmp invocations by the producer; normal control MIR also exposes an orphaned
admission for the caller-SP marker after the backend consumes that marker. The
frame owner is correcting these authenticated producer paths without weakening
the machine audit. Its separate pass-manager construction failure is also retained.
No forced-runtime success is inferred from these first O0 compile controls.

Subsequent versioned compositions retain every failure. Consumer16 exposed a
missing genuine scoped personality on a leaf and Enter converted to Invoke by
SjLj. Producer18 establishes the scoped personality before descriptor creation
and preserves authenticated compiler operations as calls; consumer9 asserts this
ownership without attaching a personality late. Consumer18 normal O0/O2/O3 compile
and assembly controls pass, with flags-off bytes identical. Its SjLj control then
rejects legitimate early-poll uses of the actual capture; producer20 corrects that
specific operand audit. Consumer20 reaches a consumer bug: overloaded
`llvm.stackrestore` was declared without its pointer type. Attempt11 adds `{P}`;
consumer21 builds and exposes invalid resolver-failure IR.

The actual invalid-IR mutator is LowerEmscriptenEHSjLj, not FinalAdmission. It
creates an abort call in its new tag1 catchpad, then its own longjmpable-call loop
converts that call to an Invoke whose unwind destination is the same catchswitch.
`consumer21-target-O0-post-sjlj-ir-attempt1.log` preserves this before consumer EH
preparation; the later consumer-generated target-failure abort remains a distinct
plain call. Producer23 retains implicit unwind to caller for the exact pass-owned
catchswitch identity. Consumer23 relinks unchanged attempt11 objects against it,
using compose plan SHA
`b6a7d5ff37242b25f1bb23b196fe2c4d272b46ce5cdb6b72557ced8e207ee4e0`.
Three relink stages 543518/543571/543638 exit0 with empty groups. All 18 normal
O0/O2/O3 stages pass and flags-off objects are byte-identical to producer23.

Consumer23 SjLj still fails MachineVerifier, retained in
`consumer23-controls-O0-flagged-attempt1.log` (PGID544248, exit1, empty group).
The real prologue captures caller-entry SP, but a second COPY defining the marker
result remains in the original entry block moved behind the SjLj dispatch. A
matching retained-target catchret bypasses that block and reaches a normal return
using the result; its definition does not dominate the return. MachineVerifier
remains enabled. The frame owner must make the actual captured value dominate
all retained-target paths; no stack reset or fabricated SP is a remedy.

Real typed-C++ flagged compilation separately rejects compiler-generated
`llvm.wasm.get.exception`/`get.ehselector` with actual CatchPad token operands.
The retained pre-record IR is `consumer18-cxx-O0-pre-record-ir-attempt1.log`.
Admission needs exact scoped frontend token/funclet provenance, including genuine
zero-argument rethrow; it cannot use a blanket `llvm.wasm.*` exemption. This is
separate from the passing ordinary personality diagnostic.

The full owned GNU-header unwind provider separately compiles to object, LLVM IR
and native assembly (PGIDs416448/416504/416561, terminal empty). Its four metadata
primitive entries emit no linear-SP writeback. Root independently reread all 94
own-body pins. Canonical accessors have no calls. The actual six-body delivery
closure has only pinned direct calls; neither audit finds SP writes, imports,
indirect calls or native throws.
Delivery compilation succeeds with four empty terminal groups in
`delivery-compile-2-result.json`. These are body/closure evidence, not runtime
generation, concurrency, exhaustion or compiler-admission acceptance.
Guard/personality/stop-callback bodies require real participating records.
Consumer12's proposed primitive skip requires the producer's authenticated exact
module/class membership query; a source attribute alone is insufficient, including
when the record flag is disabled. The forged-attribute negative gate remains
required. Trusted provider admission, composed native machine verification and
actual unchanged GNU unwind lifecycle remain the next gates.

Unchanged GNU `nptl/unwind.c` compiles against the coherent backend64/public196
jump header and the owned ancestry predicate, with real ForcedUnwind/GetCFA,
fatal, abort and GNU longjmp calls retained. Proof
`gnu-unwind64-compile-1-result.json` SHA
`9758296af736a23eae5ee8a03e50b12727bc854c65df6d23f0533414f6966e0a`
pins its genuine source, actual dependencies, layout and four empty terminal groups.
Actual internal pthread_unwind_buf is 84/alignment4; the public typedef is
84/alignment16, not an invented 96-byte object. The peer's unchanged GNU
cancellation and jump/cleanup chain compile with the same64-byte backend.
These compile gates do not establish a working unwind destination, public
pthread lifecycle or compatibility with old24-byte jump clients.

The first coherent compiler composition now builds successfully from the single
producer27 GNUFrames object, producer25 FrameLowering and producer23 SjLj source,
with both consumer12 EH objects. Its compiler SHA is
`4d8417ac505fc3e6712dd54764832f9d2a6697f7fcbedd121e770f6346836a40`;
`consumer-coherent1-build-plan.json` pins the actual 3,513 source/object/tool inputs.
All six compile/archive/link/version groups terminated with status0 and no members.
O0/O2/O3 ordinary controls pass all18 compile stages, and genuine Wasm C++ ABI
typed/catch-all/rethrow controls pass all15 stages with actual LSDA/personality
relocations. Both suites retain flags-off byte identity to the producer compiler.
These are compilation gates, not forced-unwind execution acceptance.

The actual SjLj gate still fails MachineVerifier. A record address materialized
inside the moved original-entry block does not dominate the resumed handler path:
`%93 = ADD SP32,16` is used by an activeSP load in the tag1 catch. The actual callerSP
now dominates correctly. Pre-prologue diagnostics prove Enter and Bind both use
the same genuine record frame-index1 (64/alignment16), while Bind context is
frame-index0 (40/alignment4). Its separately materialized context address has the
same potential dominance problem. Both real allocations need authenticated
materialization after the fixed-frame prologue and before the resume dispatch;
reading an abandoned globalSP in a handler is not an acceptable repair.

An independent optimized-target diagnostic reveals another strict-consumer
rejection: WinEHPrepare duplicates the pure i32 ptrtoint of one actual native
`llvm.wasm.catch(1)` SSA value. Consumer13 is a minimal source correction
accepting only those two i32 casts from the exact same catch SSA and retaining
resolver dominance, metadata and payload authentication. The failure and actual
before-consumer IR remain immutable. This is separate from the machine-address
failure and does not establish a working retained destination.

The separately authorized consumer13 continuation now builds against producer31,
whose real record64 and context40 addresses are materialized in the genuine fixed
frame prologue. The continuation lives at
`/mnt/p6/build/glibc-native-forced-unwind-consumer13-20261002`; the earlier task
remains unchanged. Plan SHA256
`89f2191f24ac0e3d8cc4247ff807b60ddd0844c9f2ffc4fa6df9f613d50c0f07`
pins 3,447 inputs and 3,148 snapshots. Only WasmEHPrepare13 is compiled; the exact
consumer12 CFG object and single producer27 GNUFrames object are reused with
producer31 FrameLowering. All five build groups terminate with status0 and no
members. The private compiler SHA256 is
`31a8efbcefe712899402bdbf47a7a5adb1724b46a2bc7a88c5890e74facf7fbf`.

Actual flagged SjLj O0, O2 and O3 each fail with
`GNU call audit found an unconsumed admission`. This occurs before CFGStackify,
not in the consumer's added guard sequence. The original recorded call has its
actual preceding admission and `wasm.gnu.call.admitted.v1` metadata. Producer
LowerSjLj23 calls `changeToInvokeAndSplitBasicBlock` at line2000; the pinned
upstream `llvm/lib/Transforms/Utils/Local.cpp` utility at lines2603–2642 copies
only profiling metadata to the new invoke. The actual owned admission survives,
but the admitted-call metadata does not. FinalAdmission consequently inserts a
second admission before both the cancellation poll and user call. The unchanged
machine audit correctly rejects the resulting consecutive admissions. Actual
pre/post-pass IR and source snapshots are pinned in
`logs/consumer13-call-admission-diagnosis-1.json` under the continuation. The
O0 control, O0 diagnostic, independent O2 and independent O3 groups are
655890, 659271, 671147 and 671193 respectively; all terminate with status1 and no
members. The producer owns the exact metadata-transfer correction. No composed
runtime or genuine GNU owner/cancellation acceptance follows from this build.

The actual consumer13 compiler independently passes the normal O0/O2/O3 suite
(18 stages) and the coherent WebAssembly C++ ABI suite (15 stages), including
flags-off byte identity, actual typed/catch-all/rethrow code, LSDA and personality
relocations. Its three forged-seal controls reject with the required provenance
diagnostic, including records-off modes. Two independent C++ controls reject the
wrong actual catchpad token and wrong personality, rather than accepting an
arbitrary earlier failure. All stage groups are empty. Their proofs are
`consumer13-continuation-controls-normal-1-result.json`,
`consumer13-continuation-controls-cxx-1-result.json`,
`consumer13-continuation-forged-2-result.json` and
`consumer13-continuation-cxx-negative-2-result.json`. These actual compilation
and rejection controls do not turn the three failing SjLj controls into passes.

The genuine-owner source/recipe handoff is pinned separately as
`genuine-owner-provider-handoff-1.json`, SHA256
`6c7128c82a7f271cee5a9e27f3123bdbe2444d2a1103af7a2cab9dcbd85f5786`.
It identifies the unchanged provider corpus, four primitive candidates and
18 functions requiring real records. Fresh coherent early GNU alias lowering,
backend64 helpers, real GNU unwind/jump/cleanup bodies and authenticated provider
membership remain required. Existing void-v1 Enter/Leave/admission operations
call genuine abort on invalid input and cannot be treated as no-stack primitives;
the status/fatal compiler boundary is a separate unresolved composition gate.
No diagnostic fatal import or synthetic owner substitutes for that closure.

The forged sealed-attribute negative first rejected correctly at the producer's
machine audit, but the fixture omitted that exact earlier diagnostic. Its assertion
failure is retained. Version2 explicitly recognizes that provenance rejection and
passes all three source-forgery controls, with no output object and empty terminal
groups. A concurrent initial runner launch hit the supervisor lock before any
child was created; subsequent gates ran sequentially.

Ordered acceptance gates:

1. Source/frame/provider ABI readback, GNU24/alignment8 and libc++abi72/offset48
   measurements; exact ordered archive/member audit; flags-off byte-identical
   ordinary output. Unknown/indirect/uncovered/import/tail and modern-EH paths
   reject until fully admitted. No marker provider or cancellation stub links.
2. O0/O2/O3 real zero/static/dynamic/indirect/nested/recursive frames, real returns
   of void/i32/i64/f32/f64, mismatched nested EH/delegate routes and leaf liveness,
   native tag0/foreign identity/ownership. No JS or assembly SP reset.
3. Every original language-pad kind receives stop first and once per activation;
   cleanup-throw/fatal paths retain genuine abort; callback/helper frames have
   measured records. Real same-E rethrow, nested suspension and stale/cross-owner/
   epoch/version/payload controls reject correctly. Actual traps remain separately
   measured and do not establish general forced unwind.
4. Native tag1 skipped-frame pop plus retained-target reconciliation, several live
   environments from one setjmp site, nested/recursive targets and dynamic alloca.
   Retained cleanup is absent at jump and appears exactly once on later normal exit.
   Per-thread forced state/private words/epochs/suspension are clear after destination.
5. Unchanged GNU `nptl/unwind.c` with genuine public GNU jumps/cleanup chain and
   genuine libc++abi typed/foreign catch+rethrow; nested C++ destructors/C cleanup
   once. Swallowed force, invalid destinations and returning-stop limits use genuine
   abort in separately named negative processes. Full generic-return ABI remains
   blocked unless a faithful native architecture route is implemented.
6. Ordinary C++ EH, GNU jump/allocator/startup regressions and concurrent TLS/TP
   isolation; then real public pthread_exit/deferred-cancel/eventual-join with
   default stack guards and transport boundaries. Only this later integration can
   establish default GNU NPTL/public loader/runtime readiness for Nightly.

Draft1/compiler attempts1–5 remain retained as incomplete source history, not failed
executions. Source preparation and ordinary diagnostic success do not establish
general forced unwind, public pthread_exit/cancellation or Nightly readiness.
