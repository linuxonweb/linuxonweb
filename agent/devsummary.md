# Development summary — active task

Task start: 2026-11-03T07:06:26Z. Five-hour budget ends approximately12:06UTC;
only an important bug may justify the requested one-hour extension.

Current overall acceptance: **26/100, provisional and evidence-limited**.
This is progress toward the full user goal, not a code-quality grade. Root's
rubric: desktop6/15; I/O+startup7/25; JIT3/15; graphics6/25; packages1/10;
mobile0/5; preview/reproducibility3/5. The goal remains unmet and work continues.

## Completed startup/I/O iterations

|Iteration|Owner|Start|End|Result|Overall acceptance|
|---|---|---|---|---|---|
|0: recover + baseline|startup_io|07:06:26UTC|2026-11-03T07:20:54.415Z|Checkpoint49fc26e; task branch; real I/O and cold Firefox baseline|21/100|
|1: durable metadata path|startup_io|2026-11-03T07:23:00.854Z|2026-11-03T07:38:10.916Z|Commit80a52d1;50 browser checks + independent review; ABBA metadata sample9.4% lower|24/100|
|2: startup memory/CPU/input diagnosis|startup_io|2026-11-03T07:30:54.517Z|2026-11-03T08:14:46.012Z|Matched 3-CPU memory reduction; monitoring/input confounds isolated; compression remains opt-in|24/100|

The first live I/O owner failed before app load because a background preview
server had been reaped. Its479MB host-only PSS is not Firefox memory. The
packages agent restored a persistent systemd preview before actual baselines.

The narrow metadata fix preserves strict durability and original read/write
paths. An explicit-commit experiment was rejected after random4KiB performance
regressed. Raw source, failed/passing observations and summary are in
`docs/evidence/gpt6-astra-builtin-rubywebterm-20261103/`.

## Startup evidence and limits

Cold1: guest started by5.0s, no Firefox window at31.35s, blank Firefox window
at51.87s, startup page rendered by90.55s. Peak sampled owned PSS5.013GiB.
Trace1: actual about:blank typing and navigation observed after110.75s;
observation bounds are not exact input latency or proof of early readiness.
Native host GL reported NVIDIA GeForceMX110 through ANGLE; WebGPU unavailable.

Compressed1: peak sampled PSS3.897GiB; remains opt-in. Its fast input probe
produced malformed text. Later input diagnostics showed no host queue overflow
(70 enqueued/delivered,0 dropped), and exposed an owner flaw: awaiting keydown
acknowledgement delayed intended20ms key releases (one actual hold403ms).
Independent release scheduling alone was insufficient: synchronous resource
sampling could still block the release timer. Raw3 repeated L characters after
a 598 ms hold; compressed3 had a 244 ms hold. Resource monitoring now runs in
a separate Worker. Input1 passed 176 actual DOM keypresses with exact text,
ordered down/up pairs, maximum dispatch hold 32.61 ms, maximum DOM hold
38.39 ms, and median 20.94 ms for an intended 20 ms. Monitoring still samples
CPU/RAM/PSS/quota every second; its slowest sample took 134.8 ms without
blocking input. This validates the harness, not guest input latency.

CPU correction: initial owner affinity/native browser reported8, but Chromium
was observed migrating under a3CPU ancestor quota. Earlier receipts retain
cgroup names but not historical quota values, so effective CPU allocation of
those measurements is not guaranteed. Raw3/compressed3 were compared
at 3-CPU affinity with per-second ancestor quotas; every recorded effective
allocation was 3 CPUs. Do not treat simultaneous CPU
and compression changes as a single improvement.

Direct constructor instrumentation: one208.8MB Firefox Module compile902.7ms,
initial Instance246.6ms. Large-module compilation is not the main startup delay.
687 cloned-module Instance events without byte identity totaled29.17s across
workers; this sum is not serial critical-path time. Call-site classification
remains to be completed. Native/GC/JIT acceptance remains separate.


### Matched three-CPU cold runs

Both runs used Chromium 150.0.7871.114, a fresh browser profile and fresh guest
home database, the same served archive, guest RAM 2048 MiB, and 1280×720.
The only application setting difference was compressed-initramfs=1.

