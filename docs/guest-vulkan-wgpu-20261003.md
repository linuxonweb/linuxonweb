# Guest Vulkan through browser Rust wgpu

A real native Linux/Wasm Vulkan app now renders through Rust wgpu in the browser.
The final combined backend completes the matched WebGPU workload **16.5979× faster
on the NVIDIA GPU than on host SwiftShader**. The same package also passes the
wgpu WebGL fallback. These are offscreen render-and-readback results, not display
FPS or Firefox GPU acceptance. Firefox GPU tests remain paused pending root review.
Public v10 and Nightly build inputs are unchanged by this work.

| Final combined candidate | Completed FPS | 30-frame elapsed | Median frame | p95 frame |
|---|---:|---:|---:|---:|
| NVIDIA MX110, Rust wgpu BrowserWebGpu | 38.1633 | 786.095 ms | 25.1575 ms | 31.930 ms |
| Host SwiftShader, Rust wgpu BrowserWebGpu | 2.29929 | 13047.500 ms | 452.7475 ms | 520.235 ms |
| NVIDIA MX110, Rust wgpu Gl/WebGL2 fallback | 39.7141 | 755.400 ms | 24.5275 ms | 35.140 ms |

Both WebGPU arms use identical package, guest executable, shaders, Rust module,
served runtime hashes, requested asset bytes, runner and six assigned CPUs.
The elapsed ratio is 16.597866670058963; the median ratio is 17.996521911954687.
No GL software comparison is claimed: the forced SwiftShader launch still exposes
physical NVIDIA through WebGL. The software control is host WebGPU SwiftShader,
not guest Mesa/Lavapipe.

The app links the pinned public Khronos static loader and calls actual `vk*`
functions. Each frame renders a full-screen triangle into 128×128 RGBA8 with an
8192-iteration, three-component f32 recurrence. Five warmup frames are excluded.
The guest monotonic clock surrounds `vkQueueSubmit` and `vkQueueWaitIdle`; the
recorded commands include render, texture-to-buffer readback and the host barrier.
Timing therefore includes GPU completion, readback and the guest/host transport.
It excludes the CPU reference calculation, boot and presentation; it is not
command-submission-only timing and is not capped by vsync.

On the first warmup frame each arm checks all **65,536 RGBA components** against
an independently computed C reference, with tolerance two byte values and zero
failures. All subsequent 34 frames have the same complete-buffer checksum as
that arm's checked frame. Hardware/software checksums differ within the allowed
floating-point tolerance; byte-identical cross-adapter pixels are not claimed.
All arms report 35 Rust passes/draws/completed readbacks, two translated shaders,
closed native state with zero resources/allocated bytes, one closed translator
and no cleanup errors. Each owned browser/server is reaped with an empty group.

Hardware identity comes from the same browser's navigator adapter
`nvidia/maxwell` and CDP SystemInfo primary NVIDIA MX110 (vendor 4318/device 5966,
driver 580.173.02). Rust BrowserWebGpu returns privacy-reduced empty PCI/name
fields, so these alone are not a hardware proof. The software arm reports
`google/swiftshader` and Rust device class `Cpu`; the hardware arm reports `Other`.
The GL arm reports its actual ANGLE NVIDIA renderer through Rust. Merely having
an i915 `/dev/dri` node does not establish which GPU this browser uses.
Actual browser children have oom_score_adj 0; no inherited 1000 claim is made.

## Implementation and supported scope

The path is public Vulkan loader → experimental guest ICD → kernel
`gpu_hostcall` → GPU owner Worker → bounded Naga SPIR-V translation →
wasm-bindgen module containing **real Rust wgpu** → browser WebGPU or WebGL2.
The existing direct JavaScript renderer remains a separate reference path;
the selected renderer does not call its GPU execution routines. wgpu owns the
device, queue, shaders, pipeline, vertex buffers, color targets, command encoder,
staging buffer, submission and map/completion callbacks.

The selected profile supports one instance/device/graphics queue, native buffer
and memory mapping, basic command buffers, float32-vector vertex inputs,
triangle-list drawing, one single-sample RGBA8 color attachment, render passes,
framebuffers, viewport/scissor and image-to-buffer readback. The guest advertises
128×128 maximum images/framebuffers; host validation also has bounded resources,
16 MiB allocation, 64 KiB vertex buffers, eight attributes/bindings and 256 draws
per pass. WebGPU vertex stride is bounded at 2048 bytes; GL uses 252 bytes and
requires integer viewport coordinates. Completion is synchronous at the guest
queue boundary; wgpu GL completion/map polling yields to the Worker event loop
and has a 60-second deadline.

This is a **nonconformant Vulkan subset**. The selected Rust backend rejects
compute, uniforms, descriptor resources, textures/samplers, depth/stencil,
push constants, index buffers, instancing, WSI and general Vulkan extensions.
Unsupported operations return errors; they are not silently accepted. The
existing ICD's additional optional profiles are not enabled by this benchmark.
The translator processes actual application SPIR-V and validates its entry,
interface and capabilities; it does not recognize benchmark shader hashes or
substitute CPU pixels. Its pinned Naga0.20 frontend emits WGSL; wgpu30 converts
that WGSL to GL shaders when GL is selected. General Vulkan→WebGL is not implied.

