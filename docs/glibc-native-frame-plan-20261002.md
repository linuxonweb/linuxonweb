# GNU native Wasm frames and forced unwind — concrete next packet

This includes a source design and a sparse compiler prerequisite. No general descriptors, GNU
forced unwind, cancellation, lifecycle, Nightly159, JIT or GPU are accepted.
The committed compiler prerequisite is read-only: patch
`67473abb362e308fef395f80baffdabb8e5baa8572222b457fefb879911cec40`, driver
`1147a637f9144f77c35398fc0cfd77a06fb4fec21f91706361c34395d1b8848b`.
The independent EH-routing owner retains `WebAssemblyCFGStackify.cpp`; this
packet neither edits nor reruns that task. Its later candidate results must be
reviewed separately. Historical tag1 `[1,9,9]` and escaping-SP failures remain
failures of their original inputs.

The reviewed first implementation is an explicit RECORDS_ONLY mode. Patch7
`e8ad41d2c68b3fc2ee050ab7fca67cc915a6ed24dcb2fe3f5319d54732ec0a24`
builds private Clang
`8316763b3bfe16f00bee38fd3aee1150de5dfb59c456b442a82010dfc85d7482`.
Its frozen sources, ABI and provider snapshots reproduce the normal gate;
later module4 work uses separate source copies. O0/O2/O3 native shared-memory
Wasm modules pass 5,361 assertions without imports or SP resets. Each mode
checks actual descriptor/head/owner geometry, recursion depth13, indirect calls,
source zero/static frames, dynamic alloca payload survival and lexical VLA
stackrestore. All three flags-off objects are byte-identical to the preceding
compiler. Nine compiler rejects and thirteen runtime rejects per mode remain
explicit. The owner token is synthetic; genuine GNU TP/startup/lifecycle and
forced unwind are absent. Root independently executed the same modules and
reparsed the45-member archives: only indices15/41 change. Our reread proof is
`normal-records-reread-1.json`, SHA
`337ce63d6d5bfc59398d053b7cb785b8fec507c82d0b795208f1a3d695df0fe8`.

Historical patch3
`5565389aacc85bc5cc3fcd75cea068e6ae4d111405c213d6267231549dac0d60`
built three owned LLVM units and linked private Clang
`8436fd935f5a10d79871d57a907b2505434cb2969faffcdd802338bd83c866cc`.
All six supervised groups finished empty. Ordered backend archive inspection
preserves all45 members and changes only indices15/41; the new pass object is
linked separately. The earlier patch2 API failure and two successful objects
remain unchanged. Later failed patch5 compilation lacked a direct
MachineFrameInfo header; patch6 corrected that include. Controls2 exposed a
valid entry FrameIndex operand before PEI visited its separate return block.
Patch7 preserves the unique-publication check while counting that real operand.
Controls3 failed only the fixture assembly driver's child argument routing;
controls4 uses the read-only llvm-mc assembler. Every first failure remains.

The first O0 controls fail at a conservative record-pointer identity check.
Actual retained post-PEI MIR shows the same64-byte compiler frame object at
SP+16 rematerialized independently for Enter and Leave. The proposed patch5
adds a proof against the actual record frame index and exact PEI
stacksize+objectoffset formula. It recognizes only constant-affine SP/FP
addresses, rejects a mutable SP root for dynamic frames, checks stable FP
definitions, and retains body SP commit/normal epilogue ordering checks.
Root reviewed the correction and its later include/operand fixes before each
separately retained sparse build.

`test-records.py` prepares O0/O2/O3 native controls for all source functions,
actual manifest membership, recursion, indirect calls, source zero/static
stack, dynamic alloca, lexical VLA stackrestore and head unpublication. Its
owner token is explicitly synthetic; this gate cannot prove genuine GNU TP,
thread lifecycle or cancellation. Native providers and observation bridges
must have no linear-stack writes, no imports and no external compiler capture
or commit marker provider. No stack reset operation is supplied. Flag-off byte
identity and reject controls are required. First failed inputs and exact
commands remain alongside later attempts.

## Exact evidence and ABI choice

Run `python3 -B tools/glibc/native-frame-plan/evidence.py`, then
`python3 -B tools/glibc/native-frame-plan/review.py`. Fresh storage is
`/mnt/p6/build/glibc-native-frame-plan-20261002`; replay can select a fresh
`GNU_FRAME_PLAN_TASK`. Source snapshots, exact original/basis pairs, line findings,
compile commands/PIDs/PGIDs, include hashes and native disassembly are retained.
The only new compilation measures proposed layouts using the accepted compiler,
actual `wasm32-unknown-linux-gnu`, native EH, selected owned GNU architecture
headers and genuine pristine GNU `unwind.h`. It does not execute any proposal.

