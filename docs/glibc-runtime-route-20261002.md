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
of this build. Root independent review and terminal freeze now pass:47,442
manifest entries, exact15 repository paths, manifest
`dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09`.
The frozen discovery report's earlier pending wording predates this review.
These actual failures and archive/header results drive the next implementation.
These are steps toward the complete GNU sysroot; they do not
establish a complete libc, public NPTL lifecycle or Firefox Nightly baseline.

The [owned libio alias adapter](glibc-data-alias-20261002.md) compiles retained
genuine GNU vtable IR and passes eight independent linked pointer/dispatch
controls, seven malformed frontend and eleven malformed object rejections.
It preserves table offsets168/420 and corrects only LLVM's alias extent fields
to GNU's84bytes; code/data/relocation sections remain byte-identical. The final
58-entry evidence and five repository files are frozen. Fresh genuine
libio/vtables.o now compiles unchanged GNU source into a5,242-byte native
object. Root independently checked364 actual dependencies, seven stages,
strong84-byte aliases at168/420 and eleven unchanged non-linking sections.
Its terminal freeze is underway; undefined GNU providers remain. The newly
exposed distinct legacy104-byte kernel-stat provider/converter is assigned
separately, preserving public stat version0 and the128-byte time64 ABI.

The [final16 wrapper packet](glibc-syscalls-final16-20261002.md) is now frozen
and independently reviewed: native48,728/0 and FPCAST48,719/0,231 link objects,
16 actual GNU make targets,36 repository paths and96,238 manifest entries.
Manifest `888d4947e801e9c3ecc5c58c194751964be069c8ed993284c846da4c4c105266`.
Root verified the actual packaged modules and unchanged base records except
the launcher and new probe. Thirteen unsupported APIs expose genuine ENOSYS.
The frozen report's pending review status predates this completed review.

The [checked-jump compile packet](glibc-checked-jump-make-20261002.md) closes
the actual GNU source-selection failure using separately selected native
ordinary/checked providers with byte-preserved accepted helper bodies.
Root froze/reviewed22,551 entries and five repository paths. Exact GNU-built
object substitution is now running through real native/FPCAST guest gates,
including all three invalid checked-jump fortify exits; it is not yet accepted.

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

Root completed the frozen readback of the actual GNU libio/vtables.o compilation
and checked-jump object substitution: 142,601 manifest entries and 23 exact
repository paths, with native48,709/0 and FPCAST48,730/0 guest results. Both
actual archives contain the verified modules, retaining every base record except
the test init launcher and adding only the probe. The vtables object proves
compilation and alias metadata; it does not prove complete stdio execution.
The checked-jump runtime proves two selected GNUmake-owned architecture objects
retain the established native ABI and checked failure behavior, with230 other
runtime objects unchanged. These completed reviews supersede older pending-review
wording in the immutable reports. Root evidence:
`/mnt/p6/build/glibc-root-checkpoint2-review-20261002/proof.json`.

The actual GNU legacy converter and memory providers are now separately frozen
and independently reviewed:47,053 entries and 32 exact repository paths, root
proof `/mnt/p6/build/glibc-root-checkpoint3-review-20261002/proof.json`.
Legacy104-byte kernel input converts through GNU bodies into public128-byte
version0 data with24,612/0 synthetic checks in each mode. The six GNU units and
three precise guarded duplicate-case labels retain public-version semantics.
Memory13 actual make units retain unchanged GNU sbrk and separate logical break
from mapping placement; native/FPCAST host291/0 includes genuine public-header
indirect calls. Regenerating stale owned sysd-syscalls selects mprotect/madvise
providers without modifying the GNU generator. This is compilation and bounded
host behavior, not default NPTL or exact-object real Linux guest acceptance.
General advice liveness/ownership and invalid remap flags still need review;
physical protection, default stack guards, files/shared mappings remain absent.
No later fresh fullmake pass or Nightly acceptance has been established.

