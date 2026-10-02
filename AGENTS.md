# libc change — 2026-10-02 (latest user direction; read this first)

The user now says: "do not use musl , use libc for best compability".
Interpret the requested replacement as glibc pending any user correction.
Stop further musl-based Nightly builds and investigate a genuine native
Wasm/Linux glibc toolchain, syscall/thread/TLS ABI and dependency rebuild.
Renaming a musl target or linking musl archives under a GNU triple does not
satisfy this requirement. Preserve the existing working releases and build
trees. Nightly → JIT → GPU → verified Sites release remains the objective;
glibc is now a prerequisite. The prior Nightly configure/export/component
checks used musl and are historical evidence, not acceptance of this target.
Fresh same-model/same-effort subagents receive only necessary task context.

GNU glibc 2.44 is pinned from the signed GNU release archive, SHA-256
`37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667`,
under `/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44`.
Its pristine configure fails explicitly because wasm32 has no upstream sysdeps
port. Unmodified GNU memchr/strnlen compile into native shared-memory Wasm and
pass 16,450 host assertions with no imports, musl or WASI linkage. This proves
only the compiler/header/string bootstrap, not a GNU sysroot or guest runtime.
The selected next packet is an owned GNU wasm32 static architecture/sysdeps
port, actual GNU allocator with nonrecursive native memory-growth providers,
then GNU startup/TLS/NPTL and coherent dependency rebuilds. Reports and exact
scripts are in the bootstrap task directory. Candidate brintOS source links
returned 404; Lind's available port includes incompatible WASI/musl startup,
clone stubs and a different runtime ABI, so neither is an accepted drop-in.

Independent ABI evidence belongs under
`/mnt/p6/build/glibc-guest-abi-review-20261002`. The actual retained kernel
architecture is in the Nix source `s6qc0any0wby0f4nnivpaanvqb9hl130-source/arch/wasm`.
It uses asm-generic syscall numbers, raw-pointer set_thread_area (244), and
custom clone (220) arguments fn/fnarg/flags/parent_tid/child_tid/tls. Its memory
syscalls brk/munmap/mremap/mmap are omitted. GNU malloc needs direct Wasm memory
providers; the existing malloc-backed Firefox mmap shim cannot bootstrap it.
GNU public stat and signal layouts differ from the kernel UAPI and require
verified conversions. Compiler TLS uses __tls_base, separately from the GNU
TCB/thread pointer. Never relabel i386 layouts or existing musl archives.

Completed bounded GNU port packets (not a completed libc):
- `/mnt/p6/build/glibc-core-build-20261002/packet-report.txt`: genuine GNU
  configure generates Wasm build metadata. Five unchanged GNU implementations
  (errno, errno-location, memcpy, memset, wordcopy) form a closed native Wasm
  module and pass 267,297 host assertions. The separate memory-growth provider
  passes 59 assertions; syscall transport with GNU errno passes 12 synthetic
  host assertions. GNU malloc failed compilation in this first packet. The relative patch,
  manifest and replay script are frozen; replay also recreates the intentionally
  empty Linux/wasm32 Implies file. No GNU allocator or full make pass is claimed.
- `/mnt/p6/build/glibc-clone-tls-gate-20261002/report.md`: actual browser Linux
  guest native and FPCAST23i64 probes pass 43/0 and 42/0 with private stacks/TLS,
  raw kernel TP, parent/global preservation and measured clear-TID futex wakes.
  Invalid clone flags return EINVAL without TID writes. A separate controlled
  child abort occurs after valid TLS setup, before publication. The stricter
  earlier wake-coverage failure remains FAIL. No GNU libraries or NPTL are
  linked in this freestanding prerequisite. The task-local raw-TP marker
  exclusion preserves old adapter selection; it is not a production ABI yet.

- `/mnt/p6/build/glibc-wasm-arch-headers-20261002/packet-report.txt`: unchanged
  GNU malloc.c now compiles using real GNU tunables, lock and NPTL headers.
  Genuine metadata generation and architecture headers replace the bootstrap
  blockers. The cumulative relative patch SHA-256 is
  `d283e3700def73f91e04f948a29f11e32f9793e15a209bb9ff3ef1b5d0e4c82b`.
  Actual GNU-header measurements are pthread descriptor 1184/alignment32,
  time_t/off_t 8, stat 128, jmp_buf 148. Native Wasm EH/SjLj with unchanged
  GNU public jump headers passes 1,601 host assertions; signal-mask saving,
  siglongjmp, cancellation and a full GNU nonlocal-jump implementation remain
  incomplete. Initialized allocator linkage still fails on 25 dependencies;
  compiling malloc.c is not allocator runtime acceptance.
- `/mnt/p6/build/glibc-core-guest-validation-20261002/report.md`: independent
  rebuilt unchanged GNU core objects plus owned syscall/heap adapters pass
  41,686/0 in each real native and FPCAST23i64 Linux guest run. Three concurrent
  users perform 288 allocations and 41,328 nonoverlap checks; payloads survive
  memory growth and failed growth leaves pages/cursor unchanged. Linker TLS
  metadata drives storage and actual GNU errno is separate across threads.
  The earlier link and readiness-wake coverage failures remain retained. GNU
  malloc, production GNU descriptor/DTV, CRT and NPTL are absent from this gate.

- `/mnt/p6/build/glibc-startup-tls-20261002/report.md`: actual native and
  FPCAST23i64 guests each pass 34/0 using genuine GNU descriptor/DTV/guard
  headers and unchanged errno/core objects. Kernel args245 EFAULT/E2BIG retries
  preserve the pending blob, successful retrieval consumes it once, relocated
  arrays/strings/auxiliary data are bounded, and identities match kernel calls.
  Module1 TLS and separate raw GNU TP precede constructors; real CLEAR_TID wakes
  clear GNU 2.44's joinstate field. Final heap floor 659200 includes every
  static startup/TLS/descriptor/DTV/stack reservation. This is an owned static
  startup prerequisite, not unchanged GNU ELF CRT, full NPTL or loader support.

- `/mnt/p6/build/glibc-allocator-closure-20261002/packet-report.txt`: clean
  scripted rebuild of 75 unchanged GNU units and owned architecture providers
  passes 370/0 host checks. Allocator initialization/tunables/real locks,
  reallocation preservation, dirty calloc zeroing, overflow/OOM errno and
  stable large-range reuse are exercised. Cumulative patch SHA-256
  `24040a2fce8165dbf7be9f92f837ed3d42843d5b76581d5b3d6f52ee8b5f2c06`.
  This scoped probe explicitly wraps abort. True production link remains FAIL
  on __internal_syscall_cancel through GNU abort/rwlocks/futex helper; owned
  signal layout conversion is compile-only, without callback acceptance.

- `/mnt/p6/build/glibc-allocator-guest-gate-20261002/report.md`: independent
  native and FPCAST23i64 real guests pass 48,249/0 and 48,252/0. Three users
  perform 19,008 allocations and 6,624 live-range nonoverlap checks per run.
  Actual kernel environment supplies GNU arena_max=1, tcache_count=0 and
  perturb=93; genuine allocator locks block children until unlocked, with
  measured futex waits/wakes. Default unsupported secondary-arena creation can
  fall through to direct mappings; earlier held-main-arena failures remain FAIL.
  This frozen packet still wraps abort and is not full NPTL lifecycle acceptance.
  Input manifest SHA-256
  `1eec6d77fa2d86918d6434365f029aaf4a07f659ae9569059d73f5269708f813`.
- `/mnt/p6/build/glibc-abort-signal-final-20261002/report.md`: genuine GNU
  allocator/abort closes without an abort wrapper, replacement abort,
  cancellation stub or unresolved-symbol suppression. Thin LTO on unchanged
  futex-internal.c removes its dead cancellable branch; explicitly retaining
  the cancellable API still fails honestly. Host 370/0, native and FPCAST
  30/0 each, plus five separate abort/fatal cases exiting 134. Owned signal
  conversion supplies actual siginfo and NULL context; unsupported altstack
  and explicitly requested restorer behavior fail. Unflagged sa_restorer is
  ignored as required by ordinary GNU callers. A narrow architecture time64
  feature override fixes real GNU timed futex routing; the old route's failure
  is retained. This is not full cancellation, NPTL, CRT or libc acceptance.
  Cumulative relative patch SHA-256
  `c0238052c8c42006cb724a9363c73f7e5d34bf86d79faa015a922971528ef14f`;
  manifest `046d4954a351d9d499e4896dc4f4562976acd7dcaf1b5bb05c3fa31b286c312d`.
  The initially announced `/mnt/p6/build/glibc-abort-signal-build-20261002`
  snapshot remains immutable and its hashes were rechecked after the corrected
  snapshot. Neither acceptance retroactively changes the other packet's scope.

- `/mnt/p6/build/glibc-port-integration-20261002/acceptance.json`: fresh archive
  replay, real configure/metadata and an 80-unit GNU rebuild pass using the
  parameterized repository scripts in tools/glibc. Combined unwrapped GNU
  abort/signals/time64 and concurrent startup/allocator guests pass native
  48,263/0 and FPCAST 48,275/0; host 370/0. Both guest runs prove real allocator
  blocking/wakes and five abort/fatal processes exiting 134. The task manifest
  pins 22,274 entries including all 20,963 replay GNU files and 571 actual
  include dependencies, independently reread without differences. SHA-256
  `e1a9c2b3c0270afca0091d772aed63c4be993fd62ec9b219a1a84765c9f294fd`.
  All 646 predecessor entries were rechecked. Details and replay commands are
  in docs/glibc-port-integration-20261002.md and tools/glibc/README.md. Curated
  outputs are allocator.wasm, never a relabeled full libc.a/sysroot.
  Genuine `make -j2 lib` fails at generic __sigsetjmp's ELF stub directives;
  its ENOSYS/0 implementation is also unacceptable and must be replaced with
  real architecture jump behavior. Earlier source-audit/parser and temporary
  manifest-summary failures remain retained. Ports 4202/9412 are closed.

- `/mnt/p6/build/glibc-native-jumps-20261002/acceptance.json`: direct-call native
  GNU signal jumps pass actual native 48,320/0 and FPCAST23i64 48,319/0.
  Genuine GNU signal-mask saving/restoration, nested jumps and manual NPTL
  cleanup chains pass; three invalid owner/stack-bound/direction cases abort134
  with GNU fortify diagnostics. Early caller-side LLVM IR lowering avoids dead
  returning setjmp wrappers. Escaping/indirect setjmp is explicitly rejected.
  Backend/jmp_buf sizes are now 24/156 bytes, so all clients must rebuild.
  Full GNU make advances past setjmp and fails at generated signal/kill.o's
  non-Wasm syscall-template.S assembly; a corrected scoped setjmp rebuild passes.
  Details and limits are in docs/glibc-native-jumps-20261002.md and
  tools/glibc/jumps/README.md. This does not prove general CRT, pthread lifecycle,
  cancellation, C++ destructors, signal-callback jumps or production compiler flags.

- `/mnt/p6/build/glibc-generated-syscalls-20261002/acceptance.json`: 17 exact
  GNU-generated wrapper streams now link into the native payload, with GNU
  aliases, audited public signatures and normal/NOERRNO/ERRVAL conventions.
  Native 48,363/0 and FPCAST23i64 48,358/0 pass six syscall-specific suites each,
  retaining allocator/startup/abort and native-jump gates; exit0 and owned
  browsers/services closed. Three private close probes are not public GNU
  close/cancellation acceptance; dup3 is compile/type-only, renameat unselected,
  and fixture reading is a direct kernel syscall. All 112 actual link-object
  hashes were independently reread. The final manifest pins 23,079 entries including
  1,052 actual include dependencies, independently reread with zero differences;
  Final SHA-256
  `dde2aab2c80f2e1ebcc2e7b08fbe6c9e43ff4bf2603c51e42858e5bf474aa991`.
  Original proof files are retained under *-first-freeze-retained.json. A
  reporting-only correction identifies the selected Linux sigstack source's
  link_warning rather than the unselected generic stub_warning implementation;
  runtime modules and link objects remain unchanged.
  Exact later architecture-template snapshots are retained; the first failed
  template's missing historical snapshot is explicitly documented. Genuine GNU
  make still exits2 on unaudited sigaltstack, sigstack's link_warning ELF
  directives and dlmopen's static_link_warning ELF directives. Details/replay
  commands are in docs/glibc-generated-syscalls-20261002.md and
  tools/glibc/syscalls/README.md. This task is frozen and must remain unchanged.

- `/mnt/p6/build/glibc-fullmake-warnings-20261002/acceptance.json`: genuine
  GNU warning text and empty stub markers now survive as Wasm custom sections.
  The unchanged GNU Makerules stubs recipe emits __stub_revoke and
  __stub_sigreturn and excludes Linux sigstack and dlmopen. The dlmopen
  inspection object is metadata-only; its runtime compilation still fails.
  Unknown module assembly, missing warning text and runtime marker references
  reject exit3; unrelated llvm.used survives and repeated compilation preserves
  proof attempts with identical object hashes. Typed GNU sigaltstack uses the
  actual selected Linux stack_t, size12/alignment4 and offsets0/4/8. Native
  48,366/0 and FPCAST23i64 48,373/0 pass six new ENOSYS suites each, plus prior
  allocator/syscall/jump/abort gates. Both guest/browser exits0 and servers close.
  Actual kernel ENOSYS leaves output unchanged; alternate stacks are unsupported.
  Warning metadata does not enforce native linker warnings. Full GNU make
  passes the earlier units then exits2 on dlmopen's __builtin_return_address.
  All 116 actual link-object hashes and the 23,234-entry manifest, including
  1,118 actual includes, were independently reread with zero differences.
  Manifest SHA256
  `93042d98f3330664ec32a7ee22d9bda6ea84ffb977de779a0f363ccb67cdd3cb`;
  acceptance SHA256
  `62ef64a555c8efb3516505748f3732f6768a2f711ffc965b8cb3cc33e567bdd3`.
  Exact 15 packet repository paths are frozen, with zero hash differences.
  Failed attempts remain retained and limitations explicit. The packet is
  frozen; do not mutate it. See docs/glibc-fullmake-warnings-20261002.md and
  tools/glibc/fullmake/README.md. This is not complete libc/sysroot acceptance.

- `/mnt/p6/build/glibc-fullmake-inventory-20261002/acceptance.json`: fresh
  signed-source replay ran genuine `make -k -j2 lib`, returning exit2 naturally
  after 314.15s. There are 1,733 attempted targets, 1,565 structurally complete
  Wasm objects, 168 failed GNU lib targets, 30 separate GNU text stamp files
  and zero partial object outputs. This is failure discovery, not a libc
  archive or runtime acceptance. The owned make group has zero live members.
  Exact per-target sources/retained IR and commands identify 50 C cleanup
  exception-format failures, 93 unaudited syscall signatures, five caller
  return-address failures, eight fenv failures, three library-name headers,
  three memory-syscall selections, two stat ABI selections and one each for
  scheduler headers, checked-jump selection, cancellation instruction-range
  markers and libio alias assembly. The syscall_cancel marker failure is
  separate from C cleanup. Four configure probes lack their ephemeral source
  snapshots; they are explicitly separate from the 168 GNU failures, whose
  source snapshots all match. The original in-flight supervisor is retained;
  improved replay supervision was not used to repeat the build. Independent
  rereads of all 1,565 objects, 168 source snapshots, nine packet repository
  paths and 26,312 manifest entries find zero differences. Manifest SHA256
  `8b53d66f81cbdc96a3b6b38491be44ec84c2fa9df4d09c3627b23de41bbae929`,
  acceptance `9a1a6aa1f9e5130537f3990ad84546bb02d37b94bd42dae7d152415658694dfe`.
  The task is frozen. See docs/glibc-fullmake-inventory-20261002.md and
  tools/glibc/inventory/README.md; static loader design is source-only.

Completed cleanup packet: an owned minimal LLVM 22.1.8 C frontend Wasm exception hook,
using an exact-source CGException.cpp rebuild and private archive/driver
relink. Clang's C personality selection lacks the Wasm branch used by C++,
causing DWARF cleanup landingpads to reach a scoped-EH Wasm backend. Preserve
GNU source as C and real cleanup/abort semantics; do not disable exceptions,
rename the personality alone or reinterpret GNU C as C++. Validate all 50
failed units, ordinary C/no-EH controls and meaningful native/fpcast cleanup
execution including genuine pthread_once throw/reset/retry. This does not
provide GNU forced unwind or cancellation. Use fresh owned storage and leave
frozen source clones/toolchains unchanged; a 3 GiB cap is authorized only for
the new compiler packet, retaining 8 GiB launch reserve/5 GiB hard stop and no
edits to the frozen env.sh.
The private compiler now builds successfully under
`/mnt/p6/build/glibc-c-cleanup-20261002`. Independent binary archive inspection
checks all 101 ordered members, including duplicate basenames: only
CGException.cpp.o changed. Ordinary C, disabled-EH C and host C EH raw IR are
byte-identical to the original compiler. Native C EH emits actual scoped
cleanup pads and a nested cleanup-throw abort path. The first fresh GNU replay
rebuilds 48/50 affected units; pthread_once and qsort initially stop on missing
generated sem_t-align.h. Genuine gen-as-const.py/csu sem_t-align.sym generation
with selected GNU flags and retries of just those two units now yield 50/50.
The initial failures and unsuccessful make target remain retained. Independent
rereads match all 50 Wasm object/source hashes and scoped cleanup IR proofs.
This is compiler/build evidence only. The first fresh native runtime payload
links and its cleanup-throw case exits through GNU abort with status134, but
then traps before the regression suites. Diagnostic replay of the same payload
confirms the cause: the host HALT_KERNEL Symbol passes through guest C
catch_all, invoking the outer cleanup and a second GNU abort after the kernel
task has exited. The actual guest gate is FAIL, retained with all 120 linked
input snapshots. Isolated Node and Chromium probes prove that actual Wasm
traps, including an exact captured trap rethrow, bypass catch_all; constructed
RuntimeError objects do not. A task-local host-control adapter is being tested
for both process termination and exec replacement, preserving ordinary guest
exception cleanup. The task-local adapter now passes its first fresh native
Linux gate, 48,374/0: nested/indirect cleanup, linear stack restoration, genuine
pthread_once throw/reset/retry, all earlier suites, cleanup-throw abort134 and
real exec221 replacement with dirty old TLS and fresh target startup exiting42.
The FPCAST gate also passes 48,373/0. Genuine C-pad controls pass in Node and
Chromium: ordinary JS/native-tag exceptions retain cleanup and exact identity;
actual traps skip cleanup, and distinct halt/exec identities do not classify
unrelated errors. These host controls use an unexpected-abort import that is
never called; real abort134 comes from the Linux gates. Minimal production
runtime integration is now authorized for wasm.js, worker.js and wasm.d.ts,
followed by gates serving the actual integrated code. Those production gates
now pass native 48,373/0 and FPCAST 48,374/0, with all 34 actual input hashes
matching per run, browser/guest exits0, servers closed and owned groups empty.
Task-worker differences are only the retained raw-TP/futex test patch. The
task is now frozen: 24,626 entries, including 1,570 actual include dependencies,
and 29 repository paths independently reread with zero differences. Manifest
SHA256 `15bcb2d693cb08ced4f962c197a934232c7ff6d29b8c4806459f0a51f5db8e17`,
acceptance `78d57fed14afdb153ebc3526732ef4fe88924c9e2e1ba593a0d1ae62eb7141e9`,
repository freeze `c3d252ffc3bf60d49612896093206852e6cdde80f731e8b5037c6841bfe93875`.
The staged whitespace check found one space on an empty line in the host-control
test script. Its exact tested bytes and all original staged blobs are retained
in `/mnt/p6/build/glibc-c-cleanup-checkpoint-20261002`; only that space was removed.
The original frozen packet is unchanged. Corrected repository freeze SHA256
`f96e01cecaf20ed505bb622e6af3ac25ff787585ae2a148726d941e65374d307` and
historical-manifest-mapping.json identify the retained original source; an
independent check proves executable text identical and all 29 corrected paths
match staged bytes. No push/deploy is authorized. No full libc, Nightly,
new JIT or Firefox GPU release is implied.
The cleanup checkpoint is committed as `ead537aa789ae84e6bf56721af20aa575b9485ee`.

