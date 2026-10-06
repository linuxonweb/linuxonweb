# Project instructions

The user resumed the goal on 2026-10-05 UTC and added Firefox restart-tab and
Bing HTTPS repairs. Read `continue.md` for prior evidence; its pause note is
historical. Keep requested persistent preview/proxy services running.

## Goal and order
- Make current Firefox Nightly launch and verify real JavaScript JIT.
- After JIT passes, redeploy to the existing ChatGPT Sites project.
- Then build general Linux Vulkan/OpenGL support through shared host Rust wgpu,
  validate standalone and concurrent apps, then Firefox WebRender/WebGL/WebGPU
  and deploy again. Do not describe prepared code as working JIT/GPU.
- Use musl, release builds without debug information, and the original optimizer.
- Preserve user home, clipboard, settings and existing application layout.

## Agent workflow
- Use the same model and thinking level as the main agent.
- Use Astra only for planning, advice and information; do not assign it
  implementation, commands, testing or deployment tasks.
- Delegate planning, implementation, commands, testing and deployment; keep
  fewer than three task agents active at once and avoid duplicate jobs.
- Start fresh agents with `fork_turns: "none"`; provide necessary context,
  ownership, scope, goal and required results, not the entire conversation.
- Agents report commands, important evidence, failures and remaining limits.
- If platform thread limits reject delegation, continue necessary work and
  report the constraint. Never invent agent or test results.
- Current user instructions override historical plans and pause notes.
- Honor explicit user budget/pause requests; do not invent usage measurements.

## Storage and process ownership
- Default build/test artifacts to `/mnt/p6/build/<task>`; another location must
  be verified persistent, disk-backed and spacious, including symlink targets.
- Never put builds, browser profiles, caches, logs or scratch in `/tmp`,
  `/dev/shm`, tmpfs or ramfs. `/tmp` is a 4 GB tmpfs for ordinary system use.
- Before build/test/browser/server jobs, export TMPDIR, TMP and TEMP to a short,
  task-owned disk scratch path; configure tool caches and child processes too.
- Keep browser scratch paths short enough for Linux Unix socket path limits.
- Keep large output in disk files; do not print full binaries/base64 or secrets.
- Launch finite jobs with explicit time, memory and disk bounds. Only the owner
  polls/reaps its handles. Verify exact owned PID/group identity before cleanup.
- Preserve unrelated processes, active user profiles, builds, sockets and files.
- Do not delete artifacts or commit unrelated changes; record safe relocations.

## Validation and release
- Set guest CPUs to the effective host quota and verify host/browser/guest
  equality. The recent effective count was 6; measure again for each test.
- Run meaningful checks appropriate to the change; preserve failed evidence.
- Keep ordinary startup, disabled/enabled JIT, NSS/TLS, performance and GPU
  acceptance distinct. Static checks and mocks cannot establish runtime success.
- Use actual same-binary native JIT evidence and original workloads/deadlines.
- Test simple Vulkan through genuine Rust wgpu before Firefox GPU. That gate
  passed; it is not Firefox GPU acceptance. Prefer WebGPU, with genuine wgpu
  WebGL fallback where supported. Show actual backend/fallback identity.
- Build shared Vulkan/OpenGL support for Linux applications; Firefox is one
  client. Keep host wgpu services general and advertise only supported features.
- Report unknown JIT or hardware codec use as Unknown when APIs cannot prove it.
- Package CA-only NSS seeds; never ship diagnostic/private-key profile seeds.
- Follow Sites hosting instructions for deployment and retain the rollback.
- Keep dev HTTP at http://localhost:3000/linux/index.html?firefox=1.
- Preserve the old port 8001 preview, user proxies and cloudflared services.
- Keep dev serving the latest reviewed package, labelled honestly as testing
  until runtime acceptance passes. Updates require an in-page user choice.

## Current continuation pointers
- Firefox Nightly 159.0a1, build 20261004075010, starts; full JIT acceptance is pending.
  Public Sites v10 has not been replaced by this candidate.
