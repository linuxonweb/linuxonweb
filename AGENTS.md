# Latest continuation — native C++ ABI correction and Run56, 2026-10-03

Run56-native-cxx is LIVE, owned by `/root/diagnose_native_firefox_startup`:
actual PID/PGID520663, unified65279, ordinary full build j1/7200 seconds,
AS64GiB/RSS48GiB/available-RAM floor2GiB/core0/oom1000,
task32GiB/reserve20GiB. Actual inherited AS/core/oom were verified. Status/log:
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/status/build-run56-native-cxx.json`
and `logs/build-run56-native-cxx.log`. Poll the owner and exact group/handle
before modifying build inputs or starting another build. Original automatic
Binaryen O2 remains selected; no archive member filtering or lock bypass.

Actual Run55 guest startup exits139 at exported `_start`, function7/0xf94d1.
The exact served module, disassembly and Data-section-bound linker map identify
RLBox's shared_timed_mutex static initializer. Cargo bundled legacy sysroot
libc++ constructor objects `(i32)->void` into libgkrust while native C++ objects
expect `(i32)->i32`. wasm-ld returned0 with signature mismatch warnings and
generated trap stubs later inlined into `_start`. Raw5/Rust freshness, native
Wasm counts and no-DWARF checks remain compilation facts, not C++ ABI coherence.

Scoped reviewed commit `aa0abf5ed6cc0cdbd8e18549642b8ac429f27a84` adds bounded
startup diagnostics and the narrow tracked cc-rs runtime-library override.
Real standalone guest shared_timed_mutex checks pass20/0; selecting legacy
libc++/libc++abi with the same native unwinder reproduces139 before main.
Both arms use actual host/browser/guest CPUs6 and cleanly reap owned groups.
The separate disabled-FIPS NSS fallback now accepts its declared native PRBool
argument and retains CKR_DEVICE_ERROR. Actual objects/caller controls prove
new `(i32)->i32`, original `()->i32`, error48 for0/1/-1, original trap, and
unchanged non-Wasm/enabled branches. Root reviewed both corrections before
Run56. Reject ALL function signature mismatch diagnostics during future
program-link acceptance; audit actual rebuilt Rust runtime member ownership
before any new Firefox guest startup.

Evidence in `/mnt/p6/project/build/nightly-baseline-guest-20261003`:
`native-cargo-cxx-runtime-review.json`, `native-nss-signature-review.json`,
`native-cxx-run56-launch-plan.json`, and
`run55-before-native-runtime-rebuild/manifest.json`. Independent copies of all
five raw executables and the original Rust archive retain exact Run55 hashes.
Repository cause packet: `docs/evidence/firefox-nightly-startup-trace-20261003.json`.
The simple guest Vulkan gate remains18.18x passed; actual Firefox GPU, baseline,
fresh broad JIT, TLS and release acceptance remain false. Public Sitesv10 stays
unchanged; JIT release first, GPU release later.

# Previous continuation — no-debug full build and raw validation passed, 2026-10-03

The user-required simple guest Vulkan hardware/software gate has passed through
the genuine public Vulkan loader -> guest ICD/hostcall -> browser-host Rust wgpu
path. The final resource-profile module completes render/readback at 38.657801
FPS on NVIDIA versus 2.126645 FPS on host SwiftShader: 18.17783877119736x.
Both arms bind identical guest/package/Rust assets, served runtime/requested
bytes, workload, runner and six CPUs; five warmup frames precede 30 measured
frames. This is completed offscreen rendering, not presentation FPS.

Actual Mesa 26.2.3 Zink EGL/GLES2 also passes its indexed uniform/texture/depth
primitive on hardware WebGPU, SwiftShader WebGPU and genuine wgpu WebGL.
Each arm checks all 98,304 RGBA components across six frames with zero failures
and tolerance two; disabling depth makes the second far black draw overwrite
the textured near draw. Real Rust draw/upload/readback counts and zero-resource
native/translator/browser/server cleanup are retained. Evidence and scope:
`docs/evidence/guest-zink-wgpu-resources-20261003.json`, scoped 17-file commit
`7c90a762485bac165383635b319011a5d6340502`. Firefox GPU tests are now permitted
by the benchmark gate, but current Nightly159 GPU APIs, compositor and release
remain untested/unaccepted. Current WebGPU ABI work is isolated preparation;
do not reuse old128 wire layouts or modify the live baseline/JIT build.
The historical 171-check review covered the earlier primitive only. A new
read-only review confirms the retained final evidence and exposed check-egl.mjs
admission gaps for missing requests/runnerSources and empty CPU check maps.
The scoped checker hardening now rejects those and inconsistent identity pins;
210 bounded regression checks and all three retained-arm CLI rechecks pass.
No browser was relaunched. Review packet:
`docs/evidence/guest-zink-wgpu-checker-hardening-20261003.json`.

Run53 was gracefully stopped for the user-authorized parallel object stage:
actual child exit -15, owner-reaped unified 59109 exit 143, exact PGID 98039
fully empty. Its retained evidence includes 109 fresh non-Cargo native objects
and the completed no-debug Rust archive: 204,433,482 bytes, 7098 native Wasm
members, zero members with `.debug_*` sections. Archive SHA256 is
`773e119a73dd8777f57a143f1620973257a53683b572e2a1f9d8217fac019efd`.
This is fresh compilation evidence; Run53 did not complete the full build.

Run54-objects completed: actual child exit 0, owner-reaped unified 4372 exit 0,
exact PGID 160603 empty, elapsed 4965.65 seconds. The terminal generated graph
and actual inspection prove 3012/3012 native Wasm objects, 318,599,161 bytes,
all fresh after autoconf and no `.debug_*` sections. The completed Rust archive
remains unchanged: 204,433,482 bytes, 7098 native members, zero debug members.
Saved proof: `status/build-run54-objects-terminal.json`,
`status/full-graph-estimate-run54-objects.json`,
`status/no-debug-object-review-run54.json`; read-only audit unified 71918 reaped 0.
The object-only admission was 577 goals/589-node closure with no program links;
focused admission/guard checks passed 24/0. This does not accept a full build.

Run55 ordinary full j1 build succeeded in 1672.262 seconds, actual child exit 0,
owner-reaped unified 72115 exit 0, exact PGID 300325 fully empty. Object mode was
unset; the original automatic Binaryen-O2 and serial final links were retained.
Guards were AS64 GiB/RSS48 GiB/RAM-floor2 GiB/core 0/oom 1000/7200 seconds,
32 GiB task cap and 20 GiB reserve. The final raw Firefox is 175,262,059 bytes
(167.142924 MiB), SHA256
`973b387bc6784538fcca077c191aacb72fb7e58caea07962ed8423835ff87a64`, at
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/dist/bin/firefox`.
The no-debug preoptimizer main was 280,454,744 bytes. These are distinct from
Run52's debug-bearing 2,335,263,664-byte main and separately stripped
176,370,407-byte copy; no cross-build payload identity is claimed.

All five final raw executables are native Wasm, fresh after configure and have
zero `.debug_*` sections. Actual WABT `wasm-validate --enable-all` passes all
five under inherited 16 GiB AS/core 0/oom 1000, with input hashes unchanged, each
child reaped 0 and exact group empty. Validator wrapper unified 30035 reaped 0.
Terminal native audit again passes 3012/3012 fresh no-DWARF objects, with the
7098-member no-debug Rust archive unchanged. The main optimizer's observed
peak AS was 7.70 GiB; the whole phase later reached 26.67 GiB during resource
generation, exact process identity not retained. j1 does not constrain
Binaryen internal threads (observed plugin 9 threads, 8 affinity CPUs,
BINARYEN_CORES absent). Recovery-task proofs: `status/build-run55-final-binaries.json`,
`status/build-run55-final-raw-validation.json`, `status/no-debug-object-review-run55.json`.
Repository packet: `tools/nightly-musl/evidence/no-debug-full-build-run55.json`.

Mandatory diary.md followup is complete: actual raw size/path/SHA and concrete
debug-configuration, section-inspection, optimizer and freshness lessons.
Packaging owner `/root/package_no_debug_nightly_runtime` has the frozen-input
handoff for separate fpcast transformation/package. Raw binaries are not yet
the transformed packaged runtime. Complete baseline package/guest gates and
the fresh independent whole broad JIT build/acceptance before the JIT release.
NSS outer-runner preparation is scoped six-file commit
`42bd883edc23acc0609154fc6e1b62199ccaf22e`: 93 synthetic/source checks, no real
guest execution, tlsAcceptance=false and releaseAcceptance=false. Fresh whole
broad-JIT transition preparation is in
`/mnt/p6/project/build/nightly-jit-transition-review-20261003/README.txt`:
129 unchanged finite pins and 12 current broad-source matches, no full JIT build.
No controlled optimizer-memory improvement, baseline/NSS/JIT/Firefox-GPU
acceptance or Sites release is established. Public Sites v10 stays
unchanged; retain the authorized JIT release first, GPU release later.
Run most commands through fresh subagents with minimal task context and the
same inherited model/reasoning effort; scoped commits remain authorized.
Older LIVE entries below are historical observations.

# Previous continuation — actual no-debug configuration and Run53 launch, 2026-10-03

The requested no-debug restart is running as Run53, owned by subagent
`/root/restart_no_debug_nightly`: exact PGID 98039, unified 59109, j1/7200 seconds,
64 GiB inherited AS, 48 GiB polled group RSS, 2 GiB available-RAM floor, core 0,
oom_score_adj 1000; task disk cap 32 GiB/free-space reserve 20 GiB unchanged.
Recheck exact group/status/log and ask the owner to reap or change its build.
Do not mutate active source/configuration/recipes or start a concurrent build.
Current work is natural Cargo recompilation; actual rustc uses opt-level=2 and
strip=debuginfo without debuginfo=2, with inherited guards directly observed.
No Run53 final link, optimizer completion or full-build success is established.

Run52 was frozen after fully empty group 26369: 4152 native boundary checks and
1533 Pixman checks pass, 3012 native objects/552 inttypes/763 Pixman consumers
coherent. That is the pre-configuration boundary, not proof of rebuilt no-debug
object coherence. Old 7101-member Rust evidence is historical while Cargo rebuilds.
Configure run5-no-debug failed exit 1 on an ELF DT_NEEDED detector's assumption.
The scoped Linux/wasm32-only guard preserves the original detector body and
other targets; a real 567177-byte native Wasm iostream link uses static libc++.
Configure run6-no-debug succeeds: owner-reaped unified 10766 exit 0, PGID 92100 empty.

