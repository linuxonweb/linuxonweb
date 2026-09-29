# Zink B0/B1: wasm32 Mesa configure blockers and measured Zink Vulkan requirements — 2026-09-28

Packet: Zink B0 (cross-configure Mesa 26.2.3 for wasm32) and B1 (measure what
Zink actually needs from a Vulkan driver, gated per GL level), with a comparison
against the guest ICD `web/linux/tests/guest-vulkan/icd.c`. Background is Track B
of `docs/vulkan-gap-zink-vkcube-20260928.md`. Compact evidence is in
`docs/evidence/zink-20260928/requirements.json`.

All work lives under `/mnt/p6/build/zink-b0b1-20260928` (ext4 on
`/dev/nvme0n1p6`), with TMPDIR/TMP/TEMP, XDG, pip and ccache caches in that
directory. No upstream Mesa file was modified. No browser or service was started,
and no tracked source file was edited.

Mesa source is the 26.2.3 tarball from `/mnt/p6/build/zink-gap-20260928/`
(sha256 `1628058a…a81f`), extracted to `mesa-26.2.3/`. The libdrm fallback uses
Mesa's own `subprojects/libdrm.wrap` (2.4.133, packagecache tarball sha256
`fc68f9d0…77b4f5`).

## B0 — wasm32 cross-configure

The cross file is `cross/wasm32-musl.ini` (sha256 `f0720fc7…cbe11`):

- **Compiler:** the project's nix `wasm32-unknown-linux-musl-clang` wrapper
  (LLVM 22.1.8), with `-pthread -matomics -mbulk-memory` and linking `-static`.
- **pkg-config:** `pkg_config_libdir` points at the 39 nix wasm32 `.pc`
  directories.
- **Host machine:** `host_machine` is `linux`/`wasm32`.

`cross/wasm32-musl-stubs.ini` adds `stubs/pkgconfig`. That directory holds
configure-only `.pc` stubs for xshmfence 1.3.3 and xxf86vm 1.1.6. The driver
script is `run-cross.sh NAME [meson args]` and writes logs to `logs/cross-NAME.log`.

Options passed: `-Dgallium-drivers=zink -Dvulkan-drivers= -Dllvm=disabled
-Dgallium-rusticl=false -Dgles1=disabled -Dgles2=enabled -Degl=enabled
-Dbuild-tests=false -Dgbm=disabled`. The X11 variant adds `-Dplatforms=x11
-Dglx=dri`. The headless variant uses `-Dplatforms= -Dglx=disabled` (EGL
surfaceless/device only). `-Dshared-glapi` still exists in 26.2.3, but it is
deprecated and "does nothing", so it was omitted.

### Ordered configure blockers

| # | Run | Blocker (meson.build line) | Affects | Resolution used | Adapter class |
|---|-----|----------------------------|---------|-----------------|---------------|
| 1 | x11-a1, headless-h1 | `libdrm` not found (1921) | Both. Meson's `host_machine.system()=='linux'` sets `system_has_kms_drm`, so DRI is built and EGL requires it even with no platforms. | `-Dallow-fallback-for=libdrm` builds Mesa's libdrm 2.4.133 wrap as a static subproject (`-Dlibdrm:tests=false -Dlibdrm:install-test-programs=false`). | meson option. Alternative: a headers-only libdrm stub, since no DRM device exists in the guest. |
| 2 | x11-a2 | `xshmfence` not found (2347) | X11 DRI3 loader only | Configure-only `.pc` stub. A real build needs cross-built libxshmfence or `-Dxshmfence=disabled`-equivalent code paths. | stub/adapter (cross-build needed to link) |
| 3 | x11-a3 | `xxf86vm` not found (2356) | GLX only | Configure-only `.pc` stub. A real build needs cross-built libXxf86vm. | stub/adapter (cross-build needed to link) |
| — | x11-a4/a5, headless-h2 | none | — | rc=0. x11-a5 plans 1036 compile targets; headless-h2 plans 992. | — |

These optional dependencies were not found; none of them block configure: zstd,
libdisplay-info, xcb-keysyms, libunwind, libelf, valgrind, lua, spirv-tools and
libglvnd. Configure needs no upstream patch.