Root completed the five-provider syscall arity review: native48,753/0 and
FPCAST48,769/0,238 linked objects with231 predecessor objects unchanged.
Actual GNU make selects the owned zero-argument sync/vhangup, historical
three/two-argument module APIs and true variadic prctl with explicit option
dispatch. Full option behavior remains outside this bounded acceptance.
Independent readback covers144,470 manifest entries and34 repository paths,
with executed v3 CPIO module identity and fresh empty process groups:
`/mnt/p6/build/glibc-syscalls-arity-root-review-20261002/frozen-proof.json`.
Frozen manifest is
`e9002b3d9ef9d00a8df62566e2eabe05cb8f4c391b90343c90f3d75081167095`.
This supersedes pending-review wording in the immutable packet report.

The [cancellation boundary diagnosis](glibc-cancel-boundary-plan-20261002.md)
adds a source-confirmed restart constraint. GNU SIGCANCEL has SA_RESTART;
the selected kernel restores its interrupted registers/mask after the callback
and can restart before the worker syscall import returns. Deferring an unwind
to that return alone is insufficient for blocked cancellation. Eleven original
and snapshot inputs, ten findings and the actual register structure are in
`/mnt/p6/build/glibc-cancel-boundary-plan-20261002/evidence.json`.
The required native restart decision and genuine forced unwind remain unbuilt.

Root completed the [five-wrapper packet](glibc-syscalls-last5-20261002.md)
review and terminal freeze: native48,761/0 and FPCAST48,756/0,239 linked inputs,
24,278 manifest entries and31 exact repository paths. Root independently reread
all frozen bytes, checked both executed CPIO payloads and rechecked19 empty
owned process groups. Manifest
`19c1ae05f93df716db260dbf6d16dd1092e3e6d0c9ff757594d1d44117550671`;
proof `/mnt/p6/build/glibc-syscalls-last5-root-review-20261002/frozen-proof.json`.
The frozen report retains its earlier prepared wording; this completed review
supersedes that status without changing tested source or runtime evidence.
Capability no-op/readback, reversible owned mounts and isolated reversible
pivot_root execute through real GNU wrappers. pidfd nonNULL signal conversion
accepts only SI_USER/SI_QUEUE/SI_TKILL, with exact callback fields and input
canaries; other classes remain explicitly unsupported.

Root completed the [memory runtime review](glibc-memory-runtime-20261002.md):
native49,874/0 and FPCAST49,846/0,246 linked inputs with236 predecessor inputs
unchanged. Eight actual GNU make providers retain six pristine GNU bodies,
including sbrk, and explicit mremap/memory-authority derivatives. Real GNU
malloc_trim discards interior free pages, preserves metadata and neighboring
live allocations, and reuses the resulting bins. Mapping ownership includes
adjacent mappings and wholly owned break pages; partial holes remain untouched
and return ENOMEM. Rounded remap copies preserve the entire old page, including
its last byte, and clear the expanded tail. Three GNU descriptor threads execute
the public mapping APIs concurrently with genuine allocator checks.
Independent readback covers191,846 manifest entries and25 repository paths;
both actual CPIO payloads match the executed modules and21 owned groups are empty.
Manifest `2604aa26fae2ae073c2326b5741752ac013cdf4a83878c81950fc943adcff2c4`;
proof `/mnt/p6/build/glibc-memory-runtime-root-review-20261002/frozen-proof.json`.
The immutable report's prepared wording is superseded by this completed review.
The first fixture failure and first freezer failure remain retained; their
corrections did not change the tested GNU allocator/provider objects. This proves
logical anonymous private writable memory, not physical protection/decommit,
file/shared mappings or default NPTL stack guards.

Root approved the pinned14-path coherent source plan and final overlay/configure/
metadata/fresh GNU make, consuming the immutable memory runtime packet. Earlier
failed inventories remain retained; current results come from actual builds.