|Observation|Raw3|Compressed3|
|---|---:|---:|
|Peak sampled owned PSS|4.2732 GiB|3.2287 GiB|
|No Firefox window yet|51.20 s|51.61 s|
|Firefox chrome, content still blank|71.75 s|70.87 s|
|Rendered startup GPU-check page|90.86 s|90.94 s|
|First observed launch log|21.48 s|20.57 s|
|First observed GL context log|47.23 s|46.40 s|

These are screenshot/log observation bounds, not exact event times. The
matched sample supports about 24.4% lower peak PSS, not a startup speed gain.
Both runs stopped cleanly with no owned processes remaining. Compressed input
eventually navigated to a blank New Tab, but the fixed-delay screenshot was
premature; neither input latency nor compressed-default acceptance is claimed.
It remains too large for the attached phone's observed available memory.

All run JSON, guest logs and selected screenshots are retained under
`docs/evidence/gpt6-astra-builtin-rubywebterm-20261103/`.

## Measured owner/build/test times

|Run|Start UTC|End UTC|Elapsed seconds|Result|
|---|---|---|---:|---|
|io1|2026-11-03T07:15:26.606Z|2026-11-03T07:15:51.910Z|25.305|failed; see evidence; 0 owned remaining|
|io2|2026-11-03T07:17:58.015Z|2026-11-03T07:18:06.520Z|8.505|completed; 0 owned remaining|
|cold1|2026-11-03T07:18:12.133Z|2026-11-03T07:20:54.415Z|162.282|completed; 0 owned remaining|
|home1|2026-11-03T07:23:00.854Z|2026-11-03T07:23:09.304Z|8.450|completed; 0 owned remaining|
|io3|2026-11-03T07:23:16.679Z|2026-11-03T07:23:24.230Z|7.551|completed; 0 owned remaining|
|abba1|2026-11-03T07:28:32.416Z|2026-11-03T07:28:50.224Z|17.808|completed; 0 owned remaining|
|abba2|2026-11-03T07:30:24.858Z|2026-11-03T07:30:42.841Z|17.984|completed; 0 owned remaining|
|trace1|2026-11-03T07:30:54.517Z|2026-11-03T07:33:43.602Z|169.084|completed; 0 owned remaining|
|home2|2026-11-03T07:38:04.013Z|2026-11-03T07:38:10.916Z|6.903|completed; 0 owned remaining|
|compressed1|2026-11-03T07:38:10.982Z|2026-11-03T07:40:53.406Z|162.424|completed; 0 owned remaining|
|direct1|2026-11-03T07:48:59.504Z|2026-11-03T07:51:42.229Z|162.725|completed; 0 owned remaining|
|raw3|2026-11-03T08:00:46.361Z|2026-11-03T08:03:29.172Z|162.812|completed; 0 owned remaining|
|compressed3|2026-11-03T08:03:29.264Z|2026-11-03T08:06:11.362Z|162.098|completed; 0 owned remaining|
|input1|2026-11-03T08:14:33.066Z|2026-11-03T08:14:46.012Z|12.946|completed; 0 owned remaining|

Recorded owner execution sum: 1086.877 s. These runs were sequential in startup_io; other agents worked in parallel.
Task wall time through this ledger update: 4330.615 s.
Model inference/active attention time is not exposed by the tools; no invented
main/subagent compute-time totals are reported. Other agents append their own
build/test durations. No startup_io test/build exceeded5minutes.

## Current iteration 3 — profile I/O and opt-in code-cache seed

The corrected compressed run `warm1` reached the rendered Firefox page by
90.87 seconds. Its exact about:profiles page later rendered successfully. The
30-second manual screenshot-to-click handoff expired before the requested
Restart normally click, so **no warm restart was attempted**. The owner failed
that harness gate and reaped all its processes. This is not a Firefox restart
failure. The handoff is now bounded at 90 seconds; fresh cloned test profiles
exclude stale DevToolsActivePort/Singleton files and require a cleanup receipt.

By 132 seconds the first-profile trace recorded 11,423 home API calls: 3,871
writes, 33.4 MB written, 46.98 seconds aggregate write time, and 62.21 seconds
union of in-flight API intervals (maximum concurrency 2). These totals include
substantial post-start work and are not all serial startup latency. The current
per-phase evidence is in warm1-home-phase-attribution.json. Aggregate async
time is 7.81 s before 50 s, 6.28 s during 50–70 s, 14.34 s during 70–90 s,
16.43 s during 90–110 s, and 17.44 s during the subsequent input/background
phase. Exact window/page timestamps remain bounded by screenshots.

