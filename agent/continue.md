# Active continuation — 2026-11-03 13:22 UTC

Fresh task start: **2026-11-03T13:22:11Z**. Normal deadline: **18:22:11Z**.
One extra hour only for important bug fixes, with a maximum of19:22:11Z.
Branch: `gpt-6-astra-pro_builtin-agents_linuxonweb-20261103-1322`.
Checkpoint tag: `checkpoint-linuxonweb-20261103-1322-81103b2`.
Frozen parent `81103b2ec04a8a4f8453617ca128448e831645bc` is unchanged.
Baseline acceptance remains **42/100**, pending new evidence.
Main agent is CTO; same-model built-in subagents own engineering.
Integration/acceptance owns shared lifecycle/harness/publication and Git index coordination.
Firefox agent owns cache protocol/native restart/JIT build route.
Packages agent owns package persistence and missing native ports.
Request the shared heavy-runtime lease before any guest boot or benchmark.
Use `agent/task.md` as current exact instructions; previous notes are archived.

Completed prior delivery: https://fileharbor-meak.basicgleam65.chatgpt.site/raw/meaklocaldev/85337f77-8669-4c34-b004-c691237d91ba/linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_complete/index.html

## Inherited verified baseline

# LinuxOnWeb continuation — 2026-11-03

Read `agent/task.md` for the exact user request and `AGENTS.md` for active rules.
The main agent is CTO; same-model built-in subagents implement, test and deploy.
Task started 2026-11-03 07:06:26 UTC; the five-hour base deadline is 12:06:26.
An extra hour is authorized only for an important bug, not general scope growth.
Branch: `gpt-6-astra-pro_builtin-agents_linuxonweb-20261103`. No Git remote existed.
Do not blanket-add the many unrelated untracked directories, profiles or binaries.

## Verified release and acceptance

Overall acceptance is **42/100**, not a quality claim of completion: desktop6/15,
I/O+startup10/25, genuine JIT4/15, graphics9/25, packages7/10, mobile2/5,
preview/reproducibility4/5. Responsive Firefox within30s, general OpenGL/Vulkan,
50% host performance, Node.js, and full mobile Firefox remain unmet.

The public default is the accepted, single-gzip **APK4 image d258203daee8**:
116,197,223 bytes, SHA256
`4675a8ceb318c539cd64eb1b69338a19185d0cadb7a5f51b2352048a0c09a771`.
Candidate source: `out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103/build/rootfs-apk4`.
Original Firefox native SHA256 remains
`26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998`;
original /init remains byte-identical. Compressed initramfs is now the normal
Firefox default; `compressed-initramfs=0` retains the raw diagnostic path.

Actual production browser boot, DecompressionStream, extras/init wrapper,
Firefox/cube rendering, normal admin terminal, signed `sudo apk update/add`,
Python r1 module help with empty prefix-warning output, and product Stop passed.
The rootfs and APK database reset together at guest reboot; /home persists.
GNU coreutils uses explicit /usr/bin paths; bare ash `ls` may remain BusyBox.
Do not call this a persistent rootfs installation system.

Live signed package repository:
https://a3cf34ce40307517.5x7aqstuceku.opentunnel.xyz
The image also has an explicit tagged @snapshot repository; it is not an
automatic stale fallback. Package/mobile agent owns package publication and
final encrypted recovery uploads. Do not put signing keys or preview tokens in Git.

## Measured results and their limits

Accepted create fast path (80a52d1): 50 browser checks and independent review;
64-cycle metadata ABBA sample767.32→695.39ms (~9.4%). Strict durability unchanged.
Accepted atomic lookup+attributes (c2e4d21): 24 host checks plus actual native
stat/lstat/permissions/ENOENT assertions; one read-only transaction instead of two,
legacy fallback preserved. Native128-stat ABBA median about11.9% lower;
LOOKUP counts remain262, separate getattr calls785→526. Do not add percentages
or claim general I/O throughput from these distinct metadata workloads.

Earlier controlled reference-image raw/compressed pair used real3CPU capacity,
identical inputs and1s PSS:4.2732→3.2287GiB peak (~1.0445GiB lower). It did not
improve startup: window observed around71s, rendered page around91s. Those peaks
are not fresh measurements of APK4. Large Firefox Module compilation was only
~0.903s; repeated-large-compile caching is not a justified startup optimization.

