The requested release remains Firefox Nightly 159 running as native Wasm in
Linux, using GNU glibc, with working JavaScript JIT, then Firefox GPU support
and verified Sites deployment. The current public v10 remains Firefox 128 ESR.
This document records source review and required acceptance, not a completed
toolchain or a successful browser build.

The allocator, startup TLS, signals, signal jumps and initial GNU-generated
syscall packets provide bounded prerequisites. Their standalone fixtures and
large assertion counts do not establish a complete libc/sysroot or general
pthread runtime. Read the corresponding acceptance reports before reuse.

Continue actual GNU make, using fresh signed-source replay and owned architecture
overlays. Frozen generated-syscall run3 exits2 on unaudited sigaltstack and GNU
ELF warning directives. GNU include/libc-symbols.h distinguishes link_warning,
static_link_warning and stub_warning. Makerules' stubs target extracts
.gnu.glibc-stub.* section names to generate __stub_* macros. An architecture
adaptation must preserve those names and warning text; it must not silently
erase unsupported-function metadata. dlmopen's static-link warning does not
mean dlmopen is an ENOSYS stub. Test sigaltstack's genuine kernel ENOSYS with
its exact GNU stack_t signature; the kernel does not support alternate stacks.

The next isolated fullmake-warnings task preserves genuine revoke and Linux
sigstack warning bytes in Wasm custom sections. Its actual GNU Makerules stubs
target, using llvm-objdump, emits __stub_revoke and __stub_sigreturn and correctly
omits sigstack. That recipe is unchanged; the source tree retains the previously
reviewed wasm32 abi-versions.h generation hook elsewhere in Makerules. Warning
metadata preservation alone does not provide native linker warning enforcement.
Full GNU make now passes those units and generated sigaltstack, then exits2 on
dlfcn/dlmopen.c's unsupported __builtin_return_address. The isolated packet's
real guest gates pass native 48,366/0 and FPCAST23i64 48,373/0, each including
six warning/ENOSYS suites and the earlier syscall, jump and abort regressions.
These checks verify unsupported alternate stacks return ENOSYS and leave output
unchanged, not alternate-stack support. The final manifest contains 23,234
entries including 1,118 actual includes; an independent reread finds zero
differences, as does the separate check of all 116 actual link objects. Its
SHA256 is 93042d98f3330664ec32a7ee22d9bda6ea84ffb977de779a0f363ccb67cdd3cb.
The task is frozen; continue in a new owned task.

Resolve caller provenance and native loader semantics explicitly. GNU
elf/dl-open.c uses the caller's map for namespaces and RPATH/RUNPATH;
elf/dl-sym.c requires it for RTLD_NEXT. Returning null for every return-address
builtin cannot establish those semantics. Nightly NSPR prlink.c has registered
static-library tables through PR_LoadStaticLibrary, but its initialization and
ordinary lookup still call dlopen/dlsym. A native architecture route must cover
the required process/static handles and symbol tables, preserve public APIs,
and report unsupported ELF loading or namespaces honestly. Compilation alone
does not prove loader behavior, and silently dropping selected dlfcn APIs is
not completion of the runtime.

Then complete syscall/structure adaptation and a genuine static archive/header
installation. Audit every selected generated wrapper against GNU C signatures
and actual kernel argument widths. off_t/time_t are 64-bit although pointers and
long are 32-bit. Require file offsets and truncation beyond 4 GiB, stat/statx field
conversion, time64 errors/overflow, public aliases and thread-local errno tests.
Compile/link closure and installed headers must identify genuine GNU sources
and owned providers, with no musl/WASI objects or unresolved-symbol suppression.
Archive production is one gate; it does not prove startup or threading works.

General startup must integrate the actual kernel args245 data, static linker
TLS template, GNU descriptor/DTV, constructors and native memory providers.
The raw GNU thread pointer and LLVM __tls_base are separate. Replace fixture-only
reservations with bounds derived from each production module. Validate several
independently linked executables, initialized/zero TLS, arguments/environment,
auxiliary values and concurrent workers without replaying global initialization.

