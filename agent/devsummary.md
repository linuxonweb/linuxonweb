# Development summary — fresh continuation

Start: 2026-11-03T13:22:11Z. Deadline:18:22:11Z, important bugs only until19:22:11Z.
Baseline acceptance42/100. Prior full accounting is archived in
`agent/archive/devsummary-20261103-1322.md`. Each agent retains stage receipts;
parallel/nested durations are never added as overall elapsed wall time.

|Iteration|Owner|Start|End|Result|Acceptance|
|---|---|---|---|---|---|
|0: handoff/checkpoint|integration_acceptance|2026-11-03T13:22:11Z|2026-11-03T05:24:29-08:00 (Git checkpoint time)|Mandatory reads; clean tracked tree; frozen checkpoint tag; fresh branch|42/100|

## Iteration1 — production cold/warm baseline and harness correction

Acceptance remains42/100. Actual Start Firefox menu timing was added to the
bounded owner, separate from page navigation. Three owners ran sequentially:

- cold1: 2026-11-03T13:28:46.474Z–2026-11-03T13:30:59.433Z; 132.959s; Rejected hardware baseline: direct Chromium owner omitted NVIDIA offload. Zero remaining owned processes.
- cold2: 2026-11-03T13:32:04.794Z–2026-11-03T13:34:17.577Z; 132.782s; Hardware cold baseline via actual production Start Firefox. Zero remaining owned processes.
- warm1: 2026-11-03T13:34:57.851Z–2026-11-03T13:37:10.656Z; 132.806s; Warm retained profile plus cached image baseline; input gate incomplete. Zero remaining owned processes.

Cold hardware screenshot shows no Firefox at30s and rendered GPU page/cube at70s.
Exact address text appears96.389s; navigation is still pending100.060s and
confirmed by final120s capture. These are observed bounds, not exact first-ready
latencies. Warm profile renders70s but the manual input control missed the120s
owner deadline; this is a harness handoff failure, not a passed usability gate.
Event-driven nonce input/navigation instrumentation is under preparation.
CPU/RSS/available RAM/quota1s; PSS5s sampled lower-bound peaks. Driver-offload
failure is retained separately. No matched FPS result is inferred from GUI
instantaneous counters. Exact receipts: tools/startup-benchmark/evidence/continuation-20261103-1322/baseline/acceptance.json.

## Iteration2 — automatic Firefox usability measurement

Acceptance remains42/100. Test-only nonce panel and content stdout default pref
are composed into an isolated APK4-derived rootfs before cache-generation hashing.
NativeFirefox/init unchanged; original GPU workload remains and normal production
extras/decompression/desktop launch are exercised. First protocol run failed its
20s typed acknowledgment; the corrected owner waits for actualDOMinput focus
before typing and preserves failure screenshots. No deadline was widened.

Successful owner ready-base2:2026-11-03T14:03:24.003Z–14:04:43.598Z,79.595s.
After the production StartFirefox request, native paint was observed61.128s,
focus62.607s, exact input64.046s, distinct navigation acknowledgment64.824s.
The65.743s screenshot still showed the old compositor frame; actual visible
READINESS COMPLETE with matching nonce is confirmed by final.png at66.478s.
Thus30s remains failed. Normal productStop and zero owned processes passed.
This is a measured cold functional readiness bound, not a matchedFPS result.

Readiness base builds32.757s and33.511s passed monitored3CPU/resource gates.
PSS is sampled5s, CPU/RSS/availableRAM/quota1s. The owner/candidateproxy share
owned cleanup. Raw failure and passing receipts/screenshots are retained under
tools/startup-benchmark/evidence/continuation-20261103-1322/readiness/.

Production route verified after owner cleanup14:05:36UTC:servedAPK4d258203daee8,
116197223bytes, SHA2564675a8ceb318c539cd64eb1b69338a19185d0cadb7a5f51b2352048a0c09a771.
Rawweb/linux manifests are legacy; immutable published-build overrides are the
actual production assets. Recovery must use the verified publisher.