GNU's exception is24/alignment8; private words are at12/16. LLVM22.1.8's stock
`unwind_itanium.h` adds `reserved[3]` and stronger alignment. Mixing that header
with GNU's embedded `pthread.exc` is forbidden. The already prepared
`cxx-exception-closure/cxxabi-compile.py` copies genuine GNU `unwind.h` and adds
only type aliases; its GNU Wasm unwinder corrects the GNU `void *` LSDA accessor
prototype. Its pinned layout evidence is GNU exception24/alignment8,
`__cxa_exception`72/unwind offset48, dependent72/offset48, EH globals8. These
prepared layouts are reused as evidence, not runtime acceptance. All future
GNU, libc++abi, libunwind and clients rebuild against that same header and a
small owned extension header for additional entry points. GNU's exception and
pthread descriptor are not enlarged.

Proposed shapes in `frame-abi.h` are descriptor32/alignment4, activation64/16,
context40/4, forced state48/4, jump registration36/4 and thread sidecar60/4.
The64-byte activation is allocated with **16-byte stack alignment** by the
compiler; the C type has alignment16 too. Context preserves existing Wasm
landing-pad prefix `lpad_index,lsda,selector` at0/4/8 and adds validated CFA
at16; activation caller-entry SP is at20 and activeSP at28. These supersede the earlier32-byte
frame sketch and remain versioned proposals. Actual current backend jmpbuf
stays24 bytes; signal mask storage remains genuine GNU.

## Activation and module admission

Every emitted participating function has exactly one compiler-owned record:
ordinary C/C++, ctor/dtor, lambda, generated assignment, zero-local-stack,
static locals, realignment, dynamic alloca, indirect calls and recursion.
No application manually links records. A final target IR pass inserts a real
fixed alloca64/alignment16 at entry; its address escapes to sealed entry/leave
operations and cannot be sunk, promoted, merged or given a short lifetime.
Backend verifies its actual linear-memory frame object and global SP writeback;
red-zone allocation is disabled for admitted functions. The existing dedicated
fresh prologue vreg preserves `global.get __stack_pointer` before subtraction
or realignment. It initializes `caller_entry_sp`, never body `stacksave`.
`fixed_sp` is this frame's post-allocation/realignment SP; dynamic movement
cannot change CFA or the record's stable address. `active_sp` tracks the actual
current SP at every dynamic alloca and llvm.stackrestore, including exceptional
edges, before a user call/poll can throw. Restoring fixed SP before cleanup
would let stop/helper allocation overwrite live dynamic data; that route
rejects. Bounds checks must precede
record stores: overflow enters a real fatal/guard route, never corrupts another
thread's memory. Publication is complete before any entry poll or user call.

One canonical thread-owned sidecar holds the activation chain. Module TLS must
resolve to that same sidecar using actual raw GNU TP and task/exec epoch;
`__tls_base` alone and a worker/module-global head cannot identify GNU ownership.
Owned startup supplies bounded state now, and genuine pthread-create/exit must
eventually allocate/initialize/release it with default stack/guard support.
No undocumented GNU descriptor padding is reused. Select a bounded owner
registry managed at thread creation/exit, keyed by rawTP and taskEpoch, with
one canonical module1 TLS pointer to its sidecar. Cross-module thunks resolve
that same canonical pointer; per-module copies of sidecar state reject. Helpers
are sealed, hash-audited native code with no allocation, imports, polls or
callbacks. Every emitted activation, including instrumented runtime functions,
remains represented. Only specifically audited primitive bridge bodies omit
records under an explicit nonreentrant boundary contract. General libc/runtime
names never exempt code from admission.

Module registration publishes immutable descriptor ranges, actual function/table
relocations and real LSDA ownership before constructors. Each descriptor binds
version/size, module generation, actual function identity, personality, LSDA
and pad count. Function identity is an actual relocated table reference, not a
return address or PC. The module token includes a nonwrapping registration
generation. Thread activation/forced epochs also reject wrap and address reuse.
Validate owner, epoch, descriptor membership, function admission, bounds,
monotonic frame geometry, record phase, depth and previous link on every
transition. An authenticated root is a declared module/host boundary, never
an unexplained null previous link. Static linking audits every actual object,
archive extraction and indirect/table entry. Cross-module calls either target
registered admitted entries or explicitly audited native boundary thunks;
unknown entries/imports reject before a cancellation-capable call. Table growth
and replacement must update admission atomically. A custom section alone
does not enforce any of this; a mandatory owned linker/module loader does.

## GNU stop, native EH and resume