- Original broad JIT checks passed with zero diagnostic worker attachment;
  earlier intermittent stalls remain unexplained. Disabled original mutation
  passes. Four enabled native guard supplements and their disabled control now
  pass on the diagnostic candidate, but current broad enabled JIT timed out;
  full JIT, TLS, performance and release remain pending. Fresh ordinary
  cold/warm startup passes, including preserved home/download and warm caching.
- Broad/mutation evidence: `/mnt/p6/build/fji1/`, `/mnt/p6/build/fji2/`,
  `/mnt/p6/build/fjm1/`, and `/mnt/p6/build/jgd4/` through `jgd14/`.
  Current enabled broad timed out; disabled broad passed.
- TLS run2 `/mnt/p6/build/fst1/` is terminal: ordinary readiness passed,
  NSS results timed out; Browser Console module execution is unconfirmed.
  No authentication cases were verified; owned processes drained naturally.
  Read its terminal receipt; do not label this a proven NSS library failure.
- TLS AutoConfig run3 showed Firefox UI but no parent READY; zero certificate
  cases. Current-archive wrapper and offline admission manifests are under
  `/mnt/p6/build/tls-wrapper-rebind-20261005/`; runtime remains pending.
- Headless Chromium gets a one-CPU quota. The user explicitly authorized headed
  JIT execution without another confirmation on 2026-10-05. Preserve that choice.
  Fresh host inspection found eight effective CPUs
  on 2026-10-05; remeasure at runtime. The old FJI5 owner hardcodes six and
  cannot be admitted at eight. `/mnt/p6/build/fji5/` has 123 pins and 28
  owner controls. `/mnt/p6/build/fji8/` repairs historical owner admission;
  27 new and 21 inherited offline controls pass. JIT runtime admission is false.
- `/mnt/p6/build/fji6/` directly compares the current dev and diagnostic
  archives: only `init` and two AutoConfig files differ. `/mnt/p6/build/fji7/`
  analyzes the acquisition gap; 17 offline controls pass. Same-binary parity
  does not establish ordinary-startup native JIT or release acceptance.
- `/mnt/p6/build/fji9/` and `/mnt/p6/build/fji10/` prepare ordinary-startup
  raw console capture. Its byte integrity passes offline checks, but the shared
  console cannot prove native writer identity or replace direct stderr for the
  original privileged scopes. Neither path is admitted for runtime.
- `/mnt/p6/build/fji11/` prepares test-only changed-init direct stderr capture
  without AutoConfig; 47 corrected offline controls pass. Runtime admission,
  native JIT and unchanged ordinary-startup acceptance remain pending.
- `/mnt/p6/build/fji12/` prepares nonce-bound Browser Console entry and
  ordinary quit; `/mnt/p6/build/fji14/` checks post-exec parent/FD identity.
  Offline controls pass; live console focus, owner integration and JIT remain pending.
- FJI14's `/proc` probe used `IOUtils.readUTF8` and is invalid for zero-size
  proc files; `/mnt/p6/build/fji18/` has the corrected bounded-byte probe.
  Rebind FJI12 explicitly to FJI18 before any runtime admission.
- `/mnt/p6/build/fji17/owner-contract-v2.json` binds FJI11, FJI12 with the
  corrected FJI18 probe, frozen routes and both original 50-case sessions.
  It is an offline contract; no live owner or runtime admission exists.
- `/mnt/p6/build/fji19/stage-plan-v2.json` verifies 202 pinned inputs and
  maps 63 guest files per JIT arm. It remains offline; six-CPU source sessions
  require fresh measured CPU rebind and a new live owner before testing.
- `/mnt/p6/build/fji20/bundle-run1/` is an offline CPU rebind example: its
  process measured six effective CPUs while webterm measured eight. Remeasure
  inside the actual owner cgroup; neither count is reusable admission.
- `/mnt/p6/build/fji22/` prepares a dynamic-CPU headed owner for the older
  diagnostic AutoConfig JIT path; its bundle is nonadmitted and no runtime ran.
  It is nearer a diagnostic test but cannot prove ordinary startup/current UI.
- `/mnt/p6/build/fji24/` rebinds that diagnostic path to FJI23's passive
  recorder. Headed diagnostic live7 is terminal: all 50 original broad/native
  subset predicates pass independently, but the full session timed out during
  interrupt recovery. Six-CPU equality and cleanup pass. Evidence/reviews are in
  `/mnt/p6/build/headed-jit-root-oct05/`; full JIT acceptance remains pending.