Actual regenerated no-debug configuration passes 1556 checks: 1476 computed
C/C++ flag rows across 737 backend files omit debug flags, MOZ_DEBUG_SYMBOLS is
absent, and Rust default flags omit debuginfo=2. Four forced make/driver rows
verify firefox/plugin-container/xpcshell --strip-debug before the unchanged
automatic Binaryen-O2; gfxtest retains its previous linker scope. Native Wasm
ABI/EH, memory/table/8 MiB stack and browser wrap contracts remain selected.
Real small no-debug preparation passes 101 checks; independent review 121 and
ELF prerequisite 14 pass, with failed initial review predicates retained.
Evidence: tools/nightly-musl/evidence/no-debug-rebuild-launch-run53.json.
Generated flags and first compiler admission do not establish all-object
dependency coherence, finished browser artifacts or guest acceptance.

Metadata-removal size benefit is measured on Run52; optimizer code-work/RAM
improvement from the new configuration remains unmeasured. After the actual
no-debug rebuild succeeds, write the final Firefox binary size and absolute
path in repository diary.md, with important lessons and mistakes. This
mandatory followup remains pending; diary.md is currently absent. Inspect
section sizes and actual flags before repeating massive optimizers: the old
--disable-debug configuration omitted --disable-debug-symbols.
Next finish the no-debug build and natural object coherence, strip/transform/
validate main and all required helpers, package and pass baseline guest gates;
then a fresh whole broad JIT build and acceptance, authorized Sites release,
then GPU acceptance and the second authorized release. Public v10 unchanged;
no full-build/package/guest/JIT/GPU/Sites acceptance is implied.
Run most commands through fresh subagents with minimal task context, using the
same inherited model and reasoning effort; scoped commits remain authorized.
Older LIVE and pending-flag entries below are historical observations.

# Previous continuation — Run52 main size and static validation, 2026-10-03

Run52 main Firefox completed its unchanged original Binaryen-O2 operation.
The raw debug-bearing main is 2,335,263,664 bytes, SHA256
`d418d84a6e68ad569264a74721587aee1f7ceaa16a901d032a4990617034bf2f`.
A separate debug-stripped copy is 176,370,407 bytes, SHA256
`8c236b2d18a627f272ec9931cc84625dcb02dcf0abc8fa28a88d40e58db90a64`.
Stripping removes 2,158,893,257 bytes (92.4%), six debug sections; all 16 remaining
section payload hashes match and the original main remains unchanged.
The 2.335 GB debug file is not the final download artifact.

Actual separate stripped-main `wasm-validate --enable-all` passes exit 0 in
15.03 seconds under inherited 16 GiB AS/core 0; peak polled RSS 6.38 GiB and
minimum available RAM 11.50 GiB. Exact validator group 69632 empty after reaping.
Earlier raw validation under 8 GiB AS aborted with `std::bad_alloc`; this retained
allocation diagnostic does not prove an invalid module. Raw ABI inspection
finds 238253 functions,207620 elements and maximum 23 element parameters;
raw indirect targets are not yet uniformly 23i64->i64. This is static evidence,
not guest/browser/JIT acceptance.

Run52 is now terminal: user-requested SIGTERM for the no-debug rebuild,
actual child exit -15, owner-reaped unified43377 wrapper exit143. Exact PGID26369
is fully empty. Main/plugin original-O2 finished; xpcshell reached original-O2
optimizer75550 before interruption and build cleanup removed its unfinished
output. Completed main/plugin and native objects remain retained. Shutdown
record: `status/build-run52-no-debug-stop.json`. No full-build success or
full-build/package/guest/JIT/GPU/Sites acceptance is implied.

Retained public v10 runtime has a 157,967,665-byte Firefox 128.14.0 executable
inside the 88,910,833-byte gzip Firefox+Linux archive. Actual archive hash
matches the local manifest and retained v10 deployment record. Current Sites
v10/source commit `b9656d4705aa4f6a073fa1b7122acf53a728a7c1` is confirmed by
parent tool observation; the public manifest returns 403, no current public
artifact was downloaded. The 178,196,480-byte whole-Site source tar is a
separate artifact. Public v10 unchanged. Measured sources/reports/logs and
hash provenance are pinned in
`tools/nightly-musl/evidence/nightly-size-and-validation-run52.json`.

The latest user delegation supersedes historical inline/no-subagents notes:
run most commands through fresh subagents with minimal task context, keeping
the same inherited model and reasoning effort. The user authorizes scoped
commits on the current branch. For the requested no-debug restart, freeze retained artifacts after the
now-proven empty group, reconfigure without debug and
verify actual flags/dependency coherence, with scoped linker debug stripping
before original-O2. Actual flag verification is pending.
No optimizer-memory improvement is claimed from that unmeasured change.
Next complete the no-debug build, strip/transform/validate all required helpers and
main, package and pass actual baseline guest gates; then the fresh whole broad
JIT build and acceptance, authorized Sites release, then GPU acceptance/release.
After the actual no-debug rebuild, write its final Firefox binary size and
absolute path in repository `diary.md`, plus important lessons and mistakes.
This followup is mandatory and not yet completed. The old configuration used
`--disable-debug` without `--disable-debug-symbols`; section composition was
overlooked before repeated O2 retries. Inspect section sizes/actual flags before
repeating massive optimizers; metadata-removal size benefit is measured, while
optimizer code-work/RAM benefit remains unmeasured.
Older LIVE entries below are historical observations.

# Latest continuation — host reboot recovery, 2026-10-03

Run51 was interrupted by an external host reboot. Previous boot
1778b83986e6483a9183fcc2a02f4958, current boot
80b2f373-8b98-45ed-9288-55ea9465c1c2. Old exact PGID2368654 and
optimizer2370793 are absent; unified1600 is unavailable. Original stale
running status is preserved as status/build-run51-pre-reboot-status.json.
Recovered terminal status has null exit code, reaped=false, unknown actual
termination time; finished is explicitly the terminal observation time.
No optimizer crash cause is inferred from the reboot. Final Firefox was0bytes,
now quarantined as status/build-run51-incomplete-firefox after empty-group
proof. Retained artifacts pass4152 native checks and1533 Pixman checks;
3012 native objects/552 inttypes/763 Pixman remain coherent, Rust pinned.

Run52 started: owned PID/PGID26369, unified session43377, j1/7200seconds,
64GiB AS/48GiB polled RSS/2GiB available-RAM floor, unchanged originalO2.
Actual original-O2 optimizer27880 and inherited limits verified. Check the exact
group/handle and current logs before changes. Launch boot and
recovery context are recorded in status/build-run52-launch-context.json.
Host now has60GiB swap, approximately39GiB physical RAM. /tmp is confirmed
4GiB tmpfs after the actual reboot. No final browser/baseline/JIT/GPU or
Sites acceptance; public v10 unchanged. Goal active inline, no subagents.
Older LIVE entries below are historical observations.

# Latest continuation — optimizer RAM/swap bounds, 2026-10-03

Run49 terminal/reaped2 after about20minutes; exact PGID2297842 empty. Original
Binaryen-O2 optimizer aborted, with no final browser output. Last direct VM
observation was about47.9GiB under48GiB RLIMIT_AS. Allocation failure near the
limit is an inference, not a proven crash cause; no new kernel OOM kill or
retained Run49 backtrace. Retained artifacts pass4152 native boundary checks
and1533 Pixman checks (3012 native objects/552 inttypes/763 Pixman consumers).

User authorized more optimizer RAM and is adding swap. Run50 (64GiB AS/32GiB
RSS) was explicitly stopped early to apply the user's resident-memory change;
terminal/reaped143, exact PGID2360265 empty, same4152/1533 retained checks pass.
Run51 LIVE: owned PGID2368654, unified session1600, first optimizer2370793, j1/7200seconds,
64GiB inherited RLIMIT_AS,48GiB polled process-group RSS bound,2GiB available-RAM
floor. Host physical RAM is about39GiB, so the available-RAM floor constrains
physical use before48GiB can be resident. Current host swap80GiB. Additional swap supports virtual
allocation, not additional physical RAM. Original automatic-O2 retained;
no stripping/optimizer bypass or active Firefox source change. Supervisor
now records peak per-process virtual memory and disables giant core dumps
for full-build children. Full-build AS override24..64GiB/RSS24..48GiB;
defaults24GiB. Preflight4GiB available RAM and RAM+free swap>=AS+2GiB.
Real supervisor checks39/0, including actual24/48/64GiB inherited limits,
zero core limit, oversized mappings rejected, RAM/swap and virtual-usage
readers, override validation/scoping, and orphan cleanup. Source/evidence:
tools/nightly-musl/evidence/optimizer-virtual-memory-retry.json and
docs/firefox-nightly-final-optimization-20261003.md. Disk policy32GiB task/
20GiB reserve unchanged. Poll Run51 exact handle/group before further changes.
No Nightly baseline/browser/JIT/GPU/deploy acceptance; public v10 unchanged.
Goal active inline, no subagents. Next complete baseline/package/guest gates,
then fresh whole broad-PBL/JIT build and full acceptance, followed by GPU.
Older LIVE entries below are historical observations.

# Latest continuation — original optimizer retry with more swap, 2026-10-03

User explicitly requested retrying the original optimizer, then lowered the
available-RAM stop floor to2GiB and authorized higher resident memory. Host now
has59GiB swap. Run49 LIVE: j1,7200seconds, owned PGID2297842, unified34812;
first optimizer2300129. Actual original Binaryen -O2 command and inherited
48GiB RLIMIT_AS/oom_score_adj1000 verified. Resident group bound32GiB,
available-RAM stop floor2GiB. No stripping/optimizer change; defs.mk unchanged.
Full-build overrides NIGHTLY_ADDRESS_SPACE_GIB=24..48 and
NIGHTLY_RESIDENT_MEMORY_GIB=24..32; defaults24GiB each. Preflight requires4GiB
available RAM and available RAM+free swap >=address-space limit+2GiB.
Disk allowance32GiB/free-space reserve20GiB unchanged. Poll exact Run49
handle/group before changing active recipe/source or starting another build.

