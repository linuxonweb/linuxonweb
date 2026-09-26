# WebGL2 fallback for guest graphics

The preceding [guest graphics milestone](guest-vulkan-graphics-execution-20260926.md)
verifies public Vulkan calls through Linux to browser WebGPU. The next capability
is the same application rendering through WebGL2 when WebGPU is unavailable.
This plan preserves the full Firefox/JIT/OpenGL objective; fallback for this
bounded Vulkan profile does not complete it.

## Implementation packets

1. Add a separately versioned, hash-pinned SPIR-V→GLSL ES 3.00 translator using
   the existing archived Naga dependency closure. Preserve both accepted WGSL
   translator artifacts. Compile and verify real output and rejection/recovery.
2. Implement a WebGL2 renderer with the same bounded resource/pass/readback
   contract. Reuse genuinely backend-independent validation where practical;
   never disguise GLSL metadata as WGSL to bypass a validator. Validate all
   commands before pass effects, copy caller-owned data, and release every
   native object on normal close, error and context loss.
3. Exercise real GLSL compilation/linking and shader-dependent pixels in a
   browser. Compare the existing eight shader/layout combinations against the
   independent Vulkan viewport oracle. Add negative/far clip depth and varying
   non-unit-w cases, plus viewport/scissor, load/store, mutations, stale handles,
   budgets and context loss. Track shaders, programs, buffers, textures,
   framebuffers, vertex arrays and any sync objects independently of renderer
   counters; inspect ownership before emergency cleanup.
4. Add explicit backend selection to the shared protocol host. Prefer WebGPU;
   permit WebGL2 only when initial WebGPU acquisition is unavailable and the
   requested graphics profile can be supported. A failed shader or a device
   lost after resource creation must not silently trigger a different backend.
   HELLO and queue flags must accurately describe the selected backend. WebGL2
   must not advertise compute or accept the private WGSL operations.
5. Run the same public Vulkan application in actual Linux with WebGPU disabled
   or absent and verify its pixels, operation counts, kernel markers and cleanup.
   Verify WebGPU preference when available and preserve the existing WebGPU and
   compute regressions. Check unsupported/no-backend behavior explicitly.
6. Checkpoint the verified capability, then continue X11 presentation and the
   larger Mesa/Zink/Firefox integration. Do not deploy isolated test routes as
   a substitute for the requested runtime integration.

## Translation and coordinates

The pinned [Naga GLSL backend](https://raw.githubusercontent.com/gfx-rs/wgpu/c7458638d14921c7562e4197ddeefa17be413587/naga/src/back/glsl/mod.rs)
supports an explicit WebGL ES 3.00 target. The existing archived `glsl-out`
feature declares no additional dependencies. Use validated IR reflection and
the writer's actual output/reflection; preserve original application entry
names while recording the emitted GLSL entry name.

Start with the existing SPIR-V front-end coordinate adjustment and the GLSL
writer's explicit coordinate-adjustment flag. The writer applies a Y inversion
and converts depth to GL clip space. Treat shader output, viewport/scissor
coordinates, fragment position and readPixels row order as one contract. Do not
add an assumed extra row flip: establish byte parity with the positive-height
Vulkan viewport oracle and asymmetric geometry first. Varying clip w needs
perspective-correct color expectations, not affine interpolation.

The WebGL profile initially keeps empty resource layouts, float32 vector vertex
attributes, RGBA8 color, triangle lists, no culling/depth/blending and bounded
targets/buffers. Reject linear/noperspective interpolation when the WebGL target
cannot express it without an unsupported extension. This backend restriction
must remain explicit rather than advertising parity with every WGSL input.

## Evidence and operational boundaries

Preflight is `/mnt/p6/build/guest-vulkan-webgl-20260926/preflight-run1`: parent
`094d0be13fc930d139344bc7660b65ddfd280dfd` and nested Sites tracked/index state
were clean; ports 4182/9396 were closed; the user's server identity was preserved.
The new task and its short scratch directory are verified ext4. Every build,
cache, profile, log and temporary artifact must stay on disk-backed storage.

Only the existing sole serving owner may start test services. Previous adapter
exits had no established cause, including an exit within an active owner turn.
Check current PID identities, handles, ports and HTTP health before each runtime
gate. An observation timeout alone does not justify a restart. Preserve failed
attempts and stop command agents at their first error for root review.

Neither translator compilation nor browser-only pixels establish Linux fallback.
SwiftShader results establish API behavior, not physical GPU acceleration.
Firefox EGL/GL/compositor integration, native JIT, hardware decoding and final
release acceptance remain separate requirements.
