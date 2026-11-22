# Genuine GNU native Wasm cancellation plan — 2026-10-02

This packet is a source and compile-only plan. It does not implement cancellation,
close the outstanding loader link, or accept NPTL, libc, Nightly159, JIT or GPU.
Root review precedes implementation. It owns only
`tools/glibc/cancel-native-plan/**`, this document, and
`/mnt/p6/build/glibc-cancel-native-plan-20261002`.

The recommended route preserves GNU `cancellation.c`, `pthread_cancel.c`,
`unwind.c`, state/type setters and join/lifecycle algorithms as C. It adds an
owned native architecture bridge, compiler-wide cleanup/CFA support, a narrow
kernel-copy signal restart hook and a worker boundary adapter. Standard LLVM's
Wasm unwinder lacks `_Unwind_ForcedUnwind` and `_Unwind_GetCFA`; defining just
`__syscall_cancel_arch` cannot establish their contracts.

## Evidence and measured limits

Run `python3 -B tools/glibc/cancel-native-plan/evidence.py`. The latest passing
evidence is `evidence-attempt-2.json` in the task directory: 42 original/snapshot
pins, 24 source findings, two compile-only IR outputs and independent original
and snapshot rereads with zero differences. The 42 pins include pristine GNU
sources, exact LLVM/kernel sources, accepted private compiler, selected kernel,
the actual worker/signal/jump adapters, prepared routing acceptance and original
default/Release loader failure logs. Source lines and hashes are in that JSON.
The selected kernel hash is
`21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`.

The default full-link attempt3 fails solely on `__syscall_cancel_arch` from
genuine `gnu-nptl-cancellation.o`. The contemporaneous Release attempt3 also
fails on `__mmap64` from `gnu-libio-fileops.o`; its memory selection was still
being reviewed. These snapshots establish link failures, not executed C++ EH.
The loader owner may produce later attempts without changing these snapshots.

Compiling `layout.c` against the pristine GNU unwind header measures its actual
exception record at size24/alignment8, stop pointer4 and unwind word4. Proposed
owned frame, extended context and syscall boundary records measure32/4,24/4
and32/4 respectively; their IR initializer and static assertions are retained.
These are proposed data shapes, not installed ABI. They do not alter GNU's
embedded exception record or the measured descriptor1184/alignment32. CFA is
proposed at context offset16 and actual caller-entry SP at frame offset12.
Both current controls deliberately use `wasm32-unknown-unknown` for freestanding
ABI/IR shape measurements, with no Linux target configuration or GNU sysroot.
Subsequent compiler acceptance must use actual `wasm32-unknown-linux-gnu` and
the selected coherent GNU architecture headers/flags; these controls do not
establish final-target integration.

The accepted private frontend compiles two atomic-load busy-loop controls.
Without a potentially throwing call inside the object scope, the function has
no invoke or cleanuppad. The source call control has both. This proves the
need to introduce safepoints while source cleanup scopes remain live; it does
not prove a compiler safepoint implementation or loop cancellation. Compile
PIDs/PGIDs4155812 and4155813 exit0 with empty groups; exact commands are retained
in `logs/compile-attempt-1.json`. The first inspection run failed before any
compile because it incorrectly located `pthreadP.h` under `nptl`; the actual
file is `sysdeps/nptl/pthreadP.h`. The original tool transcript retains that
failure. It has no on-disk pre-fix script snapshot and is not represented as a
successful attempt. The passing run snapshots its corrected script exactly.

The preceding routing/prototype packets are prepared, not frozen. Their
48-case/336-check routing result covers exactly five fixture functions and
diagnostic foreign records. Their frame state is module-global and their
tag0 forwarding preserves the exception-record pointer, not JS wrapper
identity. Their result is neither general CFA nor GNU forced unwind.

## Interruptible syscall boundary