[wgpu's browser documentation](https://wgpu.rs/doc/wgpu/documentation/platforms/web/index.html)
describes wasm32-unknown-unknown, WebGPU and optional WebGL backends and matching
wasm-bindgen versions. The
[upstream GL adapter implementation](https://github.com/gfx-rs/wgpu/blob/v30.0.1/wgpu-hal/src/gles/web.rs)
requires a compatible surface. The fallback creates a private OffscreenCanvas
surface and retains it through teardown; rendering still uses offscreen textures.
`auto` first requests BrowserWebGpu, then explicitly constructs GL if adapter
acquisition fails. The explicit GL path has been executed; simulated missing
navigator.gpu/automatic fallback admission is not yet separately tested.

## Reproduction and retained failures

Sources are in `web/linux/tests/guest-vulkan-wgpu/`. Cargo.lock pins wgpu30.0.1,
wasm-bindgen0.2.129, wasm-bindgen-futures0.4.79 and js-sys/web-sys0.3.106.
`build-host.py` requires the installed wasm32 Rust target, cached locked crates,
matching bindgen CLI and wasm-objdump. It records compiler/version/command logs,
hashes and section sizes; release opt-level2 strips debuginfo, and both raw and
bindgen Wasm omit DWARF. No additional Binaryen optimization is used.

`build.py` requires the installed musl LLVM22.1.8 toolchain, glslangValidator,
spirv-val and wasm-validate. It reuses the retained Khronos loader archive in
`/mnt/p6/build/gpu-host-p1-20261001/graphics-build-run1`, enforcing SHA256
`de3ea65041731fd32e319a34e3282ec68933d7372ecc184a06b364fd671683f8` and
header-source hashes from its metadata. Loader/header commits are respectively
`61187c40845c92a80bcd2216089dd01badcda7ac` and
`98f440ce6868c94f5ec6e198cc1adda4760e8849`. Actual include dependencies are
recorded in the app build report. A clean-machine dependency acquisition workflow
is not provided by these bounded local builders.

Use fresh output paths under the task root; commands intentionally reject reuse.
All scratch is on disk, with a 20 GiB disk reserve and bounded owned children.
The runner obtains dynamic loopback HTTP/CDP endpoints, uses actual six host
CPUs and checks guest kernel SMP. Chromium hardware runs need the local graphical
session; software runs select SwiftShader explicitly. The healthy package keeps
PID1 alive after the app exits so a successful test does not cause a kernel panic.

```sh
export T=/mnt/p6/project/build/guest-vulkan-wgpu-20261003
export TMPDIR="$T/tmp" TMP="$T/tmp" TEMP="$T/tmp"
python3 web/linux/tests/guest-vulkan-wgpu/build-host.py --output "$T/host-build-next"
python3 web/linux/tests/guest-vulkan-wgpu/build.py --output "$T/app-build-next"
python3 web/linux/tests/guest-vulkan-wgpu/package.py --build "$T/app-build-next/build.json" --wgpu-dir "$T/host-build-next" --output "$T/package-next"
node web/linux/tests/guest-vulkan-wgpu/run-guest.mjs hardware webgpu "$T/hardware-next" "$T/package-next"
node web/linux/tests/guest-vulkan-wgpu/run-guest.mjs software webgpu "$T/software-next" "$T/package-next"
node web/linux/tests/guest-vulkan-wgpu/check-benchmark.mjs "$T/hardware-next/result.json" "$T/software-next/result.json" "$T/comparison-next.json"
node web/linux/tests/guest-vulkan-wgpu/run-guest.mjs hardware webgl "$T/fallback-next" "$T/package-next"
```

wgpu30.0.0 initially panicked at `backend/webgpu.rs:85` on the first target's
successful popErrorScope. Its binding used JsOption, which maps undefined rather
than WebGPU's nullable successful result. Official wgpu30.0.1 changes this to
JsNullable. The exact patch dependency fixes the real guest run; no global browser
API shim or vendored algorithm patch is used. Failed hardware-run1/run2, old
dependencies and diagnostic panic logs are retained. The first GL attempt without
a surface is retained as fallback-guest-run1. Both are failures, not acceptance.

The first immutable WebGPU pair measured 17.5749×. A fresh reviewer independently
passed 171 predicates on that earlier pair and exposed checker admission gaps
for mismatched served sources and contradictory Rust CPU adapter identity. The
hardened checker rejects 17 negative controls and accepts a harmless manifest
reordering. Its SHA256 is
`87466b282b137fa7406f074fd636df6f6aecebca0897c539295969353fd9d796`.
The **combined** candidate was rerun with that checker and passed; the earlier
171-check independent review does not cover the later GL/combined execution.

Raw logs, packages, source snapshots, build metadata and corrected comparisons
are pinned by [the compact evidence](evidence/guest-vulkan-wgpu-20261003.json).
The next current-Nightly integration work is recorded in
[the integration plan](firefox-nightly-gpu-integration-plan-20261003.md).
