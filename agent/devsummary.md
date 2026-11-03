# Development summary — active task

Task start: 2026-11-03T07:06:26Z. Five-hour budget ends approximately12:06UTC;
only an important bug may justify the requested one-hour extension.

Current overall acceptance: **24/100, provisional and evidence-limited**.
This is progress toward the full user goal, not a code-quality grade. Root's
rubric: desktop6/15; I/O+startup7/25; JIT3/15; graphics4/25; packages1/10;
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
