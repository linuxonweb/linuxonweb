# Guest Vulkan on WebGPU by default: hostcall transport (H1, 2026-10-01)

User direction (2026-10-01): "prefer implement webgpu backend first as default,
let linux vulkan use webgpu, maybe need virtual gpu in linux wasm or choose a
better way".

Task directory: `/mnt/p6/build/vk-webgpu-hc-20261001` (ext4, disk-backed;
TMPDIR/TMP/TEMP under its `tmp`). Base `30fb55f` (P1).

## 1. Choice of "virtual GPU"

The guest ICD (`web/linux/tests/guest-vulkan/icd.c`) already translates Vulkan
into a small byte protocol. The host executor `serveGPU`
(`web/linux/tests/guest-gpu/host.mjs`) runs that protocol on WebGPU first and
falls back to WebGL2. Until now the protocol travelled over virtio-vsock
(port 4050). Every request crossed the guest kernel socket layer, the virtio
queue, the page and a JS stream, which costs several hundred microseconds per
round trip. The V2 profile found 93% of a vkgears frame waiting on host
replies.

Options considered:

- **A kernel virtual GPU (virtio-gpu / venus).** It needs a guest DRM driver,
  the Mesa venus or virgl userspace and a host renderer. It is the most
  "native", but much larger, and it still ends in WebGPU on the host. It adds a
  kernel hop instead of removing one.
- **three.js (user question).** Rejected. three.js is a scene graph with its
  own materials and render loop. It has no path for guest SPIR-V, explicit
  pipelines, descriptor sets, barriers or readback, and it adds per-frame
  overhead. Both backends three.js offers (WebGPU, WebGL2) already exist in
  `serveGPU` and run the same guest SPIR-V. If a second backend engine is ever
  needed, the better candidate is wgpu (Rust to Wasm, with WebGPU and WebGL2
  backends via Naga). Naga is already the translator here.
- **Chosen: the W2 `gpu_hostcall` channel as the virtual GPU.**
  - The private syscall 0x6a470001 is intercepted in `worker.js` and never
    enters the kernel.
  - The guest thread blocks on its own SharedArrayBuffer slot.
  - The GPU-owner Worker reads and writes guest memory directly. W2 measured
    an ECHO p50 of about 40 us.
  - The owner runs the unchanged `serveGPU` executor, so the command set,
    validation, budgets and the WebGPU/WebGL2 renderers are shared with the
    vsock path and its 20 regression suites.

## 2. ABI (owner ops, `web/linux/dist/guest-gpu-vk.js`)

| op | Name | Arguments | Result |
|---|---|---|---|
| 0x20 | VK_OPEN | `(flags)`: 1 = force WebGL2, 2 = force WebGPU | session id > 0, or -errno |
| 0x21 | VK_CALL | `(session, io, payload, reply, cap)` | 0, or -errno |
| 0x22 | VK_CLOSE | `(session)` | 0, or -errno |

- **The `io` block (20 bytes).**
  - In: the 16-byte request header (magic `GPU1`, version, opcode, request id,
    payload length).
  - Out: the 16-byte reply header followed by the int32 protocol status.
  - The reply body goes to `reply`. A body larger than `cap` fails with
    `-ENOSPC`.
- **Payloads are copied.** The executor may keep them past the call.
- **One call at a time.** Each session allows one call in flight (`-EBUSY`
  otherwise).
- **Ended sessions.** After CLOSE, a terminal status or device loss, the
  session answers `-EIO`.
- **Abandoned calls.** Guest memory is written only when the caller still
  waits (`completeWith`).
- **Opt-in.** An owner without a `vk` config answers OPEN with `-ENODEV`, and
  the guest falls back to vsock.
  - `web/linux/main.js` passes `ownerConfig: {vk: {backend}}`, where `backend`
    comes from `?gpubackend=`. So the main page, `?gputest=1` and Firefox mode
    use hostcall.
  - The isolated regression test pages do not, so the 20 suites keep their
    vsock host options (clear, compute, loss injection).

The guest side lives in `web/linux/tests/guest-gpu/guest-gpu.c`.
- `gpu_accept` tries VK_OPEN first and prints `GUEST_GPU_HOSTCALL`. Any failure
  falls back to the vsock listener.
- `GUEST_GPU_TRANSPORT=vsock|hostcall` forces one transport. A forced
  `hostcall` failure is an error.
