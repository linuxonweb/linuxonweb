# Native Wasm GNU forced unwind design — 2026-10-02

This is an implementable, source-only prototype design, not forced-unwind,
C++ runtime, cancellation, NPTL or complete GNU sysroot acceptance. No compiler,
kernel or guest build was run for this plan. The objective remains genuine GNU
glibc 2.44 before Firefox Nightly 159, JIT, GPU and the verified Sites release.
The proposed implementation preserves GNU `nptl/unwind.c`, public pthread APIs,
ordinary C++ exception behavior, C cleanup and the native Wasm VM unwinder.

Owned evidence is `/mnt/p6/build/glibc-forced-unwind-design-20261002`.
`source-provenance.json` pins the actual files cited below; `audit.py` rereads
them. Its source roots are:

- GNU: `/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44`.
- LLVM 22.1.8: `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source`.
- Kernel: `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/s6qc0any0wby0f4nnivpaanvqb9hl130-source`.
- Accepted private C frontend: `/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang`.

## What the sources require

| Actual source | Required behavior / missing mechanism |
| --- | --- |
| GNU `nptl/unwind.c:38–132` | `unwind_stop` runs old cleanup-chain callbacks, compares actual CFA with the saved cancellation jump target, then finishes with `__libc_unwind_longjmp`. `__pthread_unwind` sets exception class zero, installs the fatal-on-swallow cleanup and calls `_Unwind_ForcedUnwind`. Returning is followed by genuine `abort`. |
| GNU `sysdeps/nptl/pthreadP.h:249–274`, `nptl/pthread_exit.c`, `pthread_testcancel.c`, `pthread_cancel.c` | Real exit/cancellation stores the result and disables further cancellation before unwinding. Deferred testcancel is a genuine public cancellation point. Remote cancel installs SIGCANCEL and atomically marks cancellation pending. |
| GNU `nptl/pthread_create.c:400–465,596–619` | `start_thread` owns the top cancellation setjmp, calls the user entry, and after return/jump runs TLS destructors, TSD and libc thread cleanup. Final thread exit clears the kernel-registered **joinstate**, not a replacement join flag. |
| GNU `nptl/pthread_join_common.c:30–102` | Public join invokes genuine testcancel, waits on joinstate through cancellable shared futexes, obtains `pd->result` and frees the TCB. Genuine create/join closure is a separate prerequisite to public lifecycle acceptance. |
| LLVM `libunwind/src/Unwind-wasm.c:26–122` | Native VM throws tag 0 and unwinds. The landing-pad context has three uintptr fields. `_Unwind_CallPersonality` actually passes `_UA_SEARCH_PHASE`, despite its cleanup comment. `_Unwind_ForcedUnwind`, `_Unwind_GetCFA` and `_Unwind_Resume` are absent here. `UnwindLevel1.c:35–37` excludes Wasm. |
| LLVM `llvm/lib/CodeGen/WasmEHPrepare.cpp:235–305,358–377` | Pure cleanuppads and single `catch (...)` do not call a personality. `_Unwind_CallPersonality` and generated calls are marked nounwind. A stop callback cannot be inserted only into that function: GNU's callback eventually throws the native longjmp tag. |
| LLVM `libcxxabi/src/cxa_personality.cpp:650–910,1023–1105` | Forced scan requires CLEANUP\|FORCE, with neither SEARCH nor HANDLER. Typed C++ handlers do not match the foreign class-zero object; catch-all can handle it. Negative exception specifications are skipped for forced unwind. Cleanup selection must remain real LSDA selection. |
| LLVM `libcxxabi/src/cxa_exception.cpp` | Foreign `__cxa_begin_catch`, `__cxa_rethrow` and `__cxa_end_catch` must remain intact. Rethrow preserves the same object; swallowing calls `_Unwind_DeleteException`, which must invoke GNU's fatal cleanup. |
| Owned `tools/glibc/jumps/jmpbuf-unwind.h`, `helpers.c`, `lower.cpp` | Current CFA test is a strict SP comparison. Jump ownership, stack bounds, direct caller lowering and tag 1 are already real prerequisites. Cancellation jump buffers are shorter than public jmp_buf and permit access only to their common prefix. |

