# Guest GPU foundation and ANGLE port boundary

The isolated prototype under `web/linux/tests/guest-gpu/` makes guest C code
submit shader, buffer, pipeline, draw and readback requests over virtio-vsock.
The host executes WebGPU, and the guest checks returned pixels and calls
XPutImage. It does not implement Vulkan, EGL/GLES, Firefox WebGPU, hardware
decoding or physical GPU discovery.

The guest binary built and passed the existing Wasm Linux ABI gate: only shared
`env.memory` and `linux.syscall/get_thread_area/copy_siginfo` imports. Its
848,316-byte artifact has SHA-256
`6a0753982c23df2ec40944cb87f7368788df8d879fed2f5da7ecc20777048352`.
An isolated CPIO preserves 3,846 original records and the archive tail, changes
only `/init` and adds the test executable. Accepted images are unchanged.

The browser host passed 38 checks with Google SwiftShader, including actual
shader execution, readback, resource bounds and device-loss cleanup. The third
guest run then passed the complete C → vsock → browser WebGPU → pixel readback →
guest X11 path in 3.231 seconds measured by the runner. All three guest markers
passed; the center pixel was RGBA `63,66,126,255`. The host handled 13 commands,
one draw, one readback and four releases with no error. Guest errors and browser
runtime exceptions were empty. The screenshot shows the RGB triangle in an X11
window. Google SwiftShader reported `isFallbackAdapter=true`: this is software
adapter semantics, not physical GPU acceleration.
[Compact result](evidence/runtime-graphics-20260926/guest-gpu-qa3.json),
[guest window](evidence/runtime-graphics-20260926/guest-gpu-qa3.png)

Two earlier fixture failures are preserved in the task cache. The first runner
could click before the module installed its handler and discarded interim state
on timeout; no guest-crash conclusion follows. The second run acknowledged the
click but TextDecoder rejected its shared guest-memory console view. Copying
console bytes into an ordinary buffer and retaining a streaming decoder fixed
that fixture. The successful third run used the checked-in diagnostic runner,
SHA-256 `fdda87f7cfb22ec119e6694fd2ff2d56b4c10bf33b1b6c26261b2080bb958b3b`.
The same guest binary and isolated archive were used; accepted rootfs images
and production startup remain unchanged.

## Reusable upstream boundary

Research uses ANGLE commit `c2fbfadacf8679abe316941d1ac5310f6c1645a1` and its
[pinned Dawn dependency](https://github.com/google/angle/blob/c2fbfadacf8679abe316941d1ac5310f6c1645a1/DEPS),
`c3d35d65fb2f087c425ba20050c5ff03d32f1114`. These are fixed research inputs,
not a claim that either is the latest release.

ANGLE's WebGPU display accepts a supplied DawnProcTable, instance and device.
It also implements offscreen pbuffer creation. This is a concrete potential
guest EGL integration point: guest opaque handles could wrap bounded transport
IDs, while the table's actual C functions dispatch to browser WebGPU.
[DisplayWgpu.cpp](https://github.com/google/angle/blob/c2fbfadacf8679abe316941d1ac5310f6c1645a1/src/libANGLE/renderer/wgpu/DisplayWgpu.cpp)

Injection alone does not remove native dependencies. The default table provider
calls `dawn::native::GetProcs()`, and its expression is evaluated when choosing
the display attribute. The backend's GN target explicitly links Dawn native,
Dawn proc, headers, image utilities and ANGLE's shader translator. A port must
replace the default provider and change that build dependency deliberately.
[Proc provider](https://github.com/google/angle/blob/c2fbfadacf8679abe316941d1ac5310f6c1645a1/src/libANGLE/renderer/wgpu/wgpu_proc_utils.cpp),
[backend build](https://github.com/google/angle/blob/c2fbfadacf8679abe316941d1ac5310f6c1645a1/src/libANGLE/renderer/wgpu/BUILD.gn)

The EGL static target pulls GLES and the ANGLE core; the shader translator adds
its parser, preprocessor, generated tables and WGSL output, with other build
dependencies such as SPIR-V headers and Abseil. No wasm-musl build of this
closure has been attempted, and its compile-unit count or porting duration is
not measured. It is not a small standalone renderer source file.
[ANGLE build targets](https://github.com/google/angle/blob/c2fbfadacf8679abe316941d1ac5310f6c1645a1/BUILD.gn)

## Next independent acceptance gates

1. Generate official headers from the pinned Dawn source, using its generator
   target `headers`; do not invent similar-looking declarations. The generated
   `dawn/webgpu.h` and `dawn/dawn_proc_table.h` are not supplied by the checked-in
   wrapper `webgpu/webgpu.h`. The gate would fetch an explicit small allowlist,
   verify Git blob identities, record SHA-256 and generator dependencies, and
   stop before compilation. No fetch script has been executed or source tree
   downloaded. [Dawn header generation](https://github.com/google/dawn/blob/c3d35d65fb2f087c425ba20050c5ff03d32f1114/include/dawn/BUILD.gn)
2. Compile a C client against those exact signatures and implement a bounded
   proc-table subset for device/queue, texture/view, command encoder/pass,
   submission, staging buffer, map future, callback and readback. Exercise real
   clear/readback and failure cleanup before calling it an ANGLE backend.
3. Compile the ANGLE translator and selected backend units for wasm-musl, then
   establish the full link closure. Only a linked, guest-executed EGL pbuffer
   `glClear`/`glReadPixels` test proves that next integration stage. Shader-based
   GLES, capability reporting, X11 presentation and Firefox come afterward.

ANGLE's buffer readback uses asynchronous mapping followed by instance WaitAny.
The guest shim therefore needs typed future and callback registries; browser
promises cannot be reinterpreted as native futures. Guest callbacks run inside
the guest after transport completion. Guest pointers, userdata and function
pointers must never become host object addresses. Strings need owned bounded
copies, chained descriptors need explicit validation, and unsupported options
need real errors. The initially inferred clear/readback subset includes object
reference operations, device limits/queue, texture/view and buffer creation,
render-pass clear, copyTextureToBuffer, queue submit, mapAsync, WaitAny,
getConstMappedRange and unmap; a traced call inventory is still required.
[Readback and mapping implementation](https://github.com/google/angle/blob/c2fbfadacf8679abe316941d1ac5310f6c1645a1/src/libANGLE/renderer/wgpu/wgpu_helpers.cpp)

The archived Firefox 128 source already has serialized DeviceAction,
QueueWriteAction and command-encoder actions in `gfx/wgpu_bindings/src/server.rs`.
Its wasm32 patch explicitly selects the Empty HAL. That serialization is another
potential integration boundary, but the current triangle protocol covers only
a small subset; changing preferences cannot replace the missing backend.

Vulkan remains unresolved: browser WebGPU does not directly expose Venus's
external-memory/virtio requirements or Zink's Vulkan capability surface.
A WebGL2 transport fallback would need explicit GLSL/capability negotiation;
it cannot silently treat WGSL as GLSL. Hardware video decode needs its own
compressed-video API and format, timing and ownership work.
[Venus requirements](https://docs.mesa3d.org/drivers/venus.html),
[Zink requirements](https://docs.mesa3d.org/drivers/zink.html)
