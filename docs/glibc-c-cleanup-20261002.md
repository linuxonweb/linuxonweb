# GNU C cleanup on native Wasm — 2026-10-02

Genuine GNU glibc C cleanup functions previously emitted DWARF landingpads
that the Wasm scoped-exception backend could not lower. The owned Clang
22.1.8 frontend hook selects the existing Wasm personality for C when Wasm
exceptions are enabled. GNU files remain C and retain cleanup and termination
behavior. Exact-source rebuilding replaces only CGException.cpp.o in the
private CodeGen archive; installed toolchains and source clones are untouched.

The task is `/mnt/p6/build/glibc-c-cleanup-20261002`. Compiler controls, all
50 selected GNU C units, and both integrated Linux runtime gates pass.
This accepts the bounded cleanup packet; a complete libc/sysroot and browser
release remain unfinished.

## Compiler and GNU build evidence

All 101 ordered CodeGen archive members, including duplicate basenames, were
checked independently. Only CGException.cpp.o differs. The private compiler
SHA256 is `14e5a2bba14dbb867273e91628d3d27263cce1b13d6ca0bbe12b91d81f94dc7c`.
Ordinary C, disabled-exception C, host C exception IR and native C++ exception
IR match the original compiler byte for byte. Ordinary and disabled-EH Wasm
objects also match. Native C exception IR contains genuine scoped cleanup
pads and cleanupret, plus the abort path when cleanup throws during unwinding.

All 50 GNU C units identified by the frozen full-make inventory now compile.
The first replay passed 48 and failed pthread_once/qsort on missing generated
sem_t-align.h. An unsuccessful make target is retained. Genuine GNU
gen-as-const.py with csu/sem_t-align.sym and the selected GNU flags generated
the header; only those two failed units were retried. All 50 object/source
hashes and their scoped-cleanup IR were independently reread. This does not
claim that the full GNU make or an archive/sysroot passes.

## Host control across guest exception handlers

The first linked Linux payload failed after its cleanup-throw test reached
GNU abort and exited 134. Same-payload replay established the cause: the host's
HALT_KERNEL Symbol was caught by the outer guest C catch_all. That cleanup
then called abort a second time against an already exited kernel task.
`logs/prototypes/real-control-interception.json` retains the exact syscalls
and stack frames. The failed payload and all 120 link inputs are retained;
99 inputs are Wasm objects and 21 are genuine ThinLTO bitcode.

The shared runtime now captures two distinct errors from an import-free Wasm
`unreachable` function before entering guest frames. One carries kernel halt;
the other carries user exec replacement. Only their exact identities are
recognized. Halt propagates through guest and kernel frames to the outer
worker boundary; exec is consumed by the outer user-call loop, which starts
the replacement module. Existing Symbol comparisons remain for compatibility.
Ordinary error handling remains unchanged.

Actual traps bypass Wasm catch_all even when rethrown through JavaScript;
constructing a RuntimeError does not have that property. This follows the
[Wasm exception-handling trap semantics](https://github.com/WebAssembly/exception-handling/blob/main/proposals/exception-handling/legacy/Exceptions.md#traps).
Node and Chromium probes confirm it. Genuine private-Clang C-pad controls
also prove that ordinary JS and native-tag exceptions still execute cleanup
and preserve exception identity, while real traps skip cleanup. Unrelated
traps and same-message constructed errors do not match the control identities.
The freestanding host probe's unexpected-abort import is never called; real
GNU abort acceptance comes from Linux execution below.

## Linux runtime gates

The owned native-tag catch helper saves the actual linear stack pointer and
restores it on a typed exceptional catch. Fixtures check stack equality after
nested/indirect throws, normal return, loop continue/break and GNU once calls.
Genuine public pthread_once throws from its initializer, resets control and
restores the GNU cleanup chain, succeeds on retry and does not run again.
Errno and TLS remain valid across ordinary guest exceptions.

The task-local host-control prototype passed native 48,374/0 and FPCAST 48,373/0.
The actual integrated runtime then passed native 48,373/0 and FPCAST 48,374/0.
Each run retains six executions of the new cleanup/once fixture and
the earlier allocator, startup, signal-jump, generated-wrapper and warning
suites. Counts vary with existing concurrent checks; zero failures and the
specific assertions establish acceptance, rather than an exact count alone.

Separate early processes prove cleanup throwing during unwinding reaches
genuine GNU abort and exits 134. Raw kernel exec221 is called inside an active
cleanup frame with dirty old TLS 157 and state. Old cleanup must not execute.
The replacement validates sentinel argv, fresh zero TLS, empty GNU cleanup
chain, descriptor/DTV and constructors after startup, then calls GNU _exit(42).
This is raw-kernel exec transport proof, not GNU public execve acceptance.

Guest execution serves the integrated production wasm.js. Its task-local
worker differs only by the retained raw-TP adapter exclusion and allocator
futex diagnostics; `logs/production-worker-only-diagnostics.patch` records
that difference. Production GNU TLS ABI selection remains a later task.

## Limits and continuation

This packet does not implement GNU forced unwind, cancellation, C++ exception
runtime, complete NPTL lifecycle, loader/CRT, a production GNU sysroot, Nightly,
new Firefox JIT or Firefox GPU. LLVM's Wasm forced-unwind/GetCFA gap remains.
The next bounded architecture packet is the fixed-rounding fenv selection and
eight real failed GNU units, followed by the remaining audited syscall/loader/
thread closure. See [the runtime route](glibc-runtime-route-20261002.md).

The public Sites release is unchanged. Initial failures, diagnostic replays,
prototype scripts and actual command/source snapshots are retained rather
than reclassified as successful runs.
