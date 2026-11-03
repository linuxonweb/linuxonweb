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

## Iteration 3 — strict cache composition and rejected input (42/100)

- Strict cache/extras identity tests passed at 14:16:05 UTC in 3.256 s; reserved-path aliases and raw/gzip identity mismatches fail closed. Candidate composition started 14:16:08.694 UTC, completed in 37.024 s. Native Firefox unchanged; final extras raw SHA pinned. Candidate remains isolated and unaccepted.
- First upgrade owner ran 14:20:11.944–14:21:34.443 UTC (82.499 s). Native content paint observed at 52.307 s, focus 53.888 s. Exact physical input failed: visible `readinessevidencce` contained an extra c. Gate correctly rejected; no 30-second, cache-activation, or speed claim. Host KeyC hold was 22.024 ms. Failure screenshot retained.
- Owner ended with zero owned children; exception used Browser.close, so this is not a clean native Close/warm profile acceptance. Next harness captures failure I/O and input, records inner key events in a newly hashed fixture, and uses explicitly controlled per-character acknowledgments for isolation. The normal-speed duplicate-input defect remains open.
- Shared rubywebterm transport returned internal -32603 approximately 14:22–14:26 UTC. A single read-only probe owner recovered retained output and verified dead unit/no children before handing heavy lane back to native package work. No permissions bypass or duplicate launch.
- Evidence: tools/startup-benchmark/evidence/continuation-20261103-1322/cache-first-upgrade/acceptance.json and failure.png. Score remains 42/100.

## Iteration 4 — real GNU ports published; score 43/100

Root accepted the exact signed GNU tar 1.35-r1, wget 1.25.0-r0, and findutils 4.10.0-r1 after 71 native behavior checks, default CA discovery/TLS rejection, signature verification, installation/removal, and live index readback. Packages increases 7/10 to 8/10; other categories unchanged, total 43/100. Node.js remains absent. Package persistence has passed an isolated five-boot native fixture, but actual production Stop/reload acceptance remains pending. See tools/guest-packages/evidence/gnu-publication-20261103-1322.json and persistence-native-fiveboot-20261103-1322.json.

Host-owned keyboard repeat is still opt-in. Two actual Firefox owners passed 12 input assertions each plus rapid exact nonce and distinct navigation. Original guest-repeat mode produced extra characters. Normal native Quit opened its observed confirmation; after confirming in the second owner, the window closed and profile shutdown continued, but exit0 was absent at the 20-second bound. This is a bounded slow-shutdown failure, not proof of permanent deadlock. Further host Stop and package regression tests are pending. Cache generation path activation is established, but same-generation startup/script-cache reuse is not accepted yet.

## Iteration 5 — host-owned repeat and production Stop (44/100)

Source promotion: normal production input now disables guest repeat generation and forwards actual browser repeat events; explicit `?input-repeat=guest` preserves the legacy diagnostic. Physical key state releases on blur, hidden document, composition, abort and Stop; virtual modifiers release before home settle and machine close. Two monitored native Firefox runs passed twelve keyboard assertions and rapid exact typing with completed visible navigation. The second final screenshot was independently reviewed. They are input tests, not startup timings.

`pkgprod-save1` ran 2026-11-03T15:04:09.626Z–15:06:34.176Z (144.549 s), through the actual production desktop and native terminal. Signed gzip/tar installation, exact world/hash references and native package-save acknowledgment passed. Normal Stop followed the acknowledgment by 88.631 ms and reached the pre-confirmation input-release check in 677.316 ms; idle was observed only after the subsequent seven-second wait; held Shift was released and the input queue was empty. Errors and remaining owned processes were empty. Source regression tests passed at 15:15:27.156Z in 1.754 s. Root approved desktop 6/15→7/15 and total 43→44 after promotion.

Package persistence still requires fresh production restart and interactive failure recovery. Native Quit after confirmation exceeded the original 20 s observation while real home writes continued; this is retained as a failed bound, not evidence of deadlock or cache reuse. A recovery-console watcher and delayed desktop command-agent stdin claim are staged for real negative acceptance. See `tools/startup-benchmark/evidence/continuation-20261103-1322/input-and-package-stop/acceptance.json`.

## Iteration 6 — production package replay and recovery routes (44/100)

`pkgprod-verify1`: 15:16:01.331–15:18:08.958 UTC, 127.627 s, passed exact signed generation/world/binary hashes/user data, default input and normal Stop. Native replay took 1.114 s before X. Recovery remains pending. `pkgprod-corrupt1`: 15:22:45.591–15:24:58.727, 133.136 s, early terminal typing lost focus when Firefox opened; no acknowledgment, zero remaining owners. `pkgprod-corrupt2`: 15:25:56.555–15:26:23.254, 26.700 s, actual Start desktop WM selected the unchanged plain image; marker assertion failed before command, zero remaining owners. No helper publication. Heavy lane passed to Firefox for the declared matched JIT matrix; active runtime remains frozen. Evidence: continuation package-production directory. Connector outage about 15:29–15:31 delayed source notes and fixture observation; retained receipts confirmed the fixture passed once, without rerun.

## Iteration 7 — failed JIT baseline and guarded rollback (44/100)

The first method-threshold baseline was slower than prior APK4 and did not complete a matched scene sample. Absolute WM readiness changed18.041→36.575s; first scene loop80.320→146.537s. No causal sleep-spawn count was captured. The newly added pre-X shell wait repeatedly spawned sleep processes and is rolled back as an unaccepted contention risk. Existing native wait-for-aurora cannot replace it unchanged because timeout returns0. Recovery-safe event activation and actual GUI recovery remain pending; helper image stays unpublished. The full threshold experiment is incomplete and will not combine runtime variants.

Stop timing correction: #power-stop opens a dialog and #stop-yes starts stopGuest. For pkgprod-save1,88.631ms measured dialog request and677.316ms measured immediately before confirmation, not idle. Idle was checked after a later7s wait. Save/restart durability and exactdata acceptance stand; earliest idle timing is unmeasured.
