# Guarded preparation follow-up — 2026-11-10, 45/100

Closed independently identified input-closure and helper receipt-binding gaps without native compilation or monitor changes. A new fixed reviewed closure authenticates1,796 regular files/five consumed trees before mutation; copied/parsed bytes are cached and exact source-before/absence pins apply.77 focused checks passed under the unchanged owner in34.008s. Final fresh source4 checkout45.262s and final preparation4 replay9.254s passed; independent review checked all ten source outputs and final recipe/modules. Old packet3a, source/build2 and intermediate3 plus capture/test failures remain preserved. Native/fullJIT/guest/performance acceptance staysfalse and overall45/100.

Exact evidence, timings, original recipe history and resume sequence are in docs/firefox-jit-integration-20261110.md and its input-closure-validation.json. The closure intentionally pins libc++ absent; a future successful dependency build requires a newly reviewed complete closure and fresh preparation. The external stable compiler scope remains required. The separately archived/refactored array candidate remains unexecuted and requires a new complete packet; do not substitute its hash into packet3a.

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


## Iteration8 — shared-cap correction and actual GUI recovery (44/100 provisional)

At about16:07, retained pkgprod-corrupt3 samples showed Chromium descendants in an unlimited user application scope despite the owner remaining under a3CPU ancestor. All prior claims of whole-browser ancestor verification are qualified, not retrospectively repaired; score44 is provisional, accepted reference42. Scoped D-Bus isolation plus common-ancestor/member-stability fail-closed guards passed quota-check1 (16:14:32.067–16:14:59.262,27.195s), then actual recovery below. The separate package guard now checks descendants created by any native thread and has14 focused tests; representatives are being rerun.

The safe event hook replaces the rejected pre-X shell polling experiment: exact helper init recovery block and one verified anchor start the command agent only after successful restore, with metadata-aware unknown layouts rejected. Source fixtures passed3.263s and independent review. Normal Stop already reloads the document; no extra recovery-only disposal mutation was needed.

`pkg-negative-setup1` failed before mutation with a browser fixture syntax error (10.335s); setup2 stopped before Node because taskset option syntax was wrong (62ms service). Corrected setup3 passed16:31:47.281–16:31:59.080,11.799s. It only changed one exact signed gzip archive in a fresh clone of the known-good closed profile; before/after hashes and durable close/reopen are recorded. `pkgprod-recover1` ran16:32:28.901–16:33:06.624,37.723s. Native checksum rejection, blocked desktop, visible focused console, actual typed disable and native acknowledgment passed. Actual Stop entered stopping and reloaded idle with recovery UI gone. Immediate CDP worker target count48/50 failed the new cleanup gate; actual liveness versus delayed target destruction is unresolved. Same-tab restart did not run. All27 samples shared cpulimit.slice cap3; owned cleanup0. A bounded metadata/destruction probe is next, not a product shutdown patch without evidence.

Midpoint source/encrypted cumulative backup:42.269s preparation,134.321s first upload with3 small HTTP409 conflicts,43.788s serial resume verified all14 server hashes,7.264s public metadata/index exact-hash readback. Original base/private recipient relationship preserved; candidate runtime images excluded. See midpoint-recovery.json for hashes and working link. No complete cloud redownload/decryption claim.

## Iteration 9 — capped native recovery, explicit graphics, and cold Firefox (44/100 confirmed)

Root confirmed44/100 after the proper common-cap GNU recheck and12 real native keyboard assertions. Packages:71 GNU checks +39 persistence positives +54 negatives =164 combined checks,128.292s, all owned descendants under one shared3CPU ancestor, cleanup0. Native graphics readback fixture ran16:41:30.741–16:42:52.554; native owner14.755s,1443 passes/4329 draws/1443 presentations,151 distinct first-frame colors, zero remaining resources. This is explicit WebGPU rendering with CPU/2D readback presentation, not fullAPI/conformance or a performance claim.

GUI recovery2 ran16:43:41.484–16:46:18.352,156.868s: checksum failure, visible focused native console, real typed disable, normal Stop,49 same-page workers destroyed within1.327s after idle, same-tab Start to normalWM. Native base/world/userdata confirmation in that Firefox restart was missed because of focus; no false completion. Separate plain production gate16:57:08.602–16:57:48.124,39.522s passed7 native assertions in a real Aurora terminal, normal Stop heldShift release and59 workers destroyed. This is explicitly cross-mode evidence; signed plain installation/replay and ordinary nonroot command resolution are still unaccepted. Earlier plain harness failures32.840/46.463s retained.

