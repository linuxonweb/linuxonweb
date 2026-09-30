# Guest Vulkan: depth attachments (packet A5) — 2026-09-29

This packet adds depth attachments to the experimental guest ICD in `web/linux/tests/guest-vulkan/`,
covering:

- the vsock host `web/linux/tests/guest-gpu/host.mjs`;
- the WebGPU renderer and the WebGL2 fallback renderer.

The translators are unchanged. The depth shaders are ordinary position/colour SPIR-V and need no
new adapter pass.

It is track A item A5 of `docs/vulkan-gap-zink-vkcube-20260928.md`. It builds on A4 (sampled
textures, `docs/guest-vulkan-textures-20260929.md`).

This is a bounded, nonconformant profile:

- It makes no claim about Zink, OpenGL, Firefox GPU, decoders or a native JIT.
- The accepted `web/linux` images and `web/sites` are unchanged, and nothing was deployed.

**Hardware.** As in A4:

- **WebGPU** ran on the NVIDIA GeForce MX110 (Maxwell, driver 580.173.02) through Chromium's Dawn
  Vulkan backend.
- **WebGL2** ran on Intel UHD 620 through ANGLE/OpenGL.

## Profile and HELLO

The profile is opt-in and layered on the texture profile. The host advertises it only when it is
started with `allowDepth`, which requires `allowTextures`, `allowUniforms` and `allowGraphics`. Its
HELLO then also carries:

```
depthProfile:1, depthFormats:['d32-sfloat','d16-unorm'], maxDepthDimension:128
```

The protocol has one new opcode:

| Opcode | Name | Payload |
|---|---|---|
| 28 | `DEPTH_TARGET` | u32 width, height, format (1 = `depth32float`, 2 = `depth16unorm`) |

There are two JSON extensions:

- **Pass JSON** gains an optional `depth:{target, loadOp, storeOp, clearValue}`:
  - `loadOp` is `clear` or `load`, and `storeOp` is `store` or `discard`.
  - `clearValue` in [0,1] is present only with `clear`.
- **Pipeline JSON** gains `depth:{format, depthCompare, depthWriteEnabled}`, or `depth:null` for a
  colour-only pipeline.

When a device is created without `depthProfile`, the following are unchanged from A4:

- depth formats report no features;
- `framebufferDepthSampleCounts` is 0;
- depth images, passes and pipelines are refused.

## Guest ICD (`icd.c`, `transfer.inc`, `graphics.inc`, `graphics-commands.inc`)

**Formats**

- `D32_SFLOAT` and `D16_UNORM` report optimal-tiling `DEPTH_STENCIL_ATTACHMENT` only. They have no
  linear or buffer features.
- `vkGetPhysicalDeviceImageFormatProperties` accepts them only with usage exactly
  `DEPTH_STENCIL_ATTACHMENT`. It reports maxExtent 128, 1 mip, 1 layer and 1 sample.
- These are unsupported: `D24_UNORM_S8_UINT`, `D32_SFLOAT_S8_UINT`, `X8_D24_UNORM_PACK32` and
  `S8_UINT`.
- `framebufferDepthSampleCounts` is 1.

**Images and views**

- 2D only, one mip and one layer, at most 128x128, optimal tiling.
- `vkGetImageMemoryRequirements` returns 4 or 2 bytes per texel, alignment 4, device-local memory.
- `vkBindImageMemory` sends `DEPTH_TARGET`. The image is host-only and never mapped.
- Views require bound memory, the `DEPTH` aspect and the image's own format.

**Render passes**

- Attachment 0 is colour, as before. Attachment 1 is depth, and the subpass must reference it
  through `pDepthStencilAttachment`.
- Depth `loadOp` may be `CLEAR`, `LOAD` or `DONT_CARE`. `storeOp` may be `STORE` or `DONT_CARE`.
- Initial and final layout must both be `DEPTH_STENCIL_ATTACHMENT_OPTIMAL`.
- These return `FEATURE_NOT_PRESENT`:
  - stencil load or store operations other than `DONT_CARE`;
  - an `UNDEFINED` initial layout;
  - stencil-bearing formats;
  - a depth attachment without a subpass reference.

**Framebuffers**

- Two attachments: a colour view and a depth view.
- Count, extent, attachment kind and depth format must match the pass. Otherwise the call returns
  `INITIALIZATION_FAILED`.