`_Unwind_ForcedUnwind(E,stop,param)` validates E and the current sidecar, creates
a bounded thread-owned forced state and stores a state pointer plus nonzero
epoch in E's two genuine private words. It never enlarges E, treats class0
alone as forced, or aliases ordinary RaiseException. Allocation cannot depend
on GNU malloc during cancellation. It raises native tag0 with **the same E**.
Runtime bridge activations obey the declared boundary contract; traversal is
the VM's real unwinding, not an interpreter or manual stack walk.

Each participating activation has a native tag0 guard **inside each relevant
language try region**, before its first cleanup/personality/catch. A function's
outer escape handler is insufficient: inner C cleanup or C++ catch could run
first. For existing typed catches a prefix can see E; cleanup-only catch_all
has no payload, so add an inner typedtag0 guard and native rethrow to the
surrounding original handler. Stock `WasmEHPrepare` skips cleanup personality
and single catch-all, so all these paths must be covered deliberately. Machine
structured-EH lowering must demonstrate this ordering, including stop-triggered
tag1. No invalid IR catchswitch/cleanuppad rethrow shape is accepted.

On tag0 entry, restore the current frame's recorded **active SP** to the real global,
then authenticate forced state by exact E pointer/epoch/owner. Ordinary tag0
continues unchanged. For active E, construct a live context from this exact
activation; `_Unwind_GetCFA` validates it and returns captured caller-entry SP.
Call the original stop `(1,10,E->exception_class,E,context,param)` before any
language action. Mark stop delivery with forced epoch+activationID before
calling it, so a reentrant throw or later pad does not repeat the same stop.
Stop nonzero is genuine `_URC_FATAL_PHASE2_ERROR`, following the reference
libunwind contract; it must reach the real GNU caller fatal/abort path. A
nonreturning stop longjmp remains native tag1. Verified root invokes the stop
once more with actions26 (`FORCE|CLEANUP|END_OF_STACK`); returning from that
terminal stop yields fatal phase2, never silently succeeds.

After a zero stop, language cleanups run through original valid EH paths. The
versioned `_Unwind_CallPersonality` uses forced actions10 for authenticated E,
original stock actions for ordinary exceptions, real descriptor personality,
actual Wasm LSDA index and a reentrant per-invocation context. Selector writes
are to that context, not an overwritable global channel. Existing compiler
consumers and all accessors rebuild together. LLVM's LSDA “call site” is
actually a landing-pad index; `_Unwind_GetIP` retains its existing index+2
convention only for personalities that use it. `_Unwind_GetRegionStart` retains
existing Wasm semantics; no function index is sold as a machine PC. Synthetic
guard/escape pads without language action carry no LSDA index. Real cleanup
pads use original cleanup execution; do not invent selector entries merely to
obtain CFA. Real typed pads retain LLVM's assigned indices and LSDA emission.

`_Unwind_Resume(E)` and cleanupret/rethrow continue the same active state and
current activation without repeating its stop or already completed cleanup.
`_Unwind_Resume_or_Rethrow` must do likewise. Crucially LLVM22's actual
`__cxa_rethrow` calls **`_Unwind_RaiseException`**, so that entry checks exact
authenticated forced E and preserves its state; ordinary E takes ordinary
RaiseException unchanged. Catch/rethrow in the same frame keeps its record;
remove it only on true frame escape. Nested ordinary exceptions during cleanup
have their own native identity/context and cannot overwrite suspended forced
state. Nested forced initiation must reject or use a separately bounded state
stack with an explicitly gated contract; silent state reuse is forbidden.

Genuine libc++abi personality is preserved. Forced foreign E may enter
`catch (...)`; catch-and-rethrow continues native unwinding. Swallowing causes
unchanged `__cxa_end_catch` to call `_Unwind_DeleteException`, which invokes
GNU E's embedded `unwind_cleanup`: real `__libc_fatal`, abort134. Do not erase
catch-all or fake its cleanup with a trap provider. Throwing destructors and
noexcept retain their measured real C++ terminate behavior. This plan does not
promise that every language terminate boundary can be bypassed.

## Leave, jumps and trap boundaries

Normal return runs normal language cleanup, then validates/pops the activation,
then backend writes actual captured caller SP to the global. Tail calls and
musttail reject until record handoff exists. Escape runs all required language
cleanup, validates/pops once, writes caller SP, and **native rethrows the exact
original exception**. JS/foreign identities remain unchanged; arbitrary
catch_all payloads must never be cast to `_Unwind_Exception`. Native rethrow,
not construction of a new host wrapper, carries identity. This must compose
with the independently reviewed CFGStackify escaping-SP route.

