# Explicit WebGPU readback presentation diagnostic

This is an experimental, explicitly selected presentation route. Rendering stays in the direct WebGPU renderer. Stored RGBA8 targets are read back to CPU memory and displayed through an opaque 2D canvas. It does not repair the driver failure at direct WebGPU canvas/ImageBitmap export, change the desktop default, or establish full Vulkan/OpenGL conformance or performance parity.

## Selection and bounds

The native owner requires `vk.backend = "webgpu"` and `vk.presentation = "readback-2d"`, presentation enabled, and the large colour target profile. A native explicit WebGPU flag may resolve the backend, but WebGL and external renderer backends cannot use this mode. Unknown presentation values fail. No automatic fallback exists.

The adapter supports RGBA8 targets through 512x512, at most 16 surfaces, 16 MiB of nominal RGBA canvas pixel capacity (browser/driver overhead is additional), and one in-flight frame. It checks the target extent before readback, validates the returned extent/format/row order, rejects a frame cancelled by Close or surface removal, and releases owned CPU stores during cleanup. A sink takes bitmap ownership synchronously; if it throws, the adapter closes the bitmap. The current worker sink posts/transfers synchronously. Default direct presentation retains its existing path.

## Evidence layers

- `test-readback-presentation.mjs` tests ownership, cancellation, malformed layout and explicit backend rejection with a stub renderer. It is not GPU acceptance.
- `webgpu-readback-present.html?presentation=readback-2d` is the minimal real GPU clear/readback/CPU presentation diagnostic, independent of the new adapter.
- `webgpu-readback-adapter.html?presentation=readback-2d` uses the actual new adapter, verifies every displayed pixel against alternating deterministic clear colours, and checks closed resource counts.
- `../vulkan-wsi-readback.html?backend=webgpu&presentation=readback-2d` boots the pinned real native Vulkan WSI fixture. It requires real draws, actual nonuniform first-frame pixels, correct native exits and zero graphics/WSI resources. Nonuniformity is not an exact image oracle or conformance suite.
- Existing `webgpu-present-diagnostic.html` and `webgpu-canvas-preferred.html` direct-export reproductions remain unchanged.

The guarded rechecks on 2026-11-03 passed: raw pixels in 5.512 seconds, actual adapter pixels/cleanup in 5.760 seconds, and native WSI in 14.755 seconds. Every before-navigation and continuous descendant snapshot shared `/cpulimit.slice` capped at three CPUs, with no owned processes remaining. The raw and adapter diagnostics each made 60 real render passes and checked 48 frames. Native WSI made 1,443 passes / 4,329 draws and 1,443 presentation calls; the first 128x128 bitmap contained 151 distinct RGB colours and visibly showed three coloured gears. Native WSI, GPU objects and CPU canvas stores closed at zero. See `../evidence/gpt6-astra-webgpu-readback-quota-20261103-1322.json` and its PNG.

The native loop's approximately 240 submissions per second is not physical display refresh, Firefox performance, or a matched-host result. Earlier real raw observations still lack recorded browser descendant quota and remain qualified; their receipts were not overwritten. A successful receipt from one diagnostic must not be relabelled as another gate.

## Guarded browser execution

Use `tools/guest-packages/bounded.py` as the sole CPU/RSS/RAM 1-second, PSS 5-second observer around `tools/graphics-benchmark/browser-check.mjs`. The browser launcher assigns an unused socket path inside its fresh owned directory as its session D-Bus address. This prevents desktop user-scope migration without changing any host cgroup or user bus. Before page navigation it requires the actual owned process tree to share a three-CPU-capped ancestor. The bounded owner then rejects unreadable live inventories, unbounded groups, separate unrelated limits and membership migration throughout the run.

A three-CPU affinity mask or `navigator.hardwareConcurrency === 3` does not prove this policy. Historical owner-only quota receipts cannot establish descendant enforcement. Every new GPU run needs the before-navigation preflight and per-second descendant snapshots, with no unknown cleanup identities.

Run diagnostics only within the serialized heavy-test lease, with short fresh Chromium paths, isolated serving, explicit `GRAPHICS_ANGLE=vulkan` and `GRAPHICS_WEBGPU_DIAGNOSTIC=1`. These experimental Linux WebGPU flags are recorded conditions, not default-browser compatibility acceptance. Preserve failure output and device-loss reasons; do not silently switch to WebGL.