A closed, isolated profile inventory found 14.31 MB scriptCache.bin and 4.93 MB
startupCache.4.little; substantial durable SQLite/WAL data also exists and is
excluded from seeding. The code-cache export includes exactly those two files
and the 6,031-byte urlCache.bin, with provenance and individual SHA256 hashes.
The experimental seed asset is 10,462,324 bytes compressed / 19,247,053 bytes
unpacked, pinned to archive 60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa.
It is not enabled by the production UI. A diagnostic proxy can opt in after
all download/validation/import work has started inside the cold timing window.

The importer passed 11 real-browser checks: image mismatch causes no fetch or
mutation; existing/cleared homes stay unchanged; corrupt bytes fail before
mutation; an in-page home change during download wins; strict durable reopen
preserves all three checksums; no durable/NSS profile databases are created.
Guest acceptance/use and a repeatable launch benefit remain unmeasured.

### Observer cost correction

The Node resource sampler now runs in a Worker. CPU/RSS/available memory/quota
remain sampled every second; PSS is sampled every five seconds and records its
scan duration. New PSS peaks are sampled lower bounds at that cadence; they
are not directly compared to prior one-second-PSS peaks as a code improvement.
Short runs may contain only one PSS sample. Per-PID/start CPU counter deltas
avoid negative CPU percentages when a child exits; work between a child's final
sample and exit can still be missed. No quota/controller policy is changed.

## Iteration 4 — compressed default and APK composition acceptance (2026-11-03)

Overall acceptance before root review: 31/100; this is component evidence, not completion of the user goal. Package image 4f6bf2d3a326 published with unchanged original /init and Firefox native. New concatenated gzip package image, actual desktop extras, and generated init wrapper passed a real 2 GiB / 3 CPU guest boot with APK execution, extras presence and a home write plus sync. Browser elapsed 15.363 s, exit 0. Composition build started 09:59:35 UTC and took 8.008 s; raw-path member/hash validation took 4.003 s from 10:00:32 UTC; bounded runtime envelope took 16.028 s from 10:00:36 UTC; focused default/loader tests took 1.001 s from 10:02:28 UTC. One-second resource monitors were retained. Firefox now preserves gzip by default, with explicit `compressed-initramfs=0` available. GPU overlays that require raw CPIO still select raw.

The earlier matched 3-CPU one-second-PSS pair measured 4.2732 versus 3.2287 GiB (~1.04 GiB reduction). No startup time improvement is attributed to compression. New actual frontend composition closes the package gate; package fixture separately proved two-boot coherent APK DB/files reset and persistent home. Code-cache v1 was rejected as unused (zero guest reads); v2 and writeback remain experimental and off.

## Iteration 5 — production browser compression regression (2026-11-03 10:08–10:13 UTC)

The overlay5 guest benchmark never booted: actual Chrome150 production `DecompressionStream('gzip')` rejected the published multi-member APK archive with `Junk found after end of compressed data`. No FPS result exists for cube2. Its owner ran162.449s, but this is a failed-loader observation interval, not Firefox time or memory. The Node composition + direct kernel checks in iteration4 did not cover the actual browser decompressor; their apparent full acceptance was withdrawn. Root revised provisional acceptance to35/100.

At10:12:48UTC the verified publisher restored immutable60847fb85339 (SHA60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa), retaining the compressed default known to work on this image. The failed4f6bf2d3a326 artifact and evidence remain. Packages is stream-repacking the identical decoded CPIO sequence into one gzip member. Required next gate: independent Chromium stream validation plus exact production main/extras/init wrapper reaching guest desktop, before publication. The benchmark owner now fails fast on a known boot-failed UI status instead of waiting out the full150s interval.

## Iteration6 — repaired browser image and clock-correlated Firefox gate