Final coherent configure/metadata retry completes in24.804s, exit0 and empty
PGID4176587. The retained first failure applied the vtable-only extent fixer
to an ordinary configure object. The reviewed owned driver now copies backend
bytes only for the exact empty alias summary and invokes the frozen fixer only
for the two exact GNU offset aliases; any other summary fails. Root independently
verified14 plan6 source pins and31 completed architecture files. Fresh actual
GNU make -k -j2 lib exits2 after316.34s, PGID4182308 empty:1727 Wasm objects,
40 GNU text stamps, six failed targets and no archive/sysroot. Root independently
reread1727 outputs,1733 source snapshots (four absent generated conftests
retained-only),2800 actual includes and2026 executed driver records. Caller
provenance still fails four dlfcn objects and gmon/mcount; cancellation assembly
fails nptl/syscall_cancel. Reviewed plan7 registers omitted init_module and
delete_module unchanged C providers. Actual incremental run2 exits2/113.14s,
produces1729 Wasm objects and preserves all1727 earlier object hashes. Its final
dependency audit of both GNU .d and .dt files now independently verifies2802
includes from2339 files,1736 source records,2631 driver records and12033 stages.
All original2800 include paths/hashes remain unchanged; six targets fail and
no archive/sysroot exists. The discovery packet is frozen:65589 manifest entries
and16 repository paths reread with zero differences,14 owned groups freshly
empty. Manifest `220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97`.
Proof: `/mnt/p6/build/glibc-coherent-make-root-review-20261002/frozen-root-proof.json`.
The first freezer schema assertion failure is retained; its strict list-length
correction changes no compilation or providers. This is failedmake discovery,
not a libc archive, installed headers or new runtime acceptance. Preserve the
immutable task and continue builds separately.

The [native static-loader packet](glibc-native-static-loader-20261002.md) now
has an independently reviewed prepared implementation:6748 source/tool,947
object/artifact and348 evidence entries, with320 owned groups freshly empty.
Caller99 checks, four compile rejection controls and metadata35 checks pass;
twelve unchanged GNU loader/API units and the owned native backend compile.
Both strict explicit-Wasm-EH default/Release50-argument links still fail solely
on genuine GNU __syscall_cancel_arch, PID/PGID24335/24365 exit1. All16 tag1
retained-cleanup cases fail, while16 tag0 cases pass. The finite primitive gates
do not prove public dlfcn/C++ execution, general SjLj or forced unwind. Earlier
snapshot and seven concurrent-ledger gaps remain explicitly unproven. Root
proof: `/mnt/p6/build/glibc-native-static-loader-root-review-20261002/prepared-root-proof.json`.

Root accepted the [native cancellation plan](glibc-cancel-native-plan-20261002.md)
after independently rereading42 original/snapshot pairs, two compile outputs,
six repository paths and six loader route inputs, and confirming both compile
groups empty. Proof:
`/mnt/p6/build/glibc-cancel-native-plan-root-review-20261002/final-plan-proof.json`.
This is source/ABI evidence. The owned sparse compiler implementation is next:
early cleanup-aware safepoints, actual caller-SP capture and general frame routing
must precede genuine GNU forced unwind and post-restoration kernel cancellation.
The loader control passes16 tag0 cleanup cases, but all16 tag1 SjLj cases run
retained cleanup prematurely and again on return ([1,9,9]); correct jump value
and SP restoration do not establish correct cleanup. Preserve this failure for
the compiler packet. No cancellation runtime, full GNU lifecycle, Nightly,
new JIT, GPU or deployment acceptance follows from these prerequisites.