Run48 terminated/reaped143 at the former8GiB RAM floor, before its time bound.
Its parent exited while optimizer2240018 remained; exact owned group was
SIGKILLed and verified empty. Freeze/review passes4152 native boundary checks
(3012/3012 objects,552/552 inttypes, pinned7101-member Rust archive) and1533
Pixman checks(763/763 consumers). No completed browser output. Supervisor now
waits for all live group members and escalates remaining descendants, even
after the parent exits. Real fast-parent/SIGTERM-ignoring-child regression
and memory/config tests pass33checks; source/evidence in
docs/firefox-nightly-final-optimization-20261003.md and
tools/nightly-musl/evidence/original-optimizer-swap-retry.json.
No Nightly baseline/browser/JIT/GPU/deploy acceptance yet. Public v10 unchanged.
Goal active inline; no subagents. Next completed baseline/package/guest gates,
then separate fresh whole broad-PBL/JIT build. Older LIVE entries below are
historical observations, superseded by this entry.

# Previous continuation — serial Nightly optimization, 2026-10-03

Run47 j2 terminated/reaped143 at its 20-minute bound; PGID2173102 empty.
Actual host OOM killed optimizer2175585 and four Chrome processes before
termination. Unfinished browser outputs were removed by build cleanup. Retained
3012/3012 native objects,552/552 inttypes consumers and763/763 Pixman consumers
pass4153 boundary +1533 Pixman checks; native Rust archive remains pinned.
The user added swap (host now29GiB total) and explicitly requested retry.

Run48 is now LIVE: j1,7200-second bound, owned PGID2237710, unified72143;
first optimizer2240018. Poll exact handle/group before restarting or changing
active source/recipe. Supervisor now permits opt-in full-build timeout1200..7200
seconds and j1. Default timeout stays1200; new full-build memory bounds are24GiB
inherited RLIMIT_AS/group RSS,8GiB host available RAM floor,24GiB preflight,
inherited oom_score_adj1000. Actual child guards and18 config/memory checks pass.
Reported32GiB task cap/20GiB disk reserve unchanged. Details/evidence:
docs/firefox-nightly-final-optimization-20261003.md and
tools/nightly-musl/evidence/final-optimization-retry.json. Helper packaging
committed d07aab3:36 synthetic checks, additional verified transformed executables
required for plugin-container/xpcshell. Real Nightly build/browser/JIT/GPU/deploy
still unaccepted; public v10 unchanged. Next full baseline package/guest gates,
then separate fresh whole broad-PBL/JIT build. Goal active inline; no subagents.

# Latest continuation — /tmp relocation and limit, 2026-10-03

User requested cleanup of RAM-backed /tmp, relocation of build artifacts to
~/project/build, then a persistent 4 GiB tmpfs limit. Completed: 448 inactive
build/test artifacts, 12,026,494,976 allocated bytes (11.2 GiB), copied to
/mnt/p6/project/build/tmp-recovery-20261003/artifacts (~/project/build through
the existing /home/a/project symlink). Every source/copy file hash and metadata
matched before removal; source was rechecked for changes and active process
references. Old /tmp paths are symlinks to the retained disk copies. Active
services, sockets, mounts and recently changed unknown files were preserved.
Manifest, scripts, fstab backup and acceptance summary are in that task root.
All 448 links verified. /etc/fstab /tmp options now include size=4G; live remount
and systemd daemon-reload completed. statvfs verifies exactly 4,294,967,296 bytes,
about 2.0 GiB used, /tmp permissions 1777 root:root; generated tmp.mount has
size=4G. User server PIDs 1591443/1441390 still present. No reboot performed.

Run46 has now terminated/reaped143 at its 20-minute bound; PGID2104526 empty.
No linker errors, but the three large automatic Binaryen -O2 optimizations
did not finish; incomplete output binaries were removed by build cleanup.
Do not treat Run46 as a successful full build. Next reduce simultaneous giant
optimizations (e.g. the existing j2 option) while retaining bounded phases and
the existing 32 GiB task cap / 20 GiB disk reserve. Current Nightly source and
native objects remain on disk under the recovery task, outside /tmp. No
Nightly browser/JIT/GPU/deployment acceptance yet; public v10 unchanged.
Goal remains active, inline, JIT first then GPU. No subagents.

# Latest continuation — native runtime lifecycle, 2026-10-03

Actual real Linux/Wasm runtime regression passes20 TLS/lifecycle checks and
100 native Wasm exception checks, exacthost/browser/guestCPUs6. Four concurrent
workers exercise return/explicitpthread_exit, cleanup handlers before TLS,
LIFO/nested destructor registration, TLS before ordinary pthread keys, and
main TLS before process atexit. A real negative control removing only the
thread cleanup wrapper fails exactlyfour ordering checks while EH100/0 remains.
Both owned guest browsers/servers cleanly stopped, groups empty. New runtime
adapter implements __cxa_thread_atexit_impl and explicit unavailable native
backtrace/CFA/enclosing-function queries; real LLVM Wasm EH retained. Actual
archive object equals guest-tested object. Root7815 checks pass; evidence
native-runtime.json and docs/firefox-nightly-native-runtime-20261003.md.
Only3 browser link rows select runtime/archive --wrap=exit and
--wrap=__pthread_tsd_run_dtors; gfxtest unchanged. No upstream runtime edits.
Run45 terminal/reaped143/group2099814empty: measured28.99GBtransient output,
stopped at22GiBtaskcap (old stop string misleadingly said20GiB). Reported
cap increases20->22->32GiB before applying;20GiBreserve retained. Runner now
reports authorizedTaskLimit accurately. Run46 j4/20min live PGID2104526,
unified53567, three binaries in compiler-wrapper Binaryen -O2 processing;
poll/reap before edits to active source/recipe. No Nightly browser/JIT/GPU
or deployment acceptance. Public v10 unchanged; goal remains active inline.

# Latest continuation — native XPTCall, 2026-10-03

Run44 terminal/reaped2, exact owned PGID2047580 empty. Real native scoped
XPTCall build passes; full graph3012/3012 (one new current-source object),
Rust archive unchanged,763/763 Pixman consumers coherent. New XPTCall adapter
uses the mandatory23-i64 fpcast ABI plus current metadata, replacing the old
signature whitelist. Only3 small upstream hook files changed; all logic is a
new adapter. Actual compiled Nightly xptcall.o/backend execute14 real Wasm
cases, raw negative traps, all511 transformed indirect targets uniform.
Current7853 generated method records fit (maximum14 args including hidden).
Root3879 checks pass; see docs/firefox-nightly-xptcall-20261003.md and
native-xptcall.json. Unit execution uses an isolated metadata catalog; no
actual guest browser acceptance. Run44 resolves XPTCall errors; exact next
missing symbols: __cxa_thread_atexit_impl, _Unwind_GetCFA,
_Unwind_FindEnclosingFunction, _Unwind_Backtrace. Complete real thread-local
destructor lifecycle and honest native VM backtrace policy, retaining working
Wasm exceptions. No live owned process, no Nightly JIT/GPU/deploy. Public v10
unchanged. No subagents; goal remains active, JIT first then GPU.

# Latest continuation — 2026-10-03

Run42 and Run43 are terminal/reaped2; owned PGIDs2006321/2013510 empty.
Run42 confirms Expat collisions resolved, then fails on shm_open/shm_unlink
owned by both musl and the mapping adapter. Run43 resolves those through a
fresh mapping archive with only those two definitions renamed to __wrap_*,
and browser-only linker wrapping. Original mapping source/archive retained;
gfxtest keeps the original archive. Root native compile/validator review8
checks and four forced actual program-link rows pass. Run43 full boundary4148
and Pixman1533 checks pass,3011 native objects and763 coherent header consumers.
Current blocker is the absent native Wasm XPTCall backend (Stub3 and following).
No live owned build, no Nightly browser/JIT/GPU/deployment acceptance. Public
v10 unchanged. Next: real current-metadata inbound/outbound XPTCall marshalling,
fresh native build, then browser startup/JIT acceptance.

# Current continuation — 2026-10-02

Run41 is terminal/reaped2, exact PGID1962945 empty. It rebuilt156 objects,
3011/3011 native graph objects remain present,4148 boundary checks pass,
and all763 Pixman header consumers are now coherent (1533 independent checks).
All three final browser links fail on bundled/static Expat duplicates;66
error records are link diagnostics. The scoped Expat preinclude adds58 private
aliases without changing upstream parser sources/public headers. Actual3-unit
compile and validators pass; root143 checks prove zero Expat collisions and
all28 Mozilla wrappers unchanged. The initial review incorrectly expected30;
the source-declared exact list has28, none missing. See native-expat-static.json
and docs/firefox-nightly-expat-static-20261003.md. Full retry Run42 is j4/20min,
owned PGID2006321/unified56056; poll/reap before edits or another build. No
Nightly/browser/JIT/GPU acceptance or deployment yet; public v10 unchanged.

2026-10-03 broad safety preparation: generator/checker now have a separate
broad mode for the selected full Nightly JIT, retaining unchanged integer
case bodies and fallback claims. Broad requires14 compiled,7 bailout,2
fallback and2 policy cases in each actual main/Worker context. Preparation
passes integer304/broad400 semantic checks and integer58/broad121 synthetic
checker regressions; independent review307 checks includes96 generated JS
syntax checks and exact source/result/claim/hash bindings. Evidence is
tools/nightly-musl/evidence/broad-safety-preparation.json. These are not guest
or browser acceptance. Full build plan now requires broad raw-log evidence,
without contradictory integer exclusions. Active baseline build Run41 is
j4/20min, owned PGID1962945/unified12590; poll/reap before source edits or
another build. No Nightly deployment; public v10 unchanged.

Run40 is terminal/reaped143 at the20min bound; exact PGID1923539 empty.
All3011 native objects present,175 objects rebuilt during phase,0 compiler
errors,4149 frozen boundary predicates pass; Rust archive unchanged.
Actual Pixman shared-header dependency set has763 consumers:607 coherent,
156 still pending. Independent1533 header checks pass while explicitly
retaining the incomplete state. Evidence full-build-boundary-coherence-run40.json.
Do not claim all objects' existence implies all shared-header rebuilds complete.
Continue the full build with a fresh bounded phase; public v10 unchanged.