At each actual setjmp site the compiler records environment, invocation/label,
target activationID, ownerTP/taskEpoch and real body saved SP in its activation's
bounded jump registrations. Existing body stacksave is correct for saved jump
SP, distinct from CFA. `__libc_unwind_longjmp` remains genuine GNU/native route;
owned preparation validates the matching registration and updates forced state
for the transition before throwing tag1. Each bypassed activation pops without
language cleanup and writes caller SP. The matching target remains published,
restores saved body SP, consumes only transient jump routing state and retains
live cleanup scopes. Do not pop the target or run its cleanup on recovery.
Repeated setjmp updates the same environment registration; stale/different-owner
targets reject. GNU `___pthread_unwind_next` may then begin a new forced epoch
for the next real GNU buffer. Nested target registrations cannot be identified
by SP alone, which may repeat across allocations/activations.

The jump registration has an explicit nonwrapping registration_version at32;
thread next_jump_version at56 allocates it. Repeated setjmp and environment
address reuse always consume a fresh version, even within the same activation.
Longjmp routing carries that exact version alongside the native SjLj target;
pruning invalidates it before releasing storage. Counters saturate and reject,
never wrap. Retiring a forced epoch at its genuine target clears the matching
E private words and bounded state only after authentic owner/epoch validation;
the next GNU unwind_next invocation can then reuse embedded self->exc with a
fresh forced epoch, without confusing rethrow of an active earlier epoch.

Actual Wasm traps bypass catch_all and cannot unwind records. The owned outer
host boundary therefore saves a validated thread-head/epoch/SP checkpoint before
entering guest code. On the existing captured real trap it reconciles abandoned
activations to that checkpoint, without running language cleanup or claiming
forced-unwind semantics; unrecoverable faults use the existing fatal route.
Termination/exec invalidate the old epoch before resetting frame/TLS state and
starting replacement code. Constructed RuntimeError and unrelated exceptions
retain their ordinary cleanup behavior. Reentrant host-to-guest entries require
stacked checkpoints, never one worker-global saved head.

## Exact next sparse implementation packet

The first actual owned diff is now `records-patch-1/compiler.patch` under the
task directory, with exact original/basis/owned pairs in `source-pairs.json`.
It is **uncompiled pending root review**. `prepare-records.py` preserves that
first patch; corrections require a separately retained numbered packet.
`records-patch-2` retains identical compiler bytes and the corrected runtime
membership check binding `descriptor.module` to the actual registered manifest;
use that packet for the next build. Original packet1 runtime bytes remain
snapshotted. Registration generations are immutable for a live admitted
module; reuse invalidates it only after no activation or boundary references
remain. Canonical loader linking/binding is required, not a copied table with
unrelated module pointers or a fixture-selected function list.
`build-records.py` prints the finite recipe without an argument and only builds
with the exact `--reviewed-patch` hash. No source or compiler base is modified.

This first diff adds `WebAssemblyGNUFrames.cpp`, declares two factory functions
in `WebAssembly.h`, registers post-optimization IR materialization and a
preemit machine audit in TargetMachine, and extends the accepted FrameLowering.
There are three compile units, two ordered backend archive replacements and
one directly linked new object. Driver/frontend archives and generated target
headers are reused read-only. The new pass changes no compiler class layout.
It removes stale inferred memory/nosync/willreturn attributes before adding
observable record operations. No ordinary-mode source behavior changes.

IR emission supplies descriptors, their actual function-table relocations,
a rooted descriptor table and an externally named24-byte module manifest.
The module name's MD5 suffix is only a collision-resistant identifier for
ordinary object naming: admission must bind the real final bytes/hash and
registration generation. The owned loader must validate those manifests and
build canonical immutable module registration before entry; emission alone
does not prove admission. Constructor registration, section-GC/COMDAT/table
reuse and cross-module deployment still require the later loader gates.

Record helpers receive the actual compiler-created record, descriptor, captured
callerSP and fixedSP. They check rawTP/epoch, descriptor membership, bounded
geometry and parent activeSP, publish/unpublish with release/acquire ordering,
and reject counter exhaustion. `records-runtime.c` needs separately admitted
canonical thread/rawTP binding primitives; it supplies no fake TP provider.
Every user call, including the source poll, checks actual function admission;
poll definitions in selected source reject. Primitive bridges require actual
manifest entries and independent no-stack/no-import/nonreentrant code proof.
Compiler-owned commit markers have no external definition/provider. Failure
in these record-only providers is a real native trap, never evidence for GNU
fatal or cancellation behavior. A module auditor remains mandatory before
runtime use; no permissive linker or diagnostic placeholder can supply a
leftover marker.

This finite diff explicitly rejects EH pads, computed branches, SjLj/unaudited
low-level intrinsics, variadic/naked functions, inline/module assembly,
coroutines, missing frontend metadata and transformed/unclassified SP updates.
It also rejects forced state and jump registrations in runtime entry/leave.
Descriptors carry RECORDS_ONLY, with no personality/LSDA unwind admission.
Generated noexcept constructors/destructors which acquire terminate pads
reject explicitly until the routing merge. These restrictions are first-gate
controls; they cannot become accepted production policy for GNU/C++/Nightly.