The [bounded cancellation compiler prerequisite](glibc-cancel-compiler-20261002.md)
now builds and passes native O0 624/0, O2/O3 640/0. Root independently reread
1168 actual compile/link inputs and13 source paths, verified101 frontend and45
backend ordered archive members, and confirmed310 recorded process groups empty.
Only CGStmt.cpp.o, CodeGenFunction.cpp.o and WebAssemblyFrameLowering.cpp.o
change; duplicate archive member names remain ordered and intact. Opt-in
cleanup-aware polls retain source cleanups, and actual caller-entry SP capture
covers zero/static/dynamic/nested/indirect/recursive controls. Patch
`67473abb362e308fef395f80baffdabb8e5baa8572222b457fefb879911cec40`;
compiler `1147a637f9144f77c35398fc0cfd77a06fb4fec21f91706361c34395d1b8848b`.
Proof: `/mnt/p6/build/glibc-cancel-compiler-root-review-20261002/final-root-proof.json`.

The original prerequisite's 80 escaping-SP leaks per mode and diagnostic resets
remain retained; its original LTO backend cannot lower the marker. The separate
[native EH routing candidate](glibc-native-eh-routing-20261002.md) now passes 2,606
standalone cases with MachineVerifier enabled, including actual delegated
caller escapes, typed returns and retained SjLj cleanup. Its native outer try
uses the function result signature and restores actual pre-prologue SP; typed
tag1 catches bypass language catch-all cleanup while retaining exact identity.
Patch `54282b5f77bde214a3ad9d93bbcc11d83b96d4a881128397f7cbcc4e91013efa`.

Composition with the accepted caller-SP backend changes exactly two of 45
ordered archive members and passes O0 848/0, O2/O3 864/0. Each mode now preserves
SP for all 80 ordinary escaping cases, 16 tag0 and 32 tag1 cases without a JS or
assembly SP reset. Native traps still bypass EH and leak 16 bytes in fresh
discarded instances; recovery is not accepted. Initial validation, machine
block ordering and missing fixture-tag link failures remain preserved.
Root proofs: `compose-archive-root-proof.json` and `compose-runtime-root-proof.json`
under `/mnt/p6/build/glibc-native-eh-routing-root-review-20261002`.
General descriptors/CFA, genuine forced unwind/cancellation, post-restoration
kernel restart policy and public NPTL lifecycle remain pending. This compiler
candidate does not establish a complete GNU sysroot, Nightly build, JIT, GPU
or deployment acceptance.

The separate normal-frame records7 compiler now passes 5,361 assertions across
O0/O2/O3. Each mode checks zero/static/dynamic frames, stackrestore, recursive
depth 13, indirect calls, actual active-SP values, empty final chains and seven
compiler-generated descriptors. The root rerun executes the frozen native
modules without a host stack reset and exits 0. Root independently rereads 108
runtime pins and 160 link pins, verifies both 45-member archives in order with
only members 15 and 41 changed, and confirms 52 prior stage groups empty.
Compiler SHA256:
`8316763b3bfe16f00bee38fd3aee1150de5dfb59c456b442a82010dfc85d7482`.
Proof: `/mnt/p6/build/glibc-native-frame-plan-root-review-20261002/records-patch-7-native-root-proof.json`.
This is a synthetic-owner normal-record prerequisite, not genuine GNU
cancellation or EH/SjLj composition. All earlier failed attempts remain intact.