Final strict-cache fixture build17:18:07.128–17:19:41.182,94.055s: readiness image43.126s plus immutable-generation image49.739s. Two full image compositions/compressions explain the duration; no rebuild profiler was launched. Peak owned-treeRSS212606976B/PSS194086912B,94 CPU/RSS/RAM/quota samples,19 PSS samples, no quota failure or survivors. Earlier1.119s attempt aborted on observed enforced-cgroup membership transition; subsequent launch waited read-only for inherited enforced membership. No cgroup was moved.

Cold strict-cache native Firefox17:20:44.305–17:24:21.492,217.188s including bounded Quit attempt and cleanup. Production Start request17:20:50.243. First paint observed95.947s; exact rapid typing100.660s; distinct navigation104.807s; independently reviewed visible completion105.438s after Start,106.378s from page navigation.30s gate FAIL.12 native input assertions then passed106.362–114.499s. Native Quit fixture FAILED because the confirmation click happened before the dialog was visible: first screenshot has no dialog, final screenshot shows Quit Nightly pending. This is NOT a90s native shutdown failure. No warm run or cache reuse claim. Fresh-profile startupCache writes4144078B/scriptCache14246548B,0 cache reads. PSSpeak3029913600B/RSSsum3813457920B, minavailable25943597056B,209/42 resource/PSS samples, cleanup0. Strict cache remains off-default; full migration matrix unfinished.

Final release decision: approved exact Firefox persistence-image1, no cache lifecycle activation; retain old plain image. Mobile console promotion is conditional on the final actual-phone gate. No extra cache cycle fits responsibly before17:40 recovery capture.

## Iteration10 — accepted Android and exact runtime publication (45/100)

Final Android small-console two-boot gate finished17:35:33.716UTC,158.079s. Signed Python install30.773s; exact generation/world/Python+stdlib hashes, database, usermarker and restored imports passed. Offline native replay3.826s; both Stop worker counts0; only owned tab/forward removed. Six exact artifacts promoted and read back, unchanged worker/native image, score45 confirmed. Old failed attempts119.554/137.698s remain in the curated three-attempt receipt.

Exact Firefox1a3951f0c48d/4b20a717 image published17:38:11.309,2.004s. Earlier1.003s publication rejected missing construction-time passPackage before mutation. Separate adjudicated acceptance receipt cites completed exact tests/root approval and clearly excludes unrun targets; original candidate unchanged. Complete served image readback matched116265893B/4b20a717 and manifest9da17. Footer revisionefb8d0a9 matches200 metadata;13versions, unknown serverstart remainsnull. Old plain image retained, cacheLifecycle absent.

Runtime capture17:40:40.319–17:40:51.326,11.007s; full Python-O reconstruction17:41:19.238–17:41:23.240,4.002s passedallparts/fullFirefox/allmembers. Privacy45files/archive members against50knownprivatevalues passed. Provider upload17:41:52.798–17:48:44.930,412.132s,10/10serverhashes match,cleanup0. Runtime capturecommit339ebf7 is distinct from finalsourceHEAD; no runtime bytes changed aftercapture. Full encrypted decryption notperformed(publicrecipientonly).

## Iteration11 — actual HTTPS cold transfer failure (45/100)

FinalHTTPSowner17:50:36.779–17:53:17.295,160.516s,allobservedprocessessharecap3/cleanup0. Normalprivategrant authentication1.774s, actualbrowsermanifest9da17/version1a3951/footerrevisionefb8d0a9 passed. StartFirefox17:50:43.932. ActualWANdownloads were incomplete at150s: UI Firefox61.9/110.9MB, extras21.5/57.2MB, kernel6.0MBdone. These are rounded displayed response-body progress labels, not network wire-byte measurements. NativeVM didnotstart; noFirefoxinput/navigation, signedpackagecommands, ordinaryPATHaudit ornormalUIStop wasperformed. Theownerfailedbeforeitsnativepackagecommand predicate andcleanedallownedprocesses. No600srepeat, no50%/30s/fullprimaryHTTPSbootclaim. Existing production-loopback/native/Androidacceptedchecksretaintheirprecisescope.

The final matchednativebenchmark also endedincomplete83.253s aftera confirmed-exit samplingrace; noFPSaccepted. Themonitor nowexcludesonly exactvanished/reused/Z/X identitiesbeforeresourceintersection; unreadable/liveunknownremainsfatal.12focusedidentitycases+independentreviewpass. ThecorrectedguardranthroughactualHTTPSowner. Originalrubricweights verifiedatfrozen81103:desktop15/startup25/JIT15/graphics25/packages10/mobile5/preview5.