GNU checks pending enabled cancellation before a cancellable syscall and,
afterward, on genuine `-EINTR`. Disabled/exiting threads use the raw syscall
route. GNU sends SIGCANCEL only after setting the descriptor's canceled bit;
its handler also validates SIGCANCEL, same-process PID and `SI_TKILL`.
Disabled requests remain pending; reenabling asynchronous mode or changing to
asynchronous mode invokes genuine cancellation immediately in the setter.
Deferred reenabling waits for the next cancellation point.

Kernel Wasm registers contain syscall number, arguments, result, restart number
and mode, with no PC. Signal delivery calculates restart before invoking the
guest callback, then restores interrupted registers and mask after it. The
exported syscall may restart internally before returning to the worker.
Current callbacks have NULL context. A function-table index, artificial range
or null replacement return address cannot implement the GNU PC-range rule.

An adapter-only policy that clears SIGCANCEL's SA_RESTART globally would make
ignored, disabled or unauthenticated signals spuriously interrupt unrelated
operations. `rt_sigaction` flags are process-wide, so toggling them around one
thread's bridge races other threads. Toggling them from the callback is too
late for the saved restart decision. Manually reissuing every EINTR in the
worker lacks the kernel's raw restart classification, restart-block state and
side-effect contract. No such route is accepted. A future adapter-only route
would need equivalent explicit per-delivery kernel information; the current
exports do not supply it.

The minimal owned kernel-copy hook should return a typed per-delivery restart
decision separately from the existing siginfo-copy failure status. Retain the
raw pre-restart result in `arch_do_signal_or_restart`, restore registers/mask
and active siginfo normally, then apply the decision to that exact delivery.
Only a raw `-ERESTARTSYS` with authenticated enabled pending cancellation,
the matching active cancellable boundary (or an eligible raw user boundary in
asynchronous mode) and successful state restoration may
clear `restart_syscall_nr` and substitute `-EINTR`. Existing negative EINTR
routes need no conversion. Preserve `-ERESTARTNOINTR`, restart-block rules,
positive/zero results and unrelated errors unless separately audited. Never
convert a positive partial read/write into cancellation. The hook needs no
GNU descriptor layout or fictitious user PC inside the kernel.

The user adapter must **defer invocation of GNU's SIGCANCEL handler itself**
while kernel callback depth is nonzero: its asynchronous branch otherwise
starts unwinding live kernel frames. It copies genuine siginfo, records
authenticated delivery and returns normally. The worker may dispatch that
saved handler only after the outermost kernel import has returned and the
restored-state acknowledgement matches task, generation and boundary. Ordinary
signals retain their existing synchronous behavior. Native architecture
`cancellation_pc_check` must inspect a versioned owned cancellation context
with proven bridge phase/raw result/acknowledgement, not invent an address or
interpret public NULL ucontext as registers. The deferred path can instead
leave genuine GNU `cancellation.c` to consume `-EINTR`; either selection must
retain the original GNU handler for asynchronous delivery and its auth checks.
The native context is internal to SIGCANCEL; no general public ucontext claim
is introduced.

Boundary records form a thread-owned stack. They include raw GNU TP, task/module
generation, syscall number, admission phase, signal depth and result. A nested
handler's syscall cannot overwrite the outer interrupted request. Stale queued
deliveries after exec, exit or descriptor reuse must reject. Compiler TLS and
raw GNU TP remain separate; a JS worker-global boolean is insufficient. Disabled
or exiting state is rechecked before dispatch/veto, not just at installation.
Ignored invalid SIGCANCEL and noncancellable deferred calls retain normal
SA_RESTART. Genuine partial results return normally in deferred mode, retaining
pending cancellation for a later cancellation point. Asynchronous requests
can act at later independent safepoints; the syscall bridge must not relabel
an already positive result as EINTR or force cancellation from that result.
An enabled asynchronous request during a raw noncancellable blocking import
must still interrupt an eligible no-side-effect restart and unwind after
restoration. Otherwise asynchronous mode could hang outside the GNU bridge;
the deferred-only bridge predicate is insufficient for that case.

## General native forced unwind and CFA

### Concrete kernel ABI sketch for the later signal packet