The kernel-boundary candidate uses an 80-byte version 3 context and separates
restoration from restart policy. Its signal/process units and genuine GNU
helper/accessor objects compile independently; the helpers retain unchanged
GNU sigcancel_handler. Root helper2 review checks 1,492 hashes and 12 terminal
groups; no final helper link or cancellation runtime is accepted.
The fresh whole-kernel source copy passes in
`/mnt/p6/build/glibc-cancel-kernel-whole-run2-20261002`. The following
olddefconfig stage exits 2 linking the host fixdep helper, before target
compilation. The earlier source-copy failure is preserved separately; its fix
allows exactly eight pinned baseline source files with generated directory
names and still rejects old objects/configured target headers. The next action
is to compile a coherent kernel before any real post-restoration cancellation
gate. Host control builds and executes the actual fixdep helper using the same
pinned Clang with explicit host-only GNU ld/libgcc settings. Run3 olddefconfig
passes, then its strict config gate stops on a newly detected
CONFIG_RUST_IS_AVAILABLE. Pinned Kconfig evidence shows RUST also requires
HAVE_RUST; both are disabled in old and new configurations. Run4 permits only
that exact availability change, retaining the strict gate for all other
nonmetadata choices. Root independently checks 100 recipe/source/host pins;
the complete source recheck covers 93,703 files and 99 symlinks.
Run4 source verification, olddefconfig, prepare and actual vmlinux.o linking
pass. Packaging exits 2 after 560.297 seconds: the architecture Makefile invokes
the sections.pl source script relative to the O= output directory. PID/PGID
305770 is terminal and independently confirmed empty. Preserve all 856 object
files and the 6,280,529-byte linked object, SHA256
`d251b84d505e1424d348d9398b24cc1f7e1fa286ba878254afd06da96feef1b2`.
Root independently parses the exact import delta against baseline21c15250:
user.call_signal_handler_v3 (4i32->i32) and user.signal_return_policy_v3
(i32->i32) replace user.call_siginfo_handler (3i32->i32) and
user.call_signal_handler (2i32->void), with no other differences.
Proof: `/mnt/p6/build/glibc-cancel-kernel-boundary-root-review-20261002/run4-linked-root-proof.json`.
Separate packaging now passes with an owned Makefile source-path adapter.
The final 6,281,781-byte image has SHA256
`c999225be7be4a8be57afab7586be2897688d2ae0468c62a325236e48650d227`.
Root checks unchanged executable section bodies, both embedded metadata
sections, all 19 data ranges and successful Wasm validation. Audit5 readiness
passes; independent root review rereads 7,468 pins, including 4,742 actual
dependencies and 490 archives, with no mismatches or unresolved dependencies.
Proof: `/mnt/p6/build/glibc-cancel-kernel-boundary-root-review-20261002/audit5-root-proof.json`.
The isolated guest candidate updates only kernel size/hash in the integrity
manifest and adds two unavailable user imports in the main boot instance.
Basic3 passes native 49,871/0 and FPCAST23i64 49,858/0, with all 12 result files
per mode passing. Root independently checks 41 input/route pins, the exact
manifest/bootstrap/runner deltas and empty terminal groups. Preparation retains
two stale original-snapshot path labels after adapting worker/runner files;
their unchanged original snapshots remain available and the root proof records
the exact lineage corrections. Proof:
`/mnt/p6/build/glibc-cancel-kernel-boundary-root-review-20261002/basic3-root-proof.json`.
This establishes ordinary legacy GNU guest behavior on the v3 kernel, including
signals/abort, allocator/thread/memory and public-exec regressions. Genuine
admitted frame bridge and post-restoration cancellation remain unaccepted.
The initial manifest/import failures are retained; the six-GiB whole-build
budget includes the reused source tree.

Root also verifies the C++ frontend ABI diagnosis using the actual pinned
compiler: unchanged wasm32 GNU/Linux produces no catchret for two catch exits,
whereas `-fc++-abi=webassembly` produces both required catchret instructions.
Proof: `/mnt/p6/build/glibc-wasm-cxxabi-root-diagnosis-20261002/proof.json`.
This existing compiler option is preferable to an upstream catch-exit patch.
All linked C++ runtime/fixture units are rebuilt coherently for personality7.
Both baseline and patched variants pass 40 cases each: actual foreign cleanup
and ownership plus native int catch/rethrow with pointer identity. Actual SP
is unchanged and fatal callback counts stay zero. Root rereads 842 pins and
independently reruns both frozen native Wasm modules. Proof:
`/mnt/p6/build/glibc-native-forced-unwind-root-review-20261002/personality7-independent1/root-proof.json`.
The old selector-zero catch-miss assumption is disproved; both variants catch
foreign exceptions, while actual TLS observations show baseline selector0
and patched selector1. This synthetic Linux host fixture does not establish
real guest/default C++ fatal, forced unwind or NPTL acceptance.
The new module4-proposal10 private driver compiles after the retained proposal9
load-opcode error, but its first normal-control run fails compiling a flags-off
provider with SIGTRAP. Its runtime behavior remains unaccepted; diagnose the
actual compiler stage while preserving accepted frozen records7.
The full Nightly159/JIT/GPU release goal remains active and incomplete.