- `GUEST_GPU_BACKEND=webgl|webgpu` sets the open flags.
- `gpu_call` validates the reply header (magic, version, opcode | 0x8000,
  request id, length) exactly as the stream path does.

## 3. Results

**Test setup.**
- vkgears V1 app on the NVIDIA recipe (headful `DISPLAY=:0`, Vulkan-enabled
  Chromium, PRIME env stripped).
- Harness: `run-hc.mjs` from the task directory, 300 s deadline, median of 50 s
  of `GPUTEST_FPS` intervals, one boot per cell.
- Hostcall build: `package-run2/gputest-vkgears.cpio` (sha256 `e613ed9e…`).
- vsock baseline: the shipped P1 `web/linux/gpu/gputest-vkgears.cpio`.
- Same page and host executor for both. Only the transport differs, and each
  report records it in its `transport` field.
- "present" means the frame goes through XPutImage at 300x300. "nopresent"
  means rendering and readback only.

### WebGPU (NVIDIA MX110, Dawn Vulkan)

| Mode | Size | vsock (FPS) | hostcall (FPS) | Gain |
|---|---|---|---|---|
| nopresent | 300 (render 128) | 223.6 | **280.8** | +26% |
| nopresent | 128 | 224.7 | **281.8** | +25% |
| present | 300 (upscaled) | 51.0 | **59.4** | +16% |
| present | 128 | 60.4 | **76.2** | +26% |

- **Run dirs:** `fps-{vsock,hc}-{nopresent,present}-{default,128}-r1`, set
  `run-fps-set.sh`.
- **Order:** the hostcall cells ran first, then the vsock cells, all in one
  session.
- **Load:** 1-minute load average 1.3-4.3 during the runs. The user's desktop
  was active, so the absolute numbers sit below P1's same-day 239.5 / 70.9.
- **The first hostcall attempt `hc-nopresent-default-r1` failed (kept).** HELLO
  has an empty payload, and `readExactly(0)` never resolved. It is now
  answered immediately. `hc-nopresent-default-r2` gave 283.0.

### WebGL2 (`&gpubackend=webgl`)

| Mode | vsock (FPS) | hostcall (FPS) | Gain |
|---|---|---|---|
| nopresent | 118.6 | **136.8** | +15% |
| present | 36.2 | **43.5** | +20% |

- **Run dirs:**
  - vsock baseline: `fps-hcwebgl-*-r1`. It was launched without `CPIO=`, so
    the shipped vsock CPIO ran and the report says `transport:"vsock"`. The
    run is kept as the baseline.
  - hostcall: `fps-hcwebgl-*-r2`.
- **The harness reports `pass:false` for these runs.** Only its `nvidia`
  WebGPU-adapter check fails, which is expected on the WebGL2 path. `fps`,
  `noFailure` and `noPageErrors` pass.

### Remaining per-frame cost

- **Rendering only.** At about 3.5 ms per frame the guest still makes several
  blocking round trips: uploads, submit, wait and readback. That is now about
  40 us each, plus the GPU work.
- **With display.** The remaining cost is mostly the CPU upscale and the
  XPutImage/X-server path (V2 profile item 3), not the GPU transport.

### Regression

- `all-run1` passes 20/20 on NVIDIA WebGPU and Intel WebGL2:
  `PKG_RUN=1 REQUIRE_WEBGPU_VENDOR=nvidia node .../run-finite.mjs all-run1`,
  run from the task directory.
  - It rebuilt every suite with the hostcall-capable `guest-gpu.c`
    (`build-run1`, `package-run1`).
  - The check counts match the P1 baseline exactly:
    - direct live / unavailable / clear: 140 / 17 / 1087
    - transport loss / device loss: 640 / 640
    - exhaustion: 1213
    - loader: 901
    - compute: 501
    - graphics: 232753 / 232745
    - uniform: 201269 (each backend)
    - texture: 18182 (each backend)
    - depth: 42620 (each backend)
    - wsi: 276963 (each backend)
    - zinkcaps: 91309 (each backend)
- The suite pages do not opt in to sessions, so VK_OPEN returns -ENODEV. Every
  suite therefore runs over the vsock fallback with its own host options.
- `web/linux/gpu/gputest-vkgears.cpio` is now the hostcall build
  (`package-run2`, sha256 `e613ed9e…`).