The source-pinned edit surface is `arch/wasm/kernel/signal.c`,
`arch/wasm/include/asm/wasm_imports.h` and `arch/wasm/include/asm/thread_info.h`.
Add a per-thread delivery generation initialized on task creation, with explicit
wrap rejection. Keep the existing callback export/import for old modules;
the owned rebuilt kernel/worker selects a versioned new interface together:

```c
/* ABI proposal only. All parameters are actual i32/u32, not guest PCs. */
int user_call_siginfo_handler_v2(unsigned trampoline, unsigned handler,
    unsigned signal, unsigned delivery_generation, int interrupted_raw_result);
unsigned user_signal_return_policy(unsigned delivery_generation,
    unsigned signal, int interrupted_raw_result, int restored_restart_number);
/* Return-policy values: 0 = unchanged; 1 = interrupt eligible ERESTARTSYS.
   Unknown values fail the delivery; this result is separate from copy status. */
```

`arch_do_signal_or_restart` captures raw result before `syscall_restart`, and
passes it plus a fresh generation into `call_signal_handler`. The v2 callback
returns the existing copy-success/error status. The worker pushes a delivery
record before the guest trampoline, saves authentic copied siginfo/request
state, and retains that record after the callback without invoking GNU unwind.
The kernel finishes `enter_from_user_mode`, restores `saved_regs`, restores
`saved_mask` and active siginfo, and handles callback-copy failure normally.
Only then does it call the return-policy import. That import only computes a
decision and binds the restored-state acknowledgement; it must not dispatch a
guest handler or throw. Both kernel and worker verify the exact generation and
task identity; raw result must match the original syscall, not a nested result.

The kernel applies value1 only with successful callback/restoration and exact
raw `-ERESTARTSYS`; it sets the restored result to `-EINTR` and restart number
to -1. Value0 preserves normal restart. A positive original result never enters
that conversion. A late failing signal/forced fatal stays on the real kernel
path. Nested deliveries have separate generation/stack entries: restoration
consumes only the matching top entry, and dispatch waits for all live kernel
imports and callbacks to return. A return-policy import cannot use the newest
unmatched global request to cancel an older operation. The worker's outermost
syscall-return boundary consumes acknowledged deliveries after the kernel's
full user-mode exit. Normal signal callbacks and the original public GNU
signal layout do not change. This is an explicit ABI proposal; no kernel copy,
header field, import or runtime adapter has been modified by this plan.

### Sparse private compiler build recipe

Use the accepted private compiler as the behavioral baseline and its owned
`libclangCodeGen.a` as the frontend archive base, retaining its existing
CGException change. The pinned predecessor `tools/glibc/c-cleanup/build-compiler.py`
already records the exact source/archive/driver build route and all101 ordered
CodeGen members. Its private archive is about20MiB; the original LLVM Wasm
CodeGen archive is about2.4MiB and the accepted driver about122MiB. A full LLVM
checkout or full CMake rebuild is unnecessary and would exceed this packet's
storage intent.

In a fresh owned compiler task, snapshot only edited translation units and
headers, then create an LLVM VFS overlay for those files while keeping original
source/generated includes read-only. The frontend work is in `CGStmt.cpp` plus
the smallest necessary loop/cleanup helper declarations. Insert may-throw
safepoints via `EmitCallOrInvoke` while the actual EH cleanup stack is live;
function-entry/recursion insertion must also preserve active language scopes.
Source-level cleanup emission and backend CFA construction are distinct work.

The backend work starts with `WebAssemblyFrameLowering.cpp` and
`WebAssemblyLateEHPrepare.cpp`, adding only necessary target pass registration
and descriptor/record lowering units. Capture the local register loaded from
`__stack_pointer` **before** allocating this frame. Force a real bounded frame
record and global SP publication even for red-zone/zero-local-stack frames;
track its original caller SP separately from dynamic alloca movement. Lower
the generic frame-enter/leave/escape markers and verify complete native EH
coverage after optimizations. IR `llvm.stacksave` inside a body can read an
already lowered SP and is not by itself proof of caller-entry CFA. The backend
must derive that value from the real prologue and verify it in disassembly.