2026-10-03 native final-link contract: forced actual make/driver rows now
resolve imported shared memory/max4GiB, exported growable table, exported
stack pointer and8MiB stack for firefox/plugin-container/xpcshell only.
The8MiB value matches the actual native Rust target. Forced gfxtest row keeps
only its previous driver defaults. No1417 inspected generated inputs changed.
Separate real helper link/validate passes;823 elements/segment/signatures
unchanged, exported table826/no max, actual stack initializer8388608.
Inspector stack-global prefix lookup corrected. Root1490 predicates pass;
see docs/firefox-nightly-native-program-contract-20261003.md and evidence
native-program-contract.json. Full Firefox link/guest/JIT acceptance pending.
Run39 terminal/reaped143/group empty after20min,189 phase object rebuilds,
3011/3011 present,0 compiler errors,4149 frozen boundary checks pass.
Continue full browser build; public v10 unchanged.
The separate real helper's exact23-slot fpcast transform and validation pass;
all823 entries use23i64->i64, memory/table/stack/exports preserved. Root review
uses actual logs/module/dump hashes; evidence/native-program-fpcast.json.
This is helper preparation only. Build Run40 starts j4, bounded20min, owned
PGID1923539/unified88441; poll/reap before source edits or another build.

2026-10-03: the user resumes the active goal, JIT first, then GPU. Work remains
inline under the latest user-provided no-subagent instruction. Nightly JIT
ABI inspection now has tools/nightly-jit-prep/inspect-wasm.py, measured on
actual native pingsender/gfxtest and a broad emitted loop. The actual helper
fpcast+validator pass; all592 indirect entries use23i64->i64, and requiring
that contract on the raw helper fails. Root89 input/semantic predicates pass.
No browser ABI or guest acceptance is implied; apply to linked Firefox later.
See docs/firefox-nightly-wasm-abi-inspector-20261003.md.

Nightly JIT
preparation now has an explicit --coverage broad mode: source-derived239
opcodes, arguments/doubles/arrays/properties/globals/Math paths and current
Watchtower/PBL cursor hooks. Actual ASan/UBSan+Wasm emitter1969/0; integer
control972/0 and its generated overlay bytes equal selected run4. Actual native
PblJit diagnostic compile passes (663,344B) and whole-object wasm-validate
passes. Root83-check review is jit-broad-review-run1.json, SHA cbacfedddf50fdc4853c5f9ecf79076f06e6caef93ec8ed4bd3f1516d7f5ca95.
This is preparation against an isolated diagnostic PBL config, not a full PBL
browser or guest acceptance. Full build plan now selects broad preparation
from the eventual accepted source copy; no diagnostic/old128 object relink.
See docs/firefox-nightly-jit-broad-20261003.md. Public v10 unchanged.

Run36 terminal/reaped2, group empty, root4162 checks: PNG12 aliases,
SoundTouch Clear and single RLBox TLS owner, musl epoll ownership fixed.
Cairo preinclude was mistakenly attached to unused legacy CFLAGS variables.
Run37 corrects COMPUTED_CFLAGS/COMPUTED_CXXFLAGS: actual compiler command
includes the header,44 real objects rebuilt,939 Cairo collisions gone.
Run37 terminal/reaped2/group empty, root4148 checks; next errors Pixman and
XShm interposition. Run38 adds81 Pixman names through its normal exported
header and replaces ELF XShm interposition with a narrowly scoped --wrap for
firefox/plugin-container/xpcshell. Dry final Firefox command has the wrapper;
gfxtest does not. This shared header requires natural browser/Rust recompilation.
Run38 terminal/reaped143 (bounded20min), PGID1799592 empty. All3011 native
objects remain present,168 existing outputs rebuilt,0 compiler errors; root4161
boundary checks pass. Rust refresh changes522 member names but all7101 actual
member content hashes/sizes/magic remain identical with multiplicity. Scoped
pixman/cairo/mozgtk target-objects builds pass, handles reaped0/groups empty.
Root161 static namespace checks confirm PNG12/Cairo939/Pixman81 collisions
gone across15/44/31 objects and the SoundTouch/epoll/XShm/TLS link inputs.
See docs/firefox-nightly-static-names-20261003.md and native-static-names.json.
Continue natural shared-header rebuild before final link. No browser startup,
Nightly JIT, GPU or release acceptance yet; public v10 unchanged.

Run34 reaches all three final browser program links and exits2 because wasm-ld
rejects ELF --as-needed/--no-as-needed flags. It is terminal/reaped, exact group
empty. Root checks4,152 boundary predicates, all3,012 native objects and552
natural inttypes consumers;215 existing outputs rebuilt during the segment.
The graph matches the independently reviewed static-inference delta. The native
root defs.mk adapter now filters only the two exact OS_LIBS tokens, retaining
all libraries and mapping adapter. Actual Firefox make dry link confirms this,
and every generated input/root.mk is unchanged. Actual link retry is pending.
See native-wasm-as-needed.json and full-build-boundary-coherence-run34.json.


The Nightly C++ runtime is rebuilt from unchanged installed LLVM22.1.8 source
with Wasm exceptions and the same WebAssembly C++ ABI as Firefox. The previous
sysroot C++ libraries used the generic ABI: real guest integer throws worked,
but runtime_error construction trapped with a constructor signature mismatch.
The full rebuilt libc++/libc++abi/libunwind fixes it; configuration remains
byte-identical to the installed libc++ ABI1 config. Two actual guest runs pass
100/0 typed catches, rethrow and destructor cleanup; the final run binds all
three archive hashes and has host/browser/requested/kernel CPUs6 throughout.
The actual pingsender/gfxtest link and validate as native Wasm. Root independently
checks597 predicates across168 compile units and99 native archive members.
See docs/firefox-nightly-cxx-runtime-20261003.md and native-cxx-runtime.json.
The replay configure recipe is preparation, not an executed clean rebuild.
Full browser linking, startup, fatal behavior, JIT and deployment remain pending.



Run33 is terminal/reaped (exit2, exact group empty), with all3,012 native
object paths present. The actual certutil links and validates as native Wasm
after the mapping adapter; the Firefox executable remains unlinked. Run33
fails on mozinference ELF shared-library flags and missing
_Unwind_RaiseException in pingsender/gfxtest. Its frozen root review has4,149
checks; evidence is full-build-boundary-coherence-run33.json.

The mozinference native graph now uses a static library, retained by xul.
A narrowly gated runtime adapter registers54 real typed llama/ggml/parakeet
functions with PR_LoadStaticLibrary, preserving normal NSPR lookup/unload and
all existing initialization/log/error behavior. Other platforms retain the
dynamic path. Actual backend regeneration passes in inference-run1; the first
direct-object target was a no-op and is NOT compilation evidence. The normal
target-objects run llama-linker-run2 recompiles the actual unified component,
passes, and emits all54 direct symbol references. Root checks3,031 predicates,
the exact six changed generated compile inputs and211 actual inference
implementation object references in the browser graph. Source originals and
original object/dependency are preserved. See docs/firefox-nightly-static-
inference-20261003.md and tools/nightly-musl/evidence/native-static-inference.json.
No guest inference/JIT/browser acceptance or deployment is established.


The user explicitly authorizes two ChatGPT Sites releases: deploy after latest
Nightly JIT works and passes guest acceptance, then deploy again after GPU
support works and passes guest acceptance. Do not ask for the same approval
again; preserve public v10 until a concrete validated successor is ready.
Read-only Sites inspection confirms the same public project at version10.
The concrete two-release sequence and acceptance/rollback requirements are in
docs/firefox-nightly-sites-release-plan-20261002.md; no new deployment occurred.

The Nightly Sites verifier preparation binds the corrected local default-page
path, page privacy-reduced BuildID versus exact privileged identity, all eight
original benchmark cases and launch/readiness bounds, and current-ABI compute
evidence if enabled in the later GPU release. Root independently reruns133
synthetic predicates and checks four frozen-source/report/storage predicates
in sites-verifier-preparation-review-run1.json under the root-review task.
Every preparation report retains releaseAcceptance=false. Actual private and
public guest QA integration, accepted packages and deployment remain pending.

Run16's generated-make progress snapshot records707 existing native Wasm object
paths of3,012 expected, with retained input/object pins. Root independently
checks twelve snapshot/hash/count/object/status predicates in full-graph-review-
run1.json under the root-review task. This is a filesystem progress estimate,
not browser acceptance or an ETA. Run17 ends with exit2 on the upstream
Wasm-only exclusion of DuplicateFileHandle; its exact group is empty before
any native Linux/musl adapter is applied. The20GiB cap and four-job limit remain.

The narrow DuplicateFileHandle guard now enables the unchanged POSIX helper
for native Linux/Wasm outside WASI. Actual MFBT and the formerly failing
WebSerial single-source compilation pass; native ABI/preprocessor checks and
eight real host POSIX diagnostic cases pass. Root independently checks74
frozen pins, exact source diffs, native objects/commands and empty-group proofs
in duplicate-fd-review-run1.json under the root-review task. The seven-file
recipe/probe/evidence packet is saved in tools/nightly-musl. These results do
not establish guest descriptor behavior or browser/JIT acceptance. Run18
continues within unchanged bounds. Its header-triggered Rust rebuild refreshes
libgkrust.a; Run15 archive evidence remains historical, not proof of equality
with the current mutable build output.

Run18 reaches its twenty-minute bound without compiler errors; the exact group
is empty before inspection. Its frozen graph has747 existing native objects
of3,012 expected and the refreshed Rust archive has7,101 native members.
Root independently checks19 frozen boundary/input/storage predicates in
full-boundary-run18-review-run1.json under the root-review task. The provisional
archive hardlink shares Cargo's mutable inode and has no immutable claim.
Run19 resumes with unchanged j4/time/storage bounds. Browser linking, Nightly
startup and JIT acceptance remain pending.