Machine audit runs in addPreEmitPass **after PEI and before ReplacePhysRegs**.
It checks real physical body SP definitions against sealed commits and rejects
dirty CFG edges/calls/returns. Normal leave must reference this actual record;
no later user call/record access is permitted. The record-mode epilogue writes
the preserved caller-SP operand from entry, and audit checks that exact copy
root and rejects memory operations after release. It does not assume upstream
epilogue defines physical SP: upstream normally uses a fresh virtual restore
register. Actual lowered MIR/disassembly/runtime gates are required to validate
all these checks before the first build is accepted.

Root reviews the actual owned diff before heavy build. First implement records,
admission and leave using these minimal additional surfaces; forced unwind is
a subsequent merge with the routing owner, never inferred from record tests:

| Source surface | Concrete change |
| --- | --- |
| New target-local `WebAssemblyGNUFrames.cpp` and `WebAssembly.h`/TargetMachine registration | Legacy post-optimization module pass before SjLj/EH preparation creates sealed64-byte alloca,32-byte descriptors, entry/normal-leave operations; scans all definitions and rejects missing source metadata, unsupported musttail/asm/coroutine/coverage. New object linked directly without a bulk CMake rebuild. |
| Existing basis `WebAssemblyFrameLowering.cpp` | Verify real record object, disable red zone, retain pre-subtraction dedicated callerSP, initialize record before source poll, bounded prologue/publication and epilogue global writeback. Avoid adding machine-info layout fields to a partially rebuilt archive; locate compiler-owned record through IR alloca/frame-index mapping. |
| `WebAssemblyAsmPrinter.cpp` | Emit actual per-function descriptor/table relocations and module ABI/admission section for every surviving definition, preserve GC/COMDAT/extraction associations; do not interpret names as coverage. |
| `WebAssemblyLateEHPrepare.cpp` | Commit body SP changes to record activeSP and global SP before physical-register replacement; final machine coverage/admission check; provide record addresses/CFA to pad/escape routes with valid dominance. General guard composition waits for routing owner. |
| Owned tiny native record providers + mandatory object/module audit | Canonical per-thread sidecar, hash-audited nonreentrant primitives, exact input/table/import admission and compiler-marker rejection; no cancellation dispatch. |

No compiler class-layout mutation is proposed. If implementation needs new
MachineFunctionInfo/CodeGenFunction fields, enumerate and rebuild **all** archive
members consuming their changed layout before approval. Sparse mixed layout
archives are forbidden. The inherited frontend archive retains accepted C-EH
and early polls; only nominated backend/member changes and new objects appear
in the ordered binary archive audit. Reuse driver objects/read-only archives.
Expected task output under1GiB, cap2GiB, launch8GiB/hard stop5GiB. Supervised
finite stages retain failures and all actual handles; stop before budget breach.

The exact dynamic-stack lowering is pinned: `WebAssemblyISelLowering.cpp`
selects physical SP32/SP64 and expands DYNAMIC_STACKALLOC/STACKRESTORE through
generic `SelectionDAG/LegalizeDAG.cpp` CopyToReg. FrameLowering writes dynamic
allocation SP back at call-frame-destroy elimination; generic stackrestore is
a bare SP definition. The target machine stage before ReplacePhysRegs therefore
instruments **every body physical-SP definition**, including aligned allocation
and stackrestore, with ordered activeSP store and global writeback. It rejects
unclassified SP writes; prologue initialization, pad restoration and final
epilogue are explicitly classified by their compiler-owned operations/phase,
never guessed from an opcode alone. Stores use the stable frame-index/FP
address of the record and cannot depend on the newly moving SP. An audit after
insertion proves each body SP definition has the matching commit before any
call/poll/throw. This avoids a generic SelectionDAG source patch and a new
class-layout field, but needs real native tests that snapshot dynamic data
across stop/helper calls and nested stackrestore. Normal leave first prunes
registrations/unpublishes while the record is live, then performs final caller
SP writeback; no record access may follow that epilogue release.

First records gates: O0/O2/O3 native disassembly and runtime zero/static/dynamic/
realigned frames, nested indirect calls/recursion, C cleanup/ctors/dtors/lambdas,
normal head/SP restoration, distinct thread ownership/epochs, stale/foreign
record rejection, missing module/table metadata and remaining-marker rejection,
mode-off byte equality. Every emitted definition is audited, not five named
fixtures. Escaping EH/tag1 acceptance requires composed routing, exactly-once
cleanup and unchanged retained target, with no test-side SP reset. First packet
may explicitly reject LTO pending private linker; it cannot accept production.

