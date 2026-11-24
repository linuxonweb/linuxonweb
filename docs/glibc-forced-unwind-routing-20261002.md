# Native Wasm exception routing prerequisite — 2026-10-02

This separate packet fixes the measured ordinary exception SP leak and runs genuine LLVM Wasm raise/delete functions with the GNU exception ABI. It is a first routing gate, **not** GNU forced-unwind, typed/foreign C++ catch acceptance, pthread lifecycle, a complete libc/sysroot, or Nightly acceptance. `completeDesignPass=false` remains explicit.

Owned sources: `tools/glibc/forced-unwind-routing/**`. Artifacts: `/mnt/p6/build/glibc-forced-unwind-routing-20261002`. The original design and prototype are unchanged; the audit independently rereads all 31 predecessor source/tool pins and 24 predecessor object pins. Root owns review, Git and any later freeze. No kernel, Nix source/toolchain, previous task, shared route document, browser or service was changed.

## Actual SP repair and exception routing

The finite post-O2 IR adapter instruments exactly five fixture functions: `fixture_run`, `fixture_middle`, `fixture_inner`, `fixture_cpp_middle`, and `fixture_cpp_inner`. Each owns a 32-byte aligned linear-memory frame record. Its CFA is the actual caller SP captured immediately before an instrumented call; the root entry receives the exported native `__stack_pointer`. CFA bounds and frame ownership are checked at entry and each stop. It is neither a null return address nor an invented constant.

Ordinary cleanup escape first restored the captured CFA through `llvm.stackrestore`; the backend still left SP at 65488 after starting at 65536. The retained first routing execution failure is `logs/shape-execute.log`; matching native disassembly and per-command adapter source snapshots are retained. LLVM lowers STACKRESTORE into its local SP register; the cleanup rethrow path did not publish that local register to the linear-stack global. The fix restores the local register, leaves the actual frame record, then calls the owned native leaf `prototype_restore_stack` with that same captured CFA. This leaf writes `global.set __stack_pointer` and allocates no stack or callback state. Final native disassembly contains the writeback before the cleanup rethrow path. No compiler/backend tree was modified.

Each original tag0 exception enters a separate may-throw stop guard. If the stop returns, `catchret` leaves the guard and an owned helper throws a new native tag0 carrying the **exact same exception-record pointer** into the original cleanup. This is native VM throw forwarding; it is **not direct rethrow**, and host `WebAssembly.Exception` wrapper identity is not preserved. The original cleanup runs once. A stop-produced tag1 unwinds the guard to the genuine native SjLj machinery, without first executing the retained target's cleanup. The target cleanup then runs once when that frame returns. The original direct-rethrow verifier failure and original 48-byte leak remain in the immutable predecessor packet.

The final zero-import native module uses genuine `_Unwind_RaiseException` and `_Unwind_DeleteException` from LLVM's `Unwind-wasm.c`, compiled against genuine GNU `sysdeps/generic/unwind.h`. Sixteen repetitions each of ordinary tag0 escape, nested C tag1 stop, and nested C++ destructor tag1 stop yield **48 cases / 336 checks / zero failures**. They verify exact GNU record identity in the stop and at host escape; cleanup sequences `2,1,9` or `4,3,9`; three stops; no live record; restored SP; and real DeleteException invoking the original record's cleanup exactly once with `_URC_FOREIGN_EXCEPTION_CAUGHT` after ordinary escape. `logs/shape-results.json` holds every row. The first SP-writeback-only pass (48/320) is retained separately in `objects/initial-SP-writeback-pass/shape.wasm` and its report; those supplementary copied objects are not represented as a coherent historical link manifest.

The exception record here is a statically owned diagnostic foreign record, not a heap-owned C++ exception. The fixture's diagnostic `abort` trap is not called in passing cases and is not GNU fatal/abort acceptance. Stop behavior is still `prototype_stop`; no `_Unwind_ForcedUnwind`, `_Unwind_GetCFA` or GNU `unwind_stop` substitute is claimed.

The adapter now rejects an unknown definition, an unknown direct call, and an indirect call, each with exit3. Exact negative IR and logs are retained in `source/negative-*.ll` and `logs/coverage-*.log`. Compiler coverage remains finite. Runtime helpers are explicit diagnostic boundaries; they are not evidence of arbitrary C/C++ or GNU-library frame coverage. No subsequent optimization or LTO runs after adaptation.

## Coherent GNU / libc++abi measurements and bounded closure

Fresh C and C++ measurements distinguish GNU `_Unwind_Exception` **24 bytes / alignment8** from LLVM's installed-header **32 bytes / alignment16**. Both have class offset0, cleanup offset8, private fields at12/16, 64-bit class and 32-bit pointers. The LLVM declaration must not silently replace GNU's embedded pthread exception record.

The actual GNU header is copied unchanged into a coherent include directory; a compatibility header adds only C typedef names for the existing GNU struct tags. Genuine libc++ headers are consumed with public GNU headers (`_ISOMAC`) and actual Linux/Wasm UAPI headers. `__config_site` is generated from the pinned LLVM template, and `__assertion_handler` is copied from the genuine LLVM default handler template according to CMake's COPYONLY rule. The selected config uses ABI1/`__1`, pthread threads, no musl/WASI, standard feature declarations, hardening mode2 and assertion semantic32. GNU source was not reinterpreted as C++.