- `/mnt/p6/build/fji25/` headed live1 is terminal: main-thread cases completed,
  but content identity query timed out before Worker completion. Six-CPU equality
  and natural cleanup pass; disabling host GPU did not establish full JIT.
- FJI26 tracing completed all 50 broad/native subset checks but reached the
  original deadline at interrupt entry. FJI27 with the read-only observer passed
  all 50 broad cases, four privileged scopes and 11 interrupt recoveries with
  six matched CPUs. Owner is reaped; diagnostic acceptance only, not full JIT.
  Receipt: `/mnt/p6/build/headed-jit-root-oct05/fji27-live1-terminal-summary.json`.
  Storage old-fail/new-pass evidence: `/mnt/p6/build/home-observer-oct05/`.
  Observers must use `openPersistentHome({readOnly:true})` during guest execution.
- User authorized a current testing Sites publication before full acceptance.
  `/mnt/p6/build/sites-testing-release-oct05/` has the verified package and pushed
  source014359df8ab2858eec0a57c55c65da3cd4546c99. Twenty-three native archive uploads
  timed out after300000–300002ms through user-requested retry23. No saved
  version/deployment was returned; get_site confirms public v10 remains live.
  Read publication-result.json and publication-retry23.json; preserve rollback
  and testing labels.
- `/mnt/p6/build/current-jit-owner-oct05/bundle-run2/` adds profile prefs and
  active label to the ordinary-init staging map; no live owner or JIT run yet.
- `/mnt/p6/build/current-owner-transport-oct05/` gates ordinary-init Console
  entry and permit offline; actual CDP, visual and parent/native checks remain.
- `/mnt/p6/build/current-live-owner-astra-oct05/` adds bounded owned-CDP and
  FJI11 capture/receipt joins; no live owner or admission exists yet.
- `/mnt/p6/build/current-owner-assembly-astra-oct05/` joins current JIT inputs,
  CPU/resource guards and per-file home install offline; runtime launch is blocked.
- `/mnt/p6/build/current-owner-launcher-oct05/` pins private display/server/browser
  plans; offline controls pass, but live lifecycle and native capture remain open.