### Resolve the exception-header ABI first

GNU `sysdeps/generic/unwind.h:29–89` uses pointer-width `_Unwind_Word` and an
anonymous union whose alignment is twice that word. LLVM
`libunwind/include/unwind_itanium.h:17–42` explicitly adds three reserved words
on 32-bit targets and uses maximum alignment. They cannot be silently mixed:
GNU NPTL embeds `struct _Unwind_Exception exc` in `struct pthread`, while
libc++abi places its unwind header inside `__cxa_exception` and computes native
exception pointers relative to it. Actual retained `nptl/unwind.o.dt` selects
GNU's generic header. Reading LLVM's larger header through GNU's descriptor
would overrun the object.

Use a coherent owned unwind interface based on the actual GNU header for the
first candidate. Supply the C typedef names and ABI declarations required by
LLVM consumers without changing GNU's record layout. Recompile the owned
Wasm unwinder and genuine selected libc++abi units against that same header;
do not link a prebuilt WASI, musl or host C++ ABI archive. Source arithmetic
suggests GNU size24/alignment8 and LLVM size32/maximum alignment on wasm32;
these are **predictions**, not measurements. The first compile gate measures
all fields in both C and C++, including exception class, cleanup function,
private words, `__cxa_exception::unwindHeader`, GNU descriptor `exc`, cancellation
prefix, public jmp_buf and all relevant offsets. Reject disagreement before
linking. `__cxa_throw`'s Wasm destructor callback returns `void *`; use its
actual public C++ declaration, not a host-target prototype.

## Minimal owned compiler/runtime integration

The first candidate is a small host LLVM-IR adapter after optimization, plus
an owned extension of `Unwind-wasm.c` and coherent jump glue. It reuses the
accepted private frontend's C exception hook. It does not require a wholesale
LLVM build, a VM unwinder replacement or rewriting GNU unwind as longjmp.
All sources through which forced unwind can pass must be rebuilt and covered.

### 1. Register actual linear-stack frames

Each physical, post-optimization Wasm C/C++ function gets an escaping entry
alloca containing a frame record: parent, actual caller SP/CFA, owner GNU TP,
live epoch, thread/session generation, and last delivered stop generation.
Before **each** physical call, including indirect calls, the caller captures
`llvm.stacksave` and publishes a scoped thread-local call record. Callee entry
consumes it, making that real pre-call linear SP its CFA. The explicit thread
entry supplies a real stack-bound-checked root context. Each normal return
removes its frame and restores the prior call record. Exceptional exits do the
same only after that frame's existing cleanup has completed.

This defines CFA as the real caller SP before the call, rather than local
`frame_address(0)` or an invented counter. Wasm backend frame lowering saves
the incoming SP before subtracting fixed/dynamic allocations; its local frame
address is the bottom of fixed locals, and depth>0 frame-address lookup is not
supported (`WebAssemblyFrameLowering.cpp:143–177,259–325`;
`WebAssemblyISelLowering.cpp:1988–2003`). Never use NULL, depth1 frame addresses,
synthetic decreasing addresses or a dummy CFA. Epochs distinguish identity;
they do not substitute for actual stack addresses.

Disable tail calls for this candidate. Instrument after the final O2 pass and
reject later inlining/tail conversion: no subsequent cross-unit LTO can alter
the physical call graph. Existing bitcode objects must therefore be rebuilt
into final native objects through this adapter, rather than reused as ThinLTO
inputs. Include the startup path, selected GNU, C++ ABI and application units.
Externally imported host calls require a scoped pending-call restore and a
declared boundary; unknown guest callees are coverage failures. Tiny unwinder
bookkeeping leaf functions may be explicitly excluded only when audited to
have no user cleanup, callbacks or stack-transfer behavior. User callbacks,
stop callbacks, personality and C++ ABI exception operations are covered.

### 2. Deliver a may-throw stop before every first forced landing in a frame