The native guest JIT primitive and fpcast harnesses now use dynamic owned
HTTP/CDP endpoints and actual browser CPU affinity matching fresh nproc. The
runner's own affinity is unchanged. Controlled observations reproduce cgroup
migration with nproc8->6 while affinity stays8; both original failed admissions
are retained. Actual native tests pass62/0 and24/0 with host/browser/requested/
kernel CPU counts all6 at every saved phase. Root checks24 retained live-result,
source, CPU and ownership predicates; see docs/guest-jit-host-cpus-20261003.md
and tools/nightly-musl/evidence/guest-jit-runtime-host-cpus.json. All endpoints
close normally and owned groups are empty. This is runtime-primitive acceptance
only; the historical23-i64 fixture does not determine Nightly's ABI. Other
full-browser runners still need equivalent actual-affinity setup before use.
Nightly full-build/JIT/TLS/performance gates and both authorized Sites releases
remain pending; public v10 is unchanged.

Run19 reaches its twenty-minute bound without compiler errors; root checks21
terminal/status/input/storage predicates in full-boundary-run19-review-run1.json.
Its graph remains747/3012 with identical object bytes. Read-only Run20 diagnosis
shows retained shared-header recompilation:147 Run18 objects,134 Run19 objects
and64 live Run20 objects at the frozen observation. The corrected
UniquePtrExtensions.h and generated identity headers keep fixed mtimes. Four
observed compiler PIDs disappear after producing fresh native outputs; their
individual exit codes were not captured. Of349 existing objects referencing
the corrected header,346 are fresh at this snapshot. These counts describe
retained last writes, not new graph paths. Root's39-check frozen review corrects
one relative dependency-path audit error; the failed first review is preserved.
A later independent26-check review verifies23 genuine new native object paths
absent at Run19. Evidence is tools/nightly-musl/evidence/full-build-rebuild-
diagnosis-run20.json. Run20 continues under unchanged bounds; inspect actual
status before continuing. No linked Nightly/browser/JIT acceptance or deployment
is established. Public v10 remains unchanged.

Run20 terminal graph advances to979/3012 native objects:232 new paths and64
previously existing outputs rebuilt during the segment,296 retained writes in
total. All428 recorded shared-header dependencies are fresh. Its unchanged Rust
archive remains1,398,801,246 bytes/all7,101 native members. The segment ends at
1200.30s without compiler errors; exact PGID1204136 is empty and unified handle
88883 reaped143. Root independently checks1,013 terminal/input/count/native-
file/timestamp/header/archive predicates in full-boundary-run20-review-run1.json;
the frozen packet is tools/nightly-musl/evidence/full-build-boundary-run20.json.
The owned boundary freezer enriches the unchanged repository inspector's output
with mtimes/inodes only after terminal/group-empty proof; that script is pinned.
Run21 starts unchanged: PID/PGID1243720, unified handle35465, status/build-run21.json
and logs/build-run21.log under the recovery task. It reuses the completed DOM
sweep and resumes graphics compilation. Recheck current handles before work;
linking, Nightly guest/JIT acceptance and both Sites releases remain pending.

Run21 stops with exit2 on libevent's ILP32 assumption: native musl time_t and
off_t are64-bit, while its Linux config reports32-bit. The terminal graph has
1,068/3,012 native objects. After exact group-empty proof, a shared mozbuild
selector and new native-Wasm config adapter retain the original Linux config
and require musl's actual time64 marker. Both Chromium IPC and bundled libevent
recompile successfully: ipc-run1 exits0 in43.50s with eight fresh native objects
and both sides depending on the adapter. Root independently compiles four C/C++
ABI units, reproduces the original failure, and checks77 frozen/source/object/
dependency/ownership predicates. Evidence is tools/nightly-musl/evidence/native-
libevent-time64.json. The repository phase driver retains its documented fixed
task root and adds only the bounded IPC command; its as-received freeze is
historical. No full browser or guest acceptance is established.

Run22 then stops with exit2 at js/src/builtin/Profilers.cpp:490 because the
optional external Linux perf launcher uses unavailable fork. PID/PGID1281065
is absent; unified handle4419 belongs to the existing build owner, who must
retain its reaped result before source mutation. Status/build-run22.json and
logs/build-run22.log are under the recovery task. Preserve the no-env successful
noop and ordinary non-Wasm perf behavior; requested external perf on native
Wasm should fail honestly before unlinking output. The existing sole build
owner handles this next packet. Revalidate its actual current status before
continuation. Nightly linking/JIT/GPU/TLS and both Sites releases remain pending.

The optional perf adapter now preserves no-env/empty success and returns false
with an explicit diagnostic for requested native-Wasm external perf before any
output deletion. The ordinary Linux fork body and Gecko profiler are unchanged.
Actual Profilers unified compilation passes; its first component run fails on a
separate pointer-format mismatch in TestingFunctions. Native musl uses long for
intptr_t but its inttypes header selects int formats for32-bit pointers. The new
recipe/shim/inttypes.h imports the unchanged sysroot header and overrides only
native Linux/Wasm __PRIPTR, correcting all six PRI and five SCN macros. Actual
js-builtin-run2 exits0 in21.71s. Both component groups are empty/reaped; nine
host branch diagnostics preserve output bytes, and paired native C/C++ format
checks pass with original failures retained. Root's66-check actual review and
independent native11-format compilation are pinned in tools/nightly-musl/
evidence/native-perf-inttypes.json. Two earlier root diagnostics are retained
and corrected: missing explicit format attributes, then an inherited shim
include in the original arm. Selected independent evidence is inttypes-abi-run3.

Read-only dependency inventory finds553 existing native consumers,552 without
the new shim. After empty-group proof, the owner preserves all original .pp
bytes (221,313,448 bytes) and appends only each exact object's shim prerequisite.
No outputs are removed or timestamps falsified; host/Rust state is untouched.
Root reviews all552 original-byte/target/append hashes and frozen pins in
inttypes-prerequisite-refresh-review-run1.json. This is dependency refresh only:
all552 actual regenerated outputs and naturally rewritten dependencies must be
verified before declaring a coherent build. Run23 resumes with unchanged bounds:
PID/PGID1309945, unified72244, status/build-run23.json and logs/build-run23.log.
Current state must be revalidated; public v10 and both release gates are pending.

Run23 reaches its twenty-minute bound without compiler errors. Its exact group
is empty and unified72244 is reaped143. The graph has1,113/3,012 native objects:
the two additional paths came from prephase component builds, while155 existing
outputs were rebuilt during Run23. Exactly155/552 affected inttypes consumers
have fresh native objects and naturally regenerated shim dependencies; the397
remaining consumers retain their exact appended prerequisites. All original
dependency backups remain intact. The Rust archive remains460be7c1/all7,101
native members. Root checks2,647 retained boundary/pin/object/dependency/archive
predicates in full-boundary-run23-review-run1.json under the root-review task.
Evidence is tools/nightly-musl/evidence/full-build-boundary-coherence-run23.json.
The checker snapshot requires an owned task recipe directory and terminal empty
group; it must not be invoked directly from the repository. Full coherence,
Nightly linking, guest JIT and both authorized releases remain pending. Recheck
actual status before continuation; the next full segment keeps all existing
job/time/storage bounds and preserves source, outputs and caches.

Run24 also reaches its twenty-minute bound without compiler errors. Exact
PGID1351481 is empty and unified88087 is reaped143. It rebuilds143 existing
objects, with zero new graph paths; the retained graph remains1,113/3,012.
Strict inttypes coherence advances to298/552, leaving254 exact prerequisites
pending with their original dependency backups intact. The native Rust archive
is unchanged. Root's saved read-only reviewer checks2,505 actual terminal/pin/
native-object/dependency/graph/archive predicates in full-boundary-run24-review-
run1.json, including its own script pin. The scoped packet is tools/nightly-musl/
evidence/full-build-boundary-coherence-run24.json. This confirms required header
recompilation, not full graph or guest acceptance. Continue under unchanged
bounds after inspecting actual current status; no source/cache changes are
required. Nightly linking, JIT/GPU acceptance and both Sites releases remain
pending, with public v10 unchanged.

Run25 ends at its twenty-minute bound with no compiler errors. Exact
PGID1390618 is empty; unified62896 is reaped143 and boundary/coherence
handles89961/46837 are reaped0. It rebuilds174 existing native objects,
advancing strict inttypes coherence to472/552 with80 prerequisites pending.
There are no new graph paths; the graph stays1,113/3,012 and the Rust archive
is unchanged. Root's saved reviewer passes2,331 actual terminal/pin/object/
dependency/archive predicates in full-boundary-run25-review-run1.json.
Evidence is tools/nightly-musl/evidence/full-build-boundary-coherence-run25.json.
All original dependency backups and unfinished prerequisites remain intact.
Compilation advances through graphics, hal and image sources. Continue the
full build unchanged after actual status inspection; full coherence, linking,
guest JIT/GPU acceptance and both authorized Sites releases remain pending.

Run26 stops with exit2 after654.46s on one compiler error: the earlier Wasm
include guard in mfbt/TaggedAnonymousMemory.h hides mmap from native Linux/musl.
Exact PGID1433631 is empty; unified61023 is reaped2 and boundary/coherence
handles7607/84079 are reaped0. The graph advances to1,195/3,012 native objects,
with82 new paths and79 rebuilt outputs during the phase. Strict inttypes
coherence reaches551/552; the remaining consumer is mfbt/Unified_cpp_mfbt0.o.
The Rust archive and original dependency backups remain unchanged. Root's
full-boundary-run26-review-run1.json independently passes2,333 actual predicates
and records the single compiler error. Full linking, guest JIT/GPU acceptance
and both Sites releases remain pending; public v10 is unchanged.

The narrow TaggedAnonymousMemory include correction now retains sys/mman.h
for native Linux/Wasm while preserving the prior WASI and non-Linux guards.
Native C/C++ checks reproduce the original missing declaration and verify the
fixed mmap signature,64-bit off_t and32-bit pointers. Actual js-vm-run1 passes
in86.06s; its unified handle4409 is reaped0 and PGID1462133 is empty. A subsequent
audit corrects the earlier inference about the remaining consumer: it is MFBT,
not the failed VM unit. Existing mfbt-run7 passes in5.59s with handle45044
reaped0 and PGID1471296 empty. All552 original consumers now have fresh native
objects and natural shim dependencies, with original backups retained. Root's
native-tagged-mmap-review-run3.json passes1,696 actual source/ABI/component/
dependency predicates; two earlier review failures remain retained, including
the exported-header alias correction. This closes prerequisite coherence only;
the full3012-object graph, linking and Nightly guest/JIT acceptance remain open.