- `/mnt/p6/build/complete-jit-owner-astra-oct05/` implements the current JIT owner;
  root seal review/preflight pass. Root executes the repaired separate copy at
  `/mnt/p6/build/complete-jit-owner-main-oct05/` because delegation hit thread limits.
  Actual headed launches and Firefox/Browser Console UI observations exist;
  runs9–10 are terminal: both natural cleanups pass with six matched CPUs, but
  Console acquisition exceeded150s before suite release. Run10 exposed typing
  into the address bar before Console focus. Read main-runs9-10-terminal-review.json
  under `/mnt/p6/build/headed-jit-root-oct05/`; the next focus retry and shorter
  file bootstrap were tested in run11: exact Console sentinel passed, but the
  entry ACK never appeared before150s; no suite ran. Run12 expired during UI
  review. Run13 proved bootstrap/parent joins but failed on a DOM-only global
  import; run14 proved those joins with56.88s left but failed on an unbound
  Window timer. Run14 required owned termination; final groups empty/endpoints
  gone. Read main-runs12-14-terminal-review.json. Timer.sys.mjs transport repair
  is sealed at73d0012; run15 is terminal/reaped. Original checker passes all50
  ordinary broad/native rows,1137events,6matched CPUs. First privileged scope
  failed its inactive-GC precondition before forceGC; full session unaccepted.
  Read main-run15-terminal-summary.json and main-run15-broad-subset-review.json.
  Run16 is terminal/reaped:50 broad rows plus gc-debug-coverage and incremental
  raw subsets pass;150s expires in slice-gc preparation, before interrupt scope.
  Read main-run16-terminal-summary.json and both subset reviews. Next prepared
  source56944f3 shortens typed loader by importing Timer inside its callback.
  Run17 is terminal/reaped: owner received
  SIGTERM after110.86s; sender unknown, no suite entry. Owned groups are empty.
  Actual root image approval arrived after termination and was unused.
  Run18 failed before runtime on an external launcher file-limit error; reaped.
  Run19 is terminal/reaped: all50 broad/native and three privileged raw scopes
  pass, interrupt incomplete. Transport works, but full session/capture fails.
  Launcher added an extra240CPU-second cap; detachment cause Unknown. Owned
  groups empty/display gone after forced cleanup. Read main-run19 receipts.
  Run20 sent the Console shortcut before Firefox mapped; no suite entry.
  Run21 added an actual window gate, then passed29/50 broad rows before150s;
  permit left28.25s. Actual image review waits consumed67.77s.
  Run22 root handle54460 is reaped: image review timed out, zero suite entry.
  Late actual Console approval was rejected; browser exited0, groups empty.
  Source df071f1 adds10s/18s measured pacing with both actual image gates;
  it is preparation only. Read main-run21/22 terminal receipts.
  Run23 is terminal/reaped: actual delegated image review consumed75.76s,
  permit left3.67s; no broad rows completed. Run24 used native --jsconsole
  on the same binary:28/50 original broad rows and650 native events, but
  root image review consumed80.17s and permit left14.69s. Original deadline
  expired; full JIT remains unaccepted. Read main-run23/24 terminal receipts.
  Test-only startup package is `/mnt/p6/build/jsconsole-startup-oct05/`;
  independent12909-record comparison found only init's --jsconsole addition.
  This proves acquisition on that test path, not unmodified ordinary startup.
  Run25 accidentally launched Chromium as root and failed before guest startup;
  run26 then hit that retained root-owned directory during disk walking. Both
  are reaped; run25 was safely relocated. Launch browser owners as user a.
  Run27 is terminal/reaped: first image showed mapped Firefox/Console, but
  focus was unconfirmed; no nonce/Enter/suite ran. Browser exited0,6 matched
  CPUs, groups/display gone. Read main-run25/26/27 terminal receipts.
  Prepared focus repair64647e1, seal11e63cf641693fb0a71007e673b7c0a2aea98e34237bfbc86be37e633eaef473,
  allows a physical click only at an actual image reviewer's visible Console
  input point; whole-nonce/focus image still precedes code Enter.83 offline
  controls pass; no runtime acceptance. Fresh agent/reuse hit thread limits.
  Nonadmitted run28 helpers exist under headed-jit-root-oct05; obtain fresh
  inventory/admission and prompt actual image review before launching.
  Runs7/8/9/10/12/13/15/16/17/19/20/22/23/24/25/27 moved with preserved path symlinks
  and relocation receipts at `/mnt/p6/build/ordinary-console-history-oct05/`.
  Review task disk bounds before another run.
- Restored-tab one-CPU run9 passed navigation, JavaScript, close and preserved
  home; `/mnt/p6/build/restart-tab-acceptance-20261005/`. No JIT/TLS claim.
- Newer headed runs28–33 supersede the prepared run28 note above. Run30 verified
  actual physical Console click/full nonce;37 broad rows before deadline. Run31
  lost routing after input moved; no suite. Run32 passed nonce but failed ACK
  JSON before permit; failed bytes were not retained, exact cause Unknown.
  Run33 is terminal/reaped: all50 broad/native rows,1143 native events and
  gc-debug-coverage/incremental raw subsets pass; deadline expires at slice-GC
  preparation. Full session and unchanged ordinary-startup acceptance pending.
  Source c57900ae3c453fc1282e0fa34b23b4311ac645f9,51-pin seal
  08819e4848c19d06faec8330b0a871a006ba063f7a8a4af5a70083296180b4b2
  waits for nonempty entry files and retains bounded raw pairs before parsing.
  Nonempty malformed ACKs still fail;13 publication/127 focus controls pass.
  Empty-file publication was not observed in run33, so run32 cause stays Unknown.
  Read main-run33 terminal/broad/privileged reviews under headed-jit-root-oct05.
  Six actual CPUs match; exact owned groups/endpoints gone, protected services
  preserved. All source/run evidence retained; no root runtime handle is live.