Interpose a synthetic native tag-0 catch guard on each original EH edge before
the old pad. It obtains the actual exception payload, calls
`__wasm_fu_stop_at_frame(exception, frame)`, then uses native Wasm rethrow with
the original unwind destination. Add an outer per-function tag-0 boundary for
escaping calls that previously had no EH edge; convert appropriate calls to
invoke and preserve all existing funclet parents/bundles. Bookkeeping for
other exceptions/tags must remove dead records without classifying them as
forced cancellation or changing the existing cleanup flow.

This guard is required even for pure C cleanup, single catch-all and functions
with no destructor. It must run **before** their original user cleanup/catch,
exactly once per physical frame and forced session. The original pad remains
responsible for its genuine C cleanup/destructor/catch dispatch. A rethrow or
multiple landing pads in the same live frame must not deliver a second stop.
Set the visited generation before invoking the stop callback. If that callback
longjmps, its tag1 may unwind; neither helper declaration nor call is nounwind.

The two exceptional edges are different: rethrowing the original tag0 routes
to the original cleanup/catch; a tag1 emitted by the stop callback must route
to the native SjLj target machinery without executing the retained target
frame's original cleanup. Do not give the stop-helper invoke the same original
cleanup destination as the tag0-forwarding rethrow. This distinction is an
explicit IR/native prototype gate, including a destructor local to the saved
target scope that must remain alive after the cancellation jump. The native
SjLj backend and synthetic outer bookkeeping must agree on this edge; failure
is a compiler-integration blocker rather than permission to skip destructors.

LLVM's existing `llvm.wasm.rethrow` intrinsic is Throws/NoReturn;
`clang/lib/CodeGen/CGException.cpp:1338–1347` already emits its call-or-invoke to
the enclosing EH scope. Use that shape as the prototype, with LLVM verifier,
retained IR and native instruction inspection. The first prototype's decisive
gate is whether a synthetic guard can forward to the original cleanup and
catch dispatch without duplicate cleanup or losing the tag/payload. If the
IR verifier or backend cannot represent this routing, retain that failure and
use a narrowly rebuilt **single WasmEHPrepare hook/object** to insert the same
may-throw guard. Do not silently fall back to personality-only instrumentation.
That alternative needs a reviewed host tool relink and its own storage budget;
it does not authorize a full LLVM build in this source-only task.

### 3. Extend the native Wasm unwinder, preserving the foreign object

Export these actual GNU ABI functions:

```c
_Unwind_Reason_Code _Unwind_ForcedUnwind(struct _Unwind_Exception *,
                                        _Unwind_Stop_Fn, void *);
_Unwind_Word _Unwind_GetCFA(struct _Unwind_Context *);
void _Unwind_Resume(struct _Unwind_Exception *);
```

`_Unwind_Stop_Fn` has the genuine six arguments: version int, action int,
exception class uint64, exception pointer, context pointer, stop parameter.
Use version1; CLEANUP=2, FORCE=8 and END=16. Store stop and parameter in the
two private pointer-width words, matching `UnwindLevel1.c:524–538`, and maintain
a per-thread active-session stack keyed by **exact exception identity**. Throw
the original pointer through native tag0. `_Unwind_Resume` and re-raising that
same object preserve the session/private words; they resume native exception
propagation, rather than jumping over cleanup. A new ordinary C++ exception
inside a destructor remains ordinary even while a forced session is active.

The separate guard constructs a live owned context containing the actual
frame/CFA. `_Unwind_GetCFA` validates its kind/owner/epoch and returns that
record's real captured caller SP. Personality contexts retain the existing
three-field `__wasm_lpad_context` binary prefix; use a TLS sidecar for associated
frame identity rather than changing LLVM-generated field offsets. Do not cast
an unrelated landing-pad context into a larger stop context and read beyond it.

For an identity-matched forced object, `_Unwind_CallPersonality` invokes genuine
`__gxx_personality_wasm0` with CLEANUP|FORCE, selector reset as today; ordinary
native exceptions retain the normal Wasm single-phase route. **Stop delivery
is outside this nounwind personality call.** Do not force selector to zero or
disable catch-all: genuine foreign catch/rethrow and GNU fatal-on-swallow need
their actual LSDA selections. Typed catches cannot treat class0 as a fabricated
native `__cxa_exception`. `_Unwind_DeleteException` keeps calling the object's
real cleanup callback. Unexpected stop results produce genuine fatal/abort,
not success from an already unwound `_Unwind_ForcedUnwind` activation.