### Post-configure blockers (from `meson introspect`, not yet built)

| # | Blocker | Why | Proposed resolution |
|---|---------|-----|---------------------|
| P1 | `libgallium-26.2.3.so`, `libEGL`, `libGLESv2`, `libGL` and `dril_dri` are hard-coded `shared_library()` | The guest has no dlopen or `.so` loading (libc `dlopen` is a weak stub). | Link wrapper: build the static archives of the same objects (`libgallium` pieces plus the `libEGL_mesa`/`libglapi` objects) and link them into each app. This needs a small Mesa-external meson/ninja link step; no source patch. |
| P2 | The Zink loader calls `util_dl_open(VK_LIBNAME)` and then `util_dl_get_proc_address("vkGetInstanceProcAddr")` | There is no dlopen. | A static adapter object that defines `util_dl_open`/`util_dl_get_proc_address` for the Vulkan library name. It returns the guest ICD's `vk_icdGetInstanceProcAddr` directly (see the header-skew section). If symbol interposition is not possible, this is a one-line hook point in `zink_instance.py`/`zink_screen.c`. |
| P3 | The DRI/EGL loader dlopen path (`dri_loader`, `MESA_LOADER_DRIVER_OVERRIDE`) | The same missing dlopen. | Static built-in driver table. EGL/DRI already has a built-in path when linked as one object, which is what the dril/`libgallium` split exists for; verify during B3. |
| P4 | Configure reports `-Wl,--version-script` and `--dynamic-list` as NO | Harmless for static linking. | none |
| P5 | pthreads, atomics and TLS for the wasm32 shared-memory build | Mesa uses `u_thread`, `util_queue` and futexes. | The existing guest musl supports threads (Firefox uses them). Verify at link. |

Cross compile/link was **not** attempted in this packet. Native evidence below
comes from a host build.

## B1 — method

1. **Native Zink build.** `run-native.sh` builds a debugoptimized native Zink
   (zink only, EGL surfaceless, no GLX/X11). `run-native-dbg.sh` makes a debug
   build (`native-dbg-install/`, used for all probes, with Zink's `debug_printf`
   visible). The compile/link finished well inside the 20-minute bound.
2. **Interposing ICD wrapper.** `probe/wrap_icd.c` (sha256 `b5c3bfa5…71ae4930371cbe11`)
   builds `libwrap_icd.so` with a JSON manifest. It wraps the host lavapipe ICD,
   masks it, and logs what Zink does. The environment variables are:

   | Variable | Effect |
   |----------|--------|
   | `WRAP_API` | apiVersion cap |
   | `WRAP_TYPE` | deviceType |
   | `WRAP_DEXT` / `WRAP_DEXT_DENY` | device extension allow/deny list |
   | `WRAP_IEXT` / `WRAP_IEXT_DENY` | instance extension allow/deny list |
   | `WRAP_FEAT` / `WRAP_FEAT_DENY` | feature allow/deny list, clearing both core and pNext feature bits in `GetPhysicalDeviceFeatures(2)` |
   | `WRAP_LIMITS` | per-field `VkPhysicalDeviceLimits` overrides |
   | `WRAP_FMT` | format allow-list |

   It logs:
   - instance creation and device creation;
   - enabled extensions and features;
   - the pNext structures Zink queries (features and properties);
   - format queries;
   - every `vkGetDeviceProcAddr` result.

   Version 2 also wraps these device functions and logs their parameters:
   pipeline layout, descriptor set layout, graphics pipeline, image, buffer,
   memory allocate/free and sampler creation.
3. **Probe.** `probe/eglprobe.c` (sha256 `6338c9c7…ccf0d`) uses EGL
   surfaceless. It creates GL compat, GL core, GLES2 and GLES3 contexts, and
   for each one prints the version and extensions. It then renders a textured,
   uniform-coloured quad into an FBO and checks the inside and outside pixels.
4. **Run harness.** `probe/run.sh` hides `/dev/dri` with
   `unshare -rm` + bind mount, because the host DRM nodes otherwise change device
   selection. It runs with `LIBGL_ALWAYS_SOFTWARE=1 MESA_LOADER_DRIVER_OVERRIDE=zink`.
   Parameter sets are in `probe/sets.sh`, and each run's environment is saved
   as `probe/runs/*.env`.