Run27 stops with exit2 after831.10s at Abseil's raw mapping helper: the
unrecognized native Linux/Wasm target enters its64-bit branch, failing the
unsigned-long width assertion and references to SYS_mmap/SYS_munmap. Exact
PGID1481836 is empty and unified90369 is reaped2. The terminal graph advances
to2,204/3,012 native objects, with1,009 new paths since Run26:991 compiled during
Run27 and18 by prephase components. Two existing objects were rebuilt, one
during Run27 and one by the prephase MFBT component. All552 original
inttypes consumers are coherent and the Rust archive is unchanged. Root's
full-boundary-run27-review-run1.json passes3,341 actual predicates and records
the three errors from this one helper. The narrow next fix selects Abseil's
existing libc mapping fallback for native Linux/Wasm outside WASI, preserving
other target paths and musl's64-bit offset ABI. Full linking, guest JIT/GPU
acceptance and both Sites deployments remain pending.

Abseil's one-line native Linux/Wasm guard now selects its existing libc
mapping fallback, preserving musl off_t64 and every runtime body. Paired native
C++ checks retain all three original errors and accept the exact forwarding
signature. Actual abseil-run1 compiles the formerly failing unity object in3.59s;
unified34843 is reaped0 and PGID1524033 is empty. Root independently verifies115
source/pin/ABI/component/ownership predicates in native-abseil-mmap-review-run1.json.
The six scoped files and review are retained in tools/nightly-musl. Undefined
mmap/munmap remain honest final-link prerequisites; no mapping runtime, linked
Nightly, guest JIT or release acceptance is claimed. Resume the full build under
unchanged j4/twenty-minute/20GiB task and reserve bounds after this packet commits.

Run28 reaches2,222/3,012 native objects before Abseil's signal-context PC
selector rejects Wasm (one error,11.67s). Root's terminal review checks3,359
predicates; all552 consumers and Rust remain coherent. Unified53017 is reaped2,
PGID1537551 empty. The next one-line guard selects Abseil's documented nullptr
fallback for unknown native Linux/Wasm PCs, preserving other architectures and
all runtime bodies. Paired real source compilation retains the original error;
five pointer cases execute the extracted native-Wasm fallback without imports.
Actual abseil-stack-run1 passes in3.60s (unified21552 reaped0, PGID1544064 empty).
The25-check review pins its fresh27,768-byte unity object and exact relative
source dependency. The first review's absolute-path spelling mistake is retained
and corrected by resolving against the actual component directory. Packet:
tools/nightly-musl/evidence/native-abseil-stack.json and full-build-boundary-
coherence-run28.json. This is diagnostic/component acceptance, not guest signal,
linked browser or JIT acceptance. Continue full build unchanged after commit.

Run29 reaches2,396/3,012 native objects, adding173 during the phase plus
one prephase Abseil object. It exits2 after314.59s on three optional fenv macros
in nsUserCharacteristics.cpp. Unified26978 is reaped2, PGID1549619 empty;
root's3,533-check terminal review retains coherent552 consumers and unchanged
Rust. The telemetry correction adds only guards around FE_DOWNWARD, FE_UPWARD
and FE_TOWARDZERO cases, using the actual platform macros without inventing
rounding modes or changing floating-point behavior. Native original/fixed
switch checks, six native-Wasm reporting cases and real host four-mode
rounding preservation pass. rfp-run1 compiles the formerly failing1,752,059-byte
object, then exits2 on a local generated-JS packaging prerequisite; its failure
is retained. The explicit native target-objects command rfp-run2 exits0,
validating the existing fresh object without claiming a second recompilation.
Unified67107/89611 are reaped2/0; both groups empty. Root checks36 source,
native/host, dependency, timestamp and terminal predicates. Evidence:
tools/nightly-musl/evidence/native-fenv.json and full-build-boundary-coherence-
run29.json. Complete root packaging must still generate RFPTargetConstants.sys.mjs;
no linked browser, guest FPU/JIT or release acceptance is established. Continue
the full build with unchanged limits after this packet commits.


Run30 reaches2,478/3,012 native objects, adding80 during the phase and two
prephase FPU telemetry objects. It exits2 after352.77s at llama.cpp's debugger
backtrace fork call. Unified11319 is reaped2 and PGID1573454 is empty;
root's3,615-check terminal review preserves coherent552 pointer-format
consumers and the unchanged Rust archive. The one-line native Linux/Wasm
selector uses llama.cpp's existing unsupported-backtrace fallback; inference,
formatted fatal messages, abort callback and abort remain unchanged. Paired
actual-source native compilation reproduces the original fork error and
passes after correction;100 native Wasm fallback calls pass without imports.
Actual llama-c-run1 builds the formerly failing609,477-byte browser object in
3.59s, unified86830 reaped0, PGID1600605 empty. Root checks27 source-diff,
command, native, symbol, natural dependency and terminal predicates. Evidence:
tools/nightly-musl/evidence/native-ggml-backtrace.json and full-build-boundary-
coherence-run30.json. A prelaunch driver-byte equality assumption failed only
because the owned driver retains its task-relative root; no phase or source
mutation occurred before that failure, and each driver's existing root is now
preserved. Continue full build unchanged. Browser linking, actual Nightly JIT,
GPU and both authorized Sites release gates remain pending.


Run31 reaches2,786/3,012 native objects, adding307 during the phase and one
prephase ggml object. It exits2 after311.18s on missing MAP_POPULATE, mlock
and munlock in llama-mmap.cpp; unified10559 is reaped2 and PGID1603975 empty.
Root's3,923-check terminal review preserves coherent552 consumers and the
unchanged Rust archive. Three local capability guards retain file mmap and
posix prefetch, omit the undefined optional populate hint and use the existing
unsupported locking fallback only for native Linux/Wasm. The genuine musl
archive has no mlock/munlock definitions; declarations would not fix linking.
Paired actual source compilation passes after retaining the original errors.
The linked native capability exports report mapping=true and locking=false.
Host Linux retains its mlock call and both original preprocessed locking
bodies. A mistaken requirement for an emitted unused munlock helper is
preserved in the failed host review and corrected; no source change followed
that diagnostic. Actual llama-mapping-run1 builds the fresh123,427-byte browser
unit in3.62s; unified61295 is reaped0 and PGID1621202 empty. Root checks33
source/command/native/dependency/symbol/terminal predicates. Evidence:
tools/nightly-musl/evidence/native-llama-mapping.json and full-build-boundary-
coherence-run31.json. Continue unchanged full build; complete mapping-adapter
linkage, Nightly startup/JIT, GPU and both authorized Sites releases remain
pending. Public v10 is unchanged.


Run32 completes all3,012 expected native object paths (2,171,228,922 bytes),
adding225 during the phase plus one prephase mapping object. This count is
not full browser completion. The segment exits2 after245.23s on certutil's
ELF-only -rpath-link flag; unified21619 is reaped2, PGID1626818 empty.
Root's4,149-check terminal review preserves coherent552 consumers and all7,101
native Rust members. A new root defs.mk adapter filters only that option from
LDFLAGS on Linux_wasm32, preserving all compile and generated backend inputs.
Its first selector used obsolete CPU_ARCH, failed the dry-run equality check
and is retained; the corrected actual TARGET_CPU selector passes. Actual
before/after certutil dry-run argv differs by exactly one removed token.
nss-certutil-run1 then reaches real symbol resolution and fails on duplicate
CERT_OidSeqTemplate and SECKEY_PQGParamsTemplate symbols; the failure is retained
rather than claimed successful. Unified5282 is reaped2 and PGID1643361 empty.
Root checks11 argv/input/terminal predicates, including all3,012 unchanged
native objects and unchanged generated make hashes. Evidence:
tools/nightly-musl/evidence/native-wasm-link-paths.json and full-build-boundary-
coherence-run32.json. Next scope the command's two duplicate template names;
do not allow all duplicate definitions. Full browser linking/packaging,
Nightly guest JIT/GPU and both authorized Sites releases remain pending.


The certutil command's two ASN.1 template collisions are corrected by native
Linux/Wasm-only aliases immediately before their original definitions.
Template data, command uses, library identities and other target names are
unchanged. Original source and target objects are preserved. Actual
nss-certutil-run2 recompiles both command objects and advances to undefined
mmap/munmap/mremap from SQLite; this is the previously recorded missing
mapping-adapter final linkage, not a successful certutil link. Unified57853
is reaped2, PGID1650969 empty. Root checks22 exact-source/native-symbol/fresh-
object/dependency/library-unchanged/terminal predicates in
tools/nightly-musl/evidence/native-certutil-templates.json. Next integrate the
preserved native mapping adapter as a static link input and verify actual
target links. Nightly browser, JIT, GPU and Sites acceptance remain pending.


The preserved mapping adapter is now compiled with the actual native musl
compiler, shared-thread atomics and SjLj lowering, archived as one object and
added once to target OS_LIBS in the Linux_wasm32 root make adapter. Its source
bytes are unchanged; compiler/generated-backend inputs are preserved.
Actual nss-certutil-run3 links and passes in9.90s. The17,996,713-byte native
certutil binary passes independent wasm-validate --enable-all; SHA
431377b2103fda03b3e6e26337d574ccbfa0f958dff28b7af5f5c6c2582c50c3.
Unified37106 is reaped0 and PGID1656351 empty. Root checks22 archive/native/
actual-argv/fresh-binary/validator/storage predicates; evidence:
tools/nightly-musl/evidence/native-mapping-link.json. The replay helper is
tools/nightly-musl/recipe/build-native-mapping.py and must create the archive
before installing adapters/defs.mk on a fresh tree. Full browser linking,
actual guest mapping/current NSS/JIT/GPU and both Sites releases still require
acceptance. Continue the full build unchanged.

Nightly baseline and ABBAAB runners now use a shared actual-browser-affinity
helper, with launch/readback/final allocation evidence and no API overrides.
ABBAAB also rejects changed actual assigned core IDs between arms. Baseline
CDP commands require fresh owned browser/page endpoints and live PID/profile;
cleanup proves the private group empty. Existing build-isolation preflight
remains. The shared helper passes34 pure checks; baseline43/benchmark118
regressions pass. A live owned Chromium smoke records exact six-core affinity,
rejects a deliberately wrong launch plan with actual failed evidence retained,
and exits0 with its group empty. Root checks23 source/result/ownership predicates
in nightly-browser-affinity-review-run2.json; frozen packet is
 tools/nightly-musl/evidence/nightly-browser-affinity-preparation.json.
