# Next application milestone: guest Vulkan graphics

The compute milestone is verified separately in
[its execution report](guest-vulkan-compute-execution-20260926.md). This document
is an implementation plan, not evidence of graphics support. The overall
Firefox/JIT/GPU objective remains incomplete.

The next acceptance target is a separate public-Vulkan application supplying
vertex and fragment SPIR-V, drawing from mapped vertex buffers into an image,
then receiving shader-dependent pixels through `vkCmdCopyImageToBuffer`.
Reuse the pinned static Khronos loader, resource transport and readback. Keep
the accepted compute translator artifact and ABI frozen while developing the
graphics translation contract independently.

## Bounded implementation packets

Assign fresh delegated tasks with checkpoints at each boundary; aim for 20–30
minute packets, reporting unfinished work rather than claiming the whole port
can fit in that time.

1. Add a graphics translation contract reflecting validated IR: stage,
   original/emitted entry names, input/output locations and types, interpolation,
   and resource requirements. Reject unsupported capabilities honestly.
2. Verify supplied vertex/fragment pairs in the browser GPU, including arbitrary
   entry names, name collisions, mismatched interfaces, asymmetric coverage,
   clip depth and shader-dependent colors. This alone is not guest acceptance.
3. Add a negotiated graphics protocol with declarative vertex layouts,
   pipelines, vertex allocation/upload and begin/draw/end rendering. Reuse
   texture targets and padded-row readback; preserve validation and budgets.
4. Add guest image views, render passes, framebuffers and graphics pipelines.
   Factor shared shader/layout lifetime handling out of compute-specific code.
   Use explicit resource/state types instead of extending ambiguous numeric
   operation and overloaded-field conventions indefinitely.
5. Record copied graphics state and prevalidate the whole command stream,
   including live objects, buffer ranges, attachment compatibility and barriers.
   Upload coherent vertex data at submission time. A render pass should contain
   its draws without a host wait after every draw.
6. Build the public-header-only application against the actual loader archive.
   Test two declarative vertex layouts and independently changed vertex and
   fragment programs, mapped-data changes after recording, readback and tails.
7. Run it in the real guest with authoritative memory/CPU markers, shader and
   source hashes, host operation counts, adapter identity and independent native
   resource ownership. Packets 1–7 together deliver the first new capability.
8. Test malformed-shader recovery, interface rejection, stale references,
   bounds/barriers, exhaustion and loss during graphics readback, then relevant
   shared regressions. Present returned pixels through X11 with expose/repaint
   and a second frame; the application must not call the private GPU protocol.

## Initial profile and correctness decisions

Start with one RGBA8 UNORM, optimal-tiled, single-sample color attachment;
`COLOR_ATTACHMENT | TRANSFER_SRC` image usage; a Vulkan 1.0 render pass with one
subpass; empty pipeline layout; triangle lists; fill; no depth, blending or
optional features; and one viewport/scissor. Vertex bindings and attributes
should declare bounded strides, offsets, locations and float32 vector formats,
supporting interleaved and separate bindings. Never identify shaders by byte
fingerprint or substitute the old host's fixed `vs`/`fs` and 20-byte vertex path.

Validate every supported pipeline field, attachment clear/store behavior and
pipeline/render-pass/framebuffer compatibility. Preserve pipeline usability
after shader-module destruction. Track host-write→vertex-read,
color-write→transfer-read and transfer-write→host-read visibility explicitly.
Unsupported format features, extensions and dispatch shapes remain disabled.

The pinned [Naga SPIR-V frontend](https://raw.githubusercontent.com/gfx-rs/wgpu/c7458638d14921c7562e4197ddeefa17be413587/naga/src/front/spv/mod.rs)
has coordinate adjustment and entry wrappers. Evaluate graphics translation
with `adjust_coordinate_space:true`; the compute setting is not a graphics
precedent. Reflect interfaces from validated IR, not emitted WGSL text. Verify
the complete transform against [WebGPU coordinate conventions](https://gpuweb.github.io/gpuweb/#coordinate-systems)
using asymmetric landmarks; do not stack unverified Y flips. Avoid exact edge
coverage/UNORM rounding assertions; use well-inside regions and exact endpoint
colors, with a justified tolerance only for intentional interpolation tests.

## Fallback and application integration

Separate protocol validation from renderer operations so the same public guest
graphics app can later run with WebGPU unavailable and forced WebGL2. Evaluate
the pinned [Naga GLSL backend](https://raw.githubusercontent.com/gfx-rs/wgpu/c7458638d14921c7562e4197ddeefa17be413587/naga/src/back/glsl/mod.rs)
for ES 3.00 output and reflection. Verify shader coordinate adjustment and
readPixels row order together. [WebGL2](https://registry.khronos.org/webgl/specs/latest/2.0/)
does not supply this compute/storage profile; advertise backend-specific limits.

Subsequent graphics work needs sampled images/samplers, uniform descriptors,
indexed draws, blending, depth/stencil and multiple draws/passes. Pin the intended
Mesa revision and compare its actual Zink requirements with supported features
before attempting a full build. Consult [Zink requirements](https://docs.mesa3d.org/drivers/zink.html)
and evaluate [Mesa Vulkan runtime utilities](https://docs.mesa3d.org/vulkan/index.html)
for scalable dispatch/object infrastructure. A triangle does not establish Zink
compatibility. XPutImage presentation does not establish Vulkan WSI. Firefox
still needs a guest EGL/GL/window/compositor path and observed renderer selection;
native JIT and video decoding remain separate work.