- Pass compatibility now includes the depth format.

**Pipelines**

- `pDepthStencilState` is required if and only if the pass has depth.
- `depthTestEnable`, `depthWriteEnable` and all eight `depthCompareOp` values are supported.
- `stencilTestEnable` and `depthBoundsTestEnable` return `FEATURE_NOT_PRESENT`. Depth bias is still
  rejected in the raster state.

**Recording**

- `vkCmdBeginRenderPass` needs `clearValueCount` 2 when the depth load is `CLEAR`. The depth clear
  value must be in [0,1].
- Depth barriers accept only:
  - `UNDEFINED->DSA` (TOP_OF_PIPE, no source access);
  - `DSA->DSA`, with LATE_FRAGMENT_TESTS and DEPTH_STENCIL_ATTACHMENT_WRITE as the source.
- Colour aspects on depth images, missing write dependencies and transitions to other layouts make
  `vkEndCommandBuffer` fail.

**Submission**

The depth layout and "stored contents" state are simulated across the whole command buffer. A
submit is refused before any host effect in these cases:

- a pass runs on an image still in `UNDEFINED`;
- `LOAD` has no stored contents: after a `DONT_CARE` store, after an `UNDEFINED` transition, or
  never stored;
- a colour-only pipeline is used in a depth pass;
- a depth image is copied to a buffer.

A pass leaves the depth initialized only when its store is `STORE`. Host failures after possible
effects poison the device, as before.

**Transport**

`guest-gpu.c`/`.h`: the opcode bound now extends to `GPU_DEPTH_TARGET`.

## Host and renderers

**`guest-gpu/host.mjs`**

- Handles `DEPTH_TARGET` with extent and format validation, and forwards pass/pipeline depth JSON.
- Accepts draws that omit empty `uniforms`/`textures` lists (pipelines without descriptors).

**Shared validation (`guest-vulkan-graphics/renderer.mjs`)**

- Adds `DEPTH_FORMATS`, `DEPTH_COMPARE`, `validateDepthState` and `validateDepthAttachment`.
- Pipeline and pass depth formats must match at draw time.
- `load` requires a target that a previous pass successfully stored. `discard` clears that state.
- The depth extent must equal the colour target's extent.

**WebGPU renderer**

- Each target is a `depth32float` or `depth16unorm` texture with `RENDER_ATTACHMENT` usage.
- A pass adds `depthStencilAttachment` with `depthLoadOp`, `depthStoreOp` and `depthClearValue`.
- Pipelines add `depthStencil:{format, depthWriteEnabled, depthCompare}`.

**WebGL2 renderer (`guest-vulkan-webgl/renderer.mjs`, `host.mjs`)**

- Each target is a renderbuffer with `DEPTH_COMPONENT32F` or `DEPTH_COMPONENT16`. It is attached to
  the FBO's `DEPTH_ATTACHMENT` for the pass.
- Draws set `DEPTH_TEST`, `depthFunc` and `depthMask`. Depth clears use `clearDepth` plus `clear(DEPTH_BUFFER_BIT)` with the depth mask enabled.
- `Renderbuffer` is counted in GL ownership when `allowDepth` is set.

**Guest DONT_CARE mapping.** The protocol has no DONT_CARE:

- A `DONT_CARE` load is sent as a clear to 1.0 (the far plane).
- A `DONT_CARE` store is sent as `discard`.

## Test application (`web/linux/tests/guest-vulkan-depth/`)

`client.c` is linked against the public static Khronos loader (51 public Vulkan symbols). It uses a
16x16 RGBA8 target and two constant-depth quads:

- **A**, red at z 0.25, covers columns 0-11;
- **B**, blue at z 0.75, covers columns 4-15;
- **B'**, blue at z 0.25, has the same shape as B.

Both quads cover rows 0-11. Rows 12-15 always keep the green colour clear, so every frame has an
A-only, an overlap and a B-only region.

**Rounds.** The whole sequence runs once for `D32_SFLOAT` (rounds 1-15) and once for `D16_UNORM`
(rounds 101-115). Each frame compares all 1024 bytes exactly and then a 32-byte 0xa5 tail.

