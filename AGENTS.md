# Resumed work — 2026-09-28 (Claude Opus 5.5 session)

The user explicitly resumed the goal: guest GPU in Linux-wasm, Vulkan usable by
ordinary guest apps, Firefox GPU and JIT, then OpenGL via Vulkan (Zink).
Branch: `claude-opus-5-5-guest-gpu-jit` (from `8ba982e`). The Codex-era weekly
quota stop below is superseded for this work: if the 5-hour usage window runs
out, pause and resume after it resets. Subagents use Opus 5.5; size each
packet to finish in about 20 minutes (user, 2026-09-30) and chain packets. Storage policy below still applies to every packet.

Current packets (update as they finish):
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

User priority (2026-09-30, supersedes 09-29): guest Vulkan usable by Firefox and
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
- Running: B2e BGRA8 + max texture size -> eglprobe GL strings/clear pixels
  (`/mnt/p6/build/zink-b2e-20260930`, ports 4207/9417). Next: B2c push constants
  (first draw), B2b blocking waits, then relink F1a and gate WebGL/WebGL2.

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
