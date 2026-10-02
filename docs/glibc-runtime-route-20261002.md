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

The subsequent full-make inventory ran genuine `make -k -j2 lib` and exited 2
after 314.15s, producing 1,565 structurally complete Wasm objects and 168 failed
GNU targets. All objects, failed GNU source snapshots and 26,312 manifest
entries were independently reread with zero differences. This is build
discovery, not a link/runtime pass. The full classification and source-only
loader plan are in [the inventory report](glibc-fullmake-inventory-20261002.md).
Four configure probes lack ephemeral source snapshots and are separate from
the 168 GNU failures. The inventory task is frozen.

Address the 50 C cleanup compiler failures next. In pinned Clang 22.1.8,
[C personality selection](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/clang/lib/CodeGen/CGException.cpp)
does not select the scoped Wasm format used by C++, while
[Wasm EH preparation](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/llvm/lib/CodeGen/WasmEHPrepare.cpp)
handles scoped cleanup/catch pads. Actual GNU C cleanup units reach llc with
DWARF landingpads and crash. An owned minimal frontend hook with an exact
CodeGen archive member/driver relink can preserve GNU C source and emit native
Wasm cleanup pads. Validate unchanged ordinary C and non-EH behavior, all 50
failed units, real nested/indirect cleanup execution, GNU pthread_once
throw/reset/retry and cleanup-throw abort behavior in native/fpcast modules.
Do not suppress cleanup, turn off exceptions or relabel GNU C as C++. The
separate forced-unwind/cancellation runtime gap remains after this fix.

The owned private compiler has now built successfully. Independent archive
inspection verifies all 101 ordered members, including repeated basenames,
with only CGException.cpp.o changed. Ordinary C, disabled-exception C and host
C EH raw IR match the original compiler byte for byte. Native C cleanup emits
scoped pads, cleanupret and an actual abort call when cleanup itself throws.
The first fresh replay compiles 48 of the 50 affected GNU units; pthread_once
and qsort fail on missing generated sem_t-align.h before EH compilation.
The requested make target had no rule; its failure is retained. Genuine GNU
gen-as-const.py with csu/sem_t-align.sym and selected compile flags generates
the header. Retries of only those two units now give 50/50, with all actual
object/source hashes and selected scoped cleanup IR independently checked.
The first combined native runtime links successfully. Its cleanup-throw case
exits through genuine GNU abort with status134, then traps before the existing
suites. Same-payload diagnostic replay confirms that the host HALT_KERNEL
Symbol crosses guest C catch_all: the outer cleanup executes and attempts a
second abort against an already exited kernel task. Exact syscall and stack
evidence is retained in logs/prototypes/real-control-interception.json. The
guest acceptance gate fails; all 120 link inputs and the first payload are
retained. A successful individual negative case does not override that failure.