| Round | Case | Expected A-only / overlap / B-only |
|---|---|---|
| 1 | LESS, A then B, clear 1.0 | red / red / blue |
| 2 | LESS, B then A (order independence) | red / red / blue |
| 3 | GREATER, clear 0.0 | red / blue / blue |
| 4 | A tested but not written | red / blue / blue |
| 5 | test disabled (draw order decides) | red / blue / blue |
| 6 | clear 0.5 rejects B at 0.75 | red / red / green |
| 7 | equal depth, LESS keeps A | red / red / blue |
| 8 | equal depth, LESS_OR_EQUAL takes B' | red / blue / blue |
| 9 | CLEAR/STORE with A only | red / red / green |
| 10 | next submit: LOAD, B only (stored A depth rejects B in the overlap) | green / green / blue |
| 11 | CLEAR/STORE pass then LOAD pass in one command buffer | green / green / blue |
| 12 | DONT_CARE load (far plane, not the stored depth) | red / red / blue |
| 13 | CLEAR, DONT_CARE store | red / red / blue |
| 14 | restore stored contents after the refusals | red / red / green |
| 15 | recovery after all negatives | red / red / blue |

**Negatives.** Checked in the guest for each format:

- format queries: 2 supported formats, 4 unsupported formats, and `SAMPLED` usage refused;
- 7 rejected images:
  - D24S8, S8, `SAMPLED` usage, `TRANSFER_SRC` usage, width 129, 2 mips, linear tiling;
- 3 rejected views: unbound memory, colour aspect, wrong format;
- 4 rejected render passes: stencil CLEAR, UNDEFINED initial layout, D24S8, missing reference;
- 4 rejected framebuffers: one attachment, colour view as depth, 8x8 depth, wrong-format pass;
- 6 rejected pipelines:
  - stencil test, depth bounds and depth bias (`FEATURE_NOT_PRESENT`);
  - missing depth state, depth state in a colour-only pass, and an invalid compare op;
- 5 invalid recordings: missing depth clear value, clear 1.5, colour-aspect barrier, missing write
  dependency, and depth to `SHADER_READ_ONLY`;
- 5 refused submits, with the sentinel buffer checked untouched after each:
  - a pass without the `UNDEFINED->DSA` transition;
  - LOAD after a DONT_CARE store;
  - LOAD after an `UNDEFINED` transition;
  - a colour-only pipeline in a depth pass;
  - a depth copy to a buffer.

The recovery round must then pass.

**Host-side acceptance (`guest-vulkan-depth/guest.html`).** Both backends must report exactly:

- 32 passes, 54 draws, 30 vertex uploads and 30 readbacks;
- 2 translations and 19 releases;
- no uniform or texture uploads;
- 4 depth targets: one 16x16 and one 8x8 per format;
- zero live native objects before emergency cleanup.

Every refusal is guest-side, so no host command fails. On WebGL2 every GL object kind is balanced,
including `Renderbuffer` 4/4.

## Browser configuration

`run-finite.mjs` owns a finite server on 4197 and a **headful** Chromium on CDP 9407, as in A4:

- `DISPLAY=:0`, with an isolated profile under the run directory;
- `--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist --disable-gpu-vsync
  --disable-frame-rate-limit --window-size=800,600`. The vsync and frame-rate flags are new in A5.
- PRIME offload variables are stripped from the child environment.
- The adapter is requested with `powerPreference:'high-performance'`.

`REQUIRE_WEBGPU_VENDOR=nvidia` makes any WebGPU suite fail unless the adapter vendor is `nvidia`.
`PKG_RUN=N` selects the package run directories.

## Results

The authoritative run is `/mnt/p6/build/guest-vulkan-a5-20260929/all-run1/result.json`, SHA-256
`ac4e3a4a30dbfd8c163e5a407bf43b0bb4b6eb88436e5370e5c18aebf063105c`:

- HEAD `a7a59cc`, `REQUIRE_WEBGPU_VENDOR=nvidia`, packages `*-package-run5` from `*-build-run5`;
- `pass: true`, browser exit 0, server closed;
- the only HTTP errors are two `/favicon.ico` requests;
- every file served from Git HEAD matched the working tree.

The run recorded one canceled Fetch (`net::ERR_ABORTED`) each on graphics-webgpu, texture-webgl2 and
depth-webgl2. Its cause is not established. There were no Runtime exceptions.