The flags-off SIGTRAP is now localized by GDB to legacy LLVM pass-manager
construction, before function compilation. The final-admission ModulePass
split the function pipeline; converting it to a FunctionPass still leaves
AAResults invalidated immediately before selection. Proposal14's explicit
rebuild fails compilation on a nonexistent factory; proposal15 uses LLVM22's
public constructor but final mutation also invalidates StackProtector. The
placement repair in proposal16 passes the normal-record gate: 5,361 assertions,
all three flags-off object byte comparisons and correct actual stack
restoration. Root independently reruns frozen modules, rereads 108 pins and
confirms 47 groups empty. Proof:
`/mnt/p6/build/glibc-native-frame-plan-root-review-20261002/records16-native-independent1/root-proof.json`.
Final admission runs before base addISelPrepare, after EH/SjLj/TLS/atomics;
AA is rebuilt afterward. Later generated calls remain fail-closed in machine
audits, so this is not full stack-protector/safestack compiler acceptance.
Source-setjmp admission
adjacency and an orphaned admission around the consumed caller-SP marker are
independent control failures; their corrections remain separate and unaccepted.
The combined consumer8 compiler compiles/links successfully, but neither its
runtime nor forced unwind is accepted. The GNU owner bridge compiles with
359 dependency pins and no calls/imports/linear-SP writes in primitive
assembly; real ownership/admission and cancellation composition remain pending.
Root review catches an ABA issue in raw checkpoint pointers reused after
completion. Bridge2 resolves nonreused opaque serial handles against bounded
live slots before dereference. It compiles; root rereads 381 pins, checks actual
primitive assembly and confirms 21 groups empty. Proof:
`/mnt/p6/build/glibc-cancel-kernel-boundary-root-review-20261002/bridge2-compile-root-proof.json`.
Root also verifies 94 forced-provider own-body pins and four exact assembly
bodies, with no linear-SP writes/indirect calls/native throws/imports. Proof:
`/mnt/p6/build/glibc-native-forced-unwind-root-review-20261002/provider-own-bodies-root1.json`.
Their transitive canonical-accessor/delivery closure remains unaccepted.
The consumer8-object relink onto peer16 is reviewed with 192 pins and 180
snapshots; the combined compile/control/runtime gate remains pending.

The fresh root ABI diagnostic executes native GNU-target Wasm at O0 and O2
with no module imports. `-fc++-abi=webassembly` passes all 512 calls, covering
nonvirtual member calls, virtual overrides and multiple-inheritance `this`
adjustments. Generic Itanium produces 128 actual signature/null-function traps
per mode; linked member-pointer words prove odd table indices are exercised.
This directly confirms the flag also addresses the member-pointer defect
previously encountered in Mesa, within this compiler diagnostic scope.
All 19 input/output pins are reread and 16 actual owned groups are empty.
Proof: `/mnt/p6/build/glibc-wasm-member-pointer-root1-20261002/proof.json`,
SHA256 `177c6618f5142f668a9f871e56770ce799ec12aaf3b19384fd7fc3c2243df24c`.
Replay and full rebuild requirements are in `tools/glibc/cxxabi-platform/README.md`.
The C++ closure recipe now selects the ABI for every C++ unit and removes
the C++ option when deriving the C provider argv. Historical objects remain
unchanged and cannot be mixed into a fresh coherent closure. These checks
do not establish full GNU libc, real guest C++ behavior or Nightly acceptance.