There is an additional source-visible ordinary foreign-exception edge:
`cxa_personality.cpp:1071–1099` puts Wasm search-phase `set_registers` inside
`if (native_exception)`. A foreign object in a typed-plus-catch-all dispatch can
therefore retain selector0. Measure that regression in the first C++ fixture.
If confirmed, the minimal owned libc++abi fix moves only Wasm selector setup
outside that native-only cache block; native private-header caching stays
native-only. Do not use a fake native class to avoid fixing foreign dispatch.

At the last registered root frame, deliver END|CLEANUP|FORCE once with a valid
real root context. GNU normally longjmps at its saved cancellation boundary
earlier; if the END stop returns, fail fatally. A missing intervening instrumented
frame is a coverage failure, not permission to report END prematurely.

### 4. Resolve the jump-boundary identity and retire sessions coherently

The current owned `_JMPBUF_CFA_UNWINDS_ADJ` is strictly `CFA < saved_sp` for the
downward stack. On Wasm, a call does not push a return address onto the linear
stack: a child CFA can equal the parent's saved SP. That equality can stop GNU
unwind before running the child's C++ destructor. Merely subtracting one from
CFA would fabricate a stack address.

Extend the owned jump common prefix with a live frame identity captured at
setjmp. Preserve the original real saved SP, TP owner and invocation/label.
The CFA-specific architecture predicate validates actual bounds/ownership and
uses frame ancestry to distinguish a true descendant from the saved target,
including equal-SP cases; the target frame itself does not unwind. Keep the
address-based predicate used by old cleanup chains separately audited. Genuine
GNU `unwind_stop` and its old cleanup iteration remain unchanged. The GNU
cancellation jump buffer still permits only common-prefix accesses.

One added pointer predicts backend28/publicjmp_buf160 instead of the accepted
backend24/public156; measure those values with actual selected headers. A
coherent prefix/epoch representation might need a second field, so freeze the
final measured layout, descriptor size and every client only after the first
ABI probe. Existing binaries must not be mixed with this candidate. Never write
the full public sigset into `pthread_unwind_buf`.

Immediately before native tag1 transfer, validate the saved target is live and
belongs to this thread, retire completed forced sessions and restore the frame
and pending-call TLS to that target. The direct caller's real native SjLj
recovery then resumes. This must not bypass any abandoned frame's cleanup;
tests compare completed stop/destructor records with the ancestry being removed.
Support successive GNU `__pthread_unwind_next` segments after no-EH public C
cleanup macros. Ordinary longjmp keeps its existing GNU signal-mask/manual
cleanup semantics; escaping/indirect setjmp remains explicitly rejected.

## Cancellation and NPTL limits requiring separate closure

GNU `sysdeps/nptl/cancellation-pc-check.h:24–54` relies on an interrupted PC
between genuine syscall-boundary labels so cancellation does not discard a
partial side-effect result. The selected kernel `arch/wasm/kernel/signal.c`
synchronously calls handlers with signal information; the owned GNU signal
adapter supplies NULL context (`tools/glibc/port/libc_sigaction.c`). Neither
that NULL nor Wasm function-table indices are interrupted PCs. The generic
`syscall_cancel.c` assembly-label bridge also does not become valid by stripping
its labels.

Initial public deferred cancellation can use genuine `pthread_cancel` pending
state and genuine `pthread_testcancel`, including a disabled-cancellation phase
that retains pending state. The owned architecture SIGCANCEL predicate must
honestly reject a missing PC context for the deferred PC-dependent branch;
this cannot be advertised as general cancellable I/O or asynchronous busy-loop
support. Async-enabled signal delivery and shared foreign rethrow paths require
their own gate. The current kernel cannot interrupt a CPU-only Wasm busy loop
at an arbitrary PC. A cancellable syscall bridge needs a separately specified
kernel/runtime boundary protocol distinguishing no-effect interruption from
completed/partial results, plus blocking read/futex and signal race tests.
No synthetic PC markers, cancellation-success stub or unconditional post-call
cancel that throws away partial results is acceptable.