WebGPU adapter on every WebGPU suite: `{vendor:"nvidia", architecture:"maxwell", isFallbackAdapter:false}`.
WebGL2: `ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)`, used after the
forced acquisition error "WebGPU API unavailable".

| Suite | Guest checks | Prior (A4) |
|---|---|---|
| direct live | 140 | 140 |
| direct unavailable | 17 | 17 |
| direct clear | 1087 | 1087 |
| loss-transport | 640 | 640 |
| loss-device | 640 | 640 |
| exhaustion | 1213 | 1213 |
| public-loader clear | 901 | 901 |
| compute | 501 | 501 |
| graphics WebGL2 | 232,753 | 232,753 |
| graphics WebGPU | 232,745 | 232,745 |
| uniform WebGL2 | 201,269 | 201,269 |
| uniform WebGPU | 201,269 | 201,269 |
| texture WebGL2 | 18,182 | 18,182 |
| texture WebGPU | 18,182 | 18,182 |
| **depth WebGL2** | **42,620** | new |
| **depth WebGPU** | **42,620** | new |

All 14 earlier suites pass unchanged. Per-suite elapsed time was 4.9-8.4 s, versus 10-17 s in A4.
That timing includes headful page and boot overhead and is not a GPU benchmark. The A5 frame-rate
flags may contribute, but this is not measured.

Host counters were identical on both depth backends:

- 133 commands, 32 passes, 54 draws, 30 uploads, 30 readbacks, 2 translations and 19 releases;
- 62 fences/submits;
- WebGPU: 31/31 buffers and 5/5 textures (one colour target plus four depth targets);
- WebGL2: Renderbuffer 4/4, Buffer 31/31, VertexArray 32/32, Program 11/11, Shader 22/22 and
  Sync 62/62;
- guest `GUEST_VK_SYNC teardown_released=0`.

Every pixel round on both formats and both backends is bit-exact. This includes the equal-depth
LESS/LESS_OR_EQUAL rounds, which were exact for `D16_UNORM` on both GPUs.

Depth artifacts:

| Artifact | Size (bytes) | SHA-256 |
|---|---|---|
| Client `depth-build-run5/guest-vulkan-public-client.wasm` | 433,856 | `c7566c8f…ddf05` |
| Package `depth-package-run5/initramfs.cpio` | 40,929,644 | `fa18972c…62eb59` |
| Shader `depth.vert` (fixtures `depth-shaders-run1`) | 988 | `82a84601…506b1e` |
| Shader `depth.frag` | 384 | `2767646d…317c70` |

`depth-run4` (build4) and `depth-run5` (build5) are additional passing depth-only runs on the same
hardware.

## Defects found by guest runs, and fixes

All failed runs are preserved under `/mnt/p6/build/guest-vulkan-a5-20260929/`.

1. `depth-build-run1-failed-initializer`: `icd.c` did not compile under `-Werror` because of an
   initializer issue. Fixed, and `depth-build-run1` builds.
2. `depth-run1`: the first submit returned an error (1171 checks passed).
   - Cause: `guest-gpu/host.mjs` required `draw.uniforms` and `draw.textures` arrays, but the ICD
     omits empty lists for pipelines without descriptors.
   - Fix: empty lists now default to `[]`. Only `host.mjs` changed between build1 and build2.
3. `depth-run2`: round 14 failed at x=12 y=0 (green 255, expected 0).
   - Cause: a client test bug. Round 14 compared against the previous round's expectation.
   - Fix: `expect(RED,RED,GREEN)` was added. No ICD behaviour changed.
4. `depth-run3`: the guest passed 42,620 checks, but `guest.html` acceptance failed.
   - Cause: `released` and the renderbuffer count were not yet derived.
   - Fix: they are now derived analytically: 19 releases and 4 depth targets. No behaviour changed.
5. `depth-run4`, `depth-run5` and `all-run1`: pass.

## Limitations

- **Formats and features:**
  - no stencil, no packed depth/stencil formats, no depth bias, no depth bounds;
  - no depth clamp and no `unclippedDepth`;
  - no separate depth/stencil layouts and no `VK_KHR_depth_stencil_resolve`.
- **Depth images** are attachment-only. There is no depth sampling, shadow compare, readback or
  depth copy, and no input attachments. Readback stays colour-only.