This is preparation: no Nightly guest or new release acceptance is established.

Following tests must set Linux/Wasm CPUs to the dynamically observed host count
and record/assert the actual host and guest counts. This supersedes historical
hardcoded two-CPU test setup; preserve old results as historical evidence and
use the same CPU count for new comparative benchmarks.

The shared CPU helper and five diagnostic/baseline runners now reread nproc
before every boot, when capturing startup SMP, after each phase and at run end.
Allocation drift fails with retained evidence. Sixty-six CPU fixtures,43 baseline
fixtures,11 independent fresh-reader regressions,seven syntax checks and five
caller audits pass; root's15-check source/result and pure-regression review is
in /mnt/p6/build/firefox-nightly-musl-root-review-20261002/cpu-phase-review-run1.json.
These are harness checks, not new guest acceptance. Available-count observations
varied between six and eight without an established cause; do not hardcode a
count, assert a hardware change, or loosen checks without actual harness/browser
evidence. Older non-helper runners need equivalent phase checks before
invocation. The existing UI clamp remains; exact host counts above64 require a
deliberate UI limit change rather than claiming exact agreement after clamping.

Shared selection now refuses raw host/browser mismatches and hosts above64;
phase checks also refuse forged clamped evidence. Root reruns68 CPU fixtures,
43 baseline and118 benchmark preparation predicates after this correction.
No new browser or guest acceptance occurs. Preserve historical results and
the unresolved six/eight available-count observations.

Nightly benchmark migration now binds full native-musl baseline/PBL package,
compiled app/platform identity and retained configure/compiler/link evidence;
checks all144 original rows/checksums and every case/launch/readiness ratio;
rejects fatal logs, input drift and host/browser/kernel CPU changes across all
six ABBAAB arms. HTTP/CDP ports are dynamic, and a fresh owned Chromium port
file, live spawned PID/profile arguments and matching browser/page endpoints
are required before commands or cleanup. Root independently reruns118 host
fixtures and verifies six frozen source/result pins in benchmark-preparation-
review-run1.json under the root-review task. Actual console/endpoint smoke and
Nightly performance remain pending; no browser or guest was started here.

JIT safety follow-on adds positive source-specific handler/throw policy
rejection diagnostics without changing admission, plus a separate bounded
Cu.getJSTestingFunctions incremental-GC driver. It requires active GC before
and after the real fixture loop, a newly appended raw skip with matching
thread/TLS identity and cleanup to NotActive. Root's31-check source/freeze
review independently reruns304 semantics,58 synthetic contracts and15 mocked
driver checks (jit-safety-preparation-review-run2.json). Selected fixture-run2
and observer-run5 remain preparation only: no observer compilation, real GC,
full Nightly JIT acceptance or release is established by these results.

The privileged follow-on checker and bounded driver now require actual raw
observer byte windows, run/window/source/thread/TLS/epoch binding, whole/slice
and incremental GC, debugger/coverage skips and cleanup. Interrupt acceptance
requires generated-Wasm kind3 followed by actual InterruptCheck abort and a
same-window recovery. Root independently reruns203 synthetic checker and22
mocked driver checks and verifies eight source/API/output predicates in
privileged-preparation-review-run1.json. The unapplied observer-run6 adds the
actual callback result diagnostic without changing the error branch; its nine
source/output checks pass. Direct guest APIs, ordered stderr capture, observer
compilation and full JIT acceptance remain pending. Preserve public v10.

The PBL benchmark runner now applies the same host-count setup to each arm and
saves/asserts kernel SMP evidence before benchmark logs can evict startup logs.
It now uses the shared fresh reader at preboot/startup/final, retains CPU/helper
input evidence, rejects host changes between all six ABBAAB arms and records
the final live host count. Its syntax check passes; new Nightly benchmarks are
pending the full binary. CPU migration alone does not establish exact Nightly
build identity, fatal-path rejection or a no-regression performance verdict;
those acceptance predicates still need deliberate migration before invocation.
Homepage, DevTools, WebGPU W1 and WebGL F1a diagnostic runners now share
host-count selection and independently saved startup kernel evidence for every
cold/update/warm boot. Thirty-eight fixture checks and six syntax checks pass;
no new guest test was started during the full Nightly build. Their historical
version/GPU predicates still require Nightly migration. Other older runners,
including public/TLS promotion copies, must be adapted before invocation;
historical two-CPU results and pinned promotion verifiers remain unchanged.

The updated GPU/homepage and session-startup runners select the browser host
count, require agreement with nproc, and assert the actual kernel SMP count.
Fresh isolated eight-CPU Firefox128 homepage diagnostic passes all eight checks:
`/mnt/p6/build/guest-host-cpus-test-20261002/cold-run1/result.json`.
Host nproc, hardwareConcurrency, selected/requested guest CPUs and kernel CPUs
are all eight; the browser/server clean up normally. This proves the new CPU
setup and default-page launch, not Nightly or guest GPU acceptance. See
`docs/guest-host-cpus-test-20261002.md` for retained results and limits.

Latest acquired Nightly is 159.0a1, official build `20261002211853`, Hg
`dfc77f7a6d716f1a20a2576597638d4fc21cd916`, Git mirror
`bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23`. The 198-file overlay passes all
baseline/new blob checks and eight canonical Hg/Git source pairs. Whole-tree
Hg/Git mapping remains an inference. Evidence:
`/mnt/p6/build/firefox-nightly-musl-metadata-20261002/acquisition-proof.json`.
The owned musl source passes configure, export/pre-export, MFBT native Wasm
compilation, 33 C/Rust ABI checks and static graph generation. Full build-run1
fails in linux-raw-sys (missing Wasm/Linux general/net modules). Run2 removes
the unused raw guest dependency and reaches two narrow Rustix libc cfg errors.
Both are corrected: the musl STATX fallback requires linux_raw_dep, and wasm32
uses asm-generic ioctl constants after ten exact native C/Wasm UAPI checks.
Run3 compiles Rustix/tempfile successfully and continues the full browser build.
Do not alias x86 layouts or resume GNU compiler work. Owned corrected Rust
target drops two ignored feature names while preserving the full existing ABI;
the warnings disappeared after preserving and invalidating only owned target
dependency artifacts. Actual C++ commands retain SjLj and WebAssembly C++ ABI
flags. The frozen recipe is in tools/nightly-musl; independent 18-check review
passes at /mnt/p6/build/firefox-nightly-musl-root-review-20261002/recipe-review-run2.json.
No Nightly browser binary, guest JIT, GPU acceptance or deployment is yet
established. Inspect the actual process/status before continuing a build.

Run15 completes the actual combined Firefox Rust release library: libgkrust.a
is1,398,801,246 bytes, SHA5a8c3745927a5b4e07d50a2e7bee07e65100cce1228358107923c19583e60f8a.
Root independently hashes the archive and checks all7,101 native Wasm member
magics against the retained manifest; Stylo256, trust19 and wgpu_bindings105
members are present. Evidence is tools/nightly-musl/evidence/gkrust-actual-
compilation-run15.json and gkrust-review-run1.json in the root-review task.
Run15 reaches its20-minute bound during error-free C++ compilation; Run16
continues unchanged source incrementally under j4 and existing caps. Inspect
actual process/status before continuing. No browser link or guest acceptance
is established by the combined Rust archive.

Subsequent full-build runs pass Rustix, the padded time64 timestamp constructor
and cubeb's native C preflight, then expose target C++ flags leaking into a host
shader-optimizer build. The stable native Wasm/ILP32/ICU memory overlays and
Linux std-clock selection are frozen in tools/nightly-musl/patches; a fresh
MFBT rebuild passes. Configure run4-cargo-scoped-flags passes with an owned
Cargo environment adapter. Run7 captures four actual host GLSL compiler
commands without guest ABI flags and three guest browser Clang commands
retaining WebAssembly ABI/SjLj; the independent five-check capture review
passes at /mnt/p6/build/firefox-nightly-musl-root-review-20261002/cargo-flags-review-run1.json.
Guest Cargo C++ helper argv and full browser completion remain unverified.
Independent six-check snapshot/component review:
/mnt/p6/build/firefox-nightly-musl-root-review-20261002/native-overlays-review-run1.json.
These are bounded build results, not browser or guest acceptance.

Runs8/9 pass native musl opaque pthread serialization, explicit NSPR/IPC no-fork
error paths, Mio's Linux epoll backend and a task-owned filesystem header
visibility wrapper. Native C/Rust pointer/epoll probes and exact CoreDump source
preflight pass; these are host-instantiated Wasm/compile checks, not guest tests.
Run9 ends with incomplete PKCS#11 Rust bindings used by rsclientcerts. The NSS
audit finds Nightly's existing static Rust CKBI loader; do not transplant the
old128 LOWLAND profile-root hook. The old119-root seed has stale explicit trust
relative to current certdata, so its preservation alone cannot establish Nightly
TLS acceptance. Fresh-profile initialization and existing user-trust preservation
remain under audit. No complete Nightly binary or deployment yet.

Run10 compiles actual native target pkcs11_bindings and rsclientcerts archives
using the Cargo adapter's target-only bindgen default visibility. Corrected
isolated probes use the crate's complete current vendored header family and
match the actual bindings byte for byte. Seventy-two common ABI assertions,
three sentinels and ten family-specific initializer assertions pass across
Rust/vendored C/NSS C; NSS's extended initialization structure is explicitly
not identical to the standard one. Root's eleven-check retained-hash review
passes in nss-audit-review-run2.json; the earlier header-family mismatch and
failed review remain retained. Trust-anchor target compilation and guest TLS
acceptance remain pending. Run10 ends normally with exit2 after17m35s; remaining
blockers are wgpu-core selecting unavailable Vulkan on native Wasm and an
unsupported CallerPC return-address builtin. Check current process/status
before editing or restarting. Compiler-only fatal-path evidence shows abort
followed by unreachable; actual guest fatal-path acceptance is separate.