Compile changed host units using the pinned toolchain's actual
`llvm-config --cxxflags`, with its EHoff/RTTIoff/assertionsoff/C++ ABI1 settings,
`-O1 -g0` and original/generated include roots. Reuse pinned read-only driver
objects from the accepted compiler task. Copy only the20MiB private CodeGen
archive and2.4MiB Wasm CodeGen archive, replace exact ordered members using the
existing archive audit, and relink one owned Clang against other original
archives via the predecessor's `--start-group` recipe. This puts frontend and
backend changes into the same driver; invoking the old `llc` after that driver
would bypass the new backend. If a wrapper still needs external `llc`, relink
an owned llc driver against that same private target archive and audit it.
VFS overlays/private headers require a host compiler that supports them;
otherwise use sparse owned directories with explicit include precedence.
Do not assume `/usr/bin/g++` consumes Clang's VFS option.

Maintain an exact ordered archive-member audit, including duplicate basenames:
only nominated frontend/backend members may change. Pin host compile inputs
and actual link archives, log attempted commands/PID/PGID, reserve8GiB free,
keep task files under2GiB and stop at5GiB free. Plan a sub-1GiB output budget
including a retained prior driver, fresh driver, archives, overlays, object
files and finite fixture outputs. No bulk copy of LLVM sources/libs or frozen
compiler trees. If measurements show the2GiB cap cannot fit the sparse route,
stop before exceeding it and request root's storage decision; the historical
3GiB cleanup exception does not authorize a new exception here.

The first compiler packet ends at real optimized coverage/ABI fixtures: C and
C++ cleanups, SjLj crossing and retained targets, zero-stack frames, indirect
calls, recursion, dynamic alloca, default/Release/LTO and native disassembly.
Its runtime uses bounded diagnostic fixtures without implementing GNU thread
lifecycle or the kernel cancellation protocol. Full forced/runtime semantics
remain the next packet. This recipe is not executed in the present task.

Use the native VM to unwind actual Wasm frames. An owned compiler mode emits
versioned frame descriptors and a record for every participating C/C++ frame,
including zero-local-stack frames, indirect calls and previously nounwind
calls. Capture the actual caller SP before the frame's own allocation, ensure
each emitted frame has a real bounded record, and publish its chain through
thread-owned state. The descriptor records module/callsite/LSDA/personality
information; callsite indices are LLVM's real Wasm LSDA indices, never PCs.
`_Unwind_GetCFA` returns that context's captured caller SP, with owner/generation,
stack-bound and chain validation. Leaf omission requires a proved no-throw,
no-safepoint, no-cleanup contract, not a function-name whitelist.

Insert exception routing before final Wasm EH lowering, with a final backend
check after inlining/LTO. Every escaping native tag0 frame must run the stop
before its language cleanup/personality, even if it originally had no EH pad.
Frame removal and real `global.set __stack_pointer` restoration must occur on
normal returns, escaping exceptions and SjLj recovery; merely restoring LLVM's
local SP was already measured to leak48bytes. Disable sibling-call omission
initially; later tail-call support needs explicit record handoff. Indirect and
cross-module calls require instrumented table entries or declared audited
boundary descriptors. Unknown modules or unsupported musttail/inline assembly
reject the build; a fixture coverage list cannot become production acceptance.