Genuine NPTL requires an architecture clone adapter to the kernel's custom
clone220 callback ABI, installing the child Wasm stack before its first C frame.
GNU parent publication, CLEAR_TID/joinstate wakeups and cleanup remain necessary.
Require repeated join/detach lifecycles, TLS/errno isolation, mutex/condition
contention and timed waits, keys/destructors, once and supported robust-mutex
behavior. These tests must call genuine public GNU APIs; manual descriptor and
cleanup-chain fixtures are earlier prerequisites.

GNU nptl/allocatestack.c adds MAP_STACK to anonymous mappings and uses
MADV_GUARD_INSTALL or mprotect(PROT_NONE) for guard regions.
sysdeps/nptl/pthread_early_init.h defaults guardsize to the page size. The current
owned wasm-memory.c accepts only anonymous RW mappings without MAP_STACK and
rejects mprotect; it cannot satisfy default thread allocation unchanged. A
native architecture adaptation must define and verify stack allocation and
overflow behavior honestly. Caller-supplied stacks or guardsize0 are useful
initial lifecycle cases, but do not establish default pthread_create support.
Do not return success for protection requests that are not enforced.

A source-confirmed additional gap must be resolved for cancellation and C++
cleanup. GNU nptl/unwind.c calls _Unwind_ForcedUnwind, _Unwind_GetCFA and
__libc_unwind_longjmp. LLVM 22.1.8's
[Wasm runtime](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/libunwind/src/Unwind-wasm.c)
does not implement the first two APIs, while
[UnwindLevel1.c](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/libunwind/src/UnwindLevel1.c)
excludes Wasm from its ordinary implementation. LLVM's
[Wasm EH preparation](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/llvm/lib/CodeGen/WasmEHPrepare.cpp)
explains that the VM unwinds and generated landing pads call the personality.
An ordinary missing-library fix cannot supply native stack inspection. Design
and verify a native Wasm architecture/compiler integration that preserves
cleanup execution and the GNU cancellation boundary. Plain longjmp is not
acceptance of C++ forced-unwind semantics. Require nested C++ destructor tests,
pthread_exit and deferred cancellation of blocked operations, exactly-once
registered cleanup and PTHREAD_CANCELED joins. The kernel supplies no interrupted
PC and polls signals at boundaries; do not claim busy-loop asynchronous
cancellation or allow EH to escape a live kernel signal callback.

Rebuild compiler-rt, libc++/libc++abi/libunwind and the browser's C/C++/Rust and
GTK/GLib/X11/NSS dependencies against one verified GNU sysroot. The current
early-IR jump compiler is a bounded diagnostic driver: production optimization,
PIC/LTO/debug and C++ EH flags need independent validation. Audit the known
Wasm member-function-pointer ABI trap coherently across dependencies. Reusing
an old musl archive under a GNU target name does not satisfy the release.

Nightly mozglue/misc/MmapFaultHandler.h selects its Linux sigsetjmp path unless
XP_DARWIN, XP_WIN or __wasi__ selects another branch. MmapFaultHandler.cpp then
requests SA_ONSTACK and siglongjmp from a SIGBUS callback. The accepted GNU
signal adapter rejects alternate-stack requests, and native EH cannot escape
the live kernel callback. The planned native target therefore needs an owned
build/runtime adaptation matching its actual malloc-backed mmap semantics,
or genuine signal-fault support before enabling that path. Defining __wasi__
to hide the incompatibility is not acceptance of the Linux/GNU target. Inspect
the selected compile flags and these exact sources during browser integration;
also extend the early-IR jump driver to actual C++ clients when needed.

Only then accept a complete Nightly baseline: actual version/build identity,
cold/warm launch, TLS navigation, DevTools, local media, persistent profile and
update behavior. Apply the reviewed Nightly PBL API migration and verify runtime
Wasm JIT installation, checksums, bailout/GC/shape guards and paired benchmarks
against that baseline. Expand integer loops, control flow, doubles/arrays and
properties/Math with correctness and performance evidence. Firefox GPU follows
on the same accepted build; old Firefox 128 wgpu IDs/goldens are incompatible with the
new source. Preserve the existing Sites release until the candidate's browser,
JIT, GPU and update gates justify promotion and verified public deployment.