Producer18 addresses two concrete combined-compiler failures found in the
consumer16 controls. Actual frame operations were becoming invokes during
SjLj lowering, so the later context pass could not discover the real Enter
call. Exact compiler metadata now binds the preserved operations to the unique
64-byte aligned record; user calls and cancellation polls remain longjmpable.
New forced-unwind guards on previously personality-free leaves also require
a real scoped personality. It is assigned before descriptor construction,
which retains the actual runtime __gxx_personality_wasm0 relocation.
The two-unit producer build passes; compiler SHA256
`68d232e450ff9e6ff03f2de51fbb77cd3b73ede64095673a59ed37a5983e6cce`.
Root independently verifies four source pairs, unchanged TargetMachine object
reuse, compiler bytes and five freshly empty stage groups. Proof:
`/mnt/p6/build/glibc-native-frame-plan-root-review-20261002/proposal18-build-independent1/root-proof.json`.
Producer18's normal-record gate passes 5,361 assertions; root independently
reruns all three frozen modules, rereads 108 pins, verifies flags-off byte
identity and confirms 47 groups empty. Proof:
`/mnt/p6/build/glibc-native-frame-plan-root-review-20261002/records18-native-independent1/root-proof.json`.
Consumer9 adds only an early assertion of that producer-owned personality.
The combined consumer18 compiler builds and its O0/O2/O3 normal compile controls
pass. Its first SjLj control fails the capture ownership validator because the
actual captured SP feeds the genuine tagged poll as well as Enter. Actual IR
confirms no aliases/phis. Proposal20's reviewed correction validates those
exact poll users without making polls nonlongjmpable. Its bounded rebuild and
the combined runtime gate remain pending, with all prior failures retained.

Original GNU nptl/unwind.c and cancellation.c compile with the measured
backend64/public-jmp196/cancel-unwind84 closure. Independent root checks cover
374 unwind pins (355 dependencies) and 336 unique cancellation pins (310
dependencies), and freshly confirm all four/six stage groups empty. Actual
GNU cleanup callbacks, longjmp/fatal calls, EINTR handling and cancellation
atomics remain. Proofs:
`/mnt/p6/build/glibc-native-forced-unwind-root-review-20261002/gnu-unwind64-independent1/root-proof.json`
and `gnu-cancellation64-independent1/root-proof.json` in the same parent.
Final linking still must prove that the extern_weak __pthread_unwind reference
resolves to the genuine GNU definition. These checks do not admit native
records or establish runtime cancellation/full NPTL.

Mixed-provider proposal1 is source-only. Root review finds a concrete hook
ABI mismatch: compiler polls are void(i32 callerSP,i32 reason), not zero-arg,
and capture liveness must be checked after identifying the actual poll users
to remove. Reviewed source-only proposal2 authenticates compiler metadata and
exact capture/reason operands, rejects manual poll calls, removes polls first
and retains external module/body hashes and final machine-call closure checks.
Consumer primitive skipping also needs actual producer membership; a source
attribute is insufficient if the record pass is disabled. The allocating abort
failure paths in Enter/Leave/Admit still require a nonrecursive solution that
preserves genuine GNU fatal behavior. No full sysroot/Nightly/JIT/GPU release
acceptance follows from these compile-only packets.


Continuation: producer20's bounded one-unit rebuild passes and consumer9's
composition onto it builds. The actual SjLj control then crashes in overloaded
stackrestore intrinsic creation; consumer attempt11 supplies the actual pointer
type. Consumer21 builds but its first SjLj compile now fails LLVM verification:
a catchpad invoke unwinds to its own parent catchswitch rather than the legal
parent unwind destination. The exact responsible mutator is being localized;
none of these compositions has forced-unwind runtime acceptance. C++ controls
also reject actual Clang get.exception/get.ehselector calls; those require narrow
CatchPad-token/personality provenance checks, not a llvm.wasm.* prefix exemption.
Provider3 and consumer12 source reviews require actual producer-owned Module,
Function and class-map membership before primitive skipping. Their runtime and
forged-source negative gates remain pending. Genuine allocating GNU fatal
closure is still unresolved.