The actual CMake C++23 flags and `_LIBCPP_BUILDING_LIBRARY` / `_LIBCXXABI_BUILDING_LIBRARY` definitions allow all **11 unchanged** exception units to compile: `cxa_exception`, `cxa_personality`, `cxa_exception_storage`, `cxa_aux_runtime`, `cxa_handlers`, `cxa_default_handlers`, `private_typeinfo`, `abort_message`, `fallback_malloc`, `stdlib_exception`, and `stdlib_typeinfo`. Actual dependency-only replay records full includes, including system headers, without rebuilding these objects. Every selected dependency is pinned and imported source snapshots are retained.

A separate zero-import native probe measures actual `__cxa_exception` and `__cxa_dependent_exception` at **72 bytes / alignment8**, with the GNU unwind record at **offset48**; real header static assertions pass. `__cxa_eh_globals` is8 bytes. These are measured values, not an assumed replacement layout.

The owned `Unwind-wasm-gnu.c` is a minimal adaptation of the pinned LLVM unit: it selects the actual libunwind config instead of the identically named GNU configure header and matches GNU `_Unwind_GetLanguageSpecificData`'s `void *` declaration with a pointer return/cast. It uses the genuine static hidden-symbol configuration and release `NDEBUG` trace configuration; no libc logging stubs are provided. `_Unwind_CallPersonality` remains the original SEARCH_PHASE implementation. Forced selectors and real forced-unwind state are not implemented.

Genuine typed catch/rethrow and foreign catch/rethrow probes compile. Their unsuppressed final link **fails** on these 14 distinct symbols: `__assert_fail`, `__cxa_demangle`, `abort`, `aligned_alloc`, `fprintf`, `free`, `memcpy`, `memset`, `operator delete(void*, unsigned long)`, `pthread_mutex_lock`, `pthread_mutex_unlock`, `stderr`, `strcmp`, and `vfprintf`. Both failed attempts are retained, the second with unlimited diagnostics. No typed/foreign module executed, no missing symbol was replaced with a stub, and no ownership, rethrow or fatal-on-swallow acceptance follows from compilation.

## Retained evidence and next gate

`logs/commands.json` contains actual argv, source snapshot, PID/PGID, exit and terminal group status for every supervised invocation. All 143 owned groups independently recheck empty. A finite 300-second deadline applies per script invocation; each child has its own process group. Task storage is about54 MiB on ext4, below2 GiB; each launch checks the5 GiB hard stop, and initial free space exceeds the8 GiB reserve. TMP/TMPDIR/TEMP/cache are task-owned. Sources and outputs are retained by attempt; output copying was added during this task, so early intermediate object versions are not all independent artifact pins. Early source snapshots, commands, logs, final objects, the first successful module and the immutable predecessor remain available. The `cxxabi-compile-results.json` summary was accidentally overwritten with an empty array during an unwind-only attempt; the actual commands/logs were retained, and `cxxabi-final-compile-results.json` derives the real final successful units from those commands.

`acceptance.json`, `source-provenance.json`, `object-provenance.json`, `logs/terminal.json`, and per-case reports are review artifacts, not a frozen acceptance of the complete design. Source/tool and object readbacks have zero differences. Root should inspect their hashes before any checkpoint. Replay entrypoints are:

```sh
export TMPDIR=/mnt/p6/build/glibc-forced-unwind-routing-20261002/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR" PYTHONDONTWRITEBYTECODE=1
python3 tools/glibc/forced-unwind-routing/run.py
python3 tools/glibc/forced-unwind-routing/prepare.py
python3 tools/glibc/forced-unwind-routing/cxxabi-compile.py
python3 tools/glibc/forced-unwind-routing/layout-execute.py
python3 tools/glibc/forced-unwind-routing/build-shape.py
python3 tools/glibc/forced-unwind-routing/execute.py
python3 tools/glibc/forced-unwind-routing/coverage.py
python3 tools/glibc/forced-unwind-routing/cxxabi-compile.py --probe-only
python3 tools/glibc/forced-unwind-routing/probe-link.py
python3 tools/glibc/forced-unwind-routing/cxxabi-compile.py --deps-only
python3 tools/glibc/forced-unwind-routing/audit.py
```

The next gate must link the real GNU core/allocator/abort/stdio/mutex dependencies and genuine libc++abi demangle/delete units, initialize actual compiler TLS and GNU TP, and execute typed and foreign identity/destruction/rethrow fixtures. It must extend verified frame coverage to typed catchpads and every participating real runtime call; unknown and indirect paths continue to reject. Only then may forced state drive GNU action flags/cleanup selectors and real `_Unwind_GetCFA` backed by the measured frame records, followed by unchanged GNU `nptl/unwind.c`.

GNU's `unwind_cleanup` invokes `__libc_fatal("FATAL: exception not rethrown\n")` when a foreign catch swallows cancellation. That fatal must execute through genuine GNU abort; deleting a diagnostic static foreign record is not this gate. Real public `pthread_exit`, deferred cancellation and eventual `pthread_join`, nested C++ destructors/C cleanup exactly once, ordinary C++ EH, native jumps and allocator regressions remain mandatory. Current frame state is module-global and single-instance: it does not establish TP/TLS isolation, concurrent ownership, Linux guest execution or host halt/exec integration. Async cancellation of a busy loop remains limited by the kernel's lack of interrupted-PC delivery. Default stacks/guards and complete NPTL are separate unmet prerequisites. GNU libc → Nightly159 → native JIT → GPU → verified Sites remains the overall objective.