Public `pthread_create`/`join` must close actual GNU units, clone220's custom
fn/fnarg/flags/parent_tid/child_tid/tls convention, separate compiler TLS and GNU
TP, TSD/TLS destruction, stack allocation/freeing and cancellable join futexes.
For the first lifecycle gate use the **public GNU attribute API** with an owned,
real user-provided stack and guardsize0, then public create/exit/cancel/testcancel/
join. This bounds the new forced-unwind problem without claiming default thread
stack acceptance. It is not acceptable to rename a raw-clone harness as public
pthread_create or replace GNU join with a polling shim. Failed dependencies
remain failure edges requiring a next bounded packet.

`allocatestack.c:158–224,473–546` still requires MAP_STACK and real guard behavior
for the default allocation path. Current logical memory providers and kernel
ENOSYS protection syscalls cannot satisfy those defaults unchanged. Default
stack/overflow adaptation is mandatory later before general NPTL/Firefox
acceptance; supplying guardsize0 in a test does not remove that requirement.
Static TLS/module registration and caller provenance must follow the existing
reviewed static-loader route, without null return-address replacements.

## First finite prototype packet and exact command pipeline

The following are proposed **new** implementation files/commands, not files
created or commands run by this design task. Use a fresh
`/mnt/p6/build/glibc-forced-unwind-prototype-20261002` with the ordinary 2GiB cap,
8GiB launch reserve, 5GiB hard stop, ext4 TMP/TMPDIR/TEMP/cache/profile. Do not
source the C-cleanup env override that authorizes its historical 3GiB budget.
Replay the signed GNU archive and the root-selected immutable cumulative port
snapshot; independently verify its manifest before overlaying new owned hooks.
Do not mutate or recopy an entire LLVM tree or reuse an old mismatched jmp_buf.

1. **ABI/IR shape gate.** Create owned `unwind-interface.h`, `wasm-forced.c`,
   `frame-hooks.h`, `force-ir.cpp`, revised jump prefix/glue and tiny C/C++
   fixture sources. Compile-only typed/layout probes first. Add the synthetic
   stop guard to (a) one C cleanup invoke, (b) one destructor-only C++ invoke,
   (c) typed-plus-catch-all, (d) a plain recursive C frame, and (e) a caller with
   existing native SjLj. Retain raw/post-adapter IR, verifier output and actual
   native instructions. Fail before further closure if any shape is unsupported.
2. **Genuine selected C++ ABI/unwinder gate.** Compile owned `Unwind-wasm.c`
   extension plus actual selected libc++abi implementations. Select runtime
   sources from its genuine `src/CMakeLists.txt`, initially exception,
   personality, exception storage, handlers/default handlers, auxiliary/abort
   routines, private typeinfo and required stdlib_exception/typeinfo/new-delete
   dependencies, expanding only on actual unresolved references. Use actual
   libc++ headers and configuration, threads/TLS enabled, genuine GNU allocator
   and abort. Preserve source/dep hashes and exact unresolved lists; no runtime
   stubs or unresolved-symbol suppression. This proves a finite C++ ABI closure,
   not all libc++ or Firefox's C++ dependency closure.
3. **Real GNU unwind gate.** Rebuild unchanged `nptl/unwind.c`, pthread_exit,
   pthread_testcancel, cleanup compatibility/registration, genuine jump/mask/
   fortify and allocator/abort closure through the covered pipeline. A scoped
   actual GNU descriptor/start-thread fixture may diagnose this stage, but
   cannot satisfy the final public lifecycle gate.
4. **Public lifecycle gate.** Close genuine pthread_create, pthread_cancel,
   pthread_join/join_common, attribute stack API, TLS/TSD/free-TCB dependencies
   and a meaningful cancellable futex boundary; then execute the public API
   fixtures below in native and FPCAST23i64 guests. First build must report the
   concrete unresolved/source/UAPI failures instead of replacing these bodies.
   Inspect actual pthread symbols/aliases and include them in linked-object
   snapshots. At this stage success requires genuine public exit/cancel/join.

