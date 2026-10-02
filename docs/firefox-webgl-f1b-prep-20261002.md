# Firefox WebGL F1b preparation — 2026-10-02

Read-only preparation while JIT acceptance runs. No GPU implementation,
relink, browser or regression gate was run for this document. Existing F1a,
Mesa and B2g artifacts remain unchanged. Merge lineage and exact object hashes
are in [the route document](guest-gpu-route-20261002.md#link-lineage-preserve-jit-add-w0w1-explicitly).
The accepted JIT archive must be chosen after its final gates; the new cache
candidate is not yet accepted.

## Actual Firefox context selection

The pinned source is Firefox 128.14.0 in
`/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/var/nix/builds/nix-721784-2625232085/build/firefox-128.14.0`.

1. `dom/canvas/WebGLContext.cpp:275–407` requests robustness when available,
   but retries context creation without robustness attributes. WebGL1 sets
   PREFER_EXACT_VERSION and, unless `webgl.1.allow-core-profiles` is enabled,
   REQUIRE_COMPAT_PROFILE. That pref defaults false on Linux
   (`StaticPrefList.yaml:16075`); the macOS default is different.
2. `gfx/gl/GLContextProviderLinux.cpp:36` chooses EGL when gfxVars::UseEGL()
   is true, otherwise GLX. F1a's early `gfx.x11-egl.force-enabled` and EGL
   glxtest adapter establish the intended EGL path. As a diagnostic-only
   launch option, MOZ_WEBGL_FORCE_EGL takes the direct EGL provider branch;
   log whether the ordinary forced-EGL pref path also succeeds.
3. `GLContextProviderEGL.cpp:1134–1222` first tries no-config/surfaceless
   contexts when Mesa advertises both extensions. Otherwise it chooses a
   config and creates a 16×16 dummy pbuffer. No X11 EGL window surface or
   Vulkan swapchain is required for this headless WebGL context.
4. `gfx.egl.prefer-gles.enabled` defaults false on this GTK/wasm target
   (`StaticPrefList.yaml:6179`); it is a once-read pref. The first WebGL1
   context request therefore binds EGL_OPENGL_API and asks for OpenGL 2
   compatibility (`GLContextProviderEGL.cpp:611–654`). If that attempt fails,
   Firefox tries GLES2. The known probe reports desktop `2.0 Mesa 26.2.3`
   with GLSL 1.20 and GLES `OpenGL ES 2.0 Mesa 26.2.3` with GLSL ES 1.0.16.
5. WebGL2 adds PREFER_ES3. With the default desktop preference and no compat
   requirement, the EGL provider first asks for GL 3.2 core, then GLES3 if
   creation fails. If gfxVars::WebglAllowCoreProfile() is false it also sets
   REQUIRE_COMPAT_PROFILE; log the actual flags rather than assuming one
   profile. Neither GL3.2 nor GLES3 is proven by the current Zink build.

F1a's constructor registers libEGL.so/libGL.so with NSPR, sets
EGL_PLATFORM=surfaceless, MESA_LOADER_DRIVER_OVERRIDE=zink and
LIBGL_ALWAYS_SOFTWARE=1 when unset. CPU device type is therefore intentional
for the virtual ICD. Ordinary host NVIDIA execution still needs separate
owner-side adapter evidence. Forcing preferences does not add missing GL
features or fix rejected image operations.

## Creation checks and the 128/2048 distinction

`WebGLContextValidate.cpp:313–329` unconditionally rejects fewer than eight
vertex attributes or fewer than eight combined texture units. Eight vertex
attributes are advertised by the ICD. Per-stage texture/sampler limits are
four; Zink passes those to Gallium, while Mesa computes combined texture
units by summing supported stages (`zink_screen.c:641`,
`st_extensions.c:349–374`). Thus four per stage does not by itself prove the
combined value is below eight. The current probe did not log the combined
query; capture it in F1b. Fragment texture units must also be reported honestly;
a four-texture pipeline is not a general eight-sampler WebGL implementation.

There is no unconditional 2048 texture/renderbuffer creation check in this
Firefox revision. Its optional `webgl.min_capability_mode` branch requires
1024 for 2D textures/renderbuffers and 512 for cube textures; its fingerprinting
resistance branch restricts these three caps to 2048 and fails if the driver
cannot supply them (`WebGLContextValidate.cpp:400–480`). Keep those policy
branches distinct from the default creation path. The historical B2f doc's
brief “WebGL needs 2048” statement is too broad for this exact Firefox path.
The [WebGL1 specification](https://registry.khronos.org/webgl/specs/latest/1.0/#the-drawing-buffer)
also permits a smaller drawing buffer when the requested dimensions cannot
be satisfied; acceptance must compare drawingBufferWidth/Height, rather
than treating CSS canvas size as proof of native rendering resolution.

The 128 limit still prevents a native 320×240 cube and common larger pages.
Firefox's `EnsureDefaultFB` halves both dimensions after allocation failure
(`WebGLContext.cpp:448–491`), potentially making an apparently working
320×240 canvas render at 80×60. Query and assert the actual dimensions.

Other early failures include GL errors left by initialization, unsupported
format-usage setup, shader-translator initialization, default-FBO allocation
and incomplete framebuffer status. Capture the precise FEATURE_FAILURE
identifier, context-creation event status text and ICD reject trace. Do not
replace a failed capability query with invented numbers.

## Default depth and visible presentation are separate blockers

`EnsureDefaultFB` passes `(options.depth || options.stencil)` to
MozFramebuffer, not separate depth/stencil choices. In
`gfx/gl/MozFramebuffer.cpp:134–177`, DepthAndStencilBuffer::Create allocates
DEPTH24_STENCIL8 when packed-depth-stencil is supported, or separate
DEPTH_COMPONENT24 and STENCIL_INDEX8 otherwise. Therefore even a WebGL page
using only default depth can reach a stencil allocation path. The ICD accepts
only D16_UNORM and D32_SFLOAT depth attachments and rejects stencil formats
and state. Single-sample fallback removes the MSAA requirement but does not
remove this depth/stencil requirement.

Use `{depth:false, stencil:false, antialias:false}` for the first diagnostic
context, while explicitly recording that this is a bounded color-only gate.
Do not present it as default-context or depth-cube acceptance. Actual packed
depth/stencil backing is the preferred adapter/ICD implementation. A Firefox
hook separating depth-only allocation would need justification and would
still leave real stencil support incomplete.

ReadPixels is not sufficient to prove visible canvas presentation.
`WebGLContext::PresentInto` acquires another swapchain surface and calls
BlitBackbufferToCurDriverFB. The latter uses framebuffer blit when available;
otherwise (or for BGRA conversion) it samples the color attachment through
a textured blit shader (`WebGLContext.cpp:889–952`). Current guest
vkCmdBlitImage/vkCmdCopyImage routes are not implemented. Moreover Zink color
images with attachment plus sampled usage are made render-target-only by
`transfer.inc:252–253` (`sampled=0`). Sampling their rendered contents fails.
The existing glgears path does not exercise either operation: it reads pixels
and presents an XImage itself.

A basic CPU-backed Firefox surface may avoid DMA-BUF/external-memory paths,
but it still needs the actual GL copy/blit and readback path selected by
Firefox. Record the SurfaceFactory type. Do not fake an EGLImage or external
fence; TinyX has no accelerated GLX route. Screenshot rotation and readback
pixel equality are distinct acceptance evidence.

## Resolution/backing changes required

| Layer | Current actual restriction | Needed for a tested larger-color packet |
|---|---|---|
| Vulkan properties/HELLO | icd.c:289–302 dimensions/framebuffer/viewport128; image-format properties:438 extent128/resource65536; HELLO hardmatches texture/depth dimension128 | Negotiated bounded capability values, queried host limits and consistent per-format query/create bounds |
| Image allocation | transfer.inc:236 one mip/one layer, dimensions128; 256 MiB guest heap under Zink | Checked width×height×bytes calculation and actual backing; preserve supported mip/layer counts until those implementations exist |
| Viewport/scissor | graphics.inc:139–141 static bounds128; dynamic draw validation uses image dimensions | Same negotiated dimension for static and dynamic paths; positive and negative boundary tests |
| Host color targets | GRAPHICS_LIMITS.maxTargetSize512; graphics/host maxBytes16 MiB | Color allocations genuinely permit the chosen size; account target, depth, staging and retained surfaces, not only one image |
| Host sampled/depth images | TEXTURE_LIMITS.maxDimension128; host.mjs depth handler:389 bound128 | Real larger native textures/depth objects plus truthful metadata; WebGL2 fallback must check native limits too |
| Upload | texture.inc:46 fixed65536+12 array, whole-image staging-only upload; generic Zink buffers rejected | Heap/chunked bounded upload, generic buffers/subregions/row pitch; render-target COPY_DST role and layout transitions |
| Readback | transfer.inc:734 fixed65536 stack array and full-image readback | Heap-owned bounded buffer or tiled copy; correct BGRA swap, subregion/row pitch and overflow checks; never simply enlarge the stack array |
| Transport | host/vk MAX_PAYLOAD1 MiB; GPU_TEXTURE_UPLOAD has12-byte metadata before pixels | Check full message/response sizes; chunk/tile larger transfers or version protocol limits with measured memory bounds |
| Sampling/copy | attachment resources sampled=0; no render-target sampling or Vulkan blit/image-copy | Same underlying host texture with RENDER_ATTACHMENT/TEXTURE_BINDING/COPY_SRC/COPY_DST roles, validated views/barriers, copies and feedback-loop exclusion |

A 320×240 RGBA readback is 307,200 bytes: already larger than the guest's
64 KiB array but within the current transport ceiling. A 2048² RGBA image is
16 MiB; upload/readback exceeds the 1 MiB protocol ceiling and one image alone
consumes the current host budget. Raising an advertised cap to 2048 requires
actual larger backing plus tiling/chunking, revised budgets and tests of
simultaneous color/depth/staging resources. Host GPU native limits alone do
not establish these adapter capabilities.

Cube maps (six layers), mip chains, subregion uploads, texture filtering and
legacy RGBA4/RGB565/alpha/luminance format mappings are separate missing
backing semantics. maxImageDimensionCube is not currently populated and
image creation rejects multiple layers. Do not advertise a cube size without
implementing cube-compatible images/views. General WebGL2 further requires
packed depth/stencil, 3D textures, float/half-float/storage, instancing,
queries, transform feedback, sampler objects and restart support, among the
mandatory list in WebGL2Context.cpp:28–115. A GL version-string override
would not satisfy this list.

## Small packets after GPU release

1. **F1b diagnostic relink:** copy the fully accepted JIT command/archive and
   merge the W0/W1 and current B2g EGL/ICD/Mesa plus B2c override as described
   in the route doc. Preserve old candidates. Add test-only trace wrappers or
   existing GL spew to log EGLAPI/profile/version, requested flags and the
   first rejected allocation/copy. First exercise a 64×64 color-only WebGL1
   context, clear and triangle, exact readPixels, GL errors, actual dimensions
   and repeated destroy/recreate. Test normal desktop-first selection and an
   isolated early GLES preference to distinguish profile-specific failures.
   A visible screenshot is an additional gate; allow a diagnostic failure
   with precise evidence rather than relaxing unsupported caps.
2. **Larger color backing/copy:** choose a bounded first ceiling (for example
   512), replace 64 KiB readback/upload assumptions with checked heap or tiled
   buffers, and implement real shared sampled/attachment texture roles plus
   the copy/blit path used by Firefox. Test 320×240 and non-square/odd widths,
   BGRA/RGBA, partial readback, render-to-texture feedback rejection and
   boundary/over-budget failures. At 512² the upload metadata makes a single
   full upload exceed 1 MiB; tile it or choose a lower first bound deliberately.
   Run earlier Vulkan suites, both host backends and EGL/Zink probes.
3. **Default depth/cube:** implement honest D24S8 host/ICD format queries,
   image/view aspects, clears/load/store and relevant stencil pipeline state;
   prove default WebGL framebuffer creation and cube occlusion. MSAA may
   remain unavailable and Firefox can select single-sample contexts; report
   actual antialias attributes. Finish the actual Firefox presentation path,
   requiring native 320×240 drawing buffer and two differing rotation frames.
4. **Broader caps:** only then target 1024/2048, eight sampled textures and
   cube/mip/format semantics, with bounded chunked transport and resource
   accounting. Treat WebGL2 as its own GL3/GLES3 feature packet, not an
   automatic result of increasing texture resolution.

These packets are proposed, not authorized GPU implementation in this turn.
All future candidates must retain TLS/NSS, packed DevTools workaround,
accepted JIT archive and growable table, home/profile/update behavior, and
pass startup/update/JIT gates after the GPU merge. The 128 px gears comparison
remains the current measured graphics milestone.