5. **Source reading.** `zink_device_info.py`, `zink_screen.c`, `zink_instance.py`
   and `src/mesa/main/version.c` (`compute_version`/`compute_version_es2`) were
   read to explain each result.

Surfaceless EGL reaches Zink only when the device reports
`VK_PHYSICAL_DEVICE_TYPE_CPU` together with `LIBGL_ALWAYS_SOFTWARE`
(`zink_get_cpu_device_type`, zink_screen.c:1725). GLX/kopper without the
software flag instead rejects CPU devices (:1829). The guest ICD reports `OTHER`.

## B1 — experimental results (masked lavapipe, apiVersion 1.1, deviceType CPU)

| Run | Device ext / features added | GL compat | GL core | GLES | Draws |
|-----|-----------------------------|-----------|---------|------|-------|
| e01 bare | none | screen fails: `VK_KHR_maintenance1 required!` | — | — | — |
| e02 min5 | maint5, renderpass2, dyn-rendering, robustness2, timeline (+4 feats) | same failure (maint1 absent) | — | — | — |
| **e03 min7** | + maint1, descriptor_update_template | **1.5** | no | none | pass |
| e04 | + `independentBlend` | **2.1** | no | **ES 2.0** | pass |
| e05 | + VK_EXT_transform_feedback, `transformFeedback` | 3.1 | no | ES 2.0 | pass |
| e06 | + VK_EXT/KHR_vertex_attribute_divisor, `vertexAttributeInstanceRateDivisor` | 3.1 | no | **ES 3.0** | pass |
| e07 | + VK_EXT_depth_clip_enable, `depthClipEnable` | 3.2 compat | 3.2 core | ES 3.0 | pass |
| e08 | + `geometryShader` | 3.2 | 3.2 | ES 3.0 | pass (GS not needed) |
| e09/**e10** | + `dualSrcBlend` (e10 drops GS/depthClamp) | **3.3** | **3.3** | ES 3.0 | pass |
| r-full | unmasked lavapipe | 4.6 | 4.6 | ES 3.2 | pass |

### Minimum hard requirements for Zink screen creation (e03)

- **Instance:** apiVersion 1.1. No instance extension is needed (all 17 lavapipe
  instance extensions were masked in every run).
- **Device extensions (7):** VK_KHR_maintenance1, VK_KHR_descriptor_update_template,
  VK_KHR_maintenance5, VK_KHR_create_renderpass2, VK_KHR_dynamic_rendering,
  VK_KHR_robustness2 (or VK_EXT_robustness2), and VK_KHR_timeline_semaphore.
- **Features (4):** `nullDescriptor`, `timelineSemaphore`, `dynamicRendering`, `maintenance5`.
- **Quirk:** Zink sets `have_vulkan11` only when `vk_version >= 1.2`. A 1.1
  driver must therefore *also advertise* maint1 and descriptor_update_template
  as extensions, even though they are core 1.1. The alternative is to report
  1.2+, which implies much more.
- **Warn-only "base requirements":** these produce a warning, not a failure:
  `logicOp`, `scalarBlockLayout`/EXT_scalar_block_layout, EXT_custom_border_color
  and EXT_line_rasterization.
- **Debug-build asserts (compiled out in release):**
  - `maxUniformBufferRange >= 16384` (zink_screen.c:608);
  - `maxStorageBufferRange >= 1<<27` (:1124). WebGPU's default
    `maxStorageBufferBindingSize` is exactly 1<<27.

### GL/GLES version gating (verified by experiment and `version.c`)

| Target | Needs, on top of the previous row | Mechanism |
|--------|-----------------------------------|-----------|
| GL 1.5 compat only | the 7 extensions + 4 features above | screen creation succeeds |
| **GL 2.1 + GLES 2.0** | `independentBlend` | Gives cap `blend_equation_separate`, which enables EXT_blend_equation_separate, required by GL 2.0 and ES 2.0. GL 2.1's EXT_texture_sRGB comes from formats. |
| GL 3.0 / 3.1 | VK_EXT_transform_feedback + `transformFeedback` | Enables EXT_transform_feedback. GL 3.0 also needs MaxColorAttachments >= 4 and MaxSamples >= 4 (from format queries or fake MSAA). GL 3.1 needs 12 UBO blocks: `maxPerStageDescriptorUniformBuffers >= 13`, because one is reserved for constbuf0, and `maxUniformBufferRange >= 16384`. |
| **GLES 3.0** | VK_KHR/EXT_vertex_attribute_divisor + `vertexAttributeInstanceRateDivisor` | Enables ARB_instanced_arrays (cap `vertex_element_instance_divisor`). Also needs transform feedback, UBOs and 4 color attachments, as for GL 3.x. |
| GL 3.2 core/compat | VK_EXT_depth_clip_enable + `depthClipEnable` | Enables ARB_depth_clamp. `geometryShader` is **not** checked by Mesa for 3.2, so the reported version is non-conformant but works. |
| **GL 3.3** | `dualSrcBlend` | Enables ARB_blend_func_extended (maxFragmentDualSrcAttachments). ARB_timer_query also needs `timestampValidBits > 0`. lavapipe provides it; the wrapper did not mask queue properties, so this gate is from source only. |

**Minimum set for GL 3.3 + GLES 3.0 (e10):**

- **12 device extensions:** the 7 hard ones plus EXT_transform_feedback,
  EXT/KHR_vertex_attribute_divisor and EXT_depth_clip_enable.
- **9 features:** nullDescriptor, timelineSemaphore, dynamicRendering,
  maintenance5, independentBlend, transformFeedback,
  vertexAttributeInstanceRateDivisor, depthClipEnable and dualSrcBlend.
- **Not needed:** depthClamp, geometryShader, tessellation, logicOp, 64-bit and
  sparse.

### Guest-like limits (e11–e16, on top of the e10 set)

| Run | Limit set | Result |
|-----|-----------|--------|
| e11 | Current guest graphics+uniform limits (`GL_LIM`): 128² images, 1 layer, 1 color attachment, 8 bindings/attributes, stride 2048, 1 viewport, UBO range 16384, 8 UBOs/stage, 32 allocations, 1 sample | **GL 2.1 / ES 2.0 only**, draws pass |
| e12 | maxColorAttachments = 4 | GL 3.0, ES 2.0 |
| e13 | + sample counts 4 | unchanged. MaxSamples comes from image-format queries, not the limit bits. |
| e14 | L2 + maxPerStageDescriptorUniformBuffers=13, maxDescriptorSetUniformBuffers=78 | **GL 3.3 core/compat, ES 3.0**, draws pass, `max_texture=128` |
| e15 | e14 with maxBoundDescriptorSets=1 | still 3.3. Zink ignores the limit apart from choosing a compact layout, and still creates 3-set pipeline layouts. lavapipe does not enforce it, so **the guest must support >= 3 sets (4 with bindless)**. |
| e16 | stride 252 / offset 244 (WebGL backend) | still 3.3 / ES 3.0 |

Mesa does not require `maxImageArrayLayers >= 256` or 1024² textures for its
version checks. The resulting context is non-conformant but functional for
simple apps. Firefox/WebRender will need larger textures, which is a later
limit bump.

### Device-level usage profile (wrapper v2, textured probe; `r-es2` = GL_LIM, `r-33` = L4)

- **Queries:** Zink calls `GetPhysicalDeviceFeatures2` once, and chains these
  feature structs: DepthClipEnable, TimelineSemaphore, DynamicRendering,
  VertexAttributeDivisor, Robustness2, TransformFeedback and Maintenance5.
- **Properties:** it queries Subgroup, TimelineSemaphore, VertexAttributeDivisor,
  Robustness2, TransformFeedback and Maintenance5 properties.
- **Formats:** 157 formats are queried, covering core formats 2–184, ASTC-HDR
  (1000066xxx) and A8 (1000470001).
- **Device functions:** Zink resolves about 228 names with a non-null result
  through `vkGetDeviceProcAddr` and asks for about 451 more that return null.
  23 of the resolved names are newer than the 231 headers: the `*2`/maint5
  entry points, push descriptors, `vkCmdSetLineStipple`,
  `vkGetRenderingAreaGranularity*`, `vkMapMemory2` and host image copy.
  The list is in `requirements.json`.
- **Pipeline layouts:** `setLayoutCount=3` (one layout uses 0), 52 bytes of
  push constants.
- **Descriptor set layouts:**
  - 5× `UNIFORM_BUFFER`, one per graphics stage (bindings 0–4);
  - 1 compute UBO;
  - `COMBINED_IMAGE_SAMPLER` at binding 128 (FS);
  - one empty layout.

  No storage buffers or images were used at these GL levels.
- **Graphics pipelines:** `renderPass = VK_NULL_HANDLE` (dynamic rendering via
  `VkPipelineRenderingCreateInfo`). Dynamic states are VIEWPORT, SCISSOR,
  LINE_WIDTH, DEPTH_BIAS, BLEND_CONSTANTS and STENCIL_REFERENCE.
- **Images:**
  - formats R8G8B8A8_UNORM (37) and R4G4B4A4_UNORM_PACK16 (2, ES2 RGBA4
    renderbuffer);
  - usage 0x97 (TRANSFER_SRC|DST|SAMPLED|COLOR_ATTACHMENT|INPUT_ATTACHMENT);
  - `MUTABLE_FORMAT` with a `VkImageFormatListCreateInfo` chain;
  - sizes 1×1 to 32×32.
- **Buffers:** sizes 4/16/24 B and 1 MiB. Usage 0x1ff, or 0x19ff with
  transform-feedback bits (r-33).
- **Memory:** only 3 `vkAllocateMemory` calls, each **2 MiB** from type 0
  (Zink suballocates). This fits the 32-allocation limit, but not the guest's
  1 MiB heap.
- **Samplers:** nearest/linear, REPEAT and CLAMP_TO_EDGE, no anisotropy or
  compare.

## Header skew answer

**No: Zink 26.2 cannot be built against the Vulkan 231 headers.** Each of the 7
core Zink sources was compiled with the 231 `vulkan_core.h` put ahead of Mesa's
bundled headers (`skew/*.log`, `skew/summary.json`). Every file fails:

| File | Errors |
|------|--------|
| zink_screen | 1310 |
| zink_context | 1453 |
| zink_resource | 1308 |
| zink_device_info | 1629 |
| zink_instance | 1292 |
| zink_program | 1281 |
| zink_compiler | 1305 |

The same files compile with the bundled headers. Typical errors:

- `VK_INDEX_TYPE_UINT8_KHR` undeclared (`vk_util.h:383`);
- unknown `VkPhysicalDeviceVulkan14Features` and
  `VkPhysicalDeviceLayeredApiPropertiesKHR` (`zink_device_info.h:148/152`);
- generated `vk_enum_to_str.h` types such as `VkAntiLagModeAMD`.

Zink's generated code comes from Mesa's own `vk.xml`, so **the minimum is
Mesa's bundled header version (`VK_HEADER_VERSION` 354)**. Mesa must be built
with its bundled `include/vulkan`.

The guest ICD and static loader can stay on 231. The ICD ABI (the
`vk_icdGetInstanceProcAddr` / `vkGetDeviceProcAddr` entry points and plain C
structs) is stable, and the ICD only needs to understand the structures it
advertises. Define the few needed post-231 structure types locally, or bump the
ICD headers deliberately in B2.

The 231 *loader*, however, has no trampolines for the post-231 entry points
listed above, and generic unknown-function trampolines are disabled in the
static profile. **Recommendation:** the P2 adapter hands Zink the ICD's
`vk_icdGetInstanceProcAddr` directly, bypassing the loader. Zink then fetches
device functions via `vkGetDeviceProcAddr` straight from the ICD. Bumping the
loader pin is the alternative.

## Comparison with the guest ICD (working tree, including the in-flight A3 uniform profile)

| Requirement | icd.c today | Gap |
|-------------|-------------|-----|
| apiVersion 1.1 | 1.1 | OK |
| deviceType CPU (surfaceless path) | `OTHER` | Report CPU, or add an env/adapter opt-in. `LIBGL_ALWAYS_SOFTWARE`+CPU is the only surfaceless route. |
| 7 hard device extensions | none (empty table) | all missing |
| 4 hard features | all zero; `any_features` rejects any request | all missing |
| timeline semaphores | A1/A2 semaphores; waits return VK_TIMEOUT instead of blocking | Real blocking waits are required (Zink waits on timelines for every flush). |
| dynamic rendering, `renderPass=NULL` pipelines | render passes only | missing |
| dynamic states (viewport, scissor, line width, depth bias, blend constants, stencil ref) | not advertised/handled | missing |
| push constants >= 52 B (spec min 128) | `maxPushConstantsSize=0` | missing |
| >= 3 bound descriptor sets, UBOs in set 1, combined samplers at binding 128 | 4 sets, 8 UBOs/stage (A3) | Sampled images and samplers are missing. 13 UBOs/stage are needed for GL 3.x. |
| sampled images, samplers, combined image samplers | none | missing |
| image usage 0x97, `MUTABLE_FORMAT` + format list | exact RGBA8 attachment/transfer only | missing |
| formats: RGBA8, RGBA4, BGRA8, depth/stencil, R8/RG8, etc. (157 queried) | RGBA8 + 3 float vertex formats | Answer the queries honestly; support a core subset. |
| memory: 2 MiB allocations | 1 MiB heap, 32 allocations | Heap >= 8–16 MiB. |
| maxUniformBufferRange >= 16384 | 16384 (A3) | OK |
| maxStorageBufferRange >= 1<<27 | 65536 (compute profile) | Advertise 1<<27 (WebGPU default). |
| maxColorAttachments >= 4 (GL 3.0 / ES 3.0) | 1 | GL 3.x gate |
| independentBlend (GL 2.1 / ES 2.0) | no | gate |
| transform feedback, vertex divisor, depth clip, dualSrcBlend (GL 3.x / ES 3.0) | no | gates |
| queue `timestampValidBits` (ARB_timer_query, GL 3.3) | 0 | gate (source-only evidence) |

## Proposed B2/B4 ICD packets (short, bounded; each needs a real guest gate)

Legend: **I** = implement on both backends, **E** = emulate, **R** = refuse /
do not advertise.

| Packet | Content | Backend notes | Class |
|--------|---------|---------------|-------|
| **B2a** Zink screen bring-up surface | Advertise the 7 extensions + 4 features at 1.1, plus `nullDescriptor` semantics (null UBO/sampler descriptors bind zero/dummy resources). CPU deviceType opt-in. Limits: push constants 128, storage range 1<<27, UBO range 16384, 4 sets. Define the post-231 structs locally. Gate: masked-lavapipe parity test plus a guest `vkCreateDevice` with Zink's exact pNext chain. | Both backends | I |
| **B2b** real timeline semaphores | Blocking `vkWaitSemaphores`/`vkWaitForFences` via Atomics.wait on host completion, plus `vkGetSemaphoreCounterValue` and `vkSignalSemaphore`. | Both backends | I (replaces VK_TIMEOUT) |
| **B2c** dynamic rendering + dynamic state | `vkCmdBeginRendering`/`EndRendering`, pipelines with `renderPass=NULL`, and the six dynamic states. `vkCmdBindIndexBuffer2`/`GetRenderingAreaGranularity` for maint5. | WebGPU: dynamic viewport/scissor/blend/stencil are native; line width must be 1 (refuse otherwise); depth bias is pipeline-baked, so emulate by pipeline variant. WebGL2: all native. | I/E |
| **B2d** textures | Sampled images, samplers, combined image samplers (binding 128), usage 0x97, `MUTABLE_FORMAT` + format list (same-format views only), RGBA8/BGRA8/RGBA4 (WebGPU: emulate RGBA4 via RGBA8 + CPU conversion)/R8/RG8/D24S8/D32, honest format-property answers, and 2 MiB allocations with a >= 16 MiB heap. | RGBA4: WebGPU emulates, WebGL2 native | I/E |
| **B3** GL 2.1 / ES 2.0 milestone | `independentBlend` (WebGPU per-target blend is native; WebGL2 needs `OES_draw_buffers_indexed`, else refuse and stay at GL 1.5), plus the P1–P3 static-link adapters. Build static Zink/EGL for wasm32 and run eglprobe in the guest. | per-target blend: WebGPU native; WebGL2 extension-dependent | I |
| **B4a** GL 3.x limits | `maxColorAttachments=4` (MRT) and 13 UBOs/stage (WebGPU default is 12 per stage: request an adapter limit >= 13, else cap at GL 3.0). | Both | I |
| **B4b** transform feedback | VK_EXT_transform_feedback | WebGL2: native. WebGPU: emulate via a vertex-stage storage write in the translator, or refuse, which leaves GL 2.1/ES 2.0 on WebGPU. | I (WebGL) / E or R (WebGPU) |
| **B4c** vertex attribute divisor | ES 3.0 / ARB_instanced_arrays | WebGPU `stepMode:"instance"` supports divisor 1 only; emulate divisor > 1 in the shader, or report `maxVertexAttribDivisor=1` (whether ES 3.0 still exposes then is untested). WebGL2: `vertexAttribDivisor`. | I/E |
| **B4d** depth clip enable | GL 3.2 | WebGPU: `depth-clip-control` feature (`unclippedDepth`). WebGL2: no control, so emulate in the shader or refuse (caps at GL 3.1 / ES 3.0). | I/E/R |
| **B4e** dual-source blend | GL 3.3 | WebGPU: `dual-source-blending` feature (adapter-dependent). WebGL2: `WEBGL_blend_func_extended` if present, else refuse (caps at GL 3.2). | I/R |
| **B4f** timestamps | `timestampValidBits` and timestamp queries (ARB_timer_query) | WebGPU: `timestamp-query` feature. Otherwise emulate with CPU `performance.now` at submit boundaries (coarse). | I/E |
| **Refuse** | geometry/tessellation shaders, sparse, 64-bit float/int, logicOp, custom border colour, wide lines, multiview, multi-viewport, storage images for GL < 4.2 | Not needed up to GL 3.3 / ES 3.0 | R |

Recommended order: B2a, B2b, B2c, B2d, B3 (first Zink pixels in the guest),
then B4a, B4c, B4b, B4d, B4e, B4f.

## Limitations (honest)

- **The measurement ICD is lavapipe, not the guest ICD.** lavapipe is lenient:
  for example it ignores `maxBoundDescriptorSets=1`, so e15 "passing" does not
  prove the guest can use fewer than 3 sets. The requirement lists are therefore
  *sufficient on lavapipe* and *necessary per Zink's code*, but the guest may hit
  more strict-validation issues.
- **Timer-query gate not masked.** Queue properties were not masked, so the
  `timestampValidBits` gate for GL 3.3 comes from source reading only.
- **Platforms not exercised.** Only EGL surfaceless was exercised; GLX/X11
  kopper, WSI swapchain use and the EGL device platform were not.
- **Cross build not compiled or linked.** Only configure was run; the P1–P5
  post-configure blockers are predicted from introspection.
- **Version strings are not conformance.** Mesa reports GL versions
  non-conformantly (no GS, 1 array layer, 128² textures). They show what Mesa
  exposes, not conformance.
- **Narrow probe.** The probe draws one textured quad per context. Heavier apps
  (vkcube-like, Firefox WebRender) will use more formats, larger textures, MRT
  and storage.
- **Noisy extension lists.** The `EXTS` lines in `.out` files can have
  interleaved `Mesa:` stderr text, which makes extension diffs noisy.

## Artifacts

Task root: `/mnt/p6/build/zink-b0b1-20260928/`.

- **Cross configure:**
  - scripts: `run-cross.sh`, `cross/*.ini`, `stubs/pkgconfig/*.pc`;
  - logs: `logs/cross-{x11-a1..a5,headless-h1,h2}.log`;
  - build dirs: `cross-build/*`.
- **Native builds:** `run-native.sh` and `run-native-dbg.sh`, output in
  `native-build`, `native-dbg-build` and `native-dbg-install`, logs in
  `logs/native-*.log`.
- **Probe:**
  - `probe/wrap_icd.c` (v1 backup kept), `probe/eglprobe.c`, `probe/run.sh`,
    `probe/exp.sh`, `probe/sets.sh`;
  - `probe/gen_tables.py` → `tables.h`;
  - run outputs: `probe/runs/{e01..e16,r-full,r-es2,r-33,base-full}.{out,wrap.log,env}`.
- **Header skew:** `skew/summary.json` and `skew/*.log`.