- Start2026-11-03T10:20:14.572Z; end2026-11-03T10:23:22.839Z; elapsed188.268s. Overall acceptance remains35/100, package release pending.
- Exact single-member candidate d35dbfeb2a15 reached actual Firefox through production DecompressionStream, extras and init wrapper. Independent graphics browser decode/composition gate passed20/20 in33.874s (separate component time).
- Completed cube correctnessPASS:82frames/34.085s=2.4058fps, wall34.084s,17.301s maximum stall. Same page origin throughout. This is~4.02% of59.84828fps host; goal unmet.
- Post-benchmark manual gate expired during context handoff; terminal commands unperformed. This is an orchestration failure, not a product package failure. Dedicated scripted desktop gate follows.
- PSS4,864,962,560B=4.531GiB sampled5s; CPU/RSS/quota1s. Not directly comparable to earlier old608 matched3.229GiB compressed measurement.
- Walltime from task start07:06:26 through10:23:22.839=3h16m56.839s. Parallel component/test durations are not added to elapsed walltime.

## Iteration7 — dedicated production package desktop and off-public flush barrier

- Actual repaired-image desktop gate2026-11-03T10:27:44.958Z→10:29:53.861Z,128.903s, clean Stop and zero owned processes. Aurora terminal launched after wm-ready; native APK update and signed Python installation succeeded, python3 --version reported3.14.6. Module execution emitted prefix warnings and no completion marker within4s; ordinary environment/latency investigation pending, publication held. Overall35/100.
- Isolated barrier fixture2026-11-03T10:31:01.655Z→10:31:29.029Z,27.374s,16checksPASS,0owned; fixture512MiB, actual guestLinux/native syscalls/strictIDB. Open acknowledged writes and activewriter durable before genuine quiesce+syncfs ACK; exactnonce Stop/reopen retained bytes. Real quota error and timeout resume running guest, no false shutdown.
- Barrier remains experimental/off-public: current real desktop PID1 can spawn/respawn writers and cannot be safely stopped. A supervisor/full-desktop lifecycle gate is not implemented; no production writeback exposure.
- Elapsed walltime from07:06:26 through10:31:29.029 is3h25m03.029s. Parallel durations remain separate.

## Iteration8 — version2 code-cache functional experiment

-2026-11-03T10:37:51.463Z→10:40:21.459Z,149.996s. Native archive remains old60847fb85339; fetch/decode/import are inside page-to-boot time. Concurrent package activity means no controlled timing comparison.
- Import exceeded its cooperative15s deadline after first4,926,718B cache file was strictly committed; pristine readdir alone took9.353s and firstwrite1.821s. Compatibility metadata and remaining caches were not installed. Native normalboot continued. No cache reuse/efficacy accepted, no input acceptance because the fixed110s probe occurred before observed readiness.
- Same page origin throughout; effective3CPU ancestor quota captured in142samples; minimum availableRAM23.77GB. Owner cleaned all descendants. Seed stays disabled, no overall score change(35/100).
- Wall elapsed from07:06:26 through10:40:21.459=3h33m55.459s. No extra fullseedrun without a concretefix and quietlane.

## Iteration9 — atomic lookup metadata

- Isolatedsourcepinstart2026-11-03T10:47:44.297938+00:00, acceptance/landingrecord2026-11-03T11:02:03.728411+00:00, wall859.430s. Nativebuild2.006s, host/nativepassingowner37.541s; priorfixturecompletionselectorfailure120.025s preserved.
-24hostcorrectnesschecks andactualnative stat/lstat/uid/gid/mode/ENOENT/fallback checks passed. ABBA128statbaseline2307.330/2288.055ms vsatomic2056.060/1992.705ms(~11.9% lower median inthisworkload);262LOOKUPs each, separategetattr785→526. Thispercentage isseparate fromcreate9.4%microbenchmark andisnotanoverallstartupclaim.
- Independentgraphics_jit reviewPASS; onlyoptional atomicreadonlysnapshotAPI andFUSEuse added, existinglegacyfallback preserved. No crossrequestcache orwrite/fsyncdurability change. Overall35/100 pendingparentrubricupdate andAPKpublication.


## Iteration 10 — repaired public APK4 and actual desktop package acceptance

Publication identity verified at 2026-11-03 11:08:22 UTC. Production owner
`apk4-quiet` ran 11:14:31.040–11:18:44.471 UTC (253.431 seconds), with zero
remaining owned processes. It loaded exact served APK4 d258203daee8 through the
browser decompressor plus extras/init. After a150-second observer-free interval,
actual normal-admin terminal commands installed signed Pythonr1/coreutils;
Python module help and `python-desktop-ok` appeared without prefix warnings.
Bare `ls` still resolves BusyBox; GNU explicit paths have separate package gates.
The first immediate publication assertion failed without preserving mismatch
values; the next full-stream served verification passed. No cause is invented.