Next forced patch additionally modifies `WasmEHPrepare.cpp` (real context/pad
indices), the routing owner's valid structured guard path, and owned GNU-header
`Unwind-wasm` implementation. Rebuild actual unchanged GNU unwind/create/exit
and coherent libc++abi/libunwind; gate stop-before-cleanup against true GNU
unwind_stop, CFA relative to real GNU buffers, legacy chains, next-buffer
longjmp, foreign catch rethrow, fatal swallow134, nested ordinary throws,
cleanup/noexcept fatal cases, invalid owners/stale targets and no record/SP leak.
This requires real GNU abort providers, not diagnostic fatal imports.

An additional owned `jmpbuf-unwind.h` change is mandatory. The existing native
macro tests strict `actual callerCFA < saved bodySP`. Wasm calls push no linear
return address, so an immediate child's actual callerSP can equal its retained
parent's savedSP. That numeric test would stop before the child's language
cleanup. Keep `_Unwind_GetCFA` truthful; never subtract an artificial bias.
`_JMPBUF_CFA_UNWINDS_ADJ` must call a versioned native architecture helper that
validates true context/registration, stack bounds and adjusted geometry, then
tests actual activation ancestry: descendants are unwindable even on equality,
the exact retained activation is not. This walks authenticated compiler-produced
metadata to validate ancestry; the VM still performs all unwinding. The generic
`_JMPBUF_UNWINDS_ADJ` for actual local-variable addresses remains numeric.
Genuine GNU `nptl/unwind.c` and its stop/legacy algorithms remain unchanged.

Register the actual environment address at every GNU cancel-jmp prefix/setjmp
site, not the containing unwind buffer address or a fixture alias. Prune
registrations on their native activation return, longjmp and known storage
lifetime end; reused environment storage replaces its previous registration.
The target recovers the exact saved activeSP and registration version. Gate
immediate-child equality, zero-stack descendants (each has a real record),
dynamic movement, same-address reuse and stale registration. Also gate genuine
legacy `_pthread_cleanup_buffer` handlers before and after target registration,
including actual `buf->priv.data.cleanup`. With descendant equality the new CFA
helper must avoid premature `do_longjump`; GNU's existing `FRAME_LEFT >=` then
compares truthful CFA against actual handler addresses. At the target, genuine
GNU decides which legacy handlers run before longjmp. Do not replace those
comparisons or that algorithm with an owned cleanup-chain implementation.
This architecture adaptation is part of the exact forced patch review and has
not been implemented or executed here.

## Production coverage and lifecycle closure

Current early source polls cover while/do/for/range and common StartFunction;
optimization-created loops, backward goto/computed-goto cycles, generated
low-level loops and LTO remain uncovered. Add source CFG cycle-edge polls while
each real EH scope is live, including labels/goto and generated bodies, carrying
source-scope coverage information. Final post-opt verifier removes guaranteed
poll-containing edges and requires the remaining reachable CFG acyclic; merely
finding one poll somewhere in an SCC is insufficient. Machine verification
repeats this after irreducible-loop fixing and CFG transformations. A newly
created cycle without a cleanup-capable poll rejects compilation, rather than
injecting a late call after destructors were discarded. Extend transformations
to preserve early coverage, or constrain them with audited flags until all
production dependencies pass. No application pthread_testcancel substitute.

Relink an owned wasm-ld against the same changed LLVM/CodeGen/AsmPrinter archives,
run target materialization and final verification after full/ThinLTO internalize,
import, clone and optimization, and admit only that linker. The original LTO
marker failure stays retained. Initial noinline and disabled sibling calls stay
until inline scope/descriptor handoff is proven. Bitcode flags/ABI metadata
survive import; mixed GNU/old headers, omitted descriptors and unknown inline
assembly fail. LLVM-generated intrinsic helpers require audited boundaries or
real frontend-equivalent scope/record coverage.

Signal/boundary design composes the same rawTP/taskEpoch with per-delivery and
syscall-boundary generations, separate from activationID/moduleGeneration.
Dispatch happens only after outermost kernel import/callback returns with exact
restoration acknowledgement, no critical record mutation, and genuine GNU
disabled/exiting checks. Kernel needs no GNU descriptor/CFA/PC. Late async polls
must service authentic pending signals while preserving errno and atomic ordering.
Default GNU pthread stacks, MAP_STACK/guards, DTV/TLS destructors, detached/join
cleanup and real clear-TID wake remain required; existing owned startup is only
a prerequisite. Public cancel/join must prove PTHREAD_CANCELED, then an external
thread must cancel optimized atomic-only busy loops without application syscalls.
Only those subsequent native/FPCAST Linux gates can accept cancellation. No
browser, kernel, shared runtime or frozen predecessor is changed here.