Isolated Node and Chromium probes distinguish ordinary JavaScript exceptions
from actual Wasm traps. Symbols and constructed RuntimeError objects are
catchable, while direct traps and rethrows of exact captured trap identities
escape guest catch_all. This agrees with the
[Wasm exception-handling trap semantics](https://github.com/WebAssembly/exception-handling/blob/main/proposals/exception-handling/legacy/Exceptions.md#traps).
The next task-local adapter must carry distinct halt and exec controls across
guest frames, classify only their exact identities at the outer JavaScript
boundary, and retain failure reporting for unrelated traps. Acceptance needs
native and FPCAST cleanup/once regression gates, genuine abort134 and actual
exec replacement inside active cleanup: old cleanup must not run and the new
GNU startup/TLS process must exit42. Also restore the linear stack pointer in
the owned native-tag catch helper and verify it after throw and normal return.
The first corrected native Linux gate, guest-native-control-run5, passes
48,374/0 with all earlier suites, nested and indirect cleanup, linear stack
restoration, genuine pthread_once throw/reset/retry, cleanup-throw abort134 and
real raw exec221 replacing an active cleanup frame. The old TLS marker is157;
the target observes fresh zero TLS, sentinel argv, empty GNU cleanup chain and
constructors after valid descriptor/DTV setup, then exits42. The supervisor
exits0 naturally and the browser exits0 with the server closed. The FPCAST
gate also passes 48,373/0. Genuine private-Clang C-pad controls pass in Node and
Chromium: ordinary JS and native-tag exceptions execute cleanup with original
identity; actual traps bypass cleanup; the two exact host-control identities
remain distinct from unrelated errors/traps. The host probe's unexpected-abort
import is never called and is not GNU abort acceptance. Minimal production
integration is authorized, with fresh gates using integrated wasm.js and the
retained task-only raw-TP/futex instrumentation in worker.js. Production gates
now pass native 48,373/0 and FPCAST 48,374/0; all 34 actual input hashes match
per run, guest/browser exits0 and servers close with owned groups empty.
The frozen manifest has 24,626 entries including 1,570 actual includes; all
entries and 29 repository paths were independently reread without differences.
Manifest SHA256 is
`15bcb2d693cb08ced4f962c197a934232c7ff6d29b8c4806459f0a51f5db8e17`;
acceptance is `78d57fed14afdb153ebc3526732ef4fe88924c9e2e1ba593a0d1ae62eb7141e9`.
The commit whitespace check removed one space from an empty line in the
host-control test script, preserving its exact tested bytes separately. The
original packet is unchanged; the corrected 29-path repository freeze SHA256 is
`f96e01cecaf20ed505bb622e6af3ac25ff787585ae2a148726d941e65374d307` under
`/mnt/p6/build/glibc-c-cleanup-checkpoint-20261002`, with the original source
mapping. Executable text is identical. Continue in a fresh task; frozen packet
files must remain unchanged. Details are in
[the C cleanup packet](glibc-c-cleanup-20261002.md). These results are
not full libc or browser acceptance.

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

The 93 failed generated wrappers need a per-entry type and transport audit.
GNU make-syscalls.sh explicitly describes its scalar signature letter as any
signedness or size; it cannot determine a native Wasm C function signature.
The retained generator emits five fixed arguments for prctl, while genuine
sys/prctl.h declares a variadic function. Its native Wasm variadic calling
convention needs a real architecture adapter. The vhangup stream has one
argument although genuine unistd.h declares vhangup(void), and legacy
init_module/delete_module entries encode opaque argument counts. Preserve
GNU aliases and source streams, but verify actual public types and kernel
arguments rather than creating all-long wrappers. Generated mprotect/madvise
also overlap owned memory-provider symbols: select the actual architecture
providers and test their protection/advice behavior against the actual
logical Wasm mappings. A syscall number alone does not implement their semantics.

The eight floating-point header failures have a separate small architecture
fix. GNU include/fenv.h requires FE_TONEAREST even when no other rounding mode
is selectable; its selected generic bits/fenv.h does not define it. A Wasm
bits/fenv.h overlay can preserve the genuine generic types and FE_ALL_EXCEPT=0
while defining only the actual fixed nearest mode. Do not advertise exception
flags or selectable rounding modes that Wasm does not supply. GNU
math/fegetround.c and math/fesetround.c already implement nearest-only behavior;
the public setter rejects other values. Replay all eight actual failed units
and test those public GNU functions, invalid-mode rejection, unchanged errno
and arithmetic at rounding boundaries in native and FPCAST Linux guests.
Keep public and internal-inline behavior distinct: include/fenv.h has trivial
internal setters when FE_HAVE_ROUNDING_MODES is zero. This source review is a
plan, not runtime or full libm acceptance.

The fresh `/mnt/p6/build/glibc-fenv-20261002` replay now passes GNU configure and
metadata generation. All eight selected GNU units compile on the first attempt;
their object and genuine source hashes were independently checked. The private
compiler and 120 runtime objects are reused through exact manifest/snapshot
verification. Public GNU API gates now pass native 48,373/0 and FPCAST 48,384/0,
each with six rounding suites and one concurrent errno suite. All 34 actual
inputs per run independently match; guest/browser exits and service closure
pass. See [the fenv packet](glibc-fenv-20261002.md). Preinclude the
genuine math/fenv.h after libc-symbols.h only for the two public implementation
units and the public fixture: this avoids internal inline substitutes while
preserving aliases/warning metadata. Do not use global _ISOMAC, which removes
libc-symbols machinery.

The final runtime closure contains 123 objects (102 Wasm-v1 and 21 ThinLTO)
plus seven source/module records. Independent rereading verifies all 260
current/snapshot hashes. Both CPIOs contain the exact tested modules, change
only the original init record and add one probe. All ten task supervisor,
runner and browser groups are terminal. The immutable packet freeze is terminal;
root independently reread all 24,032 entries with zero differences, including
1,903 absolute include dependencies (1,570 inherited). Manifest SHA256 is
`c575dc6867d292bb6ca120831ffa7c13e48a7732671d6a190009937f86c17cd1`,
acceptance SHA256
`83f3aed73e22592a1f15bcc1de5682ab4ddc81059db52efe4e349cff5284556e`,
and the exact 17-path repository freeze SHA256 is
`0fca580def5a450211d623223fcda9e58dd381a32d58547e300ec41e01e06619`.
The scoped local Git checkpoint adds this route and AGENTS.md to those 17 paths.
It is committed as `032e8eddddfccc3d88f157224ccd86156d74bc58`; an independent
check confirms the exact 19 paths and frozen blobs, clean index/selected scope,
and unchanged public Sites/release references.

After fenv acceptance, the source-only
[36-wrapper plan](glibc-syscalls-fixed-plan-20261002.md) covers a larger fixed
scalar/pointer group with real public signature and transport audits. Its full
93-entry partition keeps variadic/void anomalies, layouts and memory authority
separate; compile closure must not be mistaken for unavailable kernel facilities.
The fresh `/mnt/p6/build/glibc-syscalls-fixed-20261002` packet is now authorized
under owned `tools/glibc/syscalls-fixed/**`, retaining shared/frozen predecessors.
It must preserve genuine public types, aliases and all previous runtime gates.
Kernel source/binary planning identifies five current ENOSYS APIs (the inotify
trio, timerfd_create and memfd_create) and unsupported ramfs user-xattr storage;
those limitations require explicit capability results and later kernel work.
The first configure invocation failed on a mode0600 C-only adapter and remains
retained. A corrected query-capable Python invocation passes in a fresh object
tree. All 36 selected GNU streams match the original failure snapshots exactly,
and their actual Wasm wrapper objects plus the independent genuine-header
signature/reference object compile successfully. Root independently reread those
streams and object formats. Strengthened binding/header audits pass, and all
36 actual GNU make targets also build through the owned architecture driver;
root independently checked their actual objects, aliases and generated streams.
The first two native failures remain retained: the named fixture tried to
restore bootstrap group0, which setpgid correctly treats as the caller's own
PID. A setsid launcher with an ordinary child supplies a nonzero inherited
session/group. Corrected native 48,465/0 and FPCAST 48,478/0 pass all six public
suites, concurrent errno checks and strict create/restore status0. Root checked
actual modules/CPIOs, all206 final current/snapshot inputs (161 objects plus45
sources/modules), both34 served input sets and terminal supervisor groups.
The [packet report](glibc-syscalls-fixed-20261002.md) records exact identities
and limitations. The immutable freeze has27,077 entries and2,324 actual
includes (1,903 inherited); its SHA256 is
`b17e5f7744e2f4eae6714db5f4544b7e953a18b89a0bf419f89ead66ad2e784f`.
The27-path repository freeze SHA256 is
`30779ffbe42d50af61895e201846304b7d857ad3b0a822a05f379d4649ee21fd`.
Root independently rehashed these before the exact29-path local checkpoint
`a842340e7083ddfb7bf2f4baa8b745e74d91827d`, with all27 frozen committed blobs
matching and public Sites unchanged. No push/deploy.

The [static metadata packet](glibc-libnames-20261002.md) now passes actual GNU
make for the three blocked pthread_cancel/exit/create objects. An architecture
overlay uses GNU's own name-generation recipe and preserves actual typed static
requirements as retained native Wasm relocations, with ten strong references
and GNU's original weak trylock reference. Missing-provider, archive extraction
under GC and native/FPCAST table controls pass. Its frozen manifest has22,982
entries and445 actual compile inputs, SHA256
`b6b7e40986d9eabb7c9abc15b6dea6428883750dd4575da9add9d7efe6288ccd`;
acceptance SHA256
`c968e416b88ea395e2e4747b480d9d16b1f49c08c019468b6fe90f6b26a3d046`.
Ten frozen repository paths precede the scoped local checkpoint, with this route
and AGENTS.md added separately. These selected object/link controls establish
neither cancellation providers nor public pthread lifecycle.
The exact12-path checkpoint is
`4668062c29e0450008de51ba5c5f7a989142f16a`; root independently verified all
frozen blobs and unchanged Sites HEAD.
The [next 26 public wrappers](glibc-syscalls-next26-plan-20261002.md) have a
separate source/binary plan; pivot_root needs historical-export provenance and
four selected facilities have actual bound ENOSYS bodies. Neither these plans
nor the selected compilation establish a complete GNU sysroot. The isolated
next26 replay passes real native48,554/0 and FPCAST48,567/0 guest gates,
retaining all earlier regressions and isolated setsid/chroot/publicexec. Its
191-object link adds genuine GNU sigemptyset/sigaddset. Actual GNU streams,
public types, strong providers/aliases and all26 make targets pass. Retain
the original selector/header/link failures and warning-bearing mount runs.
The pinned kernel mishandles freeing its static default mount source="none";
explicit-source real ramfs mounts pass warning-free, without a kernel patch
or output suppression. Default-source compatibility remains a blocker.
The frozen manifest has27,631 entries and2,736 includes(2,324 inherited),
SHA256 `8a7fd6467b2e0f4811d855472845bd55ffad61e15aaebf02475c871c30be5766`;
acceptance `a12316a740cf22f5f60b5941cf65a4c4e2894c16f94a5a254c15d6d060b6922a`.
Root independently rehashed all entries and28 frozen repository paths after
reviewing both actual payloads,456 current/snapshot input hashes and served
inputs. The freezer ended0 with an empty group. The local checkpoint adds
only AGENTS.md and this route to those28 paths; Sites remains unchanged.
The exact30-path checkpoint is
`a249f2e3a27efbedd2ff0d55c581faccd4ee075e`; root verified all28 frozen
committed blobs and unchanged public Sites HEAD.

The [stat plan](glibc-stat-plan-20261002.md) now has nine genuine GNU-family
objects and eight public header/address checks compiled, with290 inputs
audited. Its architecture selection uses genuine statx291 and GNU conversion
instead of incompatible legacy kernel stat64 layouts. Real native and FPCAST
tests must still verify field/canary/errno, symlink and dirfd behavior,64-bit
sizes and beyond2038 timestamps against independent raw statx, retaining the
191-object runtime regressions. No full GNU sysroot or Nightly is accepted.
The [stat compile packet](glibc-stat-20261002.md) is frozen with23,063 inputs,
including290 actual compile inputs and144 verified borrowed tools. Manifest
SHA256 `e6efcd1c146eb5d559ab782aa5013908cb83f8d487c8005860c727fc19119a1a`;
compile acceptance `275c840812213e186feec0a3ad24183baca207b9b9a13323b4748b8474d03a41`;
12-path repository freeze `a8370c760161a7cc15e6644714ae91fefce818a8cd10b565d2ac396852db317d`.
Root independently rehashed all entries and validated nine actual objects,
five raw statx units and four empty terminal groups. The scoped checkpoint
adds only this route and AGENTS.md; real public runtime tests remain separate.
The exact14-path stat compile checkpoint is
`ecfd442fe473764dbff4a6ec2974835364575b6a`; root verified all12 frozen blobs.
The [independent host controls](glibc-stat-host-20261002.md) pass10,308
assertions through eight genuine public GNU APIs in native and FPCAST23i64,
with synthetic statx transport. They exercise larger-than32-bit inode/size/
blocks, positive/negative time64, device boundaries, contiguous16-byte guards
and unchanged output/real errno on errors. These are conversion controls,
separate from actual guest filesystem acceptance. Frozen23,160-entry manifest
`9c7c8b559980b666eca66dceae7bfd92135c665958b4434c8bbf2e4c186a3285`;
acceptance `069443641269e1ee124741760afbf11d985b578d0ccccdadb641ee4b2dcf448b`;
six-path repository freeze
`17939d07d8f343265eb7bea06ae46f2208e9709f53bd3142dbf014434404f058`.
Root independently rehashed all entries, validated both modules and23-i64
FPCAST type and verified three empty terminal groups. No push/deploy.
The stat host controls are committed as
`444df08f5c2fd4540171649a664f2dcc8250b6df`. Final real stat attempt3 now passes
native48,633/0 and FPCAST48,640/0 with contiguous16-byte guards, actual time64
values beyond2038 and eight genuine GNU public APIs. All prior runtime
regressions remain. Root independently verified203 objects,221 source/object/
module records,543 dependency records, both packaged modules, served inputs
and26 empty owned groups. Preserve the failed caller-errno fixture and passing
prior payloads with incomplete padding coverage; they do not replace the final
gates. The frozen stat runtime manifest contains27,892 entries, SHA256
`4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042`;
its exact22-path repository freeze is
`0aab221e0a60f34525b128a80fb4e95d0e7e54dd228fd245e155cb09ef1ab80c`.
See [the stat runtime report](glibc-stat-runtime-20261002.md).

The [remaining closure plan](glibc-remaining-closure-plan-20261002.md) identifies
43 original failures with no dedicated later target rebuild. The36+26 wrapper
packets cover62 original generated failures; the other17 of79 cumulative
wrappers predate the inventory. This count is source/target reconciliation,
not a fresh fullmake result. Four scheduler/semaphore targets have now compiled
and both real guest gates pass: native48,573/0 and FPCAST48,584/0. Root
independently rehashed47,123 manifest entries,30 repository files and201
objects, checked exact payload bytes in both CPIO archives and eleven empty
owned groups. Actual GNU public scheduler policy restoration and five
nonblocking semaphore APIs are accepted; blocking sem_wait and public NPTL
lifecycle/cancellation remain unaccepted. See
[the scheduler/semaphore report](glibc-sched-sem-20261002.md).

In parallel, a fresh cumulative genuine make -k -j2 lib discovery build combines
accepted frozen compiler/header/typed-wrapper/libnames/stat overlays, without
copying fixture libc objects or depending on mutable scheduler inputs. Its
second make returned exit2 naturally after359.14s, producing1,690 complete
Wasm objects,36 GNU text stamps andzero archives/partial outputs. Of the168
original failed targets,125 now compile and43 still fail; newly exposed
io/xstatconv.o is a distinct44th failure. The scheduler overlay was not part
of this build. Agent audit is complete, root independent review/freeze pending.
These actual failures and archive/header results drive the next implementation.
These are steps toward the complete GNU sysroot; they do not
establish a complete libc, public NPTL lifecycle or Firefox Nightly baseline.

The [owned libio alias adapter](glibc-data-alias-20261002.md) compiles retained
genuine GNU vtable IR and passes eight independent linked pointer/dispatch
controls, seven malformed frontend and eleven malformed object rejections.
It preserves table offsets168/420 and corrects only LLVM's alias extent fields
to GNU's84bytes; code/data/relocation sections remain byte-identical. The final
58-entry evidence and five repository files are frozen. Fresh genuine
libio/vtables.o rebuilding/integration is separate and pending, followed by
the newly exposed distinct legacy104-byte kernel-stat provider/converter.

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