Root independently verifies all six backend64 integration inputs with 36 fresh
empty compile-stage groups. Unique pin counts are 340/340/342/342/342/385 for
owner-startup, owner-gate, bridge-lifetime, native-bridge, GNU helper and GNU
handler. The actual native bridge has no calls/indirect calls/throws/SP writes;
the bootstrap has no SP writes and uses its explicit actual TLS/TP imports.
The GNU helper retains its real indirect signal callback and remains recorded.
The handler's nptl/pthread_cancel.c bytes match pristine GNU. Proof:
`/mnt/p6/build/glibc-cancel-kernel-boundary-root-review-20261002/backend64-inputs-independent1/root-proof.json`.
The only changed input path is compile-gnu-cancellation.py: its current version
extends dispatch to five genuine GNU jump units. Preserved snapshots establish
the exact recipe that executed; the proof records the current delta explicitly.
The root review initially rejected that path drift and an overbroad no-indirect
assumption for the recorded GNU helper; both original review scripts are kept.
This evidence proves compile inputs and machine-body constraints only, not
owner admission, cancellation runtime, complete NPTL, Nightly or JIT acceptance.


The catch self-routing mutator is now identified precisely: LowerSjLj's
longjmpable-call conversion uses the pass-created handler as fallback even
for a call inside that same handler. FinalAdmission merely verifies the
already-invalid IR. Reviewed proposal23 requires the actual generated
CatchSwitch identity under records4, asserts unwind-to-caller and preserves
the genuine may-throw funclet call. Its one-unit build passes; root independently
checks four source pairs, unchanged GNUFrames18/TargetMachine16 objects,
compiler bytes and four fresh empty groups. Proof:
`/mnt/p6/build/glibc-native-frame-plan-root-review-20261002/proposal23-build-independent1/root-proof.json`.
Consumer23 passes the former IR failure, then reaches a MachineVerifier failure:
the captured caller-SP register is defined in original-entry bb2, but the
catchret/resume route reaches return bb10 without executing that block. Actual
entry capture placement needs correction; verification remains enabled.
Reviewed C++ proposal2 recognizes only actual frontend intrinsic IDs with
CatchPad and personality/funclet provenance. Its call-only immediate-unreachable
rethrow scope remains explicit; diagnostic and negative controls are pending.

Five unchanged genuine GNU jump/cleanup units independently pass compile
review: sigjmp_save, ordinary/checked longjmp, NPTL jmp-unwind and cleanup_upto.
Root rereads 132/132/133/339/343 pins and confirms 30 stage groups empty.
Original GNU mask and cleanup paths remain; cleanup_upto retains its actual
indirect callback, and no old24 prepare provider is substituted. Proof:
`/mnt/p6/build/glibc-cancel-kernel-boundary-root-review-20261002/gnu-jump64-independent1/root-proof.json`.
The executed recipe's preserved snapshots are distinguished from the subsequent
extension to NPTL mappings. Backend __longjmp/____longjmp_chk still require
reviewed recorded definitions and final linking. These compile controls do not
establish thread cancellation or complete GNU sysroot/Nightly/JIT acceptance.


The true-entry capture fix25 builds successfully. Root checks all five source
pairs, unchanged reused TargetMachine16/GNUFrames18/LowerSjLj23 objects,
compiler bytes and four fresh empty groups. Proof:
`/mnt/p6/build/glibc-native-frame-plan-root-review-20261002/proposal25-build-independent1/root-proof.json`.
Coherent26 source review confirms component identities and only the approved
C++ catch helper additions over provider3. A final GNUFrames rebuild is
approved before consumer12 composition. Separate normal/SjLj/C++/forged-source
control suites are prepared, not yet executed. Allocating GNU fatal handling
remains unresolved; status-core source work is separate from accepted V1
runtime and does not silently replace genuine GNU abort behavior.