Active packet: `/mnt/p6/build/glibc-fenv-20261002`, repository scope
`tools/glibc/fenv/**`. Fresh signed GNU replay/configure/metadata passes;
the accepted private compiler and 120 runtime objects are reused with manifest
and snapshot verification, without changing the frozen predecessor. All eight
actual floating-point header failure units compile on the first attempt; their
Wasm objects and genuine source hashes independently match. The owned header
copies genuine GNU bits/fenv.h and adds only FE_TONEAREST=0, retaining
FE_ALL_EXCEPT=0 and no unsupported modes/flags. Fresh public GNU rounding APIs
now pass native 48,373/0 and FPCAST 48,384/0, including six public suites and one
concurrent errno suite each. Both guests retain earlier runtime regressions,
exit naturally, and close their browsers and servers. All 34 actual input
hashes per run match independently. The two GNU math implementations are
unchanged, with strong internal bodies/public weak aliases and warning/stub
metadata. Public-header preinclude avoids GNU's internal trivial setters;
raw/optimized IR and native instructions retain volatile indirect calls and
f32/f64 arithmetic. A symbol-display parser fix is retained separately; no
payload changed. Root independently verified all 123 actual link objects
(102 Wasm-v1, 21 ThinLTO), seven source/module records and all 260 current and
snapshot hashes. Both actual CPIO payloads match their modules; only /init
changes among original records, with one added probe. All ten supervisor,
runner and browser process groups are empty. Freeze is terminal and root
independently reread all 24,032 entries with zero differences (1,903 include
dependencies, 1,570 inherited). Manifest SHA256
`c575dc6867d292bb6ca120831ffa7c13e48a7732671d6a190009937f86c17cd1`,
acceptance `83f3aed73e22592a1f15bcc1de5682ab4ddc81059db52efe4e349cff5284556e`,
17-path repository freeze
`0fca580def5a450211d623223fcda9e58dd381a32d58547e300ec41e01e06619`.
The exact 19-path local checkpoint additionally includes this file and the
runtime route and is committed as `032e8eddddfccc3d88f157224ccd86156d74bc58`.
Root independently verified exact scope, all 17 frozen committed blobs, clean
index/selected worktree and unchanged Sites/release references. No push/deploy. See
docs/glibc-fenv-20261002.md. The usual 2 GiB task cap applies, with task-local
disk TMP/cache/profile; no full libm/sysroot or Nightly claim.
The planner also partitioned all 93 unaudited generated wrappers and identified
a next 36-wrapper fixed scalar/pointer group. See
docs/glibc-syscalls-fixed-plan-20261002.md; it is source-only planning, not
wrapper build or kernel capability acceptance.
Completed packet: `/mnt/p6/build/glibc-syscalls-fixed-20261002`, owned
`tools/glibc/syscalls-fixed/**`. Fresh signed GNU replay, verified reuse of the
accepted fenv 123-object runtime/compiler and new typed wrappers/public fixtures
are authorized, followed by actual native and FPCAST gates. Shared adapters and
all frozen tasks remain unchanged. Its scoped local checkpoint is now complete;
no push/deploy was performed.
Fresh kernel planning finds real ENOSYS bodies in the current kernel for
inotify_init1/add_watch/rm_watch, timerfd_create and memfd_create; ramfs user
xattrs lack storage. Record unsupported capabilities honestly while preserving
the later kernel-support work; wrapper compilation does not enable facilities.
Exact independently checked body offsets/configuration hashes and fixture
limitations are in docs/glibc-syscalls-fixed-kernel-20261002.md. Fresh preparation
PID/PGID 3388792 is terminal exit1: configure invoked a mode0600 C-only driver
directly and received permission denied. Preserve that failed configure tree
and initial adapter sources. Correct the owned invocation/query handling and
use a fresh configure attempt; do not rewrite the failure as a passing replay.
Correction completed: only configure/metadata/runtime-copy retried in a fresh
object tree, PID/PGID 3401054 terminal exit0 after 71.255 s. Original failed
tree/logs/script bytes remain retained. The owned query adapter records actual
command/cwd/sources/output/status and uses verified private clang. All 36 wrapper
objects and the independent GNU public-prototype/reference object compile;
PID/PGID 3409265 terminal exit0 after 40.006 s. Root independently reread all
36 streams against frozen original snapshots and verified actual Wasm-v1
objects. Public runtime fixtures/gates and final packet acceptance remain pending.
The strengthened audit verifies 36 strong bodies/public aliases with matching
function identities, 36 exact GNU public-address initializers and 263 actual
include hashes, including public headers equal to the signed pristine release.
The actual GNU make route also builds all 36 original targets through the new
architecture Makefile/driver; root checked the resulting Wasm objects, symbols
and exact generator streams. Its independent proof is
`/mnt/p6/build/glibc-syscalls-fixed-review-20261002/actual-make-proof.json`.
The first two native guests remain FAIL: the fixture attempted to restore
bootstrap process group0, which setpgid interprets as the caller's own PID.
Corrected named launcher uses an existing setsid shell with an ordinary child
and a nonzero inherited group; actual create/restore succeeds with errno intact.
Final guests pass native 48,465/0 and FPCAST 48,478/0, all six public suites,
concurrent errno checks and strict setpgid status0. Root independently checked
both actual CPIO/module bytes, all 206 final current/snapshot inputs (161 objects
=140Wasm/21BC plus45 sources/modules), both sets of34 served input hashes and
17 terminal supervisor groups. Scope/limits are in
docs/glibc-syscalls-fixed-20261002.md. The immutable freeze contains27,077
entries, 2,324 actual includes (1,903 inherited) and27 repository paths. Manifest
SHA256 is `b17e5f7744e2f4eae6714db5f4544b7e953a18b89a0bf419f89ead66ad2e784f`;
repository freeze is `30779ffbe42d50af61895e201846304b7d857ad3b0a822a05f379d4649ee21fd`.
Freezer exits0 naturally, with its owned process group empty. Root independently
rehashed all frozen inputs before the scoped local checkpoint; no push/deploy.
The exact29-path checkpoint is `a842340e7083ddfb7bf2f4baa8b745e74d91827d`,
tree `713399715c5ebb4a90fdb2b24534e71b14159716`, parent
`032e8eddddfccc3d88f157224ccd86156d74bc58`. Root independently verified all27
frozen committed blobs, exact scope, clean index and unchanged Sites HEAD.

The separate root-owned `/mnt/p6/build/glibc-libnames-20261002` packet now builds
all three originally blocked GNU pthread_cancel/exit/create objects through
actual GNU make. Owned architecture metadata exposes the existing GNU static
library-name recipe, with22 real macros independently matching the GNU script.
Owned pthreadP.h includes the genuine header and replaces ELF static-require
assembly with typed retained Wasm pointer relocations. Ten references remain
strong; genuine GNU trylock remains weak. Real missing-provider/section-GC
archive/table controls pass natively and through FPCAST23i64. This is selected
compile/link-control acceptance, not pthread lifecycle or cancellation support.
See docs/glibc-libnames-20261002.md. The immutable manifest contains22,982
entries and445 actual compile inputs; SHA256
`b6b7e40986d9eabb7c9abc15b6dea6428883750dd4575da9add9d7efe6288ccd`.
Acceptance SHA256 is
`c968e416b88ea395e2e4747b480d9d16b1f49c08c019468b6fe90f6b26a3d046`;
ten-path repository freeze SHA256
`410637c6cb91727eb570c6cbb43866517450c22ac4dfcf52798c9945b896bb8b`.
The six build/control groups and freezer are terminal (freezer exit0,31.902 s).
Root independently rehashed all22,982 inputs with zero differences and checked
all ten repository paths and seven empty process groups. The scoped local
checkpoint adds only AGENTS.md and the runtime route to those ten paths; no
push/deploy.
The exact12-path local checkpoint is
`4668062c29e0450008de51ba5c5f7a989142f16a`, tree
`c4edc3b09d07dcb0829666278acc4f7b2121e7e0`, parent
`a842340e7083ddfb7bf2f4baa8b745e74d91827d`. Root verified the ten frozen
committed blobs, exact scope, clean index and unchanged Sites HEAD.

