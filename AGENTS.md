# Current work and handoff — 2026-09-26

Read `Agents.md` for the existing project instructions and historical build notes.
The current user's instructions take precedence. Preserve all source clones,
known-good build trees, and unrelated untracked files. Never stage the whole
workspace indiscriminately.

## Mandatory build storage policy

User instruction: put build work under `/mnt/p6/build` or another persistent,
disk-backed filesystem. Never use `/tmp`, `/dev/shm`, or any `tmpfs`/`ramfs`
filesystem for build inputs, intermediates, outputs, extracted rootfs trees,
compiler scratch space, build caches, disassembly dumps, build logs, or test
artifacts.

This applies to temporary build files as well as final outputs; a tool's default
temporary directory is not an exception.

- Prefer a task-specific directory under `/mnt/p6/build`, including a `tmp`
  subdirectory for tool scratch files. Another disk-backed project/cache
  directory is acceptable; verify its filesystem and free capacity first.
- Set and export `TMPDIR`, `TMP`, and `TEMP` to that disk-backed scratch
  directory before every build, packaging or artifact-producing test command
  so subprocesses and `mktemp` inherit it. Set tool-specific temporary, build,
  and cache directories as needed; do not assume every tool honors these
  variables. Never fall back to `/tmp`; stop if compliant storage is unavailable.
- Keep large command output and debug dumps in files under the same disk-backed
  task directory. Do not let default temporary paths fill a memory filesystem.
- Apply this policy to all delegated agents. Do not change the system-wide
  temporary directory or move unrelated runtime sockets, protected system
  temporary files, or active user browser profiles.

Forty-five earlier Firefox build/debug artifacts were relocated from `/tmp` to
`/mnt/p6/build/linuxonweb-tmp-20260926/`, freeing about 17.35 GB. The migration
manifest there records the moves and metadata checks. Existing `/build`
contents must remain unchanged.

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
  Dynamic loading, external layers, generic unknown-function trampolines, shaders,
  general GPU buffers, GL and Firefox integration remain absent. The four current
  guest runs use SwiftShader, actual 1 GiB/two CPUs and visible isolated pages.
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

## Services and deployment

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

The public Site is `https://linuxonweb.exact-coot-7512.chatgpt.site` with exact
project ID `appgprj_6ab78cc88a948191a1abaabd04b81fe0`. Version 6 serves the
accepted static runtime through Sites assets; the unchanged Cloudflare worker
at `https://linuxonweb.testcatty.workers.dev` remains its DNS/TCP network proxy.
Cloudflare itself was not redeployed because its API token was unavailable.
Sites source is `8757a6ff2f8f0a312e7a616bb900521234395757`, deployment
`appgdep_6ab7fe800a4c8191b1f5a0ee942cd66c`, version ID
`appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_dab4dcf397488191a274dec22cdfba71`.
The accepted archive has 63 files and 151,726,080 content bytes; preserve the
`dist/server/index.js` and `dist/client` archive paths. The separate release record is
`docs/evidence/runtime-graphics-20260926/sites-release.json`.
Top-level Cloudflare release metadata and sourceFiles still describe the older,
unchanged Cloudflare deployment; do not replace them with Sites hashes. Preserve the
public audience. Read `web/sites/.openai/hosting.json` and its README; push the
exact nested-repository source commit before saving/deploying a Sites version.
Never print or persist source-repository write tokens.

The requested weekly usage percentage is not exposed by available tools. Do
not claim a measured allowance or a 95/100 overall result while the requested
guest JIT/GPU capabilities and release gates remain unresolved.

## Next continuation

The overall goal remains active and is assessed at about 80/100, not the requested
95/100. The delivered startup/storage work and isolated GPU proof do not supply
native Firefox JIT, a generally usable Vulkan/OpenGL driver, or hardware video decoding.
The user has been asked asynchronously for the remaining weekly allowance;
that answer is pending. At the start of the loader continuation, goal
accounting reported 6,141,978 tokens with no token budget; this does not reveal weekly quota or
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
  The next bounded startup experiment can remove the forced Bing CLI homepage
  from `launch_firefox` while preserving profile preferences, then compare input
  stability and startup. The current packed init supplies that URL even with a
  persistent profile; its relationship to the retained typed-navigation failures
  is unproven. Public warm 17.400 s remains above local candidate 8.403 s.
  Preserve the accepted release until any new isolated candidate passes actual
  Firefox usability, warm-cache and update/home gates. Explicitly override test
  output paths that still default to `/tmp`.
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
  The partial COMPUTE|TRANSFER profile still lacks dispatch and conformance;
  it is not a generally usable Vulkan or Zink device.
  Next shader gate: audit the archived Naga 0.20 SPIR-V-input/WGSL-output dependency
  closure, then implement real shader translation, storage GPU buffers, compute
  pipeline/descriptor binding, dispatch and buffer readback. A separate public
  Vulkan client should submit two real SPIR-V programs and verify both outputs for
  64 integers plus sentinels, rejection and cleanup. Do not substitute recognition
  of fixed shader bytes for translation. The integration report records the
  archived wgpu revision and missing dependencies; no translator build has run.
  The earlier Dawn ABI gate remains compile-only; native Dawn, the translator,
  general system discovery, shaders, GL-through-Vulkan and Firefox are unported.
- Keep native JIT and Vulkan capability claims gated on actual guest execution;
  portable baseline interpretation and host Wasm compilation are not guest JIT.

All continuation work must retain the current delegated workflow, fresh sessions
for new agents, scoped Git staging and sole serving-agent ownership. The serving
owner may continue its assigned test task across follow-up instructions.
Earlier work reused existing sessions after fresh-session creation hit the thread
limit. There are no active task-owned services to reuse; preserve the user's
pre-existing server.