Latest APK4 quiet control: first150s has no screenshots/evaluate/log polling or
tracing. CPU/RSS/quota remain1s, PSS every5s (sampled lower-bound peaks).
Actual cube81frames/23.287s=3.4783fps, about5.8% of the same host cube59.84828fps.
The full browser still stalls for seconds despite a hardware glremote path.
PSS peak2,810,084,352B=2.617GiB in this run. A3.7s early copy/hash overlap is
recorded; the later cube sample itself was quiet. No30s readiness claim follows
from a quiet owner that intentionally observes only after150s.

Benchmark settings are explicit3CPUs,2GiB guest,1280x720, WebGL presenter/backend.
Public defaults differ: CPU min(4,hardwareConcurrency), saved settings honored,
initial2GiB with a possible4GiB Firefox choice, auto/WebGPU presentation and
WebGPU guest backend. Do not silently fallback or present the benchmark settings
as the public default. Hardware host: Chrome150, NVIDIA MX110/ANGLE OpenGL.

## Rejected optional Omni experiment

Canonical159 mozpack packaging preserved8,030 non-manifest payloads plus native,
init, symlinks and external assets. Regular files8,059→26;64KiB file allocation
791,281,664→252,772,352B (538,509,312B lower), but download grew3.2MB.
Candidate `/mnt/p3/codex-build/s3n/rootfs-omni`, versiond9d7bebfe7df,
SHA256ad654b781ff46891236c4b6a6f1403a0ef396428339105d46d7b6bd1ab25980f.
It is **not published**. Matched first150s PSS regressed2.617→3.231GiB (+23.4%);
cube3.1877fps versus3.4783fps provided no gain. Fresh Firefox and an existing
APK4 profile both rendered and accepted exact about:blank input/navigation.
Retained-profile gate132.174s ended with normal Stop and zero owned processes.
A lower one-GiB viability configuration is untested; do not infer it fails merely
from the two-GiB PSS result. Builder: tools/startup-benchmark/gpt6-astra-pack-omni.py.
Full receipts/screenshots: tools/startup-benchmark/evidence/apk4-omni-20261103/.

## Concrete startup/restart leads

The actual root-owned /opt/firefox/browser/.purgecaches marker remains after
normal Firefox startup; admin cannot remove it. Source159 CheckCompatibility
sets cachesOK=false whenever it exists; removal failure is ignored. A diskless
root restores it every boot. This is a concrete repeated-invalidation bug.
Do not globally remove it: same native build ID can accompany changed resources,
and all persisted profiles need safe per-image invalidation. A same-image,
closed-test-profile diagnostic is authorized through an isolated proxy only;
its result must be recorded separately from a production-safe migration fix.

Actual about:profiles Restart normally was clicked in the Omni run: oldPID106
exited0, no new process/window appeared within90s. This is a real action failure,
not a handoff timeout. Native bytes are unchanged; baseline runtime equivalence
is untested. Readable159 source gives a likely existing mechanism: AppShutdown
calls LaunchChild(true), aTryExec defaultsfalse, and wasm/Linux
PR_CreateProcessDetached returns PR_NOT_IMPLEMENTED_ERROR. Shutdown ignores the
result. A legitimate native rebuild could use correct exec/spawn semantics;
restarting every exit0 in a shell would break ordinary Close and is unsuitable.

## Off-public experiments and safety contracts

Public HomeFS commits remain strict. Cache seed v1 imported but had zero reused
reads; v2 timed out cooperatively during a contended run. No accepted efficacy.
Both remain off, with only allowlisted code caches and generated compatibility
metadata, no prefs/security/user databases. Preserve failure receipts.

Experimental FUSE_WRITEBACK_CACHE reduced256x4KiB writes to2 host writes, but
current Stop lost acknowledged dirty guest pages. The isolated barrier fixture
passed16 checks in27.374s: real quiesce/syncfs, open/active writers, durable reopen,
quota→ENOSPC, nonce ownership and timeout resume. productionAccepted:false:
real desktop PID1 can respawn/write and cannot simply be stopped. No public
writeback mode or new supervisor is enabled. Do not weaken durability for speed.

