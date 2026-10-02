GNU-generated syscall wrappers now run in both real Linux/Wasm guest modes.
Native passes **48,363/0** and FPCAST23i64 **48,358/0** under
`/mnt/p6/build/glibc-generated-syscalls-20261002`. Each run requires six
syscall-specific PASS suites, six native-jump suites, three checked-jump abort
diagnostics, all five unwrapped GNU abort modes, concurrent real GNU allocation
and final exit0. Both browsers exit0 and their task servers close.

The owned backend compiles GNU make-syscalls.sh's exact generated stream as C,
with unchanged GNU weak aliases and hidden macros. A Linux/wasm32 Makefile
override captures stdin before the frozen early-IR jump compiler driver.
Explicit GNU return/argument types replace unsafe generic long prototypes;
macro expansion resolves the real asm-generic kernel number. The GNU header
signature audit verifies 18 public signatures, i32/pointer widths and separate
64-bit off_t/time_t. An unaudited off64 lseek instantiation fails compilation
with the declared architecture diagnostic.

The 17 selected generated wrappers are getpid/getppid/gettid, getuid/geteuid,
getgid/getegid, kill, dup/dup3, chdir/fchdir, mkdirat/unlinkat/readlinkat,
fchmod/fchown. Tests call public and internal aliases, compare kernel identities,
deliver actual kill/raise callbacks, verify invalid-signal and invalid-FD errno,
duplicate a real `/init` descriptor, and check missing-path errors. Successful
calls preserve GNU thread-local errno. Three explicitly private close template
instances exercise normal -1+errno, raw NOERRNO and positive-error ERRVAL with
valid and invalid descriptors. Selected Linux close.c remains cancellable and
is not provided by these probes. File open/close use genuine GNU nocancel code;
the fixture's read is a direct kernel call. dup3 is compiled and type-audited,
without a separate guest assertion. renameat's template signature is unselected
and untested.

`logs/selected-syscalls.json` pins exact GNU generated rules/streams.
`logs/guest-link-inputs.json` records actual object hashes and GNU alias symbols.
The old owned __getpid/__gettid provider object is absent from this new payload.
ThinLTO folds generated wrappers into lto.tmp in the link map; exact input
objects are retained. Genuine GNU core/allocator/abort/jump sources and owned
architecture providers remain distinct. No --wrap=abort, cancellation stub,
musl/WASI linkage or unresolved-symbol suppression is used.

The native module SHA-256 is
`074f56fdecff9a7829347b9ef6ac1c62e738a6899f6e3f9ab57240d69f35ccfa`;
FPCAST is `bb185d20972b06dc9c1c6c1113bb1af03f8a38a60e548f7834d5e6c9b7278857`.
`accepted-runtime-before-final-make.json` preserves these before diagnostics.
GNU jmp_buf remains 156/alignment4, backend buffer24, descriptor1184/alignment32.
Startup still uses static fixture reservations and the single-arena test policy,
with true linker main-stack bounds and explicit child stacks. Genuine NPTL
cleanup code is exercised with manual chains; general pthread creation,
cancellation and C++ cleanup remain untested. The old launcher/rootfs sits
outside the new GNU payload closure.

The genuine fresh-tree GNU make diagnostic remains **FAIL**, exit2. Run1 failed
because __kill's generic long signature conflicted with GNU int(pid_t,int), and
SYS_ify received an unexpanded macro. Its generator stream, commands and
diagnostics survive, but its pre-correction template bytes were not snapshotted;
this historical replay limitation is explicit. Exact run2 source snapshots and
hash-addressed snapshots for subsequent invocations are retained. Run2/run3 get
past generated kill and fail at signal/sigaltstack.o's unaudited signature, plus
signal/sigstack.o's GNU dangerous-function link_warning and dlfcn/dlmopen.o's static_link_warning
ELF `.section`/`.previous` assembly. No warning suppression or ENOSYS stub is
counted as implementation.
Earlier dependency-enumeration failures are retained separately; corrected
enumeration uses actual accepted compile flags and full system-header deps.

Next bounded work should audit GNU stack_t against kernel UAPI, implement its
exact wrapper and test the kernel's real ENOSYS without claiming altstack
support; preserve GNU warning text through a narrow Wasm metadata mechanism;
then run bounded make to the next blocker. Remaining generated APIs need typed
i64 splitting, pointer/structure conversion and cancellation semantics where
applicable. The early-IR pass must apply coherently to every jump client; generic
returning setjmp wrappers remain excluded by the compiler-only contract.
Production compiler flags, CRT/NPTL, a complete GNU libc/sysroot, dependency
rebuilds and Firefox Nightly159 remain pending before JIT/GPU/Sites.

Replay and test commands are in [the syscall README](../tools/glibc/syscalls/README.md).
The signed GNU archive and foundation/jump patches remain frozen; all new build
artifacts, failed inputs, browser profiles and evidence are confined to the task.
No release/Sites refs, deployment or Git checkpoint changed in this packet.
