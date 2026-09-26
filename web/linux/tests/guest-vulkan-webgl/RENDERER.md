# Bounded WebGL2 renderer

`createWebGLRenderer(gl, {onEvent, fenceTimeoutMs})` uses an exclusively owned
WebGL2 context. The caller creates and ultimately releases the context; renderer
close releases its own native objects and event listener. No protocol, Worker,
guest memory, canvas presentation, or fallback selection is performed here.

The resource/pass interface matches the existing WebGPU renderer. Shader
validation is genuinely GLSL-specific (`validateWebGLShader`); common pipeline
declarations use `validatePipelineDescriptor(input, validateShader)`. Its default
validator remains WGSL. No GLSL metadata is disguised as WGSL.

| API | Contract |
| --- | --- |
| `createPipeline(descriptor)` | Copy and validate translation/layout metadata before queueing; compile/link actual GLSL; verify active attributes and empty uniforms |
| `createVertexBuffer({size})`, `uploadVertexBuffer(handle, offset, bytes)` | Bounded aligned buffers; copy upload input immediately |
| `createTarget({width,height,format})` | One immutable RGBA8 texture/framebuffer, initially not stored |
| `begin(pass)`, `draw(draw)`, `abort()` | Synchronous bounded recording with copied descriptors and opaque resource handles |
| `end()` | Revalidate the entire pass before effects; submit and await a yielding fence |
| `readback(target)` | Pixel-pack buffer and yielding fence, followed by copied RGBA8 rows in guest logical order |
| `destroy(handle)`, `close()` | Serialized resource release; immediate idempotent close cancels waits and clears ownership |
| `getStats()` | Immutable state, budget, operation, and native ownership snapshot |

Creation/upload/submission/readback/destruction return promises; argument checks
may throw synchronously. Calls are serialized. Input validation and budget
failures before execution preserve the session. An unexpected execution failure
after possible effects becomes terminal `gpu` / `-5`, including native out of
memory. Close/context loss reject pending operations as `unavailable` / `-19`.
Fence deadlines are configurable from 1 to 30,000 ms, default 10,000 ms.

## Limits and coordinates

The profile retains 64 public resources, a 16 MiB tracked byte budget,
512×512 RGBA8 targets, 64 KiB vertex buffers, at most eight vertex attributes,
256 draws/pass, and triangle lists without blending, depth/stencil, culling,
instancing, textures, descriptors or arbitrary shader resources. Pipeline source
copies and temporary readback/index buffers count against the byte budget.

WebGL accepts vertex strides only up to 255 bytes; four-byte alignment makes
this renderer's limit **252 bytes**. Viewport coordinates and sizes must be
integers. Unsupported values reject before drawing. These differences must be
reflected in host capability negotiation and guest limits before integration.
See the [WebGL specification](https://registry.khronos.org/webgl/specs/latest/1.0/).

The verified translator's two coordinate adjustments, positive viewport/scissor
and direct readback establish guest row zero without an extra row flip. Real
same-SPIR-V tests across WebGL/WebGPU cover asymmetric geometry, near/far clip
rejection, perspective interpolation, fragment position x/y/z and reciprocal-w.
Normal triangle boundary bands are excluded from comparisons; this is not a
claim that every rasterized edge byte matches across APIs.

Vulkan's first provoking vertex differs from base WebGL's last vertex. The
renderer requests `WEBGL_provoking_vertex` and selects its first convention if
available. Otherwise, only draws consuming flat varyings use one bounded,
reused index buffer, rotating each triangle `[a,b,c]` to `[b,c,a]`; winding and
vertex values are retained. The current browser does not expose the extension,
so the native extension optimization remains untested. The index path passed
actual pixels, nonzero `firstVertex`, and multiple primitives. See
[the extension specification](https://registry.khronos.org/webgl/extensions/WEBGL_provoking_vertex/).

## Verification

Current accepted gate:
`/mnt/p6/build/guest-vulkan-webgl-20260926/renderer-browser-run4/result.json`.
It passes **46 pixel cases and 84 rejection/lifecycle cases**, with 162,287 checks
mostly comparing individual pixels. All seven WebGL contexts have zero tracked
native objects before emergency cleanup. WebGPU's 77 tracked buffer/texture
objects are also released normally. Both backends use software rendering.

Tests use actual translated SPIR-V and native rendering. GL error and timeout
injection is explicitly test-only; it checks failure handling, not evidence of
real hardware faults. Context loss uses `WEBGL_lose_context`. The finite owned
Chromium process exits with code zero. The runner freezes current source and
shader identities before execution and verifies them afterward.

With the disk-backed TMPDIR/TMP/TEMP setup from `AGENTS.md`:

Use Node 22 or newer. The recorded fixture-generation command is for a fresh
workspace; when its verified output already exists, run only the browser gate
with a fresh output directory.

```sh
python3 web/linux/tests/guest-vulkan-webgl/prepare-renderer-fixtures.py --output /mnt/p6/build/guest-vulkan-webgl-20260926/renderer-fixtures-run1
node web/linux/tests/guest-vulkan-webgl/run-renderer-browser.mjs /mnt/p6/build/guest-vulkan-webgl-20260926/renderer-browser-run5
```

The fixture output must be fresh; the example fixture directory already exists
in this workspace. The runner currently uses pinned translator builds and
the accepted fixture directories. Preserve earlier runs, including source
snapshots; do not overwrite them. No HTTP server is needed for this finite gate.

Next: host backend negotiation, disposable translator Worker verification,
accurate guest Vulkan limits, and real Linux fallback execution. This is still
a nonconformant experimental driver component, not Firefox/OpenGL support or
evidence of physical acceleration.

The [compact checkpoint evidence](../../../../docs/evidence/runtime-graphics-20260926/guest-vulkan-webgl-renderer.json)
records 71 source/artifact/process audit checks and links the raw browser result.