Owned libunwind must implement `_Unwind_ForcedUnwind`, `_Unwind_Resume`, the
context/CFA accessors and stop state using the genuine GNU24-byte record. Its
private words can reference a bounded thread-owned state/stop parameter without
enlarging that record. Invoke the original stop with version1 and
`_UA_FORCE_UNWIND|_UA_CLEANUP_PHASE` on each real frame, before its cleanup.
At a verified root add `_UA_END_OF_STACK`; stop failures must yield the genuine
reason/fatal path. `_Unwind_Resume` continues the same forced state without
redelivering the already handled stop/cleanup. GNU's unchanged `unwind_stop`
uses CFA relative to its real cancel-jmp SP and stack bounds, executes legacy
cleanup chains and performs native longjmp to the correct GNU unwind buffer.
Reconcile frame records to that retained target before the longjmp; do not
discard its cleanup prematurely. Then GNU `___pthread_unwind_next` continues
the actual chain. No null CFA, private stand-in stop or ordinary RaiseException
alias can satisfy this gate.
The loader owner's newer native control additionally exposes a real SjLj gap:
tag0 C cleanup/caller provenance passes16/16 with sequence[1,2] and SP restored;
tag1 reaches target37 and restores SP but fails16/16 because it runs retained
target cleanup prematurely and again on normal return, sequence[1,9,9].
General lowering must distinguish tag1 jump routing from tag0 language unwind,
preserve the retained target's live cleanup scope, and reconcile records without
executing that cleanup during jump recovery. A successful jump value or SP
check alone is insufficient. These loader fixture failures remain unchanged.
Exact originals/snapshots of `logs/routes-results.json`, optimized and adapted
IR, correct native assembly, object and module from the loader task are pinned
separately in this task's `review.json`. Its routes-execute stage
PID/PGID4172818 exits1 with an empty owned group; this source-plan packet does
not rerun or mutate the loader fixture.

Extend `_Unwind_CallPersonality` to distinguish an authenticated active forced
record from ordinary exceptions and supply real forced cleanup actions.
Standard `Unwind-wasm.c` currently passes SEARCH_PHASE unconditionally. Genuine
libc++abi personality remains unchanged and receives coherent GNU headers,
real LSDA and the extended context. Its catch-all can catch a foreign forced
exception; do not erase those catches. Rethrow must continue forced state;
swallow/delete must call GNU's embedded `unwind_cleanup`, causing genuine GNU
fatal/abort134. C++ noexcept/throwing-destructor behavior must follow measured
language runtime semantics, not a blanket promise that forced unwind bypasses
every terminate boundary.

The prototype's separate stop guard cannot directly rethrow through its old
IR cleanup edge because LLVM's verifier rejects that catchswitch shape. A
general compiler implementation must either generate valid native structured
EH that retains direct rethrow, or formally adopt tag0 forwarding with the
exact exception-record pointer and gate real typed/foreign C++ rethrow and
ownership. That decision remains open until the first general compiler packet.
Non-tag0 JS/native exceptions must retain exact existing identity and cleanup;
never cast arbitrary catch_all payloads into GNU exception records. The frozen
halt/exec trap mechanism must still bypass guest EH without a second abort,
and exec must reset old frame/TLS generations before fresh startup.

## Asynchronous busy-loop delivery

Current Wasm and this kernel have no asynchronous user-mode trap. Worker
messages cannot interrupt a running Wasm call. Worker termination, a host trap
or application calls to pthread_testcancel cannot implement asynchronous GNU
cancellation with cleanup. Busy-loop cancellation therefore requires compiler
safepoints, without turning the public operation into cooperative deferred
cancellation.

Introduce the slow-path may-throw call during Clang loop statement emission
while C/C++ cleanup scopes are live, plus recursive/function-entry coverage.
Fast paths can use shared atomic pending bits or a bounded instruction budget;
the slow path services real kernel IRQ/signal delivery through a no-side-effect
user-return poll, waits for kernel restoration, and dispatches pending async
cancellation through GNU state checks. A kernel user-return poll is preferable
to repeated scheduling syscalls that alter results/errno and is another small
owned architecture hook if existing entry primitives cannot expose it safely.
A general shared pending hint for kernel signals is an optimization, not an
authentication source. Test code with **no application syscalls or cancellation
points** must terminate from another thread's real public pthread_cancel.

Loops introduced by optimization, irreducible loops, recursion and LTO require
a final coverage audit. Backend-inserted polls cannot reconstruct destructors
discarded by earlier frontend codegen; use early cleanup-aware insertion and
carry verifiable coverage metadata through optimization. Preserve atomic-loop
ordering and errno. Low-level runtime/host boundaries use narrow documented
nonreentrant regions, not a broad omission of arbitrary busy loops. Disabled
state suppresses cancellation while preserving pending delivery; GNU setters
restore immediate async behavior. POSIX async-unsafe library operations still
have their documented limitations; they do not justify removing the busy-loop
gate or claiming full asynchronous support from deferred polling alone.