Minimum viable first-prototype sources are the owned ABI header, frame/session
runtime and IR adapter, revised owned jump glue, the extended Unwind-wasm.c,
genuine GNU unwind.c/sigjmp.c/longjmp.c/jmp-unwind.c/pthread_cleanup_upto.c plus
the accepted allocator/startup/abort closure, and genuine libc++abi
cxa_exception.cpp, cxa_personality.cpp, cxa_exception_storage.cpp,
cxa_aux_runtime.cpp, cxa_handlers.cpp, cxa_default_handlers.cpp,
private_typeinfo.cpp and abort_message.cpp with their actual unresolved
dependencies. The standalone C++ fixture requires real C++ standard headers
and generated __config_site configuration, actual atomics/TLS, exceptions
and thread support enabled, and no host default include or link paths.
Do not set libc++abi's no-threads configuration to close missing GNU pthread
symbols. Inspect emitted personality/tag symbols before adding GNU unwind.

The early scoped startup assumes the already validated static module1 TLS,
GNU descriptor/DTV and separate raw GNU TP, correct stackblock bounds, heap
floor and native shared-memory kernel clone convention. It is a diagnostic
bootstrap for gates1–3. Gate4 replaces its lifecycle path with genuine GNU
public create/join; neither that replacement nor default guarded stack support
is already accepted. Root's independent checked-jump source-selection packet
owns its make overlay; this design does not edit that overlay or the frozen
jump files and requires a later coherent candidate rebuild for any ABI change.

Use the existing C-cleanup driver stages as the command model, with a new owned
driver accepting both genuine C and C++ translation units. Concrete pipeline:

```sh
# Variables resolve to the verified fresh task and existing raw LLVM22 toolchain.
export TMPDIR="$FU_TASK/tmp" TMP="$FU_TASK/tmp" TEMP="$FU_TASK/tmp"
export XDG_CACHE_HOME="$FU_TASK/cache" PYTHONDONTWRITEBYTECODE=1
/usr/bin/g++ "$FU_TASK/source/force-ir.cpp" \
  $("$FU_LLVM/bin/llvm-config" --cxxflags --ldflags \
    --libs core irreader bitwriter support --system-libs) \
  -o "$FU_TASK/objects/force-ir"
# C flags are a recorded array from genuine selected configure/make flags.
# C++ uses its actual public GNU/C++ header set, not MODULE_NAME=libc or -std=gnu11.
"$FU_PRIVATE_CLANG" --target=wasm32-unknown-linux-gnu "${unit_flags[@]}" \
  -fwasm-exceptions -fno-optimize-sibling-calls -Xclang -disable-llvm-passes \
  -S -emit-llvm "$unit_source" -o "$unit_front"
"$FU_WARNINGS" "$unit_front" "$unit_metadata"
"$FU_JUMPS" "$unit_metadata" "$unit_jumps"
"$FU_LLVM/bin/opt" '-passes=default<O2>' "$unit_jumps" -o "$unit_opt"
"$FU_TASK/objects/force-ir" "$unit_opt" "$unit_force"
"$FU_LLVM/bin/opt" -passes=verify "$unit_force" -disable-output
"$FU_LLVM/bin/llc" -mattr=+atomics,+bulk-memory,+exception-handling \
  -exception-model=wasm -wasm-enable-eh -wasm-enable-sjlj \
  -wasm-use-legacy-eh -filetype=obj "$unit_force" -o "$unit_object"
"$FU_LLVM/bin/llvm-dis" "$unit_force" -o "$unit_retained_ir"
```

The new adapter also captures jump-frame identity after optimization while
preserving the existing caller-side setjmp lowering performed before O2. All
physical potentially throwing calls need guard and call-record coverage,
including genuine unwind calls declared throw(). Audit and remove inappropriate
nounwind assumptions introduced by headers, frontend or O2 before generating
native code. Run no optimizer after instrumentation other than verification;
reinspect MIR/native code for preservation. Do not pass this output to ThinLTO.

Link final objects with genuine GNU/C++ ABI libraries, `wasm-ld --no-entry
--shared-memory --import-memory --export-table`, real stack/memory sizes and
`--error-limit=0`, retaining link map and exact ordered object list. No
`--allow-undefined`, `--unresolved-symbols=ignore-all`, abort wrapping or
replacement pthread/cleanup symbols. Then `wasm-validate --enable-all` and
actual native/FPCAST Linux guest harnesses against the selected production
host-control runtime. Include the complete old regression payload, rebuilt for
the new jump ABI and instrumentation. Track task storage at every stage.