- Headed run35 is terminal/reaped: all50 broad/native rows,1137 native
  events pass; no privileged scope identity arrived before the original deadline.
  Source c314b4919702617013f3d393996ca34ddc197cb5,51-pin seal
  5f131ea061458e6e368993f67a89256d372ea76c7f17aa30d9d57813e052e81c.
  Immediate image delivery took about20ms; actual root reviews37.928s gave
  no timing gain over run34. Permit left39.507s; full session incomplete.
  Six CPUs match; owned groups/endpoints gone, protected services preserved.
  Run35 audits under headed-jit-root-oct05. Runs34/35 safely relocated with
  preserved path symlinks/hashes. No root browser runtime is live.
  Full JIT remains pending; X11 map observer advice is preparation only.
- Latest headed run38 is terminal/reaped:50/50 broad rows and1152 native events,
  gc-debug-coverage passes; incremental is incomplete, other scopes absent.
  Failed raw capture is timestamped at150.001s; owner later stopped on its free
  disk reserve. Producer.json is missing/Unknown; disk repair alone proves no pass.
  Full JIT remains unaccepted. Six CPUs matched; exact groups/endpoints gone,
  protected services preserved. Read main-run38 terminal/broad/privileged audits
  under `/mnt/p6/build/headed-jit-root-oct05/`.
  File helper now opens/writes its private guest receipt and X display; timeout
  exit3 replaces run37's stdout EACCES. Window matching/timing cause Unknown;
  map fallback still20s, actual reviews29.557s, permit left47.719s.
  Canonical package6f0f0f4 has538 verified pins; owner8ba86a3 seal eaaf2d15 has63.
  Source reviews and host controls pass; these do not establish runtime acceptance.
  File receipts schedule screenshots; they approve no focus/native/JIT acceptance.
  Terminal runs38/14/21/4/11 moved to verified persistent p3 with original links;
  all byte/stat/xattr/hardlink checks pass. Recovery receipt is under
  `/mnt/p6/build/terminal-relocation-recovery-oct05/`. About2.17GB reserve margin
  remained at review; remeasure before any launch. Original20GiB reserve unchanged.
  New scan-diagnostic helper490e2c2 passes146 host controls and release ABI checks;
  packagebda5e755 has561 independently verified canonical pins, helper-only delta.
  Artifacts: `/mnt/p3/codex-build/linuxonweb/x11-console-scan-diagnostics-oct05/`.
  Guest use is pending. Operation snapshots may be transitional; no blocked-call
  identity or JIT acceptance follows from them. Finish new owner seal before admission.
- Headed run39 is terminal/reaped:32/50 original broad rows and963 native events;
  original150s expired, no privileged identity, full JIT remains pending. Actual
  image decisions consumed59.787s; nonce/parent permit left18.703s. Six CPUs
  matched; cleanup and protected services pass. Producer.json retains the timeout.
  Owner edd17f2,63-pin seal877399f5; root package closure and run39 terminal,
  broad and privileged audits are under `/mnt/p6/build/headed-jit-root-oct05/`.
  Scan helper completed78 scans before its25s timeout; blocking-call cause Unknown.
  Opt-in native-ack acquisition is now implemented; see run40 below.
- Headed run40 is terminal/reaped:50/50 original broad rows and1182 native events,
  three privileged GC scopes pass; interrupt has3 completed recoveries and is
  incomplete at original150s. Full session/JIT remain unaccepted. Acquisition
  used64.621s, permit left85.379s, with no claimed image approval. Six CPUs
  matched; cleanup and all nine protected services pass. Owner77f724c,65-pin
  seal86b280c5 preserves defaults/native sources/workloads;135 legacy image,
  13 publication,36 native-acquisition and5 staging controls pass offline.
  Read main-run40 terminal/broad/privileged/acquisition-timing reviews under
  headed-jit-root-oct05. Native bootstrap requires actual nonce/PID/start/FD
  acknowledgement review before permit. Initial image33.694s was desktop-only;
  a partial loader image59.754s cannot prove whole-loader input or focus.
  Run41 tested that hint; see the newer terminal result below.