Quiet cube:81frames/23.287s=3.4783fps, wall23.279s, maximum7.089s frame stall;
correct pixels and GL error0. Host exact page59.84828fps. PSS2,810,084,352B
(2.617GiB), sampled every5s; CPU/RSS/quota every1s. An early3.7s copy/hash
confound is retained. There is no30s readiness claim. Overall acceptance
37→39/100 after root review. Exact evidence: startup-benchmark/evidence/apk4-omni-20261103.

## Iteration 11 — canonical Omni packing, rejected for public promotion

Canonical pack build 11:02:38.417–11:04:46.899 UTC (128.483 seconds, peakRSS
86,142,976B); APK4 combination started11:09:12.407 and took32.029 seconds
(peakRSS25,784,320B). Payload verification preserved8,030 non-manifest resource
contents plus original native/init. Regular files8,059→26;64KiB allocation
fell538,509,312B, but download grew3.2MB. Candidate d9d7bebfe7df stays isolated.

Fresh owner `omni-fresh`:11:22:22.165–11:26:56.924 UTC,274.758 seconds.
First150s PSS3,468,967,936B=3.231GiB versus2.617GiB control (+23.4%);
cube3.1877fps versus3.4783fps gives no speed benefit. Source/file packing alone
is not browser memory acceptance. Both observations use3CPUs/2GiB and5s PSS.

Actual Restart normally click at11:25:10.937 exited oldPID106 with status0;
no replacement PID/window appeared within90s. This is a real action failure.
Readable unchanged native159 source suggests unsupported NSPR detached spawn;
exact baseline runtime equivalence remains untested. Never restart every exit0
as a workaround, since that breaks ordinary Close.

Retained closed APK4 profile run `omni-existing`:11:29:30.388–11:31:42.562 UTC,
132.174 seconds, normal Stop and zero owned processes. Firefox/cube visible
by90.756s; exact about:blank input and blank-page navigation observed at
113.205/115.544s. These are observation bounds, not event latency. Public image
remains APK4. Overall acceptance remains39/100; later independently reviewed
MI8 native-prompt evidence raises the project to40/100 (mobile1/5 only).

## Timing accounting checkpoint

All completed current-owner durations are indexed in
`tools/startup-benchmark/evidence/startup-owner-time-ledger-20261103.json`.
The sum is recorded owner task time, not CPU time and not overall wall time;
parallel agent work and earlier diagnostic overlap must not be double-counted.
Builds and non-current-owner tests retain separate bounded receipts. No run in
iterations10–11 exceeded five minutes; composite owner phases are explicit.

At 2026-11-03T11:43:41.975591+00:00, elapsed since07:06:26 was 16635.976 seconds (4.6211 hours); recorded current-owner durations sum to 3184.443 seconds across 38 completed receipts.


## Iteration 12 — isolated same-image cache-marker reuse

First invocation was rejected by the closed-sibling-profile guard before browser
start (terminal24505); its proxy was reaped. Host duration was not measured; the
tool-call wall duration10.7s includes service overhead. Corrected owner marker2
ran 2026-11-03T11:52:59.062Z–2026-11-03T11:55:18.660Z (139.598s), normal Stop, zero owned
processes and no owner errors. Actual persistent startup/script cache inodes177
and181 were read5,236,797B/14,313,900B with zero rewrites. Public marker remains.

The GNU guest overlapped11:53:12–11:53:38 and recovery uploads also ran, so no
clean timing improvement is claimed. Firefox absent at90s, visible and exact
address text by110–114s; navigation pending at116s and complete by final120s.
This is cache-reuse evidence, not30s launch or a safe migration fix. Overall
acceptance41/100 after the separately accepted GNU packages; no score increase
for this off-public experiment.

Final startup_io accounting checkpoint at 2026-11-03T11:57:19.937918+00:00: elapsed since
07:06:26 is 17453.938s (4.8483h). The 39 completed current-owner
receipts sum to 3324.041s. This is summed task duration,
not CPU time or exclusive wall time. Any overlapping agent tasks are recorded in
their own ledgers, never added as total wall time. No current-owner receipt is
above300s; slow multistage/native builds elsewhere retain their separate measured
receipts and explanations. Marker/Omni builds and tests are all belowfive minutes.
