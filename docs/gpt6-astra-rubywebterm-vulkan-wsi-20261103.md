# Bounded Vulkan presentation acceptance — 2026-11-03

Author: GPT-6 Astra Pro, built-in graphics_jit agent, rubywebterm.

## Accepted result

A freshly built **native wasm32 Linux application** now creates an Xlib Vulkan
surface and swapchain, acquires images, submits real gear geometry, and presents
through `vkQueuePresentKHR` on the explicitly selected **WebGL2** backend. The
host is NVIDIA GeForce MX110 through ANGLE/OpenGL 4.5. This is an experimental,
bounded Vulkan implementation; it is not Vulkan conformance or full desktop
OpenGL support. The existing Firefox binary is unchanged.

The final native gate rendered 170 frames and 510 draws, completed 702 protocol
commands, exited successfully, and reported `GUEST_VK_CLOSE status=0`, zero live
swapchains/surfaces, and zero allocated guest GPU resources. The application ran
for 6.02 seconds; the complete monitored owner took 30.124 seconds and reaped all
owned processes. This functional run could overlap other development work, so
its 28.260 reported frames/second is **not a performance comparison**.

The actual visible frame is in
`tools/graphics-benchmark/evidence/gpt6-astra-vulkan-wsi-accepted-20261103.png`.
Exact sources, served hashes, browser flags, native markers, upstream pins, and
failed runs are in the adjacent `gpt6-astra-vulkan-wsi-20261103.json`.

## Changes and reasons

1. The direct WebGL owner no longer requests the large sampled-target capability
   that requires a direct WebGPU pixel probe or Rust resource backend. The
   strict host capability validator is unchanged. WebGPU and explicitly opted-in
   Rust requests retain their previous behavior.
2. The WebGL renderer can present from its exclusive, non-multisampled
   OffscreenCanvas. A GPU framebuffer blit reverses destination Y to match the
   native driver's logical top-to-bottom row order. `transferToImageBitmap`
   supplies the initial frame; subsequent frames go to the existing transferred
   page canvas using `bitmaprenderer`. The implementation does not call
   `readPixels` or `getBufferSubData`.
3. The existing native WSI end message carries target zero. The host previously
   looked up that target before checking the end flag, rejected it, and poisoned
   the native transport when the error exceeded the small reply buffer. The
   host now validates packet size and flags, handles the end form, and requires
   a live target for actual frames. Earlier failing runs are retained.
4. Two native SDK conditional-compilation errors were corrected: the recorded
   mip level is available to both profiles, while Zink-only debug variables and
   its topology helper remain guarded. Both ordinary and Zink profiles compile
   with `-Wall -Wextra -Werror`. Compiling Zink does not establish its runtime
   correctness or desktop OpenGL completeness.

## Correctness and ownership gates

The renderer passed **32 real GPU checks**, including asymmetric top/bottom
pixels, exact output through both presentation routes, subsequent drawing and
readback, source preservation, resize and replacement canvases, stale and
uninitialized handles, failed sinks, close while queued, and context loss.
Presentation ran while the two CPU pixel-readback methods were replaced with
throwing guards. Every native object was balanced on close. Surface entries are
bounded and cleared on forget, close, and device loss. Unsupported HTML canvas
contexts do not advertise the offscreen capability.

The 32-check browser owner took 15.842 seconds, sampled resources every second,
and reaped all owned processes. Its peak sum of RSS was 1,087,705,088 bytes;
shared pages can be counted more than once, so this is not PSS. The native WSI
owner had a peak sampled sum of RSS of 2,155,343,872 bytes. Browser and guest CPU
counts were both three, matching the effective cgroup quota.

`startup_io` independently reviewed the narrow owner configuration, host
protocol ordering, renderer capability/ownership logic, and native macro guards.
Its requested context-loss check subsequently passed.

## Build and package identity

The SDK build uses 53 hash-pinned Khronos loader/header inputs plus the current
project ICD, transport, and sample. No blocked Firefox build tree is used.

- Vulkan loader revision: `61187c40845c92a80bcd2216089dd01badcda7ac`.
- Vulkan headers revision: `98f440ce6868c94f5ec6e198cc1adda4760e8849`.
- Sample: `/mnt/p3/codex-build/g3g/vulkan-wsi-build3/vkgears-wsi.wasm`.
- Size: 1,371,077 bytes.
- SHA-256: `cc4a4c6c26d6469f3973af424b9f7cf3e6056127ee8f11e4920de368c90b8add`.
- Fresh ordinary build/validation: 12.449 seconds.
- Additional Zink-profile object compile: 20.561 seconds; runtime not accepted.

The sample statically links the guest X11/XCB libraries. With a running guest X
server and the explicit guest WebGL setting, use:

```sh
DISPLAY=:0 vkgears-wsi -wsi -info -size 128x128 -seconds 10
```

The package is an optional Vulkan demo. It must not be counted as one of the
requested common GNU packages. The source and upstream provenance must travel
with it; the existing project sample does not declare a project-wide license.

## Explicit WebGPU diagnostic

The ordinary ANGLE/OpenGL test environment returned no WebGPU adapter. A
separate, isolated diagnostic browser used Chrome's documented Linux Vulkan and
experimental WebGPU flags and acquired the real NVIDIA Maxwell adapter. It
rendered four native frames, then Dawn reported
`vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY` and device loss.
The failure and cleanup diagnostics are preserved. There was no automatic
switch to WebGL and no accepted WebGPU WSI result.

The flags belong only to the isolated developer harness. Chrome's explanation
of experimental platform/adapter behavior is available at
https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips .
The product always requires the user to choose the guest backend.

## Remaining compatibility limits

- The accepted depth demo is 128 by 128. Larger negotiated color targets do not
  imply equally large depth, texture, or complete pipeline support.
- Acquire does not wait when all swapchain images are already acquired. The
  current behavior and other bounded choices prevent a conformance claim.
- Presentation acceptance and frame callbacks do not prove physical display
  completion or unrestricted GPU throughput.
- The Zink profile records bounded push-constant layout ranges, but executing
  shader push-constant blocks and `vkCmdPushConstants` remains incomplete.
  Non-Zink layouts reject such ranges. Full desktop OpenGL is not established.
- The separate GLES bridge still has its original simplified GL/EGL sync
  behavior. The rejected real-fence candidate remains excluded.
- This result does not establish hardware acceleration for Firefox DOM or its
  compositor, a 30-second Firefox launch, or 50% of host-browser performance.

## Reproduction

Use `fetch-vulkan-sdk.py`, `build-vulkan-wsi.py`, and `package-vulkan-wsi.py` under
`tools/graphics-benchmark`. Every output directory must be new and disk-backed.
The package helper verifies the existing plain rootfs hash and appends only an
isolated test init/sample. Run its page through `browser-check.mjs` with
`GRAPHICS_ISOLATED=1`, `GRAPHICS_ANGLE=gl`, the `vulkan-wsi.html` page override,
and `vulkan-wsi-hook.mjs`, inside `monitor-run.py`. The page explicitly requires
successful native close and zero guest resource leaks. The renderer-only page
is `web/linux/tests/guest-glremote/presentation.html`; its shaders are generated
and validated by `build-presentation-fixture.py`.