## Ordered implementation packets and acceptance

1. **Compiler coverage/ABI packet.** Build a private owned compiler/pass from
   exact sources, with GNU ABI layout and early cleanup-aware safepoints.
   Validate C stays C, ordinary/no-EH controls, optimized leaf and zero-stack
   frames, recursion, dynamic alloca, indirect/table and cross-module calls,
   default/Release/LTO, setjmp targets and live-scope destructor behavior.
   Reject missing descriptors/coverage; native disassembly must prove actual
   SP capture/writeback and loop polls. Retain every failed attempt.
2. **Ordinary EH and forced-runtime packet.** Rebuild the full coherent GNU,
   libc++abi/libunwind dependency closure under that mode. Use real typed,
   foreign, nested rethrow and heap-owned exception fixtures, then implement
   genuine forced stop/CFA/resume and unchanged GNU unwind units. Gate GNU
   cleanup and C++ destructors exactly once, catch-all rethrow, GNU fatal on
   swallow, nested throws, correct target preservation and no SP/frame leak.
   An archive symbol closure is only build acceptance.
3. **Owned signal/restart packet.** Apply the minimal kernel-copy and task-local
   worker/signal adapter hooks. Separate native/FPCAST Linux gates cover real
   blocked pipe read and futex, pending-before-entry/during-block races, kernel
   restored masks/registers/mode, auth-invalid signals, unrelated SA_RESTART,
   disabled/re-enabled state, deferred noncancellable restart and asynchronous
   raw blocking interruption, partial positive I/O,
   concurrent threads and nested handler syscalls. Measure actual wait/wake
   and delivery, not a synthetic EINTR import. Do not change frozen providers.
4. **Public lifecycle packet.** Link genuine create/exit/cancel/join/state/type/
   testcancel algorithms and public GNU prototypes. Supply actual stack,
   MAP_STACK/guard, TLS/DTV and descriptor cleanup providers. Gates require
   public pthread_cancel success, real PTHREAD_CANCELED from pthread_join,
   clear-TID/joinstate wake, TLS destructors, detached/joinable cleanup and
   allocator recovery; unsupported default stack behavior cannot be bypassed
   with only manually created fixture children.
5. **Busy-loop async packet.** An external thread cancels optimized atomic-only
   loops and recursive workloads with no application polling/syscalls. Require
   bounded measured delivery, C cleanup/destructors exactly once, disabled then
   enabled and deferred then async transitions, independent thread isolation,
   errno and state preservation. Gate native and FPCAST with actual kernel
   SIGCANCEL; record poll cost and code/frame overhead. This packet is required
   before claiming asynchronous support.
6. **Integration/freeze packet.** Rebuild all participating GNU/C++/dependency
   objects with the selected ABI/compiler mode, rerun memory/jump/signal/syscall/
   loader/ordinary-EH/host-control regressions in actual native and FPCAST guests,
   audit all link/include/module/served inputs, terminal process groups and
   immutable manifests. Only this scoped evidence can advance a full GNU
   sysroot review. Nightly159, guest native JIT, GPU and Sites remain later
   separately verified milestones; no deployment is authorized here.

These hooks are architecture/compiler facilities necessitated by the native
VM boundary, not upstream GNU algorithm substitutions. Preserve signed source,
frozen packet/toolchain/kernel trees and previous releases. All implementation
storage remains owned ext4 with2GiB cap,8GiB launch reserve and5GiB hard stop;
compiler-specific larger storage requires separate authorization. This plan
does not start a cancellation compiler, kernel build or runtime gate.
`python3 -B tools/glibc/cancel-native-plan/review.py` independently rereads all
42 original/snapshot pairs, both compile-output pairs and the two terminal
compile groups, then pins the six exact repository paths and six loader route
inputs for root review. `review.json` is a final review artifact, not a libc or
cancellation runtime acceptance and not a frozen predecessor packet.