## Runtime ownership, artifacts and recovery

All host guest runtime gates are serialized under the effective3CPU ancestor
quota. Concurrent guests stalled at SMP bringup; this was a resource confound.
Keep1s CPU/RSS/quota monitoring in a separate worker and5s PSS; synchronous PSS
sampling previously delayed input keyup and invalidated those latency probes.
Profiles/caches/logs must be disk-backed with short TMPDIR Unix socket paths.
Preserve the existing phone reverse8888 mapping and unrelated services.

Owner: tools/startup-benchmark/gpt6-astra-current.mjs. Diagnostic proxy:
gpt6-astra-timing-proxy.mjs. Run artifacts: /mnt/p3/codex-build/s3n/.
Use a closed sibling test profile only; never a user's persisted browser profile.
The current proxy marker experiment is guarded by exact APK4 hash and closed
profile receipt. Public assets remain untouched.

The preview port3000 runs as an owned persistent systemd user service; the
package agent owns authenticated HTTPS metrics/messages and the public signed
repository. Source/archive browser release gate is mandatory (AGENTS.md).
Full encrypted history through80a52d1 is saved; incremental history/source and
latest artifacts need the package agent's final verified checkpoint. Public
source export excludes profiles, out/, signing keys and private preview state.

## Final bounded cache-marker result

Isolated marker2 completed11:52:59.062–11:55:18.660 UTC (139.598s), normal
Stop and zero owned processes. It cloned the closed accepted APK4 profile and
removed the marker only in that disposable guest. Original cache inode177 was
read5,236,797B in40reads and inode181 read14,313,900B in110reads, both with zero
rewrites; compatibility.ini was read unchanged. This confirms actual cache reuse.
There is no speed claim: recovery uploads and a short GNU guest overlapped.
Firefox was not visible at90s; by110s it rendered the cube and exact address input.
Navigation was pending at116s and complete in the final120s capture. No production
marker migration is enabled. Evidence: startup-benchmark/evidence/cache-marker-20261103.

## Final accepted mobile release and recovery handoff

Mobile/runtime commit a2d3da521831e39f150cb8f757d1eaa7c0d0f621 passed independent
source review,29real-Chromium integrity/lifecycle checks and actual authenticated
HTTPS MI8 native id/APK/Stop/cleanup. One verified worker fetch and one Blob
created/revoked serve28workers. The default desktop worker path is unchanged.
Phone1CPU/512MiB;6.669s imagefetch +3.601s after image verification to prompt;
full cold navigation/kernel-cache and Firefox timing are not measured. Phone
Python install exceeded45s, soft-keyboard letter taps and iOS remain unaccepted.
See the curated mobile receipt/report; never broaden this to full mobile Firefox.

Current overall acceptance42/100: desktop6,I/O10,JIT4,graphics9,packages7,mobile2,
preview4. Accepted GNU gzip/grep/sed and recovery tools:83c4c2; runtime publication
receipt preserves APK4/kernel/plain/extras/repository (all8server hashes verified).
The final cumulative source/history checkpoint includes this documentation head;
its completion receipt is maintained by packages_mobile after source freeze.
No runtime tests or optional implementation remain scheduled in this task.

Consolidated report: docs/gpt6-astra-pro_builtin-agents_rubywebterm_acceptance-20261103.md.
Exact timing table: agent/final-timing-summary-20261103.json. Self-contained next
prompt: agent/next-agent-prompt.md. Model/planning time is unmeasured; do not add
parallel or nested task durations as elapsed wall time. Keep APK4 public and all
cache-seed/writeback/Omni experiments off. The full goal remains unfinished.

Recovery status at source freeze: final cumulative source/history publication is
pending. The completed external release receipt will name this exact frozenHEAD
and final URLs. Complete recovery needs original encrypted80a52d1 full-history
base + final cumulative encrypted increment + exact accepted runtime archive;
filtered source alone is insufficient. Full public redownload/decrypt has not
been performed, although local increment fetch/fsck and runtime reassembly/hash
checks passed. Do not claim the pending upload complete until its receipt exists.