## Acceptance and expected failure edges

| Gate | Required observed evidence |
| --- | --- |
| Per-frame semantics | Real nonzero CFA in descriptor bounds, owner/epoch/ancestry correct, stop called once before each original cleanup, valid root END if exercised. Include zero-local/equal-SP frames, recursion, dynamic alloca, over-aligned locals, indirect calls and nested pads. Uncovered guest callee must reject, not skip a frame. |
| Genuine C++/C cleanup | Interleave nested RAII destructors, public C++ pthread cleanup macros, public C cleanup-attribute macros and genuine compatibility chains. Exact order and once-only execution; no destructor on the retained target frame. Throw/catch an ordinary C++ exception inside cleanup, then resume the original forced object. Escape from noexcept destructor must genuinely terminate/abort. |
| Foreign forced handlers | Typed catch does not catch cancellation; catch-all rethrows with exact object identity and all outer destructors execute. Swallowing reaches GNU's `FATAL: exception not rethrown` and process134. Exercise single catch-all and typed-plus-catch-all separately. Test ordinary foreign multi-selector behavior as well. |
| Public exit/join | A genuinely created thread calls public pthread_exit from nested C++/C scopes. Parent joins through public GNU pthread_join and sees the exact return pointer; TLS/TSD destructors and GNU thread freeres execute. Show kernel clear-joinstate and shared futex wake before descriptor/stack reuse. |
| Public deferred cancel/join | Parent calls public pthread_cancel; child first remains alive with cancellation disabled, then enables and reaches public pthread_testcancel. Genuine join returns PTHREAD_CANCELED, all cleanups run once, caller remains unaffected. Include concurrent two-thread exits/cancellations with independent errno, TP, frame chains and exception sessions, plus cancel racing normal completion. |
| Jump interaction | Retain GNU signal-mask restoration, nested direct setjmp, checked owner/stack aborts, manual cleanup-chain tests and subsequent unwind segments. After cancellation jump, TLS frame/session state is empty or exactly the live start_thread target and supports another ordinary C++ exception. Tag0 and tag1 remain distinct. |
| Runtime regressions | Rebuilt allocator/startup/signal/abort/syscall/fenv/stat accepted suites, ordinary C++ native EH, rethrow, destructor order, pthread_once throw/reset/retry and genuine C nested/indirect cleanup. Actual HALT/exec traps still bypass guest catch_all; ordinary JS/native-tag exceptions retain cleanup and exact identity. Real exec with dirty TLS creates fresh target storage. |

Native and FPCAST guests must each exit naturally with zero failing assertions;
separate fatal cases must exit134 with expected GNU diagnostics, and kernel
thread completion must not be mistaken for a caught JS Symbol. Production
HALT_USER/HALT_KERNEL escape identities are actual captured traps; do not
classify an arbitrary `RuntimeError` object as a control event. Terminal process
exit can abandon TLS frame records because the instance/thread ends; exec must
initialize new records/session storage with the new instance and descriptor.

Likely first failures are exception-header layout mismatch, unsupported scoped
guard IR/backend shape, stale or equal-SP jump identity, post-link uncovered
frames, foreign selector dispatch, genuine C++ ABI dependencies, GNU create/
join TLS/stack dependencies, and cancellable-futex/PC boundaries. Retain exact
failures. Passing an early forced-object fixture cannot waive any later public
NPTL gate. Even public lifecycle with user-provided stacks does not complete
default guards, arbitrary async cancellation, general cancellable I/O, full
libc++/loader/CRT/sysroot or Firefox dependency rebuilds.

The next bounded work should start with gates1–2 (ABI and synthetic guard
representability), then real GNU unwind and public lifecycle closure. The
critical path is actual native cleanup and GNU thread termination, followed by
default-stack/guard and syscall-cancellation adaptation, complete GNU archive/
sysroot and coherent C++/Firefox dependencies. It does not advance Nightly by
counting resolved symbols or substituting cleanup-free longjmp behavior.