Run12 regenerates the corrected wgpu-core host build script and compiles the
48,173,072-byte native target archive with16 genuine Wasm objects. Root's twelve
retained source/checksum/cfg/object/header/ABI checks pass in
backend-caller-review-run1.json. CallerPC uses the documented null diagnostic
frame fallback on native Linux/Wasm and its exact filesystem consumer compiles.
The full browser remains incomplete: run12 exits2 after~207s at authenticator's
missing native HID ioctl selection. Derive constants from the genuine native
sysroot and preserve completed artifacts. This wgpu compile repair keeps the
baseline's unavailable GPU adapter honest; it does not implement a GPU backend.

Run13 passes the native HID adapter, then ends normally with exit2 after9m32s
at Stylo's blanket Wasm exclusion of real Unix thread handles. Three exact
native-Gecko cfg exceptions retain JoinHandleExt/RawPthread. Actual generated
Gecko/Servo C++ signature checks, paired C/C++/Rust layouts and seven bit
roundtrips pass: musl C uses an opaque pthread pointer, but musl C++ and Rust std
use matching32-bit integer handles. No libc ABI or thread-pool behavior changes.
The HID archive has16 compiled native Rust objects; paired sysroot ioctl/layout
probes pass eight checks. An isolated replay of the actual mozglue-static build
script captures its real cc-rs helper command and expanded Clang native C++ ABI
and SjLj flags, with a genuine wrappers.cpp object; this is not an original
Run13 process capture. Root's ten retained-hash/archive/ABI/replay checks pass in
hid-style-helper-review-run2.json; incorrect root review predicates remain FAIL
in run1. Scoped recipes/probes/patches/evidence are in tools/nightly-musl.
Run14 exits2 normally after~8m15s; its process group is empty before source
changes. Actual native Stylo and trust-anchor archives compile. The narrow
WebGPU interop adapter excludes unavailable Vulkan/dma-buf internals only on
wasm32/Linux/musl and preserves both original Linux C exports with explicit
invalid/fd=-1 results. Actual cbindgen output is byte-identical; C++ caller
fallbacks reject those results. A copied complete crate and the actual Run15
wgpu_bindings archive compile; C++ declarations link to native Rust/musl and
validate without synthetic Global execution. Root's127 retained-artifact,
actual-object/header/source checks pass in wgpu-bindings-interop-review-run1.json.
This repairs baseline compilation, not GPU support. Run15 starts with owned
PID/PGID994708, j4/20minute guard, and compiles the full Firefox Rust library;
C++ compilation continues. Inspect actual status/process before continuation.
Linked browser, actual module startup and guest TLS remain pending.

Full-runtime Nightly packaging preparation is in
tools/guest-rootfs/package-firefox-nightly.py and
docs/firefox-nightly-package-20261002.md. Twenty synthetic fixture checks and
an independent five-check encoded-record/defaults audit pass. The tool replaces
all opt/firefox resources together, preserves all outside records and requires
actual complete-build/fpcast evidence. Real preflight refuses the still-missing
Nightly binary; no real archive or runtime acceptance has been produced.
NSS seed freshness, default-page integration and host-count guest gates remain
pending. Evidence: /mnt/p6/build/firefox-nightly-package-20261002/fixture-run2
and /mnt/p6/build/firefox-nightly-musl-root-review-20261002/package-review-run1.json.

The preparatory fresh-trust init packager is implemented and reviewed in
package-firefox-nightly-trust.py. Sixty-one fixture checks and twelve independent
real-archive checks pass: only init changes among11,470 encoded records. Candidate
archive d2a42c0527df52ab1cc99640f8004cfbafc92d435f8b1bb518e4de6fa3ca748c
still contains Firefox128; never boot, promote or deploy it alone. Feed it into
the complete Nightly packager, then the GPU homepage overlay. The new
test-firefox-nightly-baseline.mjs runner has36 synthetic contract checks and
four independent regression checks passing after review; it validates compiled
identity/report/input hashes, automatic default homepage, real keyboard/download
fixtures, persistent home, update/warm caching and per-boot host-count SMP.
No actual Nightly browser/guest ran. Review evidence:
/mnt/p6/build/firefox-nightly-package-gate-review-20261002/review-run1.json.
JIT, GPU and fresh/existing-profile NSS/TLS acceptance remain separate gates.

NSS/TLS gate preparation now includes exact173-DER/purpose/date inventory,
five fixed-condition TLS fixtures, raw current-header PKCS#11 probe and a
privileged Nightly driver in tools/nightly-nss-gate. Twenty-eight preparation,
eight CPU/proxy and seven syntax checks pass; root independently verifies all
frozen hashes and reruns28 checks in nss-gate-preparation-review-run1.json.
Actual trust-anchor archive SHA5ada69e6a11b458c52bfb173f4755e3c3cb0981bcf1d727c968b90492c6b767b
contains19 native Wasm objects. No guest/browser/server/build/link/deploy runs
occurred in that packet. Driver APIs remain unverified in the guest; module
policy, TLS/screenshots, fresh/no-seed and stopped-profile key/auth/trust
preservation remain pending. See docs/firefox-nightly-nss-guest-gate-prepare-20261002.md.

Nightly JIT preparation is ready in tools/nightly-jit-prep and
docs/firefox-nightly-jit-prep-20261002.md. Selected overlay-run4 regenerates all
239 opcode IDs and initially admits 42 integer operations. Host-run2 passes
972 assertions; actual musl Wasm diagnostics compile the adapter, PBL/Jit hooks
and browser PBL setter against current headers with an isolated config header.
Root deterministic replay/input/object review passes 33 checks at
/mnt/p6/build/firefox-nightly-musl-root-review-20261002/jit-review-run1.json.
This is preparatory evidence only: fully configure/link PBL and run real guest
JIT/browser/performance gates before broader JIT coverage, promotion or release.

The follow-on full PBL/JIT transition is planned in
docs/firefox-nightly-full-jit-build-plan-20261002.md. Runtime and JitOptions
layouts plus22 conditional surfaces require a coherent full configure/build;
never mix the preparatory three-object diagnostics into baseline archives.
Preserve the accepted baseline and use a separate full-build task with fresh
source/objects and completely rebased writable wrapper/cache/log paths, under
the established20GiB full-build cap/reserve and finite j4 phases. Actual final
sizes and Nightly table/memory/fpcast contracts remain unmeasured. Nine document
consistency checks pass; no full PBL build or guest acceptance occurred. Initial
integer coverage is only42ops and does not finish broader JIT acceptance.

Guest JIT safety preparation in tools/nightly-jit-safety has19 separate
main/Worker cases, strict source/install/run/bail/TID/TLS evidence checking,
an unapplied bounded observer and unverified privileged GC/debugger/coverage/
slow-script driver. Preparation passes304 semantics,40 synthetic contracts,
seven syntax and five structural checks; root's12 pin/replay checks pass in
jit-safety-preparation-review-run1.json. Selected fixture-run1/observer-run4
are frozen by manifest-run2 SHA04696323d58e84e8fc36b8f955c813e6274c4d0fa0a87b595037ba2acefd0a2c.
Positive handler rejection, active incremental GC, native TLS/stack callbacks
and actual guest execution remain pending. The checker deliberately never
claims full JIT acceptance, and initial integer scope still fails without
positive handler/throw policy observation. Rebase observer hooks into the new
coherent PBL source; never replace it with these old preparation copies. See
docs/firefox-nightly-jit-guest-safety-prepare-20261002.md.

The user also requires a default local version/WebGL/WebGPU test homepage and
force-enabled GPU defaults. Implementation is in
`tools/guest-rootfs/firefox-gpu-check/gpu-check.html` and
`tools/guest-rootfs/package-firefox-gpu-check.py`, with integration instructions
in `docs/firefox-default-gpu-page-20261002.md`. Nine host rendering/error checks,
five package checks and a real isolated Firefox128 default-page cold-launch
smoke pass. Existing guest WebGL/WebGPU failures remain honestly visible;
this is not Nightly or guest GPU acceptance. Candidate-only evidence is under
`/mnt/p6/build/firefox-default-gpu-page-20261002`. Integrate this overlay into
the actual Nightly archive after full build, then run the host-CPU-count guest
gates. Public v10 and local production payloads remain unchanged.

# Musl recovery — 2026-10-02 (latest user direction; read this first)

The user stopped glibc implementation and explicitly requested saving that
branch, returning to musl libc, and completing latest Firefox Nightly, native
Wasm JIT, Vulkan, OpenGL and Firefox WebGL GPU. This supersedes historical
no-musl/glibc prerequisites and no-subagent rules. Fresh subagents receive only
necessary context and inherit the main agent model and thinking effort.

GNU work is preserved on `codex-nightly159-native-wasm` at `3027767`, including
265 scoped source/document files; build evidence remains under `/mnt/p6/build`.
All three GNU agents report empty owned process groups. No GNU runtime was
accepted; no further GNU implementation is authorized by this continuation.
One existing trailing whitespace in the preserved source checkpoint was
retained to keep pinned source identities intact.

Current branch `codex-nightly159-musl-jit-gpu` starts at the last pre-glibc
checkpoint `1b4be96`. The existing musl Nightly packet is preserved read-only:
`/mnt/p6/build/firefox-nightly-port-20261002`, with a 4.9 GiB patched source,
five configure overlays and selective Rust libc0.2.186 target support. Its
configure/export/MFBT/33 ABI checks passed; full Nightly never built. The old
build entrypoint was disabled by the now-superseded glibc request. Recover in
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002`, with fresh objects,
caches and rebased recipe paths. Current task allowance is 20 GiB including
source, objects and caches, with a 20 GiB free-space reserve; report before
enlarging it. All task
temp/cache/output paths must stay disk-backed, never `/tmp`.

Source-only JIT audit remains at
`/mnt/p6/build/firefox-nightly-jit-api-20261002/acceptance-and-migration-plan.md`.
Its obsolete glibc requirement is superseded; new Nightly PBL/context/ICcursor,
opcodes and Watchtower APIs still need migration and executable acceptance.
Build Nightly first, then integrate/test native Wasm JIT, then Firefox GPU.
Public Sites v10 remains the known-good Firefox128.14.0 ESR musl release;
no Nightly deployment has happened. Preserve all source/build trees, unrelated
untracked files, deployed assets and user services. Native Wasm only, adapter
preference and existing verified-release authorization continue to apply.

# Nightly upgrade — 2026-10-02 (latest user direction; read this first)

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
