# Shared Rust graphics runtime v1

This stable package contains the exact wgpu 30.0.1 / wasm-bindgen 0.2.129
resource renderer accepted by the retained Vulkan and Mesa EGL primitive tests.
The Wasm and generated JavaScript were copied without rebuilding or optimizing.
`provenance.json` records their original build, hashes and dependency notices.

The machine GPU owner uses this package only when explicitly configured with
`gpuHostcall.ownerConfig.vk = { backend: 'wgpu', wgpuBackend: 'auto',
allowResources: true }`. `wgpuBackend` accepts `auto`, `webgpu` or `webgl`.
Auto requests genuine Rust BrowserWebGpu first, then genuine Rust Gl on
acquisition failure. Guest force-WebGPU/force-WebGL flags select that backend
within Rust when this route is enabled. The default public selector is unchanged.

The bounded graphics profile supports triangle draws, RGBA8 readback, uniform
buffers, sampled textures/samplers and depth attachments. Compute, arbitrary
instancing, blending, MRT, stencil and window swapchain presentation remain
unsupported here. Mesa's existing bounded index expansion is guest-side.

Fresh native Mesa primitive runs through this shared import passed on NVIDIA
BrowserWebGpu, SwiftShader BrowserWebGpu and NVIDIA ANGLE through Rust Gl. Each
used six frames, 98,304 pixel checks, texture/uniform/depth resources and a
depth-disabled control, with matched host/browser/guest CPUs and clean resource
and process shutdown. The receipts and their independent review are recorded in
`docs/evidence/shared-rust-gpu-service-20261006.json` at the repository root.
This evidence is scoped to those native binaries and workloads. Concurrent
process isolation, installed shared guest libraries, Vulkan/GL conformance,
Firefox WebRender/WebGL/WebGPU, performance and release acceptance remain open.

The separate current-Nightly remote WebGPU codec/client is not this protocol.
Production's historical OP_WGPU executor remains a separate integration gap.