Ordinary signal-handler tag1/foreign escape also requires the reviewed queued
exception boundary protocol. The host callback checkpoints canonical head,
epoch and activeSP; actual handler activations unwind/pop only to its catcher,
which retains exact native identity while the kernel restores registers, mask
and previous active_siginfo. It must rethrow before user code observes any raw
restart result. Nested kernel entry propagates that same identity through the
guaranteed enclosing callback catcher before outer restoration. The external
setjmp target remains published with its registration version; only skipped
guest activations pop. Cancellation dispatch is separately restricted to an
authentic outermost restored boundary. Exit/exec traps invalidate the epoch and
propagate without resuming the replaced task. None of this callback-jump route
is implemented or accepted by the records-only patch.

## Runtime-generated native JIT admission

The production goal includes SpiderMonkey PBLspecializer's generated native
Wasm, not only Clang output. Current `tools/pbl-jit/PblJit.cpp` assembles a
23xi64->i64 export with memory/table imports, no linear-stack global, no native
JS runtime/GC calls, and an atomic interrupt check at backedges. Interrupt exits
write PC/SP/IC/boxed values back and return normally to `OnLoopHead`. Current
`guest-jit.js` rejects function/tag imports and installs actual Wasm functions
into the shared native table. These exact sources and the source-only Nightly159
migration audit are pinned; none is changed or GNU/Nightly-accepted here.

Select an explicit **generated call-free leaf** contract borrowing the admitted
compiler-owned `OnLoopHead` caller activation. This is a structural proof class,
not a whitelist of function names or permission for opaque installed code.
The mandatory install decoder validates every generated definition: no calls,
throws/handlers, imports that can reenter, linear SP mutation, hidden loops,
language cleanup or unbounded path bypassing interrupt/pending checks. Actual
Wasm trap faults retain the outer trap-boundary contract. Bind module bytes,
generator/ABI version, all export signatures, table slot/generation and the
active caller activation/epoch token. Missing/mismatching caller tokens reject
entry. Free/tombstone/reuse invalidates descriptors only after existing actual
thread acknowledgements and no live activation/boundary uses that generation.
Fork/exec and module cache identity preserve or reset those bindings explicitly.

A versioned generated-function argument carries a validated shared GNU pending
hint address alongside the existing JS interrupt pointer/caller token. Extend
all accepted backedges to observe either hint without host callbacks; a hint
authenticates nothing. Pending cancellation exits with the existing state
writeback protocol. Before interpreter work, another generated entry or any
native callback, the admitted caller executes a guaranteed may-throw poll
inserted while its real source EH scopes exist. That poll performs authentic
kernel delivery/restoration and genuine GNU disabled/exiting checks. Thus forced
unwind begins in the actual represented caller after the call-free leaf has
returned; it never invents a missing generated CFA or skips live generated
cleanup. Native generated loops continue native execution on the fast path,
including memory operations and arithmetic. Normal semantic/type/GC bailouts
retain their existing interpreter behavior; cancellation must not depend on
changing the workload into an interpreter or an application testcancel loop.

Generated modules with native calls, direct EH, cleanup, linear-stack allocations
or new runtime reentrancy must emit their own real activation/prologue/guards
under the complete ABI or reject admission; the leaf contract cannot expand
silently. Exact migration of the specializer, 23xi64 callback/FPCAST adapters,
install validator/table generation and source-scope poll remains a separate
Nightly packet once the genuine GNU full build exists. Gates require generated
infinite-loop external public cancellation, normal JS interrupts, disabled
pending then reenable, thread/epoch/table reuse, GC/type bailout correctness,
real caller destructors once, actual native disassembly/module admission, and
measured fast-path overhead while retaining native JIT gains. Historical musl
JIT output and source-only Nightly migration checks cannot satisfy those gates.

## Concrete compiler composition checkpoint

Frozen module4 sources16 and18 each retain the 5,361 normal native assertions
with O0/O2/O3 and flags-off byte identity. Those controls use the synthetic
owner fixture. Source25 fixes actual retained-SjLj caller-SP dominance: the
unique marker output is defined in the true machine entry from the freshly
captured incoming global SP, before allocation. Its fresh normal controls10
again pass 5,361 assertions with all46 supervised groups terminal and empty.
Compiler25 SHA256 is
`c39c194ab365323db97dbd1ed0065f1862494cf72bed046c43448367c1fe5cb4`.
The retained-SjLj route still needs the composed EH consumer gate.