Completed integration packet: `/mnt/p6/build/glibc-syscalls-next26-20261002`,
owned `tools/glibc/syscalls-next26/**`. Native48,554/0 and FPCAST48,567/0
actual Linux guest gates pass, with all earlier regressions and isolated
setsid/chroot/public-exec modes. Its191 objects include genuine GNU
sigemptyset/sigaddset providers. All26 original GNU streams, public types,
bindings and actual GNU make targets pass. Four selected facilities return
actual ENOSYS; no unsupported success is claimed. Warning-bearing original
mount runs remain failed: the kernel frees static default source="none"
because its is_kernel_rodata returns false. Configured-source real ramfs
mounts pass warning-free; NULL/default-source compatibility is still blocked.
The immutable manifest has27,631 entries and2,736 actual includes
(2,324 inherited), SHA256
`8a7fd6467b2e0f4811d855472845bd55ffad61e15aaebf02475c871c30be5766`.
Acceptance SHA256 is
`a12316a740cf22f5f60b5941cf65a4c4e2894c16f94a5a254c15d6d060b6922a`;
28-path repository freeze SHA256
`8601858d3ab57c39b349a5bc4ddc48a1f08793ea15f50913460d0620668d29c3`.
Root independently verified all27,631 frozen inputs, all28 repository paths,
456 current/snapshot runtime hashes, both CPIO modules and34 served inputs
per gate. Freezer exited0 in60.374s; its process group is empty. The local
checkpoint adds only this file and the route to the28 frozen paths; no deploy.
The exact30-path checkpoint is `a249f2e3a27efbedd2ff0d55c581faccd4ee075e`,
tree `74238f4610059b825f047657ecfd55c1b3051993`, parent
`4668062c29e0450008de51ba5c5f7a989142f16a`; root verified all28 frozen
committed blobs, exact scope, clean index and unchanged Sites HEAD.
Root's next source-only plan covers 26 further genuine public fixed wrappers,
with exact header/stream hashes and actual kernel body evidence at
`/mnt/p6/build/glibc-next26-plan-20261002/plan.json`. See
docs/glibc-syscalls-next26-plan-20261002.md. pivot_root remains a separately
deferred historical export; swapoff/swapon/acct/fanotify_init have actual bound
ENOSYS bodies. This planning does not authorize an unsupported-success claim.
Native static-module registration and caller provenance follow the reviewed
loader plan; preserve public dlfcn APIs and honest unsupported ELF/namespace
errors. Do not replace return-address builtins with null or erase APIs.
Default GNU thread stacks additionally need MAP_STACK and real overflow/guard
adaptation; the current memory provider cannot satisfy their defaults unchanged.
No production GNU sysroot, general CRT/NPTL, cancellation or Nightly build is
accepted yet.
The fresh same-model kernel planner has only the 36-wrapper plan and narrow
source/configuration audit context. Another fresh type-review spawn hit the
tool's thread limit. No GPU build was resumed. Root's separate stat packet at
`/mnt/p6/build/glibc-stat-20261002` now compiles nine unchanged GNU stat-family
objects and eight public type/address checks, with290 actual inputs audited.
Owned architecture selection routes actual implementation calls through
statx291 with GNU conversion; no public runtime acceptance yet. See
docs/glibc-stat-plan-20261002.md. A fresh stat-runtime spawn again hit the
thread limit; the existing integration agent received only the new task's
necessary briefing and owns new tools/glibc/stat-runtime/** plus
`/mnt/p6/build/glibc-stat-runtime-20261002`. Next are real stat canary, fields,
aliases, symlink/dirfd/error and beyond2038 time64 native/FPCAST guest gates,
retaining all191-object runtime regressions. Frozen next26 and root stat
compile sources remain separate and preserved.
The stat compile packet is now immutable:23,063 entries,290 actual compile
inputs,144 verified borrowed tools; manifest SHA256
`e6efcd1c146eb5d559ab782aa5013908cb83f8d487c8005860c727fc19119a1a`.
Compile acceptance SHA256
`275c840812213e186feec0a3ad24183baca207b9b9a13323b4748b8474d03a41`;
12-path repository freeze SHA256
`a8370c760161a7cc15e6644714ae91fefce818a8cd10b565d2ac396852db317d`.
Root independently rehashed all inputs/repository paths, validated all nine
objects and checked five actual statx raw-IR units. All three build groups
and the external freezer are terminal and empty; freezer exit0/50.660s.
The local checkpoint adds only this file and the route to those12 paths.
No full public stat runtime/sysroot/Nightly acceptance or push/deploy.
The exact14-path compile checkpoint is
`ecfd442fe473764dbff4a6ec2974835364575b6a`, tree
`a6ef45aa5245e8be2723f06461147995073d231a`, parent
`a249f2e3a27efbedd2ff0d55c581faccd4ee075e`; all12 frozen blobs and exact
scope independently match, index clean and Sites unchanged.

Independent root synthetic stat controls now pass10,308 assertions across
native and FPCAST23i64 actual GNU public table calls. Fifteen genuine objects,
real GNU errno and independently encoded statx fields exercise64-bit inode,
size/blockcounts, times beyond2038/before1900, device boundaries, contiguous
16-byte canaries, output-preserving errors and negative-fd short circuit.
This is synthetic transport, not guest acceptance. See
docs/glibc-stat-host-20261002.md; immutable task
`/mnt/p6/build/glibc-stat-host-20261002` has23,160 entries, manifest
`9c7c8b559980b666eca66dceae7bfd92135c665958b4434c8bbf2e4c186a3285`;
acceptance `069443641269e1ee124741760afbf11d985b578d0ccccdadb641ee4b2dcf448b`;
six-path repository freeze
`17939d07d8f343265eb7bea06ae46f2208e9709f53bd3142dbf014434404f058`.
Root independently rehashed all entries, verified both modules and actual
23-i64 FPCAST type, and checked three empty terminal groups. Freezer
exit0/57.030s. The local checkpoint adds only this file and the route.
The synthetic stat checkpoint is `444df08f5c2fd4540171649a664f2dcc8250b6df`,
tree `a9970a8109af4ba1a4ea623b9ee0c2c6463e938d`, parent
`ecfd442fe473764dbff4a6ec2974835364575b6a`; root checked all six frozen blobs,
exact eight-path scope, clean index and unchanged Sites HEAD.

Final real stat attempt3 passes native48,633/0 and FPCAST48,640/0, including
all prior191-object runtime regressions. Eight genuine GNU public stat APIs
preserve actual beyond2038 timestamps, file/link/symlink/dirfd fields and errno.
Contiguous16-byte leading/trailing guards cover every output boundary byte.
The original caller-errno-leak failure and passingattempt2 payloads with
incomplete padding coverage remain retained. Root independently checked203
actual objects (182 Wasm/21 bitcode),221 current/snapshot records,543 dependency
records,13 compiler attempts, both actual packaged modules and served inputs.
All26 historical/current owned groups and the external freezer are empty;
freezer exit0/77.308s. See docs/glibc-stat-runtime-20261002.md.
The immutable task `/mnt/p6/build/glibc-stat-runtime-20261002` has27,892 entries,
3,071 absolute includes (2,736 inherited), manifest SHA256
`4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042`,
acceptance `41071efa5034d429d7af866116092bf7e74d33d01f94fb9de55d6a47b61250f9`,
exact22-path repository freeze
`0aab221e0a60f34525b128a80fb4e95d0e7e54dd228fd245e155cb09ef1ab80c`.
Root rehashed all entries and22 repository paths. No full libc/sysroot/Nightly
acceptance or Sites deployment follows from these bounded stat results.

The source-only remaining plan reconciles168 original failed targets to125
dedicated later compile closures and43 outstanding original targets. The79
cumulative wrappers include17 predating that inventory; only36+26 close62
of its93 original generated failures. See
docs/glibc-remaining-closure-plan-20261002.md. Root independently verified79
source inputs,43 original source/snapshot/command sets and39 actual kernel
body boundaries/names/active table mappings. This is not a new fullmake result.
The scheduler/semaphore packet is frozen and independently reviewed. Its four
original GNU compile targets pass; native48,573/0 and FPCAST48,584/0 retain
the prior191-object runtime regressions. Three public scheduler and five
public nonblocking semaphore APIs exercise actual policy readback/restoration,
atomic handoff, overflow/EAGAIN and contiguous guards. Root rehashed47,123
manifest entries,30 repository paths and201 link objects, verified exact
packaged payloads and all11 empty owned groups. Manifest
`7add20192700d9c544a3fadd192255f3491277d64896ddb1e1b6a3e29432af9a`;
repository freeze
`759f894b95615f489a20880e07975456c46fe3317ab84beae39f47b1f8dad86a`.
See docs/glibc-sched-sem-20261002.md. Do not infer blocking sem_wait,
cancellation or default public NPTL lifecycle acceptance.
The integration agent now owns new tools/glibc/cumulative-make/** and
`/mnt/p6/build/glibc-cumulative-make-20261002` for fresh genuine cumulative
make -k -j2 lib discovery, combining accepted frozen overlays without copying
the accepted fixture object set or touching mutable scheduler inputs. Its
second genuine make is now terminal exit2 after359.14s:1,690 complete Wasm
objects,36 GNU text stamps,zero partials andzero archives. All168 original
failures were attempted;125 now compile,43 remain, and newly reached
io/xstatconv.o adds one distinct legacy ABI failure. The scheduler overlay
was not part of this build. Root independent review and terminal freeze pass:
47,442 manifest entries, manifest
`dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09`,
exact15 repository paths. Do not claim a libc archive/sysroot. The frozen
discovery report retains its pre-freeze wording; this later review supersedes
that documentary status without changing tested source or frozen evidence.
Root's native libio offset-alias adapter is frozen in
`/mnt/p6/build/glibc-data-alias-final-20261002`,58 manifest entries, SHA256
`484c458177125e84683da87938340f0c779e9b0106b1e7338e17008ac05b7e4a`;
five-path repository freeze
`cbadd6cd0d2f6cf851071a05f7005c35c49cfc66225680df579cbfce19da14a7`.
Eight independent linked address/dispatch checks pass, seven malformed IR and
eleven malformed metadata controls reject. Two LLVM aliases preserve GNU's
168/420 offsets; post-backend linking metadata restores exact84-byte extents,
with code/data/relocations unchanged. Original incorrect LLVM alias extents
and earlier experiment remain retained. See docs/glibc-data-alias-20261002.md
and tools/glibc/data-alias/README.md. This is retained genuine frontend and
linked fixture acceptance. A fresh actual GNU target rebuild in
tools/glibc/vtables-make/** now passes: unchanged GNU libio/vtables.c yields
a5,242-byte Wasm object, SHA256
`4d740463ea8b1ba997dde317bc5c8251fc3e35ddf1834826b1e3b5f57e34e09a`.
Root independently checked364 actual dependencies, seven compile stages,
strong84-byte aliases at168/420, all11 unchanged non-linking sections and
three empty owned process groups. Terminal freeze and root full readback pass:
22,974 manifest entries, manifest
`4560bc3586da072fa8e64d8966c8918831142677636b16d8883ae4633d767589`,
exact10 frozen repository paths. Undefined GNU providers remain; never treat
this compilation as full stdio acceptance.

The final16 generated-wrapper packet is terminal-frozen and independently
reviewed: native48,728/0, FPCAST48,719/0,231 link objects,16 actual GNU make
targets,36 repository paths,96,238 manifest entries. Manifest
`888d4947e801e9c3ecc5c58c194751964be069c8ed993284c846da4c4c105266`.
Root verified exact native/FPCAST archive payload bytes and unchanged base
records except the test launcher/new probe. The13 unsupported APIs retain
actual kernel ENOSYS; no capability is synthesized. See
docs/glibc-syscalls-final16-20261002.md. Its frozen report's review-pending
wording predates this completed review. Full NPTL/sysroot remain incomplete.

Actual GNU checked-jump source selection now compiles both ordinary and
checked providers, preserving the previously tested owned native helper
bodies. Root froze/reviewed22,551 entries and five repository paths, manifest
`51c9ccab91c1fa6747c70228ad60e48e9344329571674a49dee61c074c9588e3`.
See docs/glibc-checked-jump-make-20261002.md. Substitution of those exact
GNUmake-built objects into real guest regressions now passes native48,709/0
and FPCAST48,730/0 with all prior gates and three invalid checked-jump
abort134 cases. Root independently rehashed119,627 frozen entries and13
repository paths and parsed both actual CPIO archives against their unchanged
base. Manifest
`12fbdae877de5e2f639df6152106c00c08536a0b2046dbc8d29edf50ab331c0d`;
see docs/glibc-checked-jump-runtime-20261002.md. Only two selected GNUmake
objects replace the prior helper;230 other runtime objects remain byte-identical.
The frozen report retains its earlier review-pending wording; this completed
review supersedes it without changing tested code or evidence.
Continue with real static GNU build/CRT/NPTL and coherent dependency rebuild,
never cancellation stubs or a regular setjmp wrapper targeting a dead frame.
The source-reviewed continuation route is docs/glibc-runtime-route-20261002.md.
GNU nptl/unwind.c requires _Unwind_ForcedUnwind/_Unwind_GetCFA, absent from
LLVM22.1.8's Wasm implementation; ordinary UnwindLevel1.c excludes __wasm__.
Native cancellation/C++ cleanup needs architecture/compiler integration and
real public API acceptance, beyond the manual cleanup-chain jump fixtures.

The completed source-only Nightly JIT API audit is at
`/mnt/p6/build/firefox-nightly-jit-api-20261002/acceptance-and-migration-plan.md`:
107 source checks pass, but compilation and runtime acceptance remain pending.
New PBL source lives under js/src/vm; IC cursor/context access, opcode IDs,
Watchtower guards and browser PBL initialization need the reviewed migration.
The prior Nightly musl packet is closed and its build entrypoint disabled;
its configure/export/component/33 ABI checks do not satisfy the glibc target.
No full Nightly/glibc browser, new JIT or new Firefox GPU release exists yet.

# Nightly upgrade — 2026-10-02 (superseded libc choice; read next)

The user now explicitly requires **latest Firefox Nightly first, then working
native Wasm JIT, then GPU**. This supersedes implementation against Firefox
128.14 ESR. Fresh same-model subagents with only necessary context remain
authorized. Native Wasm only, adapter preference, disk-backed task storage and
preservation of known-good source/build trees and unrelated services still
apply. Do not start the old 128-only GPU wrapper/build packets.

Official Nightly metadata was pinned on 2026-10-02: version `159.0a1`, build ID
`20261002095017`, source revision
`6ce79a0416258aa1bc3a29e9ccebccdacebf916a`, dated archive
`2026-10-02-09-50-17-mozilla-central`. Metadata and the isolated source/full-port
plan belong under `/mnt/p6/build/firefox-nightly-plan-20261002`. The existing
incremental PBL builder and payload verifier do not constitute a full Nightly
build. Locate/reconstruct the full configure/build recipe and migrate the guest
adapters against that pinned source; do not substitute a native x86 binary.
Reaudit Nightly's SpiderMonkey and wgpu APIs before reusing old ABI hooks,
decoder goldens or wrappers. Nightly has not been built, promoted or deployed.

The prior JIT release is now public **Sites v10**, still Firefox 128.14.0 ESR:
https://linuxonweb.exact-coot-7512.chatgpt.site . Parent runtime commit
`772bb8cb78fadbfaf850e1e34691d710bfcad146`; Sites source commit
`b9656d4705aa4f6a073fa1b7122acf53a728a7c1`; runtime `ce0d881dec8c`.
Saved version
`appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_d95d358ac7f081918db3fa181f4387ba`;
successful deployment `appgdep_6abf9e40b8248191ad11721dd367e7a2`.
All 90 public routes pass full read-only verification, including the entire
88,910,833-byte Firefox image. Cloudflare injects an exact reviewed 938-byte
challenge script into the two HTML routes and removes their ETags; all other
HTML bytes match, and all 88 non-HTML routes retain strict byte/hash/header
checks. The root is the built static meta-refresh without COOP; the Linux
landing page has the required isolation. Run1 FAIL remains retained; narrow
verified run2 PASS is in
`/mnt/p6/build/guest-jit-sites-20261002/public-runtime-verification-run2.json`.
Public v9→v10 browser QA was held and then superseded by the Nightly request;
do not claim those browser update/cold-warm/TLS tests passed. Preserve v9/v10
release artifacts and the safely closed public-v9 baseline profile for future
Nightly update testing. The authorized Sites redeployment after JIT was carried
out; carry the existing release authorization into the validated Nightly work.

# Resumed — 2026-10-02 (prior JIT implementation direction)

The user has explicitly resumed implementation: make Firefox's native Wasm
JIT work and verify it in the Linux/Wasm web guest, then complete GPU support
and evaluate the best route, including wgpu. Fresh subagents using the same
model are explicitly authorized, with only necessary task context (no full
conversation fork). This supersedes the pause and no-subagents clauses in the
historical handoff below. JIT comes before GPU implementation. Storage policy,
native Wasm only, adapter preference, preserving unrelated files/services and
the existing public Sites audience still apply. The user explicitly authorized
redeployment to ChatGPT Sites after JIT finishes on 2026-10-02; proceed with that
release after JIT acceptance, then continue GPU work. This supersedes historical
clauses asking for another Sites confirmation.

**Current release state:** native Wasm JIT candidate `ce0d881dec8cea07` is
accepted and promoted locally as runtime `ce0d881dec8c`. The final apply passes,
including immediately rechecking 117 pinned evidence files. Independent checks
verify the 88,910,833-byte Firefox archive SHA-256
`ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745`;
kernel and plain rootfs remain unchanged. The original eight release cases all
have median ratios <=1; the separately audited array case is about 72.36×
faster than the actual previous release. Both failed unpublished-JIT7c array
comparisons remain FAIL under the explicitly documented engineering tradeoff.
This is a numeric loop specializer with safe interpreter fallback, not universal
Ion coverage. Apply evidence and the verified baseline rollback pair are at
`/mnt/p6/build/guest-jit-promotion-20261002/apply-tradeoff-final-run1/`.
The release commit and authorized ChatGPT Sites redeployment follow. Sites v9
is still public; do not claim the new runtime deployed until public acceptance.

JIT 7c compound array updates and JIT 8 numeric property/Math compilation are
implemented. JIT8 + handler fallback candidate `962b207fbc746434` passes real
startup/update and six-boot safety checks (all 18 helpers compile before
mutation), but is not accepted or promoted. Safety exposed repeated compilation
from a cache keyed only by shared bytecode. The script-aware cache candidate
`37aeed1b7dcb8469` passes safety smoke (exactly one compilation per helper) and
the complete original benchmark's semantics. Integer/property/Math ratios are
0.007/0.014/0.010, but deep/error throws regress 1.103/1.077, blocking promotion.
Explicit-throw fallback candidate `256bb70bc59e7d97` passes a smoke but does not
yet resolve those regressions. Cached eligibility rejection plus a copied
JIT-entry fast return in candidate `ce0d881dec8cea07` passes its original smoke:
deep/error medians 39/39 ms match the earlier control. Its full original ABBAAB
benchmark passes all six boots, 144 rows, checksums and unchanged inputs; all
eight median ratios are <=1, with deep/error 1.000. Later host variance is large;
do not claim exception/JSON speedups. Candidate boot 6 demonstrates major-GC
epoch 4→5 eviction/recompilation. Cold/warm startup and profile-preserving update
pass on this same candidate, including zero image requests for warm/update
boots. Full safety also passes all six boots and 450 result rows: every candidate
boot compiles the 18 required helpers exactly once before mutation checks,
with 8,408 assertions per boot. Spec6 passes all six functional boots, but its
`and-or` timing is held at 5/4 ms versus JIT7c. A predeclared six-boot precision
confirmation uses 2,500 reps instead of 100, unchanged function bodies and no
excluded samples. Its coverage-only acceptance bound is candidate/control
<=1.05 with both aggregate median batches >=75 ms; the original eight-case
promoted comparison still requires every median ratio <=1. The precision check
passes at 108/105 = 1.028571 with aggregate arm medians 107/113 ms. Spec7
passes all six functional boots, but compound array updates measure 13/12 ms
versus JIT7c (1.083333). The predeclared 1,000-repetition confirmation fails
the same 1.05 coverage bound: median boot batches are 124/142 ms, a candidate
slowdown of 14.516%, with aggregate medians 128/146 ms. All six boots and 198
batches pass correctness, input and cleanup checks; none is excluded. Promotion
remains held. Source inspection identifies a caller-policy difference: the
protected benchmark caller runs in the C++ interpreter in the final candidate,
while JIT7c permits PBL. The default-argument callee still uses PBL/compiled
Wasm. A fixed two-boot four-mode caller/argument diagnostic passes all 264
samples, with A/B median batches 118/116, 118/116, 118/119 and 124/119 ms.
It does not establish the caller policy as the cause or overturn the failed
confirmation. An adaptive future-entry proposal remains unapplied. A fixed
six-boot comparison of the protected array workload against the actual live
promoted runtime passes its frozen strict <=1 declaration: median boot batches
are 1,013/14 ms (control/candidate), about 72.36× faster. All six boots and 198
raw batches pass correctness, input, navigation and cleanup checks.
Before launch, root froze conditional decision `c8e5fe57a2727850c375f6bfd50121ffb9ea0a10629e34c0da9ca5a67273ec98`
at `/mnt/p6/build/guest-jit-promotion-20261002/root-conditional-tradeoff-decision-run1.json`.
This allows a narrowly audited release tradeoff against unpublished JIT7c
only if the live-baseline array comparison passes. Both failed 7c comparisons
retain FAIL status and unresolved cause. The original eight
promoted-case bounds and safety/startup/update checks stay mandatory. All
original and failed confirmation evidence remains retained. The final promotion
helper passes 186 checks, including evidence freshness immediately before
replacement. Its independent final review and concrete dry-run precede apply.
The actual public v9 baseline passes Firefox readiness, typed input/download,
119 NSS trust records and persistence; its cleanly closed profile is retained
for the real public update after deployment.
Plan, build, test and deployment are delegated with minimal context, as the
user explicitly requested again on 2026-10-02.
Keep all candidate archives isolated and preserve the saved baseline.
Work started at HEAD `ada94961dcec1f1e9d253e96969487260213262e` on branch
`claude-opus-5-5-guest-gpu-jit`. GPU work is read-only route/ABI preparation until
JIT release/public acceptance. The selected JIT is promoted locally; Sites v9
remains public until the authorized release finishes.

# HANDOFF — 2026-10-01 late (historical pause, superseded above)

The user paused the goal and asked for this summary. Do not resume work until
the user says so. Branch `claude-opus-5-5-guest-gpu-jit` (JIT 7 committed as `33db1bd`).
Overall goal estimate: about 80/100, not complete. **No subagents** (user
rule 2026-10-01; this supersedes "Subagents use Opus 5.5" below). The storage
policy (`/mnt/p6/build/<task>`, TMPDIR/TMP/TEMP there, never /tmp) and
"adapters over upstream patches, native wasm only" still apply.

## Done (committed, details in the packet list below)

- **Guest Vulkan ICD:**
  - WebGPU by default, WebGL2 fallback, over the `gpu_hostcall` transport (H1);
    vsock is the fallback transport.
  - Core 1.1, sync objects, uniforms, textures, depth, WSI objects.
  - The extensions, features and limits Zink needs; a 256 MiB heap with
    suballocation.
- **OpenGL via Vulkan:** static Mesa 26.2.3 Zink+EGL works for ES2 and GL 2.x
  compatibility contexts (B2a-B2g). glgears on Zink matches softpipe pixel for
  pixel.
- **Gears table** (`docs/zink-b2g-glgears-20261001.md`), 128x128, FPS shown /
  rendered without display, NVIDIA WebGPU:
  - softpipe 166.9/443.2
  - GL-on-Zink 85.5/233.1
  - vkgears 118.3/437.1
- **Main page:** `?gputest=1` with `gputestapp=vkgears|glgears`,
  `gldriver=softpipe|zink`. GPU sessions are on by default in Firefox mode
  (`?gpu=0` opts out).
- **Firefox GPU groundwork:**
  - W0 mmap MAP_SHARED, W1 WebGPU gates, W2 `gpu_hostcall`, W3 decoder, W4a host
    executor.
  - F1a: Mesa EGL+Zink linked into Firefox (candidate `2c3830fbec61`, not
    promoted).
- **JIT (portable baseline interpreter + runtime loop specializer to wasm,
  `tools/pbl-jit/PblJit.cpp`):**
  - JIT 4-6: int loops ~190x; let/args/if/&&/||/?? loops 73-335x.
  - The candidates are not promoted.

## Done: JIT 7a + 7b (committed `33db1bd`)

- **JIT 7a (doubles) + 7b (dense number arrays, `.length`, `NopIsAssignOp`,
  `Dup2`):** see `docs/guest-jit-spec7-20261001.md`, task root
  `/mnt/p6/build/guest-jit-spec7-20261001`.
- **Results:**
  - Host test 335/0.
  - Startup/update gates pass for 7a and 7b.
  - ABBAAB 7a vs 7b (`bench-7b-run1`): array loops ~90-180x faster, whole
    fixture 280 s -> 57 s, launch unchanged, 0 bails.
- **Candidates (not committed, not promoted):**
  - `web/linux/tests/runtime-candidates/pbl-jit-spec7-run1` (7a,
    `test-pbl-a405cc684e1fb352`)
  - `web/linux/tests/runtime-candidates/pbl-jit-spec7b-run1` (7b,
    `test-pbl-cc4937fc7c48c88d`)
- Still uncommitted and NOT to be staged: `web/sites`,
  `web/linux/tests/firefox-webgpu-wrapper/` (W4b draft), runtime-candidate
  archives, backups and other unrelated untracked files.

## Not done — next steps in order

1. **JIT 7c:** arr-inc only reached 0.43x, because `a[i] += v` emits
   `ToPropertyKey` (JOF_IC) before `Dup2`. Make it a no-op on Int32 keys that
   still advances the IC index. Add it to the host arrinc case, then rebuild
   (`tools/build-firefox-pbl-jit.py`), package
   (`tools/guest-rootfs/package-pbl-candidate.py`), gate and bench. The
   commands are in the spec7 doc.
2. **JIT 8 (designed, not started):** monomorphic GetProp/SetProp, GetGName
   constants, inlined `Math.*`.
   - **Guards:** all shape and constant guards are hoisted to loop entry
     (NoEntry on mismatch).
   - **New Ty kinds:** ObjTy for PlainObjects held in vars that the loop never
     writes; ConstTy for a table of up to 16 constants (pointer + shape).
   - **Property access:** compile-time `NativeObject::lookupPure` gives the slot
     (fixed slot through `getFixedSlotOffset`, dynamic slot through
     `offsetOfSlots`). Bail if the value is not a number.
   - **Math natives:** identify them through
     `fun->jitInfo()->inlinableNative` (`InlinableNative::MathMax/Min/Abs/Floor/Ceil/Round/Sqrt/Trunc`).
     The `js::math_*` symbols are not all exported.
   - **GC safety:** compile only when no incremental GC is in progress. Store
     `gc.majorGCCount()` and the script in the Entry; at entry, if either
     changed, evict and recompile.
   - **Bytecode:** `Math.max(a,i)` =
     `GetGName; Dup; GetProp; Swap; args; Call(122)`. Also handle
     `CallIgnoresRv(126)`, `SetProp(76)` and `StrictSetProp(77)`.
   - **Test fixtures:** prop-mono and native-call from
     `web/linux/tests/guest-jit-pbl-bench.html`.
3. **Non-PBL regressions remain** (throw 1.27x, Math native 1.18x, prop 1.11x
   vs promoted); JIT 8 should remove the last two. Promote JIT only after it
   beats the promoted build on all cases. The promotion needs startup/update
   gates and user confirmation before any Sites deploy (Sites v9 stays public).
4. **GPU (paused at gears milestone `1d75be3`, waiting for user confirmation):**
   - resolutions above 128 px;
   - B2b blocking fence/semaphore waits (and the `zink_context_destroy` spin);
   - push constants;
   - Z24/S8, sampling Zink images, GL >2.x;
   - vkgears re-uploads all buffers every frame;
   - WebGL2 fence poll cost;
   - the G3 main-page gate.
5. **Firefox GPU (paused):**
   - F1b: Firefox WebGL on Zink, relinked onto the current Firefox and
     run in the guest.
   - W4b: wgpu wrapper draft, uncommitted in
     `web/linux/tests/firefox-webgpu-wrapper/`.
   - W4c: ship the decoder wasm under `web/linux`, then W5-W9 per
     `docs/firefox-webgpu-design-20260929.md`.
   - Audit Firefox for the odd-index member-function-pointer `call_indirect`
     trap (see B2c).
6. **Hardware video decoding:** not started.

Processes to leave alone: user server PID 1591443, PID 1441390, Xorg, the
user's Chromium/Chrome Canary, dev servers 443487/2647744. Nothing from this
session is running.

# Resumed work — 2026-09-28 (Claude Opus 5.5 session)

The user explicitly resumed the goal: guest GPU in Linux-wasm, Vulkan usable by
ordinary guest apps, Firefox GPU and JIT, then OpenGL via Vulkan (Zink).
Branch: `claude-opus-5-5-guest-gpu-jit` (from `8ba982e`). The Codex-era weekly
quota stop below is superseded for this work: if the 5-hour usage window runs
out, pause and resume after it resets. Subagents use Opus 5.5; size each
packet to finish in about 20 minutes (user, 2026-09-30) and chain packets. Storage policy below still applies to every packet.

Current packets (update as they finish; latest direction 2026-10-01: WebGPU-default guest Vulkan, H1 below):
- Done: Vulkan gap research `docs/vulkan-gap-zink-vkcube-20260928.md`
  (Mesa 26.2.3, Vulkan-Tools v1.3.231; tracks A vkcube, B Zink, C Firefox GL).
- Done: JIT design `docs/guest-jit-design-20260928.md` (private jit_install
  syscall intercepted in worker.js, per-process control SAB + log replay,
  runtime PBL-to-wasm specializer for SpiderMonkey).
- Done: JIT packet 1 runtime primitive (`72b71a9`,
  `docs/guest-jit-runtime-primitive-20260928.md`): 62/62 real-guest checks,
  installed call 15.7 ns vs static 15.3 ns. Firefox table is not growable yet
  (JIT packet 2 must splice/relink it).
- Done: Vulkan A1+A2 core 1.1 queries, fences, semaphores (`083368a`,
  `docs/guest-vulkan-core11-sync-20260928.md`); all ten guest suites pass.
  Waits return VK_TIMEOUT instead of blocking; no extensions/WSI yet.
- Done: Vulkan A3 uniform buffers (`f93e8a2`, `docs/guest-vulkan-uniform-buffers-20260929.md`):
  descriptor set layouts/pools/sets + UNIFORM_BUFFER on WebGPU and WebGL2
  (opt-in `allowUniforms`); uniform app 201,269 checks on both backends, all
  ten earlier suites unchanged. No dynamic offsets/push constants yet.
- Done: Vulkan A4 sampled textures/samplers (`5195015`,
  `docs/guest-vulkan-textures-20260929.md`): opt-in `allowTextures`, RGBA8 2D
  <=128, samplers, combined image samplers; all earlier suites plus textures
  pass (`/mnt/p6/build/guest-vulkan-a4-20260929/all-run1`). First runs on a
  physical GPU: WebGPU on NVIDIA MX110 (Dawn Vulkan), WebGL2 on Intel ANGLE.
- Done: Vulkan A5 depth (`a9ee52c`, `docs/guest-vulkan-depth-20260929.md`):
  opt-in `allowDepth`, D32/D16 attachments, compare ops/writes, LOAD/CLEAR.
  Depth app 42,620 checks on NVIDIA WebGPU and Intel WebGL2; all earlier
  suites pass (`/mnt/p6/build/guest-vulkan-a5-20260929/all-run1`). No
  stencil/bias/clamp, no depth sampling/readback, <=128x128, no WSI.
- Done: Firefox GPU check page (`7d02735`): packager
  `tools/guest-rootfs/package-firefox-gpu-check.py` adds the WebGL/WebGPU cube
  page plus `distribution.ini` (toolbar+menu bookmark, default homepage) to
  the W1 candidate -> `37bd8f5d7fc7` (`/mnt/p6/build/firefox-gpu-check-20260929/candidate-run3`,
  not promoted). `guest-run4` passes cold/warm; guest reports webgl=none,
  webgpu=none (null adapter) until W3+. Web UI icon toolbar/resolutions: `8d65406`.
- Done: Firefox WebGPU design (`5f0c1b5`, `docs/firefox-webgpu-design-20260929.md`):
  guest Firefox has WebGPU DOM/IPC/wgpu bindings but only the Empty hal and
  RELEASE_OR_BETA gates. Route: `--wrap` forwarder at `wgpu_server_*` to a host
  GPU-owner Worker (host WebGPU passthrough). Packets W0-W9.
- Done: W0 mmap-shim MAP_SHARED aliasing (`91c80e0`,
  `docs/firefox-mmap-shared-20260929.md`): one backing per file, guest 63/0,
  relinked Firefox passes DevTools even without the packed-JS workaround
  (root cause fixed) plus startup/update regressions. Candidates
  `93720d50222f` (workaround kept) and `9fe35012a2b7` (workaround removed) in
  `/mnt/p6/build/firefox-mmap-w0-20260929`; neither promoted.
- Done: W1 WebGPU gates (`88a24f8`, `docs/firefox-webgpu-w1-20260929.md`): two
  `RELEASE_OR_BETA` gate lines relaxed under `__wasm__` (only upstream edit),
  prefs in `defaults/pref/wasm.js`. Guest `navigator.gpu` present,
  `requestAdapter()` resolves null (Empty HAL), no crash; startup cold/warm
  pass. Candidate `c27a1a7c6e6a` (base W0 `9fe35012a2b7`) at
  `/mnt/p6/build/firefox-webgpu-w1-20260929/candidate-run1`; not promoted.
  Later Firefox candidates build on it.
- Done: W2 `gpu_hostcall` channel (`d030464`, `docs/firefox-webgpu-w2-20260929.md`):
  private syscalls 0x6a470001-3 intercepted in worker.js -> lazily started
  GPU-owner Worker with a real WebGPU adapter (NVIDIA MX110 verified), 256
  SAB slots, owner-loss errors. Chromium writeBuffer accepts SAB views.
  Firefox W1 regression run4 passes; runs 2/3 failed under host load on a
  duplicated guest keystroke (kept).
- Done: W3 host wgpu action decoder (`web/linux/tests/firefox-webgpu-decoder/`,
  `docs/firefox-webgpu-w3-20260929.md`): Rust->wasm bincode decoder (377,315
  bytes, no imports, `/mnt/p6/build/firefox-webgpu-w3-20260929/decoder-build-run2`).
  Gate-run3: 21,098 checks, 0 failures. 31 goldens come from Firefox 128.14.0's
  own client encoders (wgpu c7458638) and round-trip byte-exact; 4,047 malformed
  cases are rejected; 11,400 fuzz inputs cause no traps. The decode median is
  9.2 us. W4 blockers are listed in the doc: adapter_pack_info, callback queue
  drained in poll_all_devices, mapped-range staging, direct-FFI descriptors,
  async error policy, epoch-checked ids.
- Done: Firefox DevTools blank fix (`132e4fc`, `docs/firefox-devtools-20260928.md`):
  packed-JS adapter reads `ppmm.sharedData` in the parent process (the cpmm
  snapshot is incoherent under the Wasm mmap shim). Candidate `b21b2cac65a3`
  at `/mnt/p6/build/firefox-devtools-20260928/candidate-run1` passes console,
  eval, inspector and warm in the guest. v9->candidate update gate
  `/mnt/p6/build/firefox-homepage-20260926/devtools-update-run1` passed (home,
  user.js, prior download preserved; zero-image restart). Promoted locally in
  `web/linux`; v9 inputs kept in `/mnt/p6/build/firefox-devtools-20260928/v9-baseline`.
  Not deployed to Sites (v9 still public).
- Done: JIT packet 2 Firefox prep (`fbfdaab`, `docs/guest-jit-firefox-prep-20260928.md`):
  Table section splice (min 177851, no max; only opt/firefox/firefox changes),
  stack-pointer option (c), fpcast 23-i64 guest test 24/24, host check on
  spliced Firefox 11/11, startup/update regressions pass. Candidate
  `a9438150f676` at `/mnt/p6/build/guest-jit-ffprep-20260928/candidate-run1`
  (base `b21b2cac65a3`) is NOT promoted; promote with the JIT specializer.
- Done: Zink B0/B1 (`c4e71e9`, `docs/zink-requirements-20260928.md`): Mesa
  26.2.3 wasm32 configure passes (bundled libdrm, xshmfence/xxf86vm stubs).
  Zink startup needs 7 device exts + 4 features (maintenance1/5,
  desc_update_template, renderpass2, dynamic_rendering, robustness2,
  timeline_semaphore; nullDescriptor etc.), CPU device type for surfaceless,
  >=3 descriptor sets, headers >=354 (bind Zink directly to the ICD).
  Current guest limits reach GL 2.1/ES 2.0 at best. Plan B2a-d, B3, B4a-f.
User priority (2026-09-29): finish guest Vulkan first, then Firefox WebGPU
(prefer passthrough to host WebGPU if feasible), then Firefox GPU generally;
Zink/OpenGL is deferred until after that. JIT continues in parallel when a slot
is free.
- Done: JIT 3a PBL static diagnosis (`docs/guest-jit-pbl-diagnosis-20260930.md`,
  scratch `/mnt/p6/build/guest-jit-pbl-diag-20260930`). PBL adds only 6
  `js::pbl::` functions (0.075% of code). The 09-26 "slower" verdict rests on
  one run per build and is likely mostly noise. The one clear regression is
  exceptions (~1.3-1.6x, every throw goes through `jit::HandleException`); per-op
  checks compiled in for non-`__wasi__` come next. fpcast does not explain it.
  Next is JIT 3b: an ABBAAB 6-cold-boot measurement of baseline `6c7fad94` vs PBL
  `6febc628`, run on an idle host (no concurrent browser gates).
- Done: JIT 3b A/B (`docs/guest-jit-pbl-bench-20261001.md`, `/mnt/p6/build/guest-jit-pbl-bench-20261001/run1`):
  ABBAAB 6 cold boots, harness pass (checksums identical, inputs unchanged).
  PBL vs baseline: int-loop 0.99 (equal), fib calls 0.78 (PBL faster), throws
  1.12-1.30 slower (H2), Math.max native calls 1.18 slower (Call IC path, not
  fpcast), prop-mono 1.075 (below threshold), json noise-bound. GO for JIT
  packet 4 on PBL; the specializer should emit direct JSNative calls and inline
  monomorphic property ICs.
- Done: JIT packet 4 runtime loop specializer (`docs/guest-jit-pbl-spec-20261001.md`,
  `/mnt/p6/build/guest-jit-spec-20261001`): `tools/pbl-jit/PblJit.cpp` turns hot
  innermost int32 loops into wasm via jit_install (one LoopHead hook in a PBL
  copy, `tools/build-firefox-pbl-jit.py`). Host emitter test 47/47. ABBAAB vs PBL
  (`run1`): int-loop 254.6 -> 1.33 ms/100 reps (~190x), all checksums identical,
  other 7 cases no regression. Candidate `test-pbl-0ba71ef269c7910a`
  (`web/linux/tests/runtime-candidates/pbl-jit-run1`, not committed/promoted) is
  on the old fa0217 lineage (forced Bing), so the session-startup gate cannot
  run (non-JIT control fails identically). Next JIT 5: rebase PBL+JIT onto the
  promoted Firefox, run startup/update gates, then GetArg/doubles, prop ICs,
  native calls.
- Done: JIT 5 rebase (`docs/guest-jit-rebase-20261001.md`, `/mnt/p6/build/guest-jit-rebase-20261001`):
  `build-firefox-pbl-jit.py --link-command` relinks PBL+JIT onto the promoted
  TLS Firefox link (`b21b2cac65a3`). Candidate `test-pbl-d1284e694e28b982`
  (`web/linux/tests/runtime-candidates/pbl-jit-rebase-run1`, not committed/promoted)
  passes `jit5-startup-run1` and `jit5-update-run1` (firefox-homepage task). ABBAAB vs
  promoted: int-loop 0.004, fib 0.76, throw-flat 1.27, prop-mono 1.11,
  native-call 1.18, json 1.00. Next JIT 6: let/TDZ, args, if/else, &&/||/??.
- Done: JIT 6 specializer coverage (`docs/guest-jit-spec6-20261001.md`, `/mnt/p6/build/guest-jit-spec6-20261001`):
  let/TDZ, GetArg/SetArg, if/else/continue/&&/||/?? as nested wasm blocks with
  typed joins, liveness-based head guards, Mod/Neg/BitNot, Bool/Undef/Null.
  Host test 114/0. Candidate run2 `test-pbl-25c06bc9ce505703`
  (`runtime-candidates/pbl-jit-spec6-run2`, not committed/promoted) passes
  `jit6-startup-run2`/`jit6-update-run2`. ABBAAB vs JIT 5 on the new
  `guest-jit-spec6-bench.html`: 7 new cases 73-335x faster, controls equal, 0 bails.
  Next JIT 7 (doubles, dense GetElem/length), JIT 8 (prop ICs, JSNative calls).
- Done: Web UI stop button (`1eafeb7`): single stop icon (SVG has no `hidden`
  property), light blue, and a Stop/Cancel confirm popover below the button.
- Done: gputest G2 cube demo (`docs/gputest-demo-20260930.md`, `/mnt/p6/build/gputest-g2-20260930`):
  `web/linux/tests/gputest-demo/` vkcube-lite (depth cube, uniform MVP, XImage
  presentation, `GPUTEST_FPS` lines) packed by `tools/guest-rootfs/package-gputest-demo.py`
  into `web/linux/gpu/gputest.cpio` (1,316,864 B, `1a65cf4b`). Real page gates:
  `?gputest=1` NVIDIA WebGPU 48 FPS/72 s; `&gpubackend=webgl` Intel ANGLE 39 FPS;
  `&firefox=1` 14 FPS (capped 15) beside Firefox. Rotation verified by screenshot diff.
- Done: Firefox WebGPU W4a host executor (`docs/firefox-webgpu-w4a-20260930.md`,
  `/mnt/p6/build/firefox-webgpu-w4a-20260930`): gpu_hostcall op 0x10 with
  `WGQ1`/`WGR1` messages, 25 calls (server/adapter/device/buffer/map/encoder
  copy+clear/queue write+submit/poll events/stats) in `web/linux/dist/guest-gpu-wgpu.js`,
  full Firefox ids with epoch checks, per-call error policy + poll events.
  Guest test 102/0 on NVIDIA (maxwell); W2 regression 150/0. Decoder wasm is
  still served from the W3 build dir (ship it in W4c). No textures/passes/shaders.
- Done: Vulkan A6a WSI objects (`056172b`, `docs/guest-vulkan-wsi-20260930.md`):
  ICD interface 3 surfaces (xlib/xcb), VK_KHR_swapchain on graphics devices,
  swapchain images; acquire/present return FEATURE_NOT_PRESENT (A6b). Full
  regression 18/18 suites (`/mnt/p6/build/guest-vulkan-a6a-20260930/all-run2`,
  NVIDIA WebGPU + Intel WebGL2; wsi 276,963 checks each).
- Paused: W4b Firefox wgpu wrapper draft (uncommitted, `web/linux/tests/firefox-webgpu-wrapper/`,
  goldens in `/mnt/p6/build/firefox-webgpu-w4b-20260930/goldens-run1`). W4a runner hex parser fixed (`aa93cf0`).

User priority (2026-10-01, supersedes 09-30): full guest Vulkan + OpenGL for
ordinary apps, measured with a glxgears-style benchmark: software GL (Mesa
softpipe; llvmpipe needs an LLVM JIT) vs OpenGL on Zink on the guest ICD vs
native Vulkan gears, on the NVIDIA recipe; then STOP for confirmation. Firefox
WebGL relink (F1b) and W4b are paused. Packets: B2e (done) -> B2f buffers/suballoc -> B2c push
constants -> B2b blocking waits -> caps (1 MiB alloc, 128 px, Z24/S8, present);
S1 softpipe Mesa build + `glgears` EGL app with XPutImage + FPS (parallel);
V1 `vkgears` (same geometry, Vulkan); S2 three-way score table.
Previous priority (2026-09-30, supersedes 09-29): guest Vulkan usable by Firefox and
apps, Firefox WebGL/WebGL2 on guest Vulkan via Zink (no Vulkan WebGL backend in
Firefox; design `docs/firefox-webgl-zink-design-20260930.md`), then STOP for
user confirmation. Chain: Zink B2a (exts/features/limits, CPU device type) ->
B2b (blocking fences/timeline semaphores) -> B2c/B2d as needed; B3 static Mesa
Zink+EGL wasm32 build (`tools/zink/`, `/mnt/p6/build/zink-b3-20260930`, running)
-> guest eglprobe pixels -> F1 Firefox EGL adapter (PR_LoadStaticLibrary table,
EGL_PLATFORM=surfaceless, gfx.x11-egl.force-enabled, GPU host in Firefox mode).
W4b/W4c, JIT 3b and G3 wait until after that milestone.
- Done: Zink B3-prep (`95e5298`, `docs/zink-b3-static-build-20260930.md`): Mesa
  26.2.3 Zink+EGL(surfaceless)+GLES2 static wasm32 archives, no Mesa patches;
  `eglprobe.wasm` links with the guest ICD, 0 undefined, only guest imports
  (`/mnt/p6/build/zink-b3-20260930/link/run3`). Vulkan lookup via
  `tools/zink/shims/zink_static_vk.c` (replaces u_dl.c, bypasses the 1.3.231 loader).
- Main page serves guest GPU sessions in Firefox mode by default (`7136d3b`, `?gpu=0` opts out).
- Done: F1a (`dfbc7f6`, `docs/firefox-webgl-f1a-20260930.md`): Mesa EGL+Zink+ICD
  linked into Firefox (+18.65 MB, no new duplicate symbols) with NSPR static
  `libEGL.so`/`libGL.so`, glxtest adapter reporting TEST_TYPE EGL, and
  `gfx.x11-egl.force-enabled` in `wasm.js` (a `once` pref). Candidate `2c3830fbec61`
  (`/mnt/p6/build/firefox-webgl-f1a-20260930/candidate-run2`, not promoted) passes
  cold/warm. WebGL reaches Zink: "CPU device requested but none found" (needs B2a).
- Done: Zink B2a (`6742a69`, `docs/zink-b2a-20260930.md`): 7 Zink exts, features2
  chain, CPU device type (LIBGL_ALWAYS_SOFTWARE / GUEST_VK_DEVICE_TYPE), limits,
  renderpass2/dynamic rendering/update templates/timeline counters/null UBO,
  push ranges accepted (not executed). 20/20 suites incl. zinkcaps
  (`/mnt/p6/build/zink-b2a-20260930/all-run2`). Guest `zink_create_screen` OK;
  EGL init fails: surfaceless EGL needs BGRA8 configs.
- Done: Zink B2e (`2a26a22`, `docs/zink-b2e-20260930.md`): BGRA8, 128 px
  resources under `GUEST_VK_ZINK`, independentBlend; 20/20 suites. Guest EGL
  init OK (1.4, 6 pbuffer configs, glsl 460); eglCreateContext fails because the
  ICD rejects Zink's vkCreateBuffer usage 0x1ff.
- Done: glgears S1 (`f9c1ce7`, `docs/glgears-s1-20261001.md`): glxgears port on
  surfaceless EGL (FBO readback -> XPutImage), `tools/glgears/build-glgears.sh`,
  `web/linux/gpu/gputest-glgears.cpio`, page `?gputest=1&gputestapp=glgears&gldriver=softpipe|zink&glmode=bench|present|nopresent`.
  Softpipe 300x300 on the NVIDIA recipe: ~87 FPS presented, ~185 FPS nopresent.
  Zink: EGL init OK, eglCreateContext fails (vkCreateBuffer usage 0x1ff, B2f).
- Done: Zink B2f (`docs/zink-b2f-20261001.md`, `/mnt/p6/build/zink-b2f-20261001`):
  generic buffer usage, 256 MiB heap/suballocation/offset maps, multiple pools,
  Zink colour images, typed trace-and-fail stubs (`zink-stubs.inc`,
  `GUEST_VK_TRACE_CALLS=1`). Guest eglprobe on NVIDIA WebGPU: ES2 and GL 2.0
  compat contexts, GL strings, exact glClear + glReadPixels pixels. First draw
  stalls in shader compile (no Vulkan call traced). 20/20 suites (zinkcaps 91,309).
  Next B2c: locate the compile stall (1.2/1.3 tracing), push constants,
  viewport/scissor, buffer copy/fill/update, generic vertex/index/UBO binding.
- Done: V1 vkgears (`fcfcde8`, `docs/vkgears-v1-20261001.md`): same gears in Vulkan
  on the guest ICD, render 128x128 (ICD cap) upscaled to 300x300, page
  `?gputestapp=vkgears[&vkmode=][&vksize=]`. NVIDIA WebGPU 59 FPS present / 189
  nopresent; Intel WebGL2 43 / 120 (WebGL nopresent = issue only). Reproducible
  CPIO `338e88c1`. Open: re-uploads all buffers per frame.
- Done: glgears `&glsize=WxH` (`8af39db`): softpipe at 128x128 gives 202 FPS
  presented / 452 nopresent, which beats vkgears on the ICD (189 nopresent). ICD
  per-frame overhead dominates.
- Done: V2 vkgears profile (`docs/vkgears-v2-profile-20261001.md`): 93% of a
  nopresent frame (5.2 ms) is the guest blocked on host awaits. Ranked fixes:
  (1) one error scope per submit (-1.2 ms nopresent / -3.6 ms present),
  (2) pipelined fences = B2b (-2.5 ms), (3) present path without CPU upscale +
  one-frame-late staging ring (-5 ms present). Projected ~175 FPS present.
- Done: P1 host per-frame overhead (`docs/gpu-host-p1-20261001.md`,
  `/mnt/p6/build/gpu-host-p1-20261001`): WebGPU renderer pops error scopes per
  call and awaits them with work-done in one round trip, defers upload scopes
  (native upload error -> terminal -5 on next op), reuses one readback staging
  buffer. vkgears NVIDIA: nopresent 185->240 FPS, present 54->71 (128px 64->79).
  20/20 suites unchanged. WebGL2 fence poll (setTimeout 4 ms) is the next host cost.
- Done: Zink B2c stall fix (`docs/zink-b2c-20261001.md`, `/mnt/p6/build/zink-b2c-20261001`):
  the "stall" was two silent Wasm `call_indirect` traps. (1) wasm32-musl clang
  uses the generic Itanium C++ ABI: member-function-pointer calls with an odd
  table index trap (Mesa GLSL `builtin_builder::_image`); fixed by the minimal
  Mesa patch `tools/zink/patches/0001-*.patch`, applied to a copy by
  `tools/zink/mesa-overrides.sh` (Mesa trees untouched). **Firefox uses the same
  toolchain: audit it for the same trap.** (2) `vkCmdBindVertexBuffers2` added;
  all 550 other procs are typed UNIMPL stubs. Shader compile/link OK; the first
  draw fails cleanly. 20/20 suites unchanged. Next B2d: pipeline layouts with
  binding 128 / >=3 sets, depth_clip_enable, dynamic viewport/scissor, generic
  vertex/index/UBO backing, push constants -> UBO, Copy/Fill/UpdateBuffer,
  `zink_context_destroy` spin (B2b).
- Done: Zink B2d (`81c9722`, `docs/zink-b2d-20261001.md`): first GL draws via
  Zink (ES2 + compat) on WebGPU and WebGL2; H1 virtual GPU (`9a5ecb8`).
- Done: Zink B2g + S2 gears table (`1d75be3`, `docs/zink-b2g-glgears-20261001.md`):
  indexed draws (submit-time gather), cull/frontFace (WebGL inverts),
  descriptor pool reset/free, vertex/fragment interpolation matching; glgears
  on Zink pixel census identical to softpipe. S2 at 128x128 (present/nopresent
  FPS), NVIDIA WebGPU: softpipe 166.9/443.2, GL-on-Zink 85.5/233.1, vkgears
  118.3/437.1; Intel WebGL2: Zink 51.8/116.0, vkgears 56.3/137.9
  (`/mnt/p6/build/gears-s2-20261001`). Regression `zink-b2d-20261001/all-run4`
  20/20. Milestone reached: STOP for user confirmation before next packets
  (caps >128 px, B2b blocking waits, push constants, GL >2.x).
- Done: Zink B2d (`docs/zink-b2d-20261001.md`, `/mnt/p6/build/zink-b2d-20261001`):
  first GL draws through Zink on the guest ICD. eglprobe ES2 + GL compat
  clear/draw pass on NVIDIA WebGPU (`zinkb/guest-webgpu-run15`) and Intel WebGL2
  (`guest-webgl-run16`). ICD-only adapters: SPIR-V binding remap, unused push
  block and extra gl_FragData outputs dropped, Zink uint[] UBO rewritten to
  vec4[] + bitcast, dynamic viewport/scissor, generic vertex/UBO staging ring,
  MAX_RES 1024. Host accepts vec4 inputs fed by fewer components. 20/20 suites
  (`all-run2`). Open: sampling Zink images (probe draws untextured unless
  `EGLPROBE_TEXTURE=1`), push constants, index/strip draws, Z24S8, B2b waits.

User direction (2026-10-01, latest): WebGPU backend first and as the default
for guest Vulkan ("virtual GPU in linux wasm or a better way"); three.js was
considered and rejected (see the H1 doc). Subagents are forbidden: work inline.
- Done: H1 hostcall virtual GPU (`docs/guest-vulkan-webgpu-backend-20261001.md`,
  `/mnt/p6/build/vk-webgpu-hc-20261001`): guest ICD talks to the GPU-owner
  Worker over `gpu_hostcall` ops 0x20-0x22 (`web/linux/dist/guest-gpu-vk.js`,
  unchanged `serveGPU` executor, WebGPU first / WebGL2 fallback), vsock is the
  fallback. Opt-in per page via `ownerConfig.vk` (main page on; isolated test
  pages stay on vsock). Guest env `GUEST_GPU_TRANSPORT`, `GUEST_GPU_BACKEND`.
  vkgears matched NVIDIA WebGPU: nopresent 224->281 FPS, present 51->59
  (128px 60->76); WebGL2 119->137 / 36->44. Hostcall vkgears CPIO promoted.
  Next: B2d (Zink first draw) on this transport, then the three-way gears table.

User request (2026-09-30), `?gputest=1` / `?firefox=1` / forced GPU prefs:
- `?firefox=1` already auto-boots Firefox (`web/linux/main.js`); keep it
  working, alone and combined with `gputest`.
- Firefox prefs: `package-firefox-gpu-check.py` `[Preferences]` now forces
  webgl.force-enabled, webgl.enable-webgl2,
  webgl.disable-fail-if-major-performance-caveat, dom.webgpu.enabled (+workers)
  and gfx.webgpu.ignore-blocklist on the default branch (like about:config).
  The page also records `webglcontextcreationerror`. Candidate
  `/mnt/p6/build/firefox-gpu-check-20260929/candidate-run5` (`d5103be54146`,
  commit `c31cf89`); gate `guest-run5` passes cold/warm; not promoted.
  Forcing does not add a GL driver (no libGL/EGL/glxtest in the guest), and
  WebGPU stays a null adapter until W4.
- `?gputest=1` packets (A5 landed; unblocked):
  - G1 DONE (`7e69a15`, `/mnt/p6/build/gputest-g1-20260930`): `web/linux/gputest.mjs`
    + main.js wiring, pinned translators in `web/linux/gpu/`. E2E with a test
    CPIO: A5 depth client 42,620 checks on NVIDIA WebGPU. Lessons: CPIO without
    directory entries; no `( ) &` subshells in `/gputest-init` (no /proc yet),
    use a separate waiter script. Sites deploy must include `web/linux/tests/`.
  - G1 (original spec): main-page host wiring. Add vsockDevice. Retry `vsock.connect(4050)`
    and serve with `serveGPU` (WebGPU high-performance, WebGL2 fallback,
    graphics/uniform/texture/depth), using translator wasm shipped under
    `web/linux`. Append the demo CPIO to the initramfs (decompressed for
    Firefox) and set `rdinit=/gputest-init`.
  - G2: demo CPIO with an animated depth-tested rotating cube (uniform MVP)
    presented via XImage in a loop, printing FPS. `/gputest-init` starts it
    after X is up, then `exec /init`. Adapter only: no rootfs `/init` change.
  - G3: main-page gate on NVIDIA for `?gputest=1` and
    `?gputest=1&firefox=1`.
  - There is no OpenGL demo until Zink.
- Web UI (`30d992f`): Boot button turns into Stop after boot (flush home,
  close, reload without auto-boot); portrait resolutions 512x960, 720x1280,
  900x1600; display click scrolls to top after 2 s. Headless check
  `/mnt/p6/build/ui-stop-20260930/test.mjs` passes.

User rules (2026-09-28): native wasm only, no x86 emulation. Prefer adapter
code (host runtime adapters, guest shims, link wrappers, packed JS/pref
overrides, new files) over modifying upstream Firefox/Mesa/kernel source; patch
upstream only when unavoidable, as minimal hook points, and justify it.

# Current work and handoff — 2026-09-27 UTC

Read `Agents.md` for the existing project instructions and historical build notes.
The current user's instructions take precedence. Preserve all source clones,
known-good build trees, and unrelated untracked files. Never stage the whole
workspace indiscriminately.

## Budget stop — latest check 2026-09-27 UTC and local time

Stop condition is now established from the current Codex session's own
`token_count.rate_limits` metadata, not inferred from goal token totals.
The latest record at `2026-09-27T07:14:48.308Z` reports `limit_id=codex`,
`window_minutes=10080`, `used_percent=96.0`, and `resets_at=1791046687`.
That is a seven-day window with **4% remaining**, below the user's standing
80%-remaining stop floor in `Agents.md`. The separate 15% task allowance cannot
be calculated without a starting quota reading; the remaining-quota floor alone
requires stopping. Do not infer weekly quota from the goal token counter.
The earlier `2026-09-27T02:52:17.316Z` reading was 60% used/40% remaining;
the latest reading supersedes it and the historical claims below that weekly
usage was unavailable.

All implementation subagents are completed; none needs interruption. No task
browser or server was started during this documentation continuation. No fresh
service inventory was taken; cleanup and server-identity observations below
belong to the earlier acceptance runs. Preserve the user's existing server.
The development goal is paused under the user's conditional stop instruction.
The user authorized only this documentation and
Git handoff; that authorization does not resume implementation. Resume
only on a subsequent user resume/budget instruction, and recheck fresh quota
metadata before starting a large port. Read only quota fields from the current
session; do not dump conversation logs or credentials.

Last completed release is public Sites v9, root runtime commit
`ae1648539f394d557ff067902599b002ec587c5d`, Sites source
`0f4067fbe8bf73a556029dd4f6b28d948c4e7390`; acceptance/handoff commit `df08f2f`.
The graphics review remains read-only: no Mesa version has been pinned and no
new graphics implementation/build has started. The graphics translator explicitly
rejects resource bindings and accepts only private globals; the current driver
is not a Zink-capable Vulkan implementation. On resumption, pin actual Mesa
requirements before selecting a bounded implementation task. Native JIT,
general Vulkan/OpenGL, Firefox GPU support and hardware decoding remain
incomplete; do not mark the full goal achieved.

## Next agent: current state and continuation checklist

**Paused and incomplete, approximately 75/100 overall.** The objective remains
Wasm Linux/Firefox performance, native JIT and guest GPU support, persistent
home, verified image caching/updates, usable desktop/mobile controls and public
Sites deployment. The current deployed release is **Sites v9** at
https://linuxonweb.exact-coot-7512.chatgpt.site . The release identities immediately
above and the detailed v9 evidence below are authoritative over older handoffs.

Completed and accepted: separate persistent `/home`; compressed, verified boot
image caching; automatic refresh and update/reload preserving home/profile data;
storage controls; warm boots with zero system-image requests; startup fixes;
and the key-free Firefox NSS seed retaining all 119 native trust records. Public
TLS navigation and local software-media acceptance pass. These are bounded
acceptance results, not proof that every performance or mobile goal is complete.

Still incomplete: native Firefox JIT, general Vulkan/OpenGL and Mesa/Zink,
Firefox GPU integration, and hardware video decoding. The isolated graphics,
compute and X11 presentation prototypes use SwiftShader software evidence;
they do not establish physical GPU acceleration or deployed Firefox GPU support.

On a subsequent explicit resume/budget instruction:

1. Read fresh session quota fields and apply the standing stop floor before
   implementation. Do not derive quota from goal-token totals or assume the
   separate 15% allowance without a starting reading. Review root and nested
   `web/sites` Git state before changing either repository. This documentation
   turn began on `gpt-6-agent-persistent-linux-performance` at root commit
   `1ce96847807f323b30b7198ab99ae01ad7528101`, with tracked files clean and 24
   unrelated untracked entries; preserve those entries and stage only scoped files.
2. Preserve the user's server, last recorded as PID `1591443`, startTicks
   `148821663`. Revalidate its identity before any process action; never stop it
   or reuse obsolete task service handles. Preserve source clones, known-good
   build trees, failed-run evidence, and existing `/build` contents.
3. Review `docs/guest-vulkan-x11-presentation-20260926.md` and
   `docs/guest-gpu-angle-feasibility-20260926.md`. Inspect the graphics translator's
   rejection of resource bindings/private-global-only boundary, then pin actual
   Mesa requirements before choosing a bounded implementation task. No Mesa
   version or new graphics port has been selected by this handoff.
4. Before any build, test, browser or task server, verify persistent disk backing
   and capacity under `/mnt/p6/build/<task>` and export `TMPDIR`, `TMP`, and
   `TEMP` to its short `tmp` directory. Apply the full storage policy below to
   caches, profiles, logs and generated artifacts; never use `/tmp` or tmpfs.
5. Preserve v9 and keep v8 as rollback. Read
   `docs/firefox-tls-bootstrap-20260926.md` and
   `docs/evidence/runtime-graphics-20260926/firefox-tls-sites-release.json`
   before a release. Never promote `prepared-seed-run1` or `fast-candidate-run1`:
   they contain the rejected diagnostic SDR-key seed; safe run2 is deployed.
   Retain the documented Cloudflare TCP destination restriction and
   `PR_CONNECT_RESET_ERROR` reachability limitation.

Fresh-agent thread-limit failures recorded below are historical: two fresh
read-only command agents succeeded during this documentation turn. Follow
`Agents.md` delegation limits for future authorized work; no implementation
agents or services were started for this handoff.

## Mandatory build storage policy

Standing user instruction for all builds: **default to `/mnt/p6/build/<task>`**.
Use another location only after verifying it is persistent and disk-backed.
Never use `/tmp`, `/dev/shm`, or any `tmpfs`/`ramfs`
filesystem for build inputs, intermediates, outputs, extracted rootfs trees,
compiler scratch space, build caches, disassembly dumps, build logs, test
browser profiles, or generated/test artifacts. This applies to every agent and
subagent, including the build, test, browser and server processes they launch.

This applies to temporary build files as well as final outputs; a tool's default
temporary directory is not an exception.
This policy overrides temporary paths in older build notes and copied commands.
Before running those commands, redirect their output, cache, and scratch paths
to compliant storage; do not reuse a historical `/tmp` path.

- Prefer a task-specific directory under `/mnt/p6/build`, including a `tmp`
  subdirectory for tool scratch files. Another disk-backed project/cache
  directory is acceptable; verify its filesystem and enough free capacity for
  the expected inputs, intermediates and outputs first.
- Check the actual filesystem backing the resolved path, including symlink
  targets; a directory named `build` is not sufficient if it resides on tmpfs
  or ramfs. Use `/mnt/p6/build`, not `/build`, as the default build root.
- Set and export `TMPDIR`, `TMP`, and `TEMP` to that disk-backed scratch
  directory before every build, packaging, test, browser or task-server command
  so subprocesses and `mktemp` inherit it. Set tool-specific temporary, build,
  and cache directories as needed; do not assume every tool honors these
  variables. Never fall back to `/tmp`; stop if compliant storage is unavailable.
- Keep large command output and debug dumps in files under the same disk-backed
  task directory. Do not let default temporary paths fill a memory filesystem.
- Keep Chromium's scratch path short, such as the task root's `tmp` directory.
  A nested `guest-service-run1/tmp` path caused its Unix singleton socket to
  exceed the path-length limit; shortening the disk-backed path is the fix,
  not falling back to `/tmp`.
- Include this policy in every delegated task and preserve these environment
  variables in launched subprocesses. Do not change the system-wide
  temporary directory or move unrelated runtime sockets, protected system
  temporary files, or active user browser profiles.

Required environment setup after verifying the destination filesystem and space
(replace `task-name` with the current task name):

```sh
mkdir -p /mnt/p6/build/task-name/tmp
export TMPDIR=/mnt/p6/build/task-name/tmp
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
```

Forty-five earlier Firefox build/debug artifacts were relocated from `/tmp` to
`/mnt/p6/build/linuxonweb-tmp-20260926/`, freeing about 17.35 GB. The migration
manifest there records the moves and metadata checks. Existing `/build`
contents must remain unchanged.

## Latest continuation: key-free NSS seed and local release acceptance

The build-policy turn made progress: scoped documentation commit `bcc59c7`.
The following seed audit and release make concrete progress; the full goal
remains incomplete (approximately 75/100). Sites v9 is now published at the
existing public URL, with public TLS navigation acceptance now passed.
Fresh agent creation failed with `agent thread limit reached` during that release;
root handled its bounded audit and release directly. This is historical, as
updated in the current continuation checklist above. No new backend port was added.

- **Never promote `prepared-seed-run1` or `fast-candidate-run1`** under
  `/mnt/p6/build/firefox-tls-20260926`. The former contains the owned diagnostic
  profile's default SDR/password-encryption key. Earlier descriptions of it as
  merely an NSS database secret were insufficient. Neither artifact was deployed.
- `tools/guest-rootfs/prepare-firefox-nss-seed.py` creates a new CA-only seed:
  remove the SDR object and its authentication metadata, secure-delete/vacuum,
  preserve all 119 native trust rows and remaining metadata, reject unexpected
  secret/private objects, and refuse to overwrite an output directory. Never
  use this preparation helper on an existing user's profile.
- `prepared-seed-run2` has zero private objects. `fast-candidate-run2` version
  `29331a186e50` is 88,378,783 bytes, SHA-256
  `7bd5e9041d568c6b5b325abba16754d943a51b009c368c39901c0fb0a751508a`.
  It uses the same resumable NSS module as the prior candidate; only that
  Firefox module and two seed databases differ from v8. It is now promoted
  locally after the `ready-update-run2` acceptance described below.
- `safe-seed-warm-run2` and `safe-seed-warm-run3` pass cold/warm guest input,
  JavaScript, home preservation, all 119 native trust records, warm HTTPS Bing,
  and zero warm boot-image requests. Two independently guest-generated SDR
  keys each decrypt their own test ciphertext and reject the other's through
  host NSS 3.125; host checks preserve the guest key objects unchanged.
- `safe-seed-media-run1` passes valid/replay/invalid/recovery software-media
  checks on the exact replacement image: valid clips each render 30 frames
  without drops, invalid padding yields decode error 3, host audio drops zero
  frames. This does not establish hardware decoding.
- Historical failed gates: the run3 invalid-certificate screenshot shows pending
  navigation, not a warning. `safe-seed-update-run1` fails before updating:
  the v8 baseline opens a blank file homepage and times out on guest input.
  Preserve its `guest-failure.json`, screenshots and result; investigate before
  claiming exact replacement update acceptance. Prior `partial-update-run1`
  passed with the rejected seed and same module, preserving 11 trust records
  while adding 108; its key DB adds 756 authentication rows, so only existing
  keys/metadata, not the whole key DB bytes, remain identical.
- `ready-update-run2` passes the real update/reload control on the exact key-free
  replacement: 108 roots repaired, 11 existing trust rows retained, existing key
  objects/metadata and home/download retained, HTTPS Bing rendered and a
  self-signed certificate rejected without an exception. Its browser/server
  close cleanly. The harness now waits for actual guest-page readiness; observed
  readiness was 15.146 seconds after NSS, beyond the former 10-second wait before
  Escape. The readiness download itself initially stole focus; only fixture
  preferences suppress the automatic downloads panel. Keep both failed runs.
- A reviewed Sites snapshot is frozen at task `release-run1/release-src/web/cloudflare`:
  58 routes, 55 parts, 151,569,304 bytes; only Firefox and boot-manifest routes
  change. Parent runtime commit is `ae1648539f394d557ff067902599b002ec587c5d`;
  nested Sites source is `0f4067fbe8bf73a556029dd4f6b28d948c4e7390`.
- Sites v9 deployment `appgdep_6ab880ade3b081919ba3764beb7362df` succeeded.
  Saved version is
  `appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_cf968ad34f24819190124c2591ce2bbc`.
  All 10 unit and 3 built-Worker tests pass. All 66 public routes verify against
  the build (167,395,980 logical bytes), normalizing only the exact reviewed
  hosting script in two HTML responses. Public cold/warm guest input, JavaScript,
  home preservation and zero-image warm boot pass. The first public URL-entry
  test becomes a Bing search, so it does not prove certificate rejection.
- Separate-tab public navigation verifies the exact typed addresses, rejects
  self-signed.badssl.com without an exception, and renders the Bing homepage
  with an HTTPS lock. `example.org` instead yields PR_CONNECT_RESET_ERROR;
  current app DNS resolves both addresses inside Cloudflare ranges, which the
  existing Workers TCP provider blocks. Keep this documented reachability
  limitation and the failed/misdirected tests; do not call them successful.
- This release's acceptance is recorded in
  `docs/evidence/runtime-graphics-20260926/firefox-tls-sites-release.json`.
  Keep Sites v8 as rollback. Continue the full goal: native JIT, general GL/Vulkan,
  Firefox GPU and hardware-decoder requirements remain incomplete.
- All owned public browser/server runs are now terminal and cleaned up. User
  PID 1591443/startTicks 148821663 and its original command remain unchanged.
  Exact build/test provenance and limitations are in
  `docs/firefox-tls-bootstrap-20260926.md` and
  `docs/evidence/runtime-graphics-20260926/firefox-nss-seed-isolation.json`.

## Active objective

Improve Firefox/Linux performance, persist user home independently of system
images, cache and update verified boot images with automatic refresh, expose
storage controls, validate desktop/mobile behavior, and redeploy the existing
public ChatGPT Site. The requested native JIT, guest Vulkan/OpenGL, and hardware
video acceleration must not be confused with host WebAssembly compilation or
host framebuffer presentation.

Both repositories were checkpointed before implementation and use branch
`gpt-6-agent-persistent-linux-performance`:

- Parent checkpoint: `ceec0ae63a26744e216d30610ad27cf0f895f3db`.
- Separate `web/sites` checkpoint: `4495e993b8653e076bd3df86e7dd50c2ddc86886`.

The parent repository tracks the full Firefox gzip archive; it is not ignored
and has no LFS/filter attributes. Include its verified bytes in scoped promotion
commits. The nested Sites repository instead locks these bytes as external build
inputs. Version 6's archive identity is independently pinned by its runtime lock;
the parent binary commit follows the initial source/manifest commit `c1665dcc`.

This is native wasm32 Linux/userspace, not an x86 emulator. The staged kernel
matches an archived configuration with FUSE and virtio-fs enabled. Its virtio-fs
driver enables permission checking internally and rejects the explicit
`default_permissions` mount option; use the tested `rw,sync,dirsync` options.

## Verified so far

- Transactional IndexedDB home backend: 16 real-browser checks, including
  sparse/truncated files, rename/unlink of open files, quota rollback, and locks.
- Actual Linux guest `/home` mount, synced file write, page reload, and exact
  readback passed. Warm boot subsequently passed with zero kernel/rootfs network
  requests. Test-only browser profiles contain the verification data.
- Cache/update UI fixture: 29 checks passed, and the real 88 MB Firefox update
  passed automatic restart and exact home-marker preservation. Warm boot used
  zero image downloads. The original CacheStorage failure was caused by nearly
  full host `/tmp`; task browser profiles and TMPDIR now live on disk. The
  verified image cache uses 1 MiB parts with its complete index committed last.
  Repeated unchanged updates preserve the distinct rollback version.
- Actual Firefox bookmark/profile reload passed: the bookmark URL, title, ID
  and GUID matched across a fresh guest, and SQLite integrity checks returned
  `ok` before and after. The row's visit_count was zero; do not claim positive
  visit-history counts. Sanitized evidence is
  `docs/evidence/runtime-graphics-20260926/storage-firefox-profile-reload.json`.
- Actual storage deletion controls passed: cancel retained the marker/profile;
  clearing image cache retained home; update refilled 134,963,688 bytes; confirmed
  home deletion removed all entries/chunks while retaining those image bytes.
  An empty root-only database may be recreated by the idle usage reader.
  Local storage scope is assessed at 95/100; live functional checks also passed.
- Host rendering: Node tests and real pixel tests pass for Canvas2D, WebGL, and
  software WebGPU, including fallback/repaint. WebGPU needs explicit offscreen
  bitmap transfer. The test environment uses SwiftShader; it proves no physical
  GPU acceleration. Canvas2D remains the measured fastest default here.
- Isolated guest GPU prototype QA3 passes guest C → virtio-vsock → browser
  WebGPU → validated pixels → X11 triangle, using Google SwiftShader fallback.
  See `docs/guest-gpu-angle-feasibility-20260926.md` and its `guest-gpu-qa3.json`
  evidence. The agent's 95/100 assessment applies only to that narrow prototype;
  it is not deployed and does not implement guest GL/Vulkan, Firefox GPU APIs,
  hardware video decoding or physical acceleration. It is not a 95/100 goal score.
- Pinned official Dawn headers were generated from eleven verified source blobs
  (597,609 downloaded bytes). The wasm32 C proc-table probe compiles, and an
  intentionally incorrect map callback is rejected for its incompatible type.
  This is compile-only evidence, not a linked driver or guest GPU execution.
  See `docs/guest-gpu-dawn-abi-20260926.md` and its `dawn-abi.json` evidence.
  Outputs and logs are in `/mnt/p6/build/dawn-abi-20260926/run1`.
  Use `/usr/bin/python3` for the pinned installed generator dependencies, and
  use `-c` for the negative callback gate: this compiler wrapper's injected
  library-search flags fail under `-fsyntax-only -Werror` before checking types.
- Portable baseline interpreter coherent rebuild passed all 83 compilation
  units, linking and Wasm validation. It was guest-tested and rejected for this
  release because it was slower. The accepted baseline was restored. This is
  not native JIT. Rejected candidate SHA-256:
  `319c01c2836aea58a8e63bbf00e5475bcbf33e271fd8c73804651ccabe80f197`.
- Frontend 27 tests, mmap sanitizer checks, native cubeb lifecycle checks,
  Cloudflare tests/build (6 passed, 3 skipped), and Sites 4 tests/build passed.
  Baseline Firefox rendered real pages and passed five JS workload checksums;
  initial timings were quantized, so use the revised fixed-batch-100-v1 fixture.
  Its result JSON was saved in the actual persistent Downloads directory.

## Artifacts and remaining work

- Preserved rootfs baselines and CPIO audits:
  `../.cache/persistent-home-20260926/`.
- Supported-mount images alter only packed `/init`; manifest is generated with
  `tools/guest-rootfs/package-persistent-home.py --manifest web/linux`.
- PBL candidate build: `tools/build-firefox-portable-baseline.py`; isolated
  outputs under `../.cache/runtime-graphics-20260926/pbl-candidate-v3/`.
- Rendering evidence/docs: `docs/host-graphics-and-firefox-jit-20260926.md` and
  `docs/evidence/runtime-graphics-20260926/`.
- Storage architecture/test status: `docs/storage-performance-20260926.md`.
- Reproducible guest test: `web/linux/tests/guest-persistence.mjs`; use its
  isolated browser profile and `ASSERT_WARM_CACHE=1 TEST_UPDATE=1` release gates.
- The Aurora readiness helper passed 23 isolated guest checks: one-second signal
  deadline, ten-second missing-display deadline, helper pending before WM launch
  followed by readiness, and already-running Aurora readiness. Actual kernel
  memory/SMP markers match the accepted Firefox configuration. See
  `docs/evidence/runtime-graphics-20260926/aurora-ready.json` and
  `web/linux/tests/aurora-ready/README.md`; artifacts remain under
  `/mnt/p6/build/aurora-ready-20260926/`. The first 1 GiB fixture panicked before
  reaching the helper without boot-console capture; the exact cause is unproven.
  Successful run2 uses `0xffff0000` bytes/two CPUs and captures kernel output.
  That isolated fixture did not launch Firefox. Subsequent real Firefox testing
  now passes for candidate `ff1ea9fc6f62`: the matched fresh-profile launch-marker
  observations are baseline 17.259 s and candidate 8.248 s (one pair, not first
  paint). Actual window/fixture render, five downloaded JS checksums, zero-image
  warm boots and real update/reload preserving exact home/profile files pass.
  See `docs/firefox-aurora-startup-20260926.md` and its compact evidence. Failed
  focus gates, adapter termination/guest stop, and successful explicit recovery
  are retained; focus setup uses real margin input, not emulation. The candidate
  is locally promoted; four old inputs are verified in the task's baseline-images.
  Frozen release staging changes exactly two routes (55 parts, 151,597,129 bytes).
  Sites version 6 deployed successfully from nested commit
  `8757a6ff2f8f0a312e7a616bb900521234395757`, pinned to parent
  `c1665dcc4ab199a88f74854627043e8c5ca85f4a`. Public version-5-to-version-6
  update/restart and warm acceptance pass, preserving exact marker, fixture,
  original version-5 download and selected profile files. Warm boot fetches zero
  system images. Actual version-6 fixture Run/Download passes five checksums;
  this newer download was created after warm and has not itself been reload-tested.
  Full public hashes/headers pass for 13 routes totaling 135,264,738 bytes,
  including all three images and the immutable worker graph. See
  `sites-v6-firefox.json`, `sites-v6-live-assets.json` and `sites-release.json`;
  version 5 remains saved for rollback. Public launch observations 34.098 s
  initial (with downloads), 33.948 s update and 17.400 s warm are unmatched;
  they do not establish a public speedup or exact first paint. Typed fixture
  navigation failed once on both versions; v6 recovered via its restored first
  fixture tab and native Reload. Cause remains unproven. Python urllib preflight
  returned 403 while the normal browser full-body verifier returned 200.
  New subagent creation reached the thread limit; existing serving/review task
  agents continue assigned work. The isolated direct Vulkan ICD lifecycle under
  `web/linux/tests/guest-vulkan/` now executes in the real 1 GiB/2 CPU guest:
  live 38 checks and unavailable 11 checks passed on first attempts. Live
  HELLO/HELLO/CLOSE created/destroyed one Google SwiftShader fallback WebGPU
  device and left zero guest instances/devices; `gpu:null` correctly rejected
  instance creation without creating a device. The 41,861-byte guest artifact
  SHA-256 is `0f2b0d4b611f2a8930e343ca1d6145824d1e48d4654307d322626b15c28e3c24`.
  See `docs/guest-vulkan-lifecycle-20260926.md` and `guest-vulkan-lifecycle.json`
  evidence. That original mode keeps zero queue flags and no command entrypoints.
  The subsequent opt-in `clear` profile now executes real guest Vulkan clear/copy
  calls through WebGPU: two 17x3 clears return all 102 exact pixels, with recorded
  values, layout/barrier validation, mapped-memory sentinels and full teardown.
  Host regression 73 checks, guest live 38, unavailable 11 and clear 951 pass;
  the latter count mostly consists of individual byte assertions. Actual guest
  kernel markers confirm 1 GiB/two CPUs. SwiftShader is software evidence only.
  All artifacts are under `/mnt/p6/build/guest-vulkan-clear-20260926/`; build-run2
  is 64,334 bytes, SHA-256
  `c0ede2c1cfb39896bcf5aafce7df2be74c96eeb2c7e08018f16d598cf6d9e730`.
  See `docs/guest-vulkan-clear-readback-20260926.md` and its compact evidence.
  The first live runner failed before guest boot on a null document element;
  its evidence is retained, a null-safe snapshot fixed the harness, and live
  retry 2 passed. Clear and unavailable passed their first guest attempts.
  At that stage the partial COMPUTE|TRANSFER profile had no compute dispatch,
  format queries, loader integration, general GPU buffers or conformance. Subsequent actual
  guest failure/exhaustion gates now also pass on first attempts: clear 951,
  transport loss 516, native device loss 516, exhaustion 1077, live 38 and
  unavailable 11 assertions. Both losses follow a completed GPU clear and return
  DEVICE_LOST from five guest submit/idle paths without changing 212 mapped bytes;
  all tracked native objects and guest allocations are released. Exhaustion fills
  the 1 MiB heap and 32-entry table, verifies six refused allocations and two
  recoveries, then completes both exact clear/readbacks. Native device loss is an
  explicit GPUDevice.destroy during staging map, not a spontaneous driver failure.
  No driver failure-path repair was needed. Evidence and 70,375-byte build-run1
  are under `/mnt/p6/build/guest-vulkan-failure-20260926/`, artifact SHA-256
  `c2bfea0d346dba4e0b1b493a49f29d528c48daeb6b014da1849089a1535cd0b9`.
  See `docs/guest-vulkan-failure-recovery-20260926.md` and its compact evidence.
  At that gate all 15 source/header hashes matched the tested build.
  Static application integration now also passes: a separate public Vulkan client
  uses the actual pinned Khronos loader's typed trampolines/terminators with an
  explicit built-in driver provider. Its first actual guest run passes 883
  assertions and both exact 17x3 readbacks, with every tracked native object and
  guest allocation released. The shared ICD now answers three required bounded
  format queries and accepts only bounded matching loader-private creation chains.
  Updated direct live/unavailable/clear regressions pass 44/14/957 assertions;
  cycles, oversized chains and mixed unsupported metadata are rejected.
  Loader build-run2 is 349,179 bytes, SHA-256
  `398747a18c68bf48b07a96cca33e829710add43be3816434eb72fcd8f64152fe`, under
  `/mnt/p6/build/guest-vulkan-loader-20260926/`. Build-run1 failed on missing beta
  declarations; matching official headers and the upstream loader-only compiler
  definition fixed that build boundary without advertising video capabilities.
  See `docs/guest-vulkan-loader-integration-20260926.md` and its compact evidence.
  At that loader gate, shaders and general GPU buffers remained absent; the
  compute continuation below adds a bounded shader/storage profile. Dynamic
  loading, external layers, generic unknown-function trampolines, GL and Firefox
  integration remain absent. Guest runs use SwiftShader, actual 1 GiB/two CPUs
  and visible isolated pages.
  The subsequent host translator gate now compiles archived Naga 0.20.0 to a
  751,237-byte standalone browser Wasm module, SHA-256
  `e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea`.
  Build-run4 and its verified dependency closure are preserved under
  `/mnt/p6/build/guest-vulkan-compute-20260926/`; earlier metadata/helper failures
  are retained. Real translation passes 33 Node checks. A dedicated-worker browser
  gate passes 167 checks, including two supplied SPIR-V formula programs producing
  128 exact GPU output words and eight preserved sentinel words on SwiftShader.
  One device and four buffers are released. A canceled Fetch event is retained
  without an established cause; no Runtime exceptions or QA errors occurred.
  This translator gate alone is host translation/compute evidence.
  See `docs/guest-vulkan-spirv-translator-20260926.md` and its compact evidence.
  The subsequent actual guest compute gate passes 499 assertions using the
  public static Khronos loader: two supplied SPIR-V programs, three GPU dispatches,
  128 verified output words and sixteen sentinel checks across two rounds.
  It verifies post-record coherent writes, consecutive dispatches retaining GPU
  state, shader/descriptor argument lifetime, malformed shader recovery, missing
  barrier and deleted-pipeline rejection. Guest allocations return to zero;
  one native device and three buffers are independently counted and released.
  Translator close is recorded, not an independent worker-lifetime audit.
  Build `compute-build-run1` is 360,103 bytes, SHA-256
  `ff6cc69182ff0f11f5677c64d566ebd7e1c1997128cfa5176b1e08e54ce83865`.
  Actual guest evidence is `compute-guest-run1/result.json` in the same task root,
  SHA-256 `b588f148bb4eadfdcd1ad68aa85ad19cd6aa9494fa101386452937d6a6780da0`.
  No guest errors or CDP events were captured. Shared-driver regressions pass:
  public-loader clear 883; direct lifecycle/unavailable/clear 44/14/957;
  transport loss/device loss/exhaustion 522/522/1083. These failure regressions
  cover the earlier image-clear path, not compute-specific injected failures.
  Existing host regression passes 73 checks. See
  `docs/guest-vulkan-compute-execution-20260926.md` and its compact evidence.
  Sites version 6 is unchanged; the prototype is not deployed. No OpenGL,
  WebGL fallback, decoder, native JIT or physical GPU claim follows. Overall goal
  remains below 95/100 (approximately 80); this is progress, not goal completion.
- Accepted runtime commit: `f24b914113dee9132471298e5e3a97b2e69b2ceb`.
  Sites version 4 previously passed exact full-image hashes,
  isolation, actual guest write/reload, zero-image warm reload, and automatic
  update/restart preserving the marker. Initial live mount timings were 62.6 s,
  53.4 s warm and 56.4 s after update. A visible 1 GiB/2 CPU repeat reached the
  kernel at 1.0 s, unpack at 34.4 s, `/init` at 38.1 s, home mount at 61.0 s,
  and shell at 71.3 s with zero system-image fetches. The corresponding local
  observation reached home at 1.98 s and shell at 2.65 s. Those earlier reports
  recorded DOM settings, not authoritative host/guest configuration, so treat
  their claimed configuration match as unverified historical provenance.
  New `runtime-origin-profile.mjs` runs confirm actual 1 GiB/2 CPU, foreground,
  zero-image-fetch boots using host lines and guest memory/SMP lines: local
  shell 4.689 s versus public 74.706 s. Worker isolation and JSPI/Atomics API
  availability match. Kernel compilation is 48.51/47.41 ms and 62 guest-module
  compiles total 152.14/151.42 ms (local/public). Repeated worker module-network
  loading dominates: longest script request 46.84/2187.49 ms, and worker-spawn
  imports total 2.204/39.619 s. Concurrent request totals are not wall time.
  Sites served every module with max-age=0,must-revalidate. The Sites-only
  derived immutable worker graph has 10/10 unit and 3/3 workerd integration
  checks passing. A lean real-browser local candidate boot passes in 2.733 s,
  with actual 1 GiB/2 CPU, isolation and 70 versioned worker requests. Version 5
  was then deployed: matched lean public console shell observations improve from
  version 4's 55.048 s to 3.486 s first and 2.693 s warm, with actual 1 GiB/2 CPU,
  visibility, isolation and no page errors. The first public boot observes 65
  versioned worker requests and zero image downloads; the warm repeat observes
  67 versioned workers with the same verified configuration. These are single-run
  observations, not a Firefox speedup ratio. Live platform/worker hashes, cache
  headers, isolation and unchanged manifest checks pass; see
  `docs/evidence/runtime-graphics-20260926/sites-v5-live-assets.json`.
  Scoped public Firefox acceptance passes at actual 4 GiB/2 CPU: real window and
  fixture render, five JS checksums, actual JSON download, update/reload exact
  marker/fixture/download preservation, and Google HTTP redirect to a rendered
  HTTPS page with lock indicator. Initial launch log/screenshot observations are
  16.150/36.517 s, not exact first paint or a matched Firefox speedup. Bing timed
  out (cause unresolved); example.com reset and its returned Cloudflare IPs are
  subject to the unchanged raw-TCP proxy's documented destination restriction.
  See `docs/evidence/runtime-graphics-20260926/sites-v5-firefox.json` and
  `docs/runtime-startup-and-live-firefox-20260926.md`. The first
  candidate run stalled with intrusive worker hooks; the no-hook control passes.
  Pinned runtime/rootfs bytes remain
  unchanged apart from the derived served platform module's worker URL.
  Small evidence: `docs/evidence/runtime-graphics-20260926/runtime-origin-profile.json`.
  Instrumentation adds overhead and resumes workers before installing hooks;
  a first constructor can race capture. Do not claim uninstrumented timings.
  A read-only browser check found JavaScript and V8 optimization allowed by
  default for both origins, no relevant preference exceptions, and no jitless
  launch flags. Do not attribute the slowdown to disabled browser optimization.
  Stable boot-manifest checks must continue to revalidate for system updates;
  future releases must retain prior immutable graph bytes for active old tabs.
  Actual guest DNS/TCP/HTTPS smoke checks passed (`wget google.com` and
  certificate-validated `curl https://www.google.com`). Small evidence is
  `docs/evidence/runtime-graphics-20260926/sites-live-timing-network.json`.

## Graphics continuation — 2026-09-26

The graphics translator, renderer and byte protocol pass real host-browser
execution; a separate public Vulkan application now also passes actual Linux
guest offscreen rendering. This is a bounded, nonconformant profile, not general
Vulkan/OpenGL or Firefox acceleration. The WebGL continuation started from
parent `094d0be13fc930d139344bc7660b65ddfd280dfd`; the accepted runtime and nested
Sites source remain unchanged. See `docs/guest-vulkan-graphics-transport-20260926.md`
and `web/linux/tests/guest-vulkan-graphics/protocol.md` for the exact contract,
evidence and next guest integration packets.

- Task root: `/mnt/p6/build/guest-vulkan-graphics-20260926/`, verified ext4.
  Accepted `translator-build-run2` is 771,221 bytes, SHA-256
  `c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636`.
  It preserves the compute run4 dependency closure/lock and rejects duplicate
  raw OpEntryPoint declarations before Naga parsing. Node check-run3 passes 66.
- Renderer browser gate: 2,585 assertions across two vertex × two fragment
  programs × two vertex layouts. Byte-protocol gate: 2,559 assertions, eight
  matching pixel rounds, 19 negative cases including whole-pass rejection and
  resource-limit recovery. Legacy host regression remains 73 assertions.
- Byte-protocol run records 124 requests, five translations, ten passes/nine
  draws, three uploads and eleven readbacks. Independently counted one Worker,
  one device, 68 buffers and one texture all close/release before emergency
  cleanup. Eleven requested source/artifact hashes match before and after.
  Raw result SHA-256:
  `bd04b15e08091b181c66b37c5a6e0e0ab66bdddc2a05309c18e5c6bd286e17fc`.
- Both graphics browser gates use SwiftShader, not physical GPU evidence.
  QA errors and Runtime exceptions are zero; renderer/protocol gates retain
  two/one canceled Fetch events of unestablished cause. Negative clip-depth/non-unit-w,
  pending-close/loss, WebGL fallback, Zink,
  Firefox GPU and hardware video decoding remain absent or unverified.
- Shared C/host regression also passes 499 public Vulkan compute assertions
  in actual Linux at 1 GiB/two CPUs. Build/package/guest run directories are
  `/mnt/p6/build/guest-vulkan-compute-20260926/graphics-protocol-regression-{build,package,guest}-run1`.
  New binary: 360,151 bytes, SHA-256
  `08b7097387590bd9e152e8d1be087580d964c10cafcde6f8187a684c380455d5`.
  Exact results/sentinels and guest/native GPU cleanup pass; inherited Worker
  close remains a report counter. All 21 source/host hashes match. One canceled
  Fetch event is retained. See the graphics task's compute-regression cross-reference.
- Fresh protocol-agent creation hit the tool's thread limit twice. Root made
  the bounded file edits directly under the file-edit exception; the existing
  sole serving agent handled all command execution and browser verification.
  Do not claim a fresh delegated protocol implementation occurred.

The guest packet committed in `094d0be` adds image views, render passes,
framebuffers, copied graphics pipelines, vertex buffers and typed draw recording.
Submission prevalidates the full stream and prepares pass JSON on the heap,
then uploads current coherent vertex bytes once per used buffer. It tracks
stored attachment contents for LOAD/readback and poisons the device on execution
failures that may leave partial effects. This remains a bounded, nonconformant
profile; do not infer general Vulkan or Firefox support.

`commands-compile-run1/result.json` under the graphics task records a successful
frozen `-Wall -Wextra -Werror` compile of the complete guest ICD. Eight source
hashes and thirteen pinned header hashes matched afterward. The object is
99,426 bytes, SHA-256
`bfb6911649d6e2b5d2f1dd83f9e2fd42aaa9aa2ca242420cfc81bede3a64d549`.
This object remains compile-only evidence. Separate actual guest evidence is
now in `guest-run1/result.json` and `guest-execution-gate-run2`: eight rounds,
four shader programs, sixteen passes/draws, twelve uploads and eight readbacks
passed, with 32 before/after hashes matching. Independent Worker/device/buffer/
texture live counts are zero before emergency cleanup. Actual kernel markers
show 1 GiB/two CPUs; adapter is SwiftShader. Zero QA/Runtime errors, one canceled
Fetch event with cause unestablished. The 232,734 checks are mostly individual
byte/pixel comparisons. See `docs/guest-vulkan-graphics-execution-20260926.md`
and its compact JSON evidence. The public application is 383,945 bytes, SHA-256
`d8955d6da382eecd5e2d2e302129ed342ad5bfb4fc431b12e9d8b05d339d0570`.
Accepted images remain unchanged. Preserve `resource-compile-run1` as earlier
resource-only evidence. No X11 presentation of the test image is established.

Shared compute regression now passes 501 checks, three dispatches, 128 output
words and sixteen sentinel word comparisons. The client preserves local invalid
header rejection and adds host IR rejection; strict host assertions are unchanged.
Root made that small test-input edit while the sole serving owner held the
available child slot; all execution remained delegated. Accepted compute inputs
are `graphics-icd-regression-{build,package}-run2` and guest `...-guest-run3`
under the compute task. The graphics task's
`compute-icd-regression-final-audit-run1` passes 39 checks, including 26 current
hashes matching the pre-run snapshot. Preserve failed runs and the wrapper that
read old run2 despite executing run3; the read-only audit verified actual run3
without rerunning. Compute Worker lifetime is still a close-call counter, and
submission execution-fault behavior remains untested.

The guest graphics packet and compute regression were checkpointed in parent
`094d0be13fc930d139344bc7660b65ddfd280dfd`: 22 scoped paths, 206 audit checks and
103 commit verification checks. The tracked tree and index were clean afterward.
Previous goal turn classification: progress (the mandatory disk-backed build
policy was strengthened in both instruction files). The current continuation
verifies the GLSL translator and real WebGL2 shader execution under
`/mnt/p6/build/guest-vulkan-webgl-20260926`. See
`docs/guest-vulkan-webgl-translation-20260926.md` and the fallback plan.
WebGL translator build-run2 passes 94 ABI/translation checks; eight independent
SPIR-V fixtures and 185 coordinate/sampling checks pass. Direct browser run1
passes 14 cases/50,021 mostly pixel checks, including both depth clipping
boundaries and reciprocal-w interpolation, with no extra readback row flip.
SwiftShader was used. All tracked native GL objects close normally before
emergency cleanup, and the finite browser exits. No persistent service started.

The first check exposed Naga's sampling normalization: implicit interpolation
overwrites explicit centroid/sample sampling. Both graphics translator sources
now reject unsupported raw direct/member decorations before parsing. Failed
WebGL build/check run1 and the predecessor diagnostic are retained. Corrected
WGSL graphics build-run3 is SHA-256
`a530270fb7ae3099fbcf60964cff494987fdf608720ce34b936e52a545b3335b`;
check-run4 passes 72 and the WebGL task's wgsl-sampling-check-run1 passes 31,
including four independent rejection cases and five byte-identical old WGSL
programs. Preserve old compute and graphics artifacts. New WGSL Worker/host/
guest regression remains required before candidate replacement.

`checkpoint-run1` under the WebGL task passes 78 checks; all frozen current
sources match, old artifacts are unchanged, the finite browser has no owned
process remaining, and user server PID1591443/startTicks148821663 is preserved.
The production WebGL renderer, host selection, Worker lifecycle, actual guest
fallback, fragment-position semantics and new-coordinate WebGPU parity are next;
do not substitute browser-only pixels for those requirements.

Fresh agent spawn and two followup attempts all failed with the platform thread
limit. Root performed bounded validation and fixes directly after explaining
the limitation. Resume delegation when possible; no second serving owner exists.
Goal accounting started this continuation at 9,624,839 tokens, with no explicit
token budget; weekly quota remains unknown.
The translator/coordinate packet is checkpointed in
`1cf9282b326e337ec992c993c0b15f8a74169e1e`: 24 scoped paths and 145 commit
verification checks, with tracked tree/index clean afterward. Exact committed
paths, commands and hashes are in the WebGL task's
`checkpoint-run1/commit-result.json`, `commit-commands.json` and
`staged-source-hashes.json`. This handoff note is a subsequent documentation edit.
The full goal is not complete and has not reached an evidenced 95/100.

### Reusable WebGL renderer continuation

Previous goal turn classification: progress (translator/coordinate proof and
sampling correctness fixes, source checkpoint `1cf9282`, handoff `b9cb47a`).
This continuation starts from `b9cb47a`, with the existing branch and clean
tracked tree. Agent creation and the sole serving owner's followup both still
fail with the platform thread limit. Root performed the bounded implementation
and finite browser commands directly; do not claim these were delegated.

New `web/linux/tests/guest-vulkan-webgl/renderer.mjs` implements the resource,
recording, whole-pass validation, asynchronous PBO/fence readback, budgets and
close/loss API. The shared WGSL renderer only adds an optional shader-validator
argument to `validatePipelineDescriptor`, retaining the existing WGSL default.
GLSL metadata is validated separately. Native errors after possible effects
become terminal `-5`, including out of memory; pre-execution budget failures
remain recoverable `-12`. Close/loss cancels confirmed pending waits.

Accepted `renderer-browser-run4` under the WebGL task passes 46 pixel cases,
84 negative/lifecycle cases and 162,287 mostly per-pixel checks. Same SPIR-V runs
through both backends, now including fragment position x/y/z/reciprocal-w and
flat shading. Seven WebGL contexts have zero native ownership before emergency
cleanup; all 77 independently tracked WebGPU buffers/textures release normally.
The finite owned browser exits zero. Both use software rendering. Preserve
earlier successful runs1–3 as historical narrower/source snapshots.
`renderer-checkpoint-run1/result.json` passes 71 current-source/artifact and
process checks. All four finite renderer browsers are absent; user server
PID1591443/startTicks148821663 remains unchanged. Compact evidence is
`docs/evidence/runtime-graphics-20260926/guest-vulkan-webgl-renderer.json`.
The scoped source commit is recorded by this packet's
`renderer-checkpoint-run1/commit-result.json`; read current Git HEAD rather than
assuming the earlier source checkpoints are still the tip.

WebGL stride is limited to 252 aligned bytes and viewports to integers. Host
HELLO and guest limits must reflect this before integration. Flat shading uses
first-provoking-vertex extension when available, otherwise bounded cyclic
index rotation. The current browser does not expose that extension: only the
index implementation is pixel-verified, including firstVertex=3 and multiple
primitives. See `web/linux/tests/guest-vulkan-webgl/RENDERER.md`.

Next packet must connect the renderer to `guest-gpu/host.mjs`: prefer WebGPU,
fall back only on initial acquisition failure with explicit pinned GLSL Worker
options, reject private WGSL/compute operations on WebGL, release owned context
and Worker on every exit, and preserve terminal failure status (do not mask it
by calling abort on a closed renderer). Update the experimental C ICD to expose
the negotiated stride and reject fractional viewports before host execution.
Current `icd.c` HELLO buffer is 4096 bytes, not the stale 512-byte summary.
Then run the same public Vulkan app in actual Linux and regress WebGPU/compute.
Do not substitute the browser gate for actual guest or Firefox support.

Goal accounting started this continuation at 9,737,322 tokens, without an
explicit token budget. Weekly allowance remains unmeasurable. Overall project
assessment remains approximately 80/100: Firefox GPU/JIT/decoder integration,
general Vulkan/OpenGL/X11, final performance validation and redeployment are
still incomplete. Keep the full goal active.

### Actual guest WebGL fallback integration

This section supersedes the preceding renderer packet's proposed host integration.
The instruction-only turn verified an existing storage rule and was no progress
toward the active performance goal. The resumed turn made concrete implementation,
guest regression and checkpoint progress. Goal accounting began at 10,145,470
tokens, without a token budget; weekly quota is still unavailable. Fresh delegation
still fails at the thread limit, so root performed bounded commands directly.

`guest-gpu/host.mjs` now prefers WebGPU and permits explicit graphics-only WebGL2
fallback on initial API/adapter/device acquisition failure. It uses the actual
pinned GLSL Worker and renderer, advertises backend-specific limits, rejects
private WGSL/compute/clear commands on WebGL, and releases owned context/Worker.
Initialization deadlines stop waiting and dispose resources delivered late.
There is no fallback after device acquisition or mid-session loss. Guest ICD
limits expose stride 252/integer viewports on WebGL; the public app verifies
limits and local rejection before exercising its original eight rendering rounds.

Authoritative graphics result:
`/mnt/p6/build/guest-vulkan-webgl-20260926/guest-fallback-run2/result.json`.
The actual Linux guest passed 232,753 mostly pixel checks on WebGL2 and 232,745
on preferred WebGPU. Each used 114 commands, 16 passes/draws/translations,
12 uploads and eight readbacks. Independent native ownership and Worker counts
reached zero before emergency cleanup. The public binary has 51 upstream Vulkan
symbols, 385,266 bytes, SHA-256
`b385309e979248414a6f52ad62285bf6adb7c75363b91844f0295c39d089845d`.
Its graphics build/package are `webgl-integration-{build,package}-run2` under
the graphics task. Run1 failed before boot due to a fixture adapter syntax error;
preserve that failed attempt. Its browser/server closed through runner cleanup.

Shared compute regression passed actual guest execution (501 checks, three
dispatches, two uploads/readbacks/translations, 21 commands):
`guest-vulkan-webgl-20260926/compute-regression-run1/result.json`, with fresh
`guest-vulkan-compute-20260926/webgl-icd-regression-{build,package}-run1`.
The finite `run-guest.mjs` now accepts that compute package as well as graphics;
the older graphics run's exact runner is preserved in its evidence directory.
No application/host input changed after the accepted graphics run.

Synthetic initialization/late cleanup and wire denial/recovery pass 86 checks
in 11 cases (`host-initialization-run3`). This uses a mock context for protocol
checks and is not rendering evidence. Run2's mock omitted status methods and
failed; run3 fixes the mock. The real guest runs prove rendering separately.
`integration-checkpoint-run1` passes 109 source/artifact/process checks; compact
evidence is `docs/evidence/runtime-graphics-20260926/guest-vulkan-webgl-integration.json`.
Both finite browser/server pairs exited, and user PID1591443 retained its exact
start/command identity. No persistent task service or candidate symlink was added.

Both backends use SwiftShader. Inspected screenshots show Aurora, not presentation
of the returned Vulkan pixels. Next integrate actual X11 presentation of those
pixels, then evaluate Mesa/Zink requirements; this is not yet OpenGL, Firefox GPU,
hardware video decoding, native JIT or Vulkan conformance. The public Site remains
unchanged. Overall assessment remains approximately 80/100; the full goal is active.

### X11 presentation continuation

Previous goal turn: progress (`d4a1ed9`, real WebGL fallback and shared compute
regression). This continuation began at 10,208,322 goal tokens with no explicit
token budget. Fresh delegation was attempted again and rejected by the platform
thread limit. Root performed bounded source/build and finite browser work;
weekly usage remains unavailable and no 95/100 overall claim is warranted.

Graphics builds now accept `--present-x11` with `--host-profile webgl`.
`presentation-x11.inc` converts the actual Vulkan readback through the TrueColor
visual into an XImage, presents in an override-redirect window, verifies server
pixels, repaints during bounded observation holds and closes X11 resources.
The build freezes/hashes 145 Xlib/protocol/header/archive inputs. This is an
application CPU-copy path, not Vulkan WSI or a general OpenGL driver.

Authoritative package: graphics task `x11-presentation-build-run2` and
`x11-presentation-package-run2`. Binary: 1,285,282 bytes, SHA-256
`8b27064c739247334863af6be7d5cd4b6cc84615b8e307a3aa9a827d78380afd`;
51 public Vulkan symbols. Archive: 41,781,072 bytes, SHA-256
`b03a30256684461b734b171166cb5ec5a3d0c20ce485ee0caf6f42b76604aa15`.
Actual dual-backend guest evidence:
`/mnt/p6/build/guest-vulkan-webgl-20260926/x11-presentation-guest-run3/result.json`.
Both runs present all eight rounds; each passes 476,544 XGetImage pixel checks
and 112,816 independent browser framebuffer component checks. WebGL2 guest
checks total 232,762; WebGPU 232,754. The full target hashes match across both
backends. Root inspected both `*-x11-framebuffer.png` captures, now showing the
actual rendered triangle in the Linux desktop. Xlib is depth24/bpp32 here.

Run1 failed framebuffer observation because the desktop cursor overlapped the
initial window rectangle; preserve its evidence. Moving the fixture 16 pixels
left passed strict comparisons in run2. Run3 adds full-frame PNG output, avoiding
the earlier page screenshot's viewport clipping. Its build and app/host inputs
match run2. No Base64 was printed. All three browsers and HTTP owners are absent
and exited cleanly. User PID1591443/startTicks148821663/command remains unchanged.
`x11-checkpoint-run1` passes 531 source/artifact/process checks. Compact evidence:
`docs/evidence/runtime-graphics-20260926/guest-vulkan-x11-presentation.json`.

Shared driver and host execution code did not change after the previous compute
regression. Current changes are optional Xlib application presentation, its build
closure, browser observation/capture and documentation. Accepted rootfs/runtime
and public Site remain unchanged. The full goal remains active at about 80/100.

See `docs/guest-vulkan-x11-presentation-20260926.md` for the actual Zink gap:
the current ICD reports no optional features or device extensions, while upstream
Zink needs substantially more than this triangle profile. Do not advertise
OpenGL/Firefox acceleration by enabling preferences or compiling Mesa alone.
Next graphics step: pin a Mesa version and inspect its requirements/startup calls,
then implement the missing resources, graphics state and presentation contract.
The independent bounded startup task remains available: isolate removal of the
forced Bing launch URL and verify actual Firefox input/startup, warm cache and
home/update behavior before promoting anything. Resolve the pending weekly
allowance before another large backend port; do not infer usage percentages.

### Firefox homepage continuation

Previous turn: progress (`428a9c2`, actual X11 presentation). This continuation
started at 10,275,332 goal tokens; no token budget or weekly usage is exposed.
Fresh delegation still fails at the thread limit; bounded work ran directly.

The forced Bing CLI launch argument has been removed from the accepted packed
Firefox init, preserving its explicit profile path and every other init byte.
Package tool: `tools/guest-rootfs/package-firefox-homepage.py`. The new version is
`89ec54c81936`, Firefox gzip 88,300,032 bytes, SHA-256
`7ad492fe595d19e210da1a365640d5e10680d5ba4e41ae85c73e0949fc2761b0`.
The other 11,469 CPIO records and kernel/plain inputs are unchanged. Current
parent `web/linux/boot-manifest.json` and Firefox archive are promoted; the old
four inputs are retained in `firefox-homepage-20260926/baseline-images`.
The generic init source was also corrected, but not used for rootfs promotion.

Finite `test-firefox-homepage.mjs` uses the existing dev server's proxy logic
with an isolated in-process server and one Chromium. No persistent service was
started. `guest-run2` under `/mnt/p6/build/firefox-homepage-20260926` passes real
baseline typed navigation/input, actual Update & restart to the candidate,
automatic saved-homepage startup/input, exact user.js and marker preservation,
and warm reload with zero kernel/rootfs requests. `fresh-default-run1` passes
with no seeded profile: New Tab appears, followed by real typed navigation and
input. Screenshots were inspected. Preserve guest-run1's pre-boot harness quoting
failure. Guest-run2's exact runner is frozen; later changes add the fresh mode
and explicit version/config assertions, not changes to the application runtime.

`acceptance-run1` verified the reports, input bindings, rollback copies and
cleanup; `promotion-run1/result.json` records the local accepted promotion.
Compact evidence: `docs/evidence/runtime-graphics-20260926/firefox-homepage.json`.
Browser and server owners exited zero, and user PID1591443 retained start identity.
See `docs/firefox-homepage-20260926.md`. Launch log timings are not first paint,
and the baseline navigation delay prohibits claiming a speedup ratio. The
verified behavior is honoring saved startup preferences instead of forced Bing.

Sites version 7 / `89ec54c81936` was deployed in that step (superseded by v8 below). Its exact nested source is
`6c68ffb494ae7381581891c9a33593a22e2faf93`, saved version
`appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_38c6842a13d48191afadf08d8f3b9e94`,
deployment `appgdep_6ab8566b78b8819198870bd7939e570a` (succeeded, rechecked).
All 66 public routes pass full content/header verification in
`firefox-homepage-20260926/public-assets-run3/result.json`. Two HTML documents
require exact, bounded normalization of the hosting-injected challenge script;
preserve the preceding failed checks. Only rootfs/manifest routes changed.
The saved tar wrapper differs from the local tar; route content equality was
verified instead. Preserve version 6 for rollback.

**Version 7's public acceptance was incomplete.** Cold guest JavaScript/input passes,
but `public-run2` and `public-run3` fail automatic warm file-homepage restoration.
`public-recovery-run2` passes only after explicit Alt+Home, using a copy of the
failed profile, with zero image requests and exact home/user.js preservation.
Its HTTPS screenshot shows example.com `PR_CONNECT_RESET_ERROR`, not success.
The recovery runner's narrow `pass` does not mean the whole release passed.
`profile-inspect-run1` decodes the saved session successfully (correct URL, one
recent crash). The test-only `public-crash-disabled-run1` also fails automatic
homepage/input; do not disable crash recovery in production as a workaround.
All those finite browser/server owners closed cleanly. See the homepage document
for scope and artifacts; diagnostic packages are never production candidates.
The full objective remains active, approximately 80/100; experimental GPU proofs
are not general OpenGL/Firefox acceleration and no native JIT/decoder claim is added.

### Single-process session startup continuation

This continuation made progress: it reproduced the public blank-restored-tab
failure locally, identified the process-selection defect, and validated a fix.
Fresh agent creation still fails at the platform thread limit; bounded commands
ran directly. Weekly usage remains unavailable; do not invent a percentage.

Packed `tabbrowser.js` selects a privileged remote process when its startup URL
is a pending session promise, even though this Wasm build disables remote
content processes. Diagnostic logs show `remote=true` and a rejected
`restoreDocShellState` (`NS_ERROR_FAILURE`). The matching preserved native source
is under `.tmp-firefox-build/.../firefox-128.14.0`; exact paths/hashes are recorded
in `firefox-homepage-20260926/session-source-audit.json`. Extra remote/fission
preferences and disabling crash recovery did not fix the bug; none were shipped.

`tools/guest-rootfs/package-firefox-session-startup.py` changes only that pending
URL fallback to `NOT_REMOTE` when `gMultiProcessBrowser` is false. It pins the
v7 rootfs/manifest and exact JS member, preserving all 11,469 other CPIO records,
init, profile preferences, member metadata except size, order and tail.
Version `b354310fe03e`, 88,406,516 bytes, SHA-256
`9a651dee0be08e6a0ffe0b2ee5b49376310d57c9b66fe72fc58959034f4ef2a0`
is now promoted locally. Four preceding v7 inputs are preserved in
`/mnt/p6/build/firefox-homepage-20260926/session-baseline-images/`; promotion
record is `session-promotion-run1/result.json` in the same task root.

`test-firefox-session-startup.mjs OUTPUT CANDIDATE [update] [BASELINE]` owns one
finite server/browser, with every artifact on disk-backed task storage. It uses
real guest typing and downloaded JS result files, exact home/user.js checks,
actual Update & restart, and zero-image warm boot. Its final runner accepts an
explicit immutable baseline, so later rootfs promotion does not invalidate replay.
The optional baseline defaults to the preserved `candidate-run1` v7 package.
Test-only `datareporting.policy.firstRunURL` is empty to avoid a delayed privacy
tab changing the selected fixture. Production privacy/crash preferences are unchanged.

`session-startup-run3` passes cold/warm; `session-control-run1` reproduces the
blank warm tab using exact unmodified v7 bytes with the same deterministic test.
`session-update-run1` and final-runner `session-update-run2` pass baseline/update
and preserve the exact earlier guest download. Screenshots were inspected and
all owners exited normally. Earlier failed tests, including a fixed click point
invalidated by a notification banner and a delayed privacy tab, remain preserved.
Compact evidence: `docs/evidence/runtime-graphics-20260926/firefox-session-startup.json`.
No first-paint or speedup ratio is claimed. User PID1591443/startTicks148821663
retains its original identity. No finite test owner remains running.

**Version 8 is now deployed; whole-release acceptance remains incomplete.**
Parent implementation/assets: `82f91eaae30ef9c090ac7e072b88ffa13489aa58`.
Exact pushed Sites source: `81c8230c80686809ced84aa84084deb1b964ab06`.
Saved version:
`appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_1398701e6ae081919bace1a4fda02289`.
Deployment `appgdep_6ab863d67d88819192aef8dcf5b0c517` succeeded, preserving public
access at `https://linuxonweb.exact-coot-7512.chatgpt.site`.
The verified snapshot is frozen at
`/mnt/p6/build/firefox-homepage-20260926/session-release-run1/release-src/web/cloudflare`:
58 logical routes, 55 parts, 151,597,037 staged bytes; exactly rootfs and manifest
routes changed. Sites unit tests (10) and actual built-worker tests (3) passed.
Worker graph remains `b9207315592456247cf13efe70142a51a33012871d2865117ff287bbafc09ee5`.
All 66 live routes passed full content/header checks (167,423,713 logical bytes),
with exact bounded hosting-script normalization for two HTML pages. The ingested
tar wrapper hash differs from the local tar; do not claim archive byte equality.
The public Firefox run passes cold and automatic warm page/input/JS checks and
exact home/user.js preservation; warm requests zero kernel/rootfs images.
Launch logs: 26.748 s cold and 7.626 s warm, not first paint or a speedup ratio.

The subsequent Bing HTTPS screenshot shows a certificate warning. No exception
was accepted; its exact error code is not yet expanded. The harness `pass=true`
refers to startup/input, not TLS or whole-release acceptance. Compact release
record: `docs/evidence/runtime-graphics-20260926/firefox-session-release.json`.
Raw live report/screenshots are `session-release-run1/public-firefox-run1` in the
task directory. All owners exited zero, server closed, no outer exceptions.
Preserve v7 and v6 saved versions and all failed controls for rollback/diagnosis.

**TLS investigation now has a locally tested candidate, not a deployment.**
See `docs/firefox-tls-bootstrap-20260926.md` and the compact evidence
`docs/evidence/runtime-graphics-20260926/firefox-tls-bootstrap.json`.
The exact error is `SEC_ERROR_UNKNOWN_ISSUER`. The v8 fallback returns after any
SSL-trusted root: the failing owned profile has 11 native trust records out of
119 roots. A fresh diagnostic completes all 119 after about 58 seconds and
renders Bing securely, but its driver exited 143 before reporting; recovery
artifacts and cleanup are preserved, and that run is not a clean pass.

Tracked patch 0004 now preserves existing native trust records and resumes only
missing shipped roots. `resume-partial-run1` reports 108 updated, 11 preserved;
all 11 old rows are byte-identical and Bing renders over HTTPS. A prepared-store
candidate `952d3cb770e4` passes fresh Firefox HTTPS with zero trust writes and a
2.123-second trust phase. That is not a whole-boot benchmark. Both candidate
drivers/browsers exit zero and close their servers. Artifacts and exact build
commands are under `/mnt/p6/build/firefox-tls-20260926`; the preserved
`firefox-mmap-aligned` media build exactly matches the deployed Firefox binary.
All builds used disk-backed scratch; the legacy unwind object was copied into
the new build directory, leaving its shared original for a separate usage audit.

Next: explicit distrust/zero-flag preservation, warm HTTPS/cache behavior, real
update/reload from a partial profile with home/key preservation, clean controls,
invalid-certificate rejection, startup/media regression, then promotion and
public deployment/acceptance. Candidate assets have not replaced live assets.
The copied browser profile must not reuse stale `DevToolsActivePort`; remove that
file only in the new copy. A successful curl probe is not Firefox TLS evidence.
General multi-tab recovery and the original JIT/GL/decoder requirements remain.
Current whole-goal estimate: 75/100, below the requested 95, with the HTTPS gate
now explicitly unresolved. Resolve the unknown weekly allowance before another
large backend port; bounded correctness work has continued without inventing quota.

## Services and deployment

**Current service revalidation supersedes the historical notes below.**
Sole owner `/root/cmd_graphics_serving` completed owned cleanup. The graphics
task's `guest-final-cleanup-run1/cleanup.json` confirms PIDs `190505`, `201964`
and `201959` absent and no listeners on `4182`/`9396`. Chromium closed through
Browser.close and its exec handle returned exit 0. The final adapter/supervisor
were already absent. All earlier service handles are retired; no task service
remains running. User PID `1591443`, startTicks `148821663`, is unchanged.
Cleanup SHA-256:
`c05f048038465e84e35cf5abf1f1f41a0e3c5cc0a00b619741d39d585e3ecc65`.

All four task-owned candidate links were checked against their latest identities
and removed; every target build, profile, cache and log remains. Future testing
requires recreating owned links from the frozen targets and starting services
through the sole owner after authoritative PID/port checks. Preserve service
attempts `guest-service-run1` through `run5`, the missing-process preflight and
the connection-refused compute attempt. One Chromium attempt failed because its
Unix socket path was too long; shorter disk-backed scratch fixed that issue.
Other adapter exits remain unexplained, including one terminal exit 0 during
the same active owner turn. Do not attribute them merely to agent turn endings,
and do not restart solely because an observation times out.

The prior serving agent (`cmd_project_audit`) gracefully closed both task Chromium
browsers and their guests on CDP ports `9394` and `9395`, and stopped the owned
dev server PID `4051151` on `127.0.0.1:4180` after final verification. All three
ports were confirmed closed. Browser profiles, frozen build inputs and evidence
remain on disk. The user's pre-existing server PID `1591443` was preserved and
still existed at cleanup. Do not terminate unrelated user services.

The continuation's sole serving agent `cmd_runtime_profile` completed cleanup:
owned ports `4180`, `4181`, `9394`, and `9395` are closed, and owned PIDs `4110623`
and `4128263` are absent. The user's existing PID `1591443` was preserved.
Profiling evidence, browser profiles and service logs remain under
`../.cache/runtime-profile-20260926/`. No task services remain running.

The Aurora helper test's owned server/browser also exited cleanly. Final socket
inspection found no listeners on `4182` or `9396`, both owned PIDs were absent,
and user server PID `1591443` retained its command/start identity. Only the test
`candidate` symlink was removed. Disk profiles, candidate archive and test logs
remain under `/mnt/p6/build/aurora-ready-20260926/`. For future cleanup, distinguish
an actual listening socket from a failed bare bind after connection teardown.

The Firefox readiness/public-v6 and Vulkan lifecycle tasks also completed cleanup.
No owned browser/adapter PID or listener on `4182`/`9396` remains; exact Vulkan
candidate symlinks were removed. The adapter closed its listener on SIGTERM but
needed an explicitly authorized, identity-checked SIGKILL after its grace period
(exit 137). Both tasks retain `cleanup.json`; user PID `1591443` was unchanged.
All artifacts remain under `/mnt/p6/build/firefox-ready-20260926/` and
`/mnt/p6/build/guest-vulkan-20260926/`. Root had to run the secure push harness in
its own echo-disabled PTY because exec sessions are agent-scoped; the credential
stayed in memory and was cleared after the successful exact-commit push.

The clear/readback continuation also completed cleanup: browser PID `50490`
closed via Browser.close and adapter PID `50178` exited on SIGTERM, both exit 0.
Ports `4182` and `9396` have no listeners; all three verified candidate symlinks
were removed. User PID `1591443` retained its exact command/start identity.
Evidence and profiles remain under `/mnt/p6/build/guest-vulkan-clear-20260926/`,
including `final-evidence-audit.json` (36 checks) and `cleanup.json`. Fresh agent
creation and completed-agent follow-up hit the tool's thread limit; the running
review agent was explicitly reassigned as sole command/serving owner. No task
service remains active.

The loss/exhaustion continuation also completed cleanup: browser PID `64410`
and adapter PID `64263` are absent after Browser.close and SIGTERM, respectively.
Ports `4182` and `9396` have no listeners, all six verified candidate symlinks
were removed, and user PID `1591443` retained its command/start identity.
Artifacts, profiles and the cleanup record remain under
`/mnt/p6/build/guest-vulkan-failure-20260926/`. No task service remains active.

The static-loader continuation also completed cleanup: browser PID `86503`
closed through Browser.close and adapter PID `86358` exited on SIGTERM, both
exit 0. Both PIDs are absent, ports `4182`/`9396` have no listeners and all four
verified candidate links were removed. User PID `1591443` retained its exact
command/start identity. Profiles, builds and evidence remain under
`/mnt/p6/build/guest-vulkan-loader-20260926/`, including `qa-summary.json` and
`cleanup.json`. No task service remains active.

The compute continuation also completed cleanup: browser PID `111111` closed
through Browser.close and adapter PID `110736` exited on SIGTERM, both exit 0.
Both PIDs and listeners on `4182`/`9396` are absent; all nine exact owned candidate
symlinks were removed. User PID `1591443` retained its command/start identity.
Builds, browser profile, packages and raw evidence remain under
`/mnt/p6/build/guest-vulkan-compute-20260926/`. The verified cleanup record is
`cleanup.json`, SHA-256
`e32dd6032eb73fd3f3fb2c82c7e85ed9b65d283f9d5217e8437fbbb310e6634b`.
No task service remains active. Do not reuse the former service handles.

The public Site is `https://linuxonweb.exact-coot-7512.chatgpt.site` with exact
project ID `appgprj_6ab78cc88a948191a1abaabd04b81fe0`. Version 9 now serves the
static runtime through Sites assets (current acceptance is recorded at the top
of this file); version 8 is retained for rollback. The unchanged Cloudflare worker
at `https://linuxonweb.testcatty.workers.dev` remains its DNS/TCP network proxy.
Cloudflare itself was not redeployed because its API token was unavailable.
The preceding version 6 rollback source is `8757a6ff2f8f0a312e7a616bb900521234395757`, deployment
`appgdep_6ab7fe800a4c8191b1f5a0ee942cd66c`, version ID
`appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_dab4dcf397488191a274dec22cdfba71`.
That preceding archive has 63 files and 151,726,080 content bytes; preserve the
`dist/server/index.js` and `dist/client` archive paths. The separate release record is
`docs/evidence/runtime-graphics-20260926/sites-release.json`.
Top-level Cloudflare release metadata and sourceFiles still describe the older,
unchanged Cloudflare deployment; do not replace them with Sites hashes. Preserve the
public audience. Read `web/sites/.openai/hosting.json` and its README; push the
exact nested-repository source commit before saving/deploying a Sites version.
Never print or persist source-repository write tokens.

Historical continuations did not expose the requested weekly usage percentage.
The current session quota reading and required pause are now recorded at the
top of this file. Do not claim a 95/100 overall result while the requested guest
JIT/GPU capabilities remain unresolved.

## Historical continuation plan — superseded by the checklist above

The following preserves the earlier implementation plan and its then-current
status. Its active-goal, unavailable-quota, pending-question, older-release and
unfinished-gate statements are historical; use the paused v9 handoff above and
later gate evidence elsewhere in this file for current status.

The overall goal remains active and is assessed at about 75/100, not the requested
95/100. The delivered startup/storage work and isolated GPU proof do not supply
native Firefox JIT, a generally usable Vulkan/OpenGL driver, or hardware video decoding.
The user has been asked asynchronously for the remaining weekly allowance;
that answer is pending. At the start of the compute continuation, goal
accounting reported 7,237,075 tokens with no token budget; this does not reveal weekly quota or
establish whether the user's 15% allowance has been reached. Resolve this
constraint before another large backend port; do not invent a percentage.

Bounded next implementation gates, subject to that allowance:

- The initial guest execution gate for `tools/guest-rootfs/wait-for-aurora.c`
  is complete using the existing artifact
  `../.cache/runtime-graphics-20260926/wm-ready/wait-for-aurora.wasm` (SHA-256
  `2c54b0b87a88366086672b3e199f886863082951a54c34ef01c2dcc6a015a2c3`).
  One-second self-test, ten-second missing-display fallback, actual Aurora
  handshake and starting it before Aurora passed with independent host watchdogs.
  The isolated candidate replacing the accepted packed init's single `sleep 10`
  is now promoted and publicly accepted in Sites version 6. Missing/nonzero
  helper fallback remains; normal deadline expiry returns zero without a second
  sleep. All other CPIO records and accepted profile/certificate fixes remain.
  The forced Bing CLI homepage has now been removed in version 7. Local update,
  saved homepage, input and warm-cache gates pass. Investigate the public warm
  restoration failure documented above before claiming full release acceptance;
  retain version 6 for rollback. Explicitly override test output paths that still
  default to `/tmp`.
- The direct Vulkan clear/readback, mid-submit transport/native-device loss and
  allocation-exhaustion/recovery gates now pass actual guest execution. Preserve
  the earlier clear/failure builds and the latest loader build-run2/packages.
  Static loader integration and the separate public-only client now pass actual
  guest execution; see `docs/guest-vulkan-loader-integration-20260926.md`.
  The installed compiler
  sysroot's libc.a supplies weak dlopen/__dlsym stubs, confirmed by actual archive
  member/symbol inspection; an ICD manifest alone does not establish loading.
  See `guest-vulkan-libc-loading.json` for the bounded evidence and limitations.
  Loader revision `61187c40845c92a80bcd2216089dd01badcda7ac` and matching official
  headers `98f440ce6868c94f5ec6e198cc1adda4760e8849` are hash-locked. Preserve
  typed dispatch and unknown-procedure rejection; dynamic discovery and generic
  extension trampolines are deliberately disabled in this static profile.
  The opt-in compute profile now supports bounded dispatch but lacks graphics,
  presentation and conformance; it is not a generally usable Vulkan or Zink device.
  The archived Naga 0.20 SPIR-V-input/WGSL-output dependency closure and host
  translator now build and pass actual worker/WebGPU formula execution. Preserve
  `translator/provenance/` and task `translator-build-run4`; the original offline
  resolver selects from the archived vendor tree, while the recorded Cargo.lock
  and per-file source-lock pin the accepted closure. Do not claim arbitrary
  cross-environment bit reproduction. Guest storage buffers, compute pipeline,
  descriptor binding and dispatch/readback now pass the separate public client's
  actual guest execution; the shared-driver regressions also pass. Preserve
  the compute build/package/run and regression evidence. Graphics resource and
  command APIs now pass the separate public application's actual guest pixel
  readback gate. Next verify graphics loss/pending-close, clip-depth/non-unit-w
  semantics and X11 presentation of those returned pixels; then measure actual
  Mesa/Zink requirements against supported driver capabilities. This is still
  separate from Firefox EGL/GL and compositor integration. Do not substitute
  fixed-shader recognition or enabled preferences for those implementations.
  The earlier Dawn ABI gate remains compile-only; native Dawn, general system
  discovery, GL-through-Vulkan and Firefox acceleration remain unported.
- Keep native JIT and Vulkan capability claims gated on actual guest execution;
  portable baseline interpretation and host Wasm compilation are not guest JIT.

All continuation work must retain the current delegated workflow, fresh sessions
for new agents, scoped Git staging and sole serving-agent ownership. The serving
owner may continue its assigned test task across follow-up instructions.
Earlier work reused existing sessions after fresh-session creation hit the thread
limit. All graphics test services are now stopped and their owned links removed.
The same sole owner retains responsibility for any next runtime startup. Follow
the authoritative revalidation above, not the obsolete exec handles. Preserve
the user's pre-existing server and all retained build artifacts.