- Headed run41 is terminal/reaped1: the DevTools hint arrived in11.970s,
  but46.062s image showed desktop only and51.553s input image showed bootstrap
  text in Firefox's address bar. No native ACK/permit,0 broad/native events;
  full JIT remains pending. Actual six-CPU equality, exact empty groups/endpoints
  and all nine protected services pass. Read main-run41 root audits.
  Early hint scheduling is disabled; predecessor252ce3d,67-pin sealb409a4e9
  restores the prior runner and recognizes two exact process Console titles.
  Actual47map/135window/13publication/36native controls pass;5stage reused after
  unchanged-source verification. These are offline proofs, not current runtime.
  Isolated helper title/diagnostic repair is under
  `/mnt/p6/build/console-title-repair-oct06/`; sealed commit d4ec8a7.
  Independent offline review verifies 258 pins,148 aliases,171 host checks and
  fresh musl/ABI build. Package307f626 now closes330 canonical pins; independent
  review verifies299 direct pins,2728 nested references; current leaf evidence verifies444 aliases. Owner
  adc1f2b has68-pin seal7550b486 and passing offline rebind controls. Root owner
  admission closed offline and headed run42 is terminal/reaped:50 broad rows,
  1079 native events and three GC scopes pass; interrupt has3 recoveries and
  remains incomplete at150s. Acquisition63.767s; full JIT remains unaccepted.
  Six CPUs, exact cleanup and nine protected services pass. Read main-run42
  terminal/subset/timing receipts under headed-jit-root-oct05. Helper timed out
  after75 scans; actual X identity and timeout cause remain Unknown.
  Case-sensitive plausible-window filtering was diagnostic only; actual class
  matching already folded case. Known historical process titles were rejected
  by old title matching; actual current guest title/cause is still Unknown.
- Root visually confirmed Bing rendered in run9; review at `/mnt/p6/build/`
  `root-launcher-review-oct05/`. Firefox certificate/TLS acceptance remains pending.
- Frozen test UI: `/mnt/p6/project/build/nightly-full-jit-startup-20261004/`
  `frozen-four-web-assets-20261004/`. Do not mutate in-flight test inputs;
  rebase routes to exact frozen bytes before adopting production UI changes.
- Persistent dev owner/status: `/mnt/p6/project/build/`
  `nightly159-dev-preview-run60-20261005/ownership.json`.
- Dev testing archive review: `/mnt/p6/build/browser-bugs-20261005/transform/`
  `root-startup-tab-testing-package-review.json`; JIT/TLS/GPU remain unverified.
- Earlier independently reviewed atomic package: `/mnt/p6/build/`
  `firefox-atomic-observer-package-20261004/transform/`; static archive/ABI
  checks and ordinary startup pass. Full JIT/TLS/performance remain pending.
  Do not reuse old runtime acceptance for this atomic-observer candidate.
- History from the former AGENTS.md and Agents.md is preserved in `diary.md`.
- Write important progress, information, mistakes and experiences in `diary.md`.
  AGENTS.md may contain at most 1,000 lines of text. Keep progress logs in
  `diary.md` so project instructions remain easy to find.

- Deferred Console source is sealed at `/mnt/p6/build/deferred-console-host-trigger-oct06/`.
  Deferred package20015f13e has root corrected selected29 closure; actual444
  aliases supersede old aggregate450. Root review is `/mnt/p6/build/`
  `deferred-package-root-closure-oct06/closure-review.json`. Owner integration
  is sealed at78ab3d63,483-pin seal1e7f4024; independent94-check admission passes.
  Run43 failed on accidental root Chromium launch before guest startup and was
  safely relocated. Run44 usera launch is terminal/reaped:50 broad/native rows,
  1113 observer events and gc-debug-coverage pass; other scope identities absent.
  Producer failed on retention cap/path; full JIT remains unaccepted. Six CPUs,
  exact cleanup and protected services pass. Read main-run44 audits and diary.md.

- Latest user two-cycle limit is exhausted: headed45/46 both terminal/reaped
  before JIT acceptance. Stop repair/runtime work until the user resumes.
  Current isolated owner ed93a665b4b,547-pin seal9cbaaf1c has prepared GC
  readiness, failed-scope capture and actual Console focus review changes;
  no live acceptance follows. Read the latest top section of continue.md
  and main-run45/46 terminal receipts under headed-jit-root-oct05.