The separate provider3 external manifest binds actual LLVM Module text and every
function body/type/class before any source seal is accepted. Primitive2 requires
actual stack-free bodies and a closed direct-call graph. The producer owns a
non-IR authenticated Module/Function map; the EH consumer must query that map,
including when record flags are disabled. The generated actual-root getter
returns the same immutable compiler descriptor manifest. This does not admit
importing startup functions: genuine pre-first-frame bootstrap imports need a
separate exact body/import/machine contract. Allocating GNU abort and helper
functions remain record4.

Coherent source26 combines that query with the actual C++ CatchPad intrinsic
checks, LowerSjLj23 and true-entry FrameLowering25. Its first compile fails
honestly on a missing IntrinsicsWebAssembly header; source27 adds only that
header. No failure is overwritten. C++ checks currently cover actual call-only
get.exception/get.ehselector from the same scoped CatchPad and a uniquely colored
zero-argument noreturn rethrow followed directly by unreachable. Other frontend
invoke/debug forms still reject pending exact coverage.

The source-only status-v2 transition core returns explicit status before the
compiler selects a genuine fatal path. Recoverable Admit/Leave failures keep the
authenticated published head; invalid owner/chain/geometry never fabricate a
record or reset the head. Missing entry admission cannot silently omit its
activation and call allocating GNU abort. That fatal-admission problem remains
unresolved. The bounded prototype validates at most64 modules and4096 descriptors
per module. Production Firefox's much larger final function set needs immutable
validated descriptor-table splitting or genuine linker concatenation, with
module lifetime/generation authentication; a single oversized aggregate must
reject under the current finite provider. A one-module fixture does not establish
full sysroot or Firefox admission.

Source27 builds successfully with one coherent GNUFrames object, preserving
the reviewed query, C++ checks and actual manifest getter. The source-bound
primitive gate passes native getter/layout and malformed/manual-poll,
wrong-capture/reason, body/module hash and forged source-seal rejection controls.
The actual status-v2 closure links canonical bridge64 and genuine state-valid
IR bodies before classification: all18 defined functions have closed primitive2
bodies without SP writes, imports, indirect calls or native EH. Root independently
replays its36 pins and seven terminal groups. This is compile closure evidence.

Source31 additionally defines the actual record64 and Bind-selected context40
addresses in the true machine prologue after allocation, using the initialized
fixed frame base and genuine object offsets. Exact Enter/Bind arguments must be
direct frame indices or unique one-step COPY_I32 definitions from those indices.
Normal O0 and O2 pre-PEI controls prove both operand forms and the unique Bind.
The bounded one-unit build passes; compiler SHA256 is
`3fad3d491e502d9923d84f9b9e802da50af2d8d8443ef62b83c0b00863c2f714`.
Its four build groups are terminal and empty. Fresh records-controls11 passes
5,361 normal native assertions at O0/O2/O3, three flags-off byte identities and
the rejection controls, with 108 exact pins and 46 terminal empty groups. These
controls still use the synthetic owner. The composed consumer advances
past caller-SP and record/context dominance checks, then rejects an unconsumed
call admission. That failure remains retained; SjLj runtime remains unaccepted.

The separate fatal-status-v3 source proposal mints a compiler-TLS token only on
an authenticated status2 transition, tied to the actual published head, owner,
epoch, root, activation, active SP and serial. Its critical scope permits genuine
recorded GNU abort descendants. Actual anchor escape or authenticated retained
target reconciliation must retire that scope. The compiler consumer and these
hook integrations are absent; corrupt status0, unpublished status3, nested fatal
failure and epoch invalidation still have explicit unresolved policy. No native
trap substitutes for GNU abort.


Work stopped on the user's switch back to musl Nightly/JIT/GPU. All GNU source,
compiler and failed-control artifacts are retained. The already launched
source32 build finished before the stop reached its supervisor; no source32
runtime or SjLj controls were launched. Its compiler SHA256 is
`53126ca50e5da00714fa51d7afab7547deed5d9cf39ba6773da7bd584660a03a`,
under `/mnt/p6/build/glibc-native-frame-plan-continuation32-20261002`.
The exact Call-to-Invoke conversion preserves compiler admission and early-poll
metadata; only LowerSjLj was rebuilt in the verified consumer13 composition.
The 3825-input plan includes 606 actual include dependencies, verified again
against the postcompile dependency file. All four build groups and the
supervisor group are empty. Latest actual composed SjLj controls remain the
consumer13 unconsumed-admission failures; source32 has compile evidence only.

The retained `fatal-status-proposal-2` corrects proposal1's persistent critical
depth: fatal lifetime is separate TLS state, with critical depth held only for
short atomic token mutations. This leaves genuine GNU import/signal paths
available. It is source-only and has no compiler status consumer. Status0,
status3, nested failure, callback checkpoint lifetime and epoch retirement
remain unresolved. No GNU cancellation, general forced unwind, production
owner, full sysroot, Nightly, JIT or GPU acceptance is claimed.