- **Shapes:** single sample, one mip and one layer, at most 128x128. A pass has one subpass with
  one colour and one depth attachment. There are no `UNDEFINED`-initial-layout passes; an explicit
  barrier is required.
- **DONT_CARE** load is implemented as a clear to 1.0. That is valid, but it is not the undefined
  contents a real driver may leave.
- The profile is nonconformant and there is no CTS. Pixels near quad edges are not compared, as in
  A3/A4. Depth values are constant per quad, so interpolation precision is not stressed.
- WebGL2 runs on Intel ANGLE, not NVIDIA.
- There is no WSI, no swapchain and no presentation.

## Next: A6 (WSI)

Goal: an ordinary X11 Vulkan application can present frames. The target is vkcube's `--wsi xlib`
path; see Track A in `docs/vulkan-gap-zink-vkcube-20260928.md`.

- **Instance extensions:** `VK_KHR_surface` and `VK_KHR_xlib_surface`, with `VK_KHR_xcb_surface`
  optional if libxcb is available in the guest sysroot. The static loader's WSI terminators must be
  enabled for these entrypoints only.
- **Surface queries:**
  - `vkGetPhysicalDeviceSurfaceSupportKHR` (queue family 0);
  - capabilities (current extent from the X11 window, image count 2-3, identity transform, opaque
    alpha);
  - formats `B8G8R8A8_UNORM` and/or `R8G8B8A8_UNORM` with SRGB_NONLINEAR colour space;
  - present modes `FIFO` (required) and perhaps `IMMEDIATE`.
- **Device extension:** `VK_KHR_swapchain`, covering create/destroy, `vkGetSwapchainImagesKHR`,
  `vkAcquireNextImageKHR` and `vkQueuePresentKHR`. Swapchain images are colour attachments with
  `TRANSFER_SRC`, in layout `PRESENT_SRC_KHR`.
- **Present path (first cut):** reuse the proven X11 CPU-copy path from
  `presentation-x11.inc`. On present, the host reads the swapchain image back and the ICD pushes it
  with `XPutImage` (or MIT-SHM if available) into the surface window.
  - This is correct but slow. A later packet can present directly to a host canvas that composites
    the guest window, bypassing the guest copy.
- **Synchronization:**
  - acquire signals the semaphore/fence immediately (images are host-owned);
  - present waits on its semaphores;
  - `OUT_OF_DATE`/`SUBOPTIMAL` on window resize.
  - the existing non-blocking fences from A1/A2 (waits return `VK_TIMEOUT`) will need a real blocking wait or a
    bounded poll for FIFO pacing.
- **Other vkcube prerequisites** to audit before A7:
  - dynamic viewport and scissor;
  - `gl_InstanceIndex`-free shaders;
  - a UBO with MVP (A3), a sampled texture (A4) and a depth attachment (this packet);
  - `vkCmdPushConstants` if used;
  - a `B8G8R8A8` colour target, which needs a BGRA readback swizzle;
  - vkcube's own format selection.
- **Tests:**
  - a guest app that presents N frames to an override-redirect window and verifies server pixels
    with `XGetImage` per frame, as in the X11 presentation test;
  - negative cases: presenting an unacquired image, a wrong layout, and a destroyed surface;
  - run on NVIDIA headful as here.

## Files

**New:**

- `web/linux/tests/guest-vulkan-depth/{client.c, guest.html, prepare.py, shaders/depth.vert, shaders/depth.frag}`
- `docs/guest-vulkan-depth-20260929.md`
- `docs/evidence/guest-vulkan-20260929/depth.json`

**Modified:**

- ICD: `icd.c`, `transfer.inc`, `graphics.inc`, `graphics-commands.inc`
- Guest transport: `guest-gpu/guest-gpu.{c,h}`, `guest-gpu/host.mjs`
- Renderers and hosts: both `renderer.mjs`, `guest-vulkan-webgl/host.mjs`
- Build and storage:
  - `guest-vulkan-graphics/{build.py, package.py}` (adds `--app depth` and `--mode depth`);
  - the `storage.py` files of the direct, loader, compute and graphics suites;
  - both `translator/build.py` files (task root only)
- Runner: `guest-vulkan/run-finite.mjs` (depth suites and the vsync/frame-rate flags)

The rebuild script is `/mnt/p6/build/guest-vulkan-a5-20260929/rebuild.sh`.
