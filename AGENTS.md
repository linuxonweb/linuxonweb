# Current work and handoff — 2026-09-26

Read `Agents.md` for the existing project instructions and historical build notes.
The current user's instructions take precedence. Preserve all source clones,
known-good build trees, and unrelated untracked files. Never stage the whole
workspace indiscriminately.

## Mandatory build storage policy

User instruction: put build work under `/mnt/p6/build` or another persistent,
disk-backed filesystem. Never use `/tmp`, `/dev/shm`, or any `tmpfs`/`ramfs`
filesystem for build inputs, intermediates, outputs, extracted rootfs trees,
compiler scratch space, disassembly dumps, build logs, or test artifacts.

- Prefer a task-specific directory under `/mnt/p6/build`, including a `tmp`
  subdirectory for tool scratch files. Another disk-backed project/cache
  directory is acceptable; verify its filesystem and free capacity first.
- Set and export `TMPDIR` to that disk-backed scratch directory before every
  build, packaging or artifact-producing test command so subprocesses and
  `mktemp` inherit it. Set tool-specific temporary/build directories as needed;
  do not assume every tool honors `TMPDIR`.
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
- The Aurora readiness helper was not promoted; existing packed startup remains.
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
  is now deployed: matched lean public console shell observations improve from
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

The public Site is `https://linuxonweb.exact-coot-7512.chatgpt.site` with exact
project ID `appgprj_6ab78cc88a948191a1abaabd04b81fe0`. Version 5 serves the
accepted static runtime through Sites assets; the unchanged Cloudflare worker
at `https://linuxonweb.testcatty.workers.dev` remains its DNS/TCP network proxy.
Cloudflare itself was not redeployed because its API token was unavailable.
Sites source is `b5858da1e8699215d6ef04cb24bd9111c501d3e4`, deployment
`appgdep_6ab7e07d39508191b9e9c5ee5390b4bd`, version ID
`appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_e476a0133e748191a46b03488991e15f`.
The accepted archive has 61 files and 151,470,080 content bytes; preserve the
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
native Firefox JIT, a guest Vulkan/OpenGL driver, or hardware video decoding.
The user has been asked asynchronously for the remaining weekly allowance;
that answer is pending. Goal accounting reported 3,280,535 tokens and 10,665
seconds, with no token budget, but these values do not reveal weekly quota or
establish whether the user's 15% allowance has been reached. Resolve this
constraint before another large backend port; do not invent a percentage.

Bounded next implementation gates, subject to that allowance:

- Guest-test `tools/guest-rootfs/wait-for-aurora.c` using the existing artifact
  `../.cache/runtime-graphics-20260926/wm-ready/wait-for-aurora.wasm` (SHA-256
  `2c54b0b87a88366086672b3e199f886863082951a54c34ef01c2dcc6a015a2c3`).
  Build/Wasm validation alone is insufficient: verify its one-second self-test,
  ten-second missing-display fallback, actual Aurora handshake and starting it
  before Aurora under an independent host watchdog. Only then replace the
  accepted packed init's single `sleep 10`, retaining the old sleep on missing
  helper/nonzero exit. Normal deadline expiry returns zero; do not sleep twice.
  Preserve all other CPIO records and accepted init/profile/certificate fixes;
  do not substitute the generic init script. Verify actual early Firefox window
  usability, matched startup timing, warm cache and update/home preservation.
  Explicitly override test output paths that still default to `/tmp`.
- The official Dawn typed proc-table/future/callback compilation gate is complete.
  A next GPU implementation needs an actual traced call inventory and typed
  transport with asynchronous lifetime/failure handling before linked guest
  clear/readback execution. The native-Dawn/translator closure remains unported;
  an ANGLE WebGPU experiment does not fulfill Vulkan or GL-through-Vulkan.
- Keep native JIT and Vulkan capability claims gated on actual guest execution;
  portable baseline interpretation and host Wasm compilation are not guest JIT.

All continuation work must retain the current delegated workflow, scoped Git
staging and sole serving-agent ownership. Existing agent sessions were reused
only after fresh-session creation hit the thread limit. There are no active
task-owned services to reuse; preserve the user's pre-existing server.
