# Vulkan gap analysis: vkcube and Mesa Zink (2026-09-28)

Research only. No driver, source, service, browser or git state was changed.
All downloads, trees and logs are under `/mnt/p6/build/zink-gap-20260928/`
(ext4; `TMPDIR` pointed at its `tmp`). Statements marked (unverified) come from
reading source or general knowledge and were not executed.

## 1. Pinned inputs

| Item | Version | Archive sha256 (computed locally) |
| --- | --- | --- |
| Mesa | 26.2.3 (latest stable seen; archive dated 2026-09-16) | `1628058a8d2c0615975de5a15ab7bbb9638c50000b5bed9456ff423ea034a81f` (68,561,540 bytes, `mesa-26.2.3.tar.xz`) |
| Vulkan-Tools | v1.3.231 (matches `VK_HEADER_VERSION 231` already pinned by the loader/ICD) | `379547b11eb65638cf5d83b260827a7b2dbfa7f31ef4002f8bfdca7bf3c89a8f` (`vt-1.3.231.tar.gz`) |

Notes: the upstream `.sha256` for Mesa was not available (404), so the hash is
local-only and no signature was checked; cross-check it against a second source
before it is used in a lock file. `cube/cube.c` is 4,331 lines. `cube.vert` and
`cube.frag` are GLSL; the checked-in `.inc` SPIR-V must be regenerated with
`glslangValidator` (not installed for this study; unverified whether the
generated words are byte-stable).

Native `meson setup` for Mesa 26.2.3 (zink, GLX, EGL, no LLVM, no Rust) succeeds
in a venv (mako, pyyaml, packaging, ply, meson 1.12.1, ninja); 1,079 ninja steps.
Logs: `log-meson-setup.txt`, `build-native/`. Nothing was compiled.

Version skew to keep in mind: Mesa 26.2 Zink is written against Vulkan headers far
newer than 231 and expects a Vulkan 1.2/1.3 device. It will not build against the
231 headers as-is; either bring a matching newer header set for the Zink build
only, or advertise the guest ICD with newer headers everywhere. This is a hidden
cost of any Zink packet. The loader pin (`61187c4...`) is for 231; the loader
works with newer ICDs but the pinned header/loader pair must be revisited.

## 2. Current ICD baseline (from `web/linux/tests/guest-vulkan/icd.c` and `.inc`)

- apiVersion 1.0 only; instance creation rejects other app versions (icd.c ~74).
- Instance/device extension lists are empty; zero optional features.
- Limits: `maxImageDimension2D=128`, `maxBoundDescriptorSets=1`,
  `maxColorAttachments=1`, memory heap 1 MiB with two memory types (transfer.inc).
- Implemented commands: instance/physical-device basics, `vkGetDeviceQueue`,
  buffers, images (linear color), memory map/flush, storage-buffer compute with
  bounded SPIR-V, render passes, framebuffers, vertex-buffer graphics pipelines,
  clear/copy, `vkQueueSubmit`. Static loader dispatch is typed; unknown functions
  are rejected; there is no generic trampoline for extension functions.
- Graphics: one color format, no depth/stencil, no blending, no sampled images or
  samplers, no UBO in graphics, no dynamic state beyond viewport/scissor per draw,
  no index buffers (host protocol has vertex buffers, draw, readback only),
  no push constants, no descriptor sets in graphics, no queries, no semaphores or
  fences beyond what submit/idle implies.
- Presentation: none in Vulkan. Only an application-level Xlib `XPutImage` copy of
  a readback exists (`presentation-x11.inc`).
- Translator: Naga 0.20 SPIR-V to WGSL/GLSL. The graphics translator rejects
  resource bindings (private globals only); the compute translator handles
  storage buffers.

## 3. vkcube (Vulkan-Tools v1.3.231 `cube/cube.c`) requirements

Instance layer/extension use: `vkEnumerateInstanceExtensionProperties`,
`VK_KHR_surface` plus one platform surface (`VK_KHR_xcb_surface` or
`VK_KHR_xlib_surface` per build option; `--wsi xcb|xlib|display|headless`
selects at run time in 1.3.231, headless uses `VK_EXT_headless_surface` and
`--c N` frame count), optional `VK_EXT_debug_utils` (skipped when absent).
Device extension required: `VK_KHR_swapchain`. Optional: `VK_KHR_incremental_present`,
`VK_GOOGLE_display_timing`, `VK_KHR_display` (not needed for X11).

API surface used (grouped):

| Group | Calls |
| --- | --- |
| Instance/device | CreateInstance, EnumeratePhysicalDevices, GetPhysicalDeviceProperties/Features/QueueFamilyProperties/MemoryProperties/FormatProperties, CreateDevice, GetDeviceQueue |
| WSI | GetPhysicalDeviceSurfaceSupportKHR/CapabilitiesKHR/FormatsKHR/PresentModesKHR, CreateSwapchainKHR, GetSwapchainImagesKHR, AcquireNextImageKHR, QueuePresentKHR, DestroySwapchainKHR, DestroySurfaceKHR |
| Sync | CreateSemaphore, CreateFence, WaitForFences, ResetFences, QueueWaitIdle/DeviceWaitIdle, QueueSubmit with wait/signal semaphores and fence |
| Resources | CreateImage (D16/D24 depth, plus staging linear textures), CreateImageView, CreateSampler, CreateBuffer (UBO), AllocateMemory/BindBufferMemory/BindImageMemory/MapMemory/UnmapMemory, GetImageSubresourceLayout, GetImageMemoryRequirements |
| Commands | CreateCommandPool/AllocateCommandBuffers, Begin/End, CmdPipelineBarrier, CmdBeginRenderPass/CmdEndRenderPass, CmdBindPipeline, CmdBindDescriptorSets, CmdSetViewport/Scissor, CmdDraw (no index buffer, vertices come from a UBO), CmdCopyImage (staging texture upload), CmdBlitImage (unverified) |
| Pipeline | CreateRenderPass (color+depth, subpass dependency), CreateFramebuffer, CreateShaderModule, CreateDescriptorSetLayout/PipelineLayout/DescriptorPool, AllocateDescriptorSets, UpdateDescriptorSets (UBO + combined image sampler), CreateGraphicsPipelines with depth test, back-face cull, dynamic viewport/scissor, CreatePipelineCache |

Shader needs: `cube.vert` reads position/color/texcoord from a UBO with
`gl_VertexIndex` (36 vertices, no vertex buffers), `cube.frag` samples a 2D
texture. Under the host transport this means: uniform buffer bound in a
graphics stage, sampled texture + sampler, depth attachment, cull mode.

## 4. Zink hard requirements at screen creation (Mesa 26.2.3)

Sources: `src/gallium/drivers/zink/zink_screen.c`, `zink_device_info.py`,
`zink_instance.py`, `VP_ZINK_requirements.json`, `docs/drivers/zink.rst`.
Counting is from reading; no Zink code was run.

### 4.1 Loading

- `screen->loader_lib = util_dl_open(VK_LIBNAME)` (zink_screen.c ~3425) is a
  hard dlopen of `libvulkan.so.1`. Guest modules are static with only weak
  `dlopen` stubs. Needs a small patch to call the statically linked
  `vkGetInstanceProcAddr` directly. Feasible.
- Loader version check (`zink_get_loader_version`, ~2583) uses
  `vkEnumerateInstanceVersion`; a 1.0 loader/ICD makes Zink fall back to 1.0 and
  fail its 1.2 requirement. The ICD must report 1.1 or better.
- Zink refuses devices below Vulkan 1.0 base but in practice its extension
  tables and `VP_ZINK_requirements.json` profile need 1.2 features plus the list
  below. Missing hard requirements make `zink_create_screen` return NULL with a
  log line.

### 4.2 Hard failures (device)

| Requirement | Why Zink needs it | ICD today |
| --- | --- | --- |
| Vulkan 1.1+ (`vkGetPhysicalDeviceProperties2/Features2`, `vkEnumerateInstanceVersion`) | Feature/property chaining | Absent (1.0 only) |
| `VK_KHR_maintenance1`, 3 | Negative viewport height, descriptor limits | Absent |
| `VK_KHR_create_renderpass2`, `VK_KHR_dynamic_rendering` (or renderpass fallback in some builds; unverified per-version) | Render path | Absent |
| `VK_KHR_descriptor_update_template` (core 1.1) | Descriptor updates | Absent |
| `VK_KHR_timeline_semaphore` (core 1.2) feature `timelineSemaphore` (zink_screen.c ~3576) | Fence/queue sync model | Absent; ICD is submit-synchronous, could emulate |
| `VK_EXT_robustness2` `nullDescriptor` (~3516) | Unbound sampler/UBO slots | Absent |
| features `logicOp`, `fillModeNonSolid`, `alphaToOne`, `shaderClipDistance` (documented GL 2.1 baseline) | Logic ops, wireframe, alpha-to-one, user clip planes | Zero features |
| 32-bit and 64-bit ints in shaders? (`shaderInt64` optional; `shaderFloat64` optional) | fp64/int64 GL extensions | Absent, optional |
| Formats: sampled/blit-src/dst for RGBA8, BGRA8, D16/D24S8/D32, R8, RG8, RGBA16F, RGB10A2, compressed optional | Every GL renderable must map | One color format |
| Limits: `maxImageDimension2D >= 4096` (GL 3.x asks 8192 typical; GL 2.1 min 2048), `maxBoundDescriptorSets >= 4` in some paths (Zink uses 4-5 sets; 5 with bindless), `maxColorAttachments >= 8` (GL 3.3 needs 8), `maxPerStageDescriptorSamplers >= 16`, `maxVertexInputAttributes >= 16` | GL minimums | 128, 1, 1 |
| Memory: host-visible coherent and device-local types, heap larger than 1 MiB | Buffers/textures | 1 MiB, 2 types |

Not exhaustive; the pinned `zink_device_info.py` has roughly 100 extension
entries, of which the "required" subset is what matters. Expect the true hard
list to be found by running Zink (see packet B1), not by reading.

### 4.3 Gates per GL/GLES version (optional features)

| Target | Needs beyond baseline | Hard/optional |
| --- | --- | --- |
| GL 2.1 (minimum) | logicOp, fillModeNonSolid, alphaToOne, shaderClipDistance, NPOT textures, point sprites (Zink emulates), 4-sample MSAA | Hard for any GL context |
| GLES 3.0 | independentBlend, transform feedback emulation (via `VK_EXT_transform_feedback`, else Zink disables GLES 3.0? unverified), instancing, `VK_EXT_vertex_attribute_divisor`, sRGB, texture formats (ETC2 emulated), occlusion query, seamless cube map | Some optional, feature gaps lower advertised version |
| GL 3.3 core | independentBlend, dualSrcBlend, depthClamp, `VK_EXT_transform_feedback`, `VK_EXT_conditional_rendering`, `VK_EXT_provoking_vertex`, `VK_EXT_custom_border_color`, `VK_EXT_line_rasterization` (or lowering), `VK_EXT_depth_clip_enable`, geometryShader for GL 3.2+ (Zink does not expose GL 3.2+ without it), `VK_EXT_primitive_topology_list_restart`, 16-bit index restart | Each missing item caps the GL version (unverified exact caps) |

Consequence: reaching "GL 2.1 or GLES 2/3" through Zink is a feature-reporting and
emulation exercise as much as a rendering one. Anything the WebGPU/WebGL2 host
cannot implement must not be advertised.

### 4.4 WSI / presentation paths

- Kopper is Zink's DRI/WSI path: `VK_KHR_surface` + `VK_KHR_xcb_surface` (no
  xlib entry in Zink's instance list) or wayland/headless where built, using a real
  `VK_KHR_swapchain`. GLX (`src/glx/drisw_glx.c`) picks driver `"zink"` unless
  disabled and calls `dri_screen_init(..., fd = -1, ...)`, so no DRM node is
  needed on this route; EGL X11 (`src/egl/drivers/dri2/platform_x11.c`) has a
  kopper path too. Whether GLX selects zink without DRI3 present in the X server
  (glxext.c ~855-1062, `dri3_create_screen`) was not fully traced (unverified).
  Tinyx (the guest X server) is not known to provide DRI3/Present.
- Software fallbacks: `libgl-xlib` is only swrast/virgl/asahi; there is no
  "zink-xlib". With `GALLIUM_DRIVER=zink` on the drisw path the presentation still
  goes through Vulkan swapchain images then a CPU copy (kopper does this for
  "software" WSI when `VK_KHR_xcb_surface` is not usable? unverified).
- Practical route: implement `VK_KHR_surface` + `VK_KHR_xcb_surface` +
  `VK_KHR_swapchain` in the ICD with a CPU-readback presenter using
  xcb `PutImage` (or SHM) into the window. The same implementation serves
  vkcube and Zink kopper.

## 5. Host backend feasibility (WebGPU preferred, WebGL2 fallback)

| Need | WebGPU | WebGL2 | Consequence |
| --- | --- | --- | --- |
| Uniform buffers / sampled 2D textures / samplers in graphics | Yes; Naga can translate bindings, but the current graphics translator forbids them | Yes with GLSL translator work | Translator + protocol extension packet |
| Depth attachment, cull, depth compare | Yes | Yes | Protocol growth |
| Indexed draw, instancing | Yes | Yes | Protocol growth (only vertex draws today) |
| Blend state incl. dual-source | Blend constants yes; dual-source only via `dual-source-blending` extension (not universal; unverified) | No (EXT_blend_func_extended optional) | GL 3.3 dualSrcBlend nonconformant/disabled |
| Independent blend, per-attachment | Yes | Yes with drawBuffers | OK |
| `logicOp` | No | No | Emulate in shader (feedback) or lie; must be advertised for Zink GL 2.1 baseline. Nonconformant. |
| `fillModeNonSolid` (polygon line/point) | No | No | Emulate via geometry expansion in the driver; else nonconformant |
| `alphaToOne` | No | No | Emulate in fragment shader; affects MSAA only |
| `shaderClipDistance` | WGSL clip_distances is optional/proposed (unverified) | No | Emulate with discard; nonconformant |
| Geometry shaders, tessellation | No | No | Zink GL >= 3.2 unavailable; GL 3.1 or GLES 3.0 ceiling |
| Transform feedback | No | Yes (WebGL2) but not from WebGPU | GLES 3.0 wants it; Zink can lower via compute; large packet |
| Timeline semaphore | n/a | n/a | Emulated in the guest ICD (single queue, synchronous submit) |
| Storage buffers/images in graphics | Yes | No | ok on WebGPU only |
| Push constants | Emulate via UBO | Emulate via UBO | Driver work |
| Occlusion queries | Yes | Yes | Async result plumbing |
| Depth clamp | Extension `depth-clip-control` | No | Partial |
| Non-uniform limits (texture size, 8 attachments) | 8192/8 | ~16384/8 (SwiftShader) | OK |
| Physical GPU | Depends on browser | Depends | All current evidence is SwiftShader |

Everything above that is emulated makes the ICD nonconformant (no Khronos CTS).
That must be stated in every release note and never advertised as a Vulkan
conformant device.

## 6. Static Mesa feasibility (wasm32-unknown-linux-musl, no dlopen)

Verified by reading (unexecuted; only native meson configure was run):

- Mesa 26.2 GLX/EGL link `libgallium_dri` directly instead of dlopen'ing per-driver
  megadrivers, but `src/gallium/targets/dri/meson.build` builds it as
  `shared_library()`. For static use, make a custom build rule or a static
  variant containing `zink` (plus its deps: NIR, glsl, mesa util, gallium
  auxiliary, DRI frontend). `loader_open_driver_lib` (src/loader/loader.c ~899)
  still dlopens for libEGL/loader paths; must be patched or unused.
- Top-level `with_dri` requires `system_has_kms_drm` and libdrm even for
  fd = -1 use; a shimmed libdrm/`-Ddri3=disabled` needs testing (unverified).
  Options to try: `-Dgallium-drivers=zink -Dvulkan-drivers= -Dplatforms=x11
  -Dglx=dri -Degl=enabled -Dllvm=disabled -Dgallium-rusticl=false
  -Dshared-glapi=disabled -Dgles1=disabled -Dgles2=enabled -Dbuild-tests=false`.
- Zink's only hard dlopen: `util_dl_open(VK_LIBNAME)`; other `dlopen` in Mesa
  (LLVM, sw winsys, `util_dl`) are compiled out or unreachable in this config.
- Dependencies for a wasm32 cross build: libX11, libxcb (+ xcb-dri3/present/
  sync/xfixes/randr/shm/glx), xorgproto, libxshmfence, expat, zlib, libdrm
  (or stub), python (host) mako. A prior port of Xlib/xcb exists in the tree for
  the X11 presentation demo (145 frozen inputs), but not the extension libraries.
- Threading: Zink uses `util_queue` threads and `GALLIUM_THREAD` by default;
  the guest supports pthreads (Firefox), but keep `GALLIUM_THREAD=0` and
  `ZINK_DEBUG` off initially.
- Build weight (unmeasured): large C/C++ (NIR, glsl, spirv, compiler) — plan for
  hundreds of translation units; the wasm output likely several MB; compile time
  and disk fit under `/mnt/p6/build/`. wasm32 (32-bit pointers, 64-bit Vulkan
  handles for non-dispatchable objects) needs care around `uint64_t` vs
  `uintptr_t` in Mesa's Vulkan structs; Zink is known to run on 32-bit ARM/x86.
- A cross file (clang wrapper 22.1.8, libc++ ABI include dir, `--target=wasm32-unknown-linux-musl`,
  `needs_exe_wrapper=true`, `exe_wrapper` unavailable; build-time code generators
  use native tools) has not been written or tested. Native mako/python generation
  worked at setup.

Verdict: feasible in principle but a multi-packet task, not a single session;
main risk is the amount of Xlib/xcb/libdrm scaffolding and Vulkan header version
skew, not the compiler.

## 7. Prioritized implementation packets

Each is intended to fit one short agent session. Acceptance tests use the
existing finite-browser guest harness (SwiftShader), disk-backed task dirs.

### Track A: vkcube with X11 presentation

A1. Core 1.1 plumbing. Report apiVersion 1.1, add `vkEnumerateInstanceVersion`,
`vkGetPhysicalDevice{Properties2,Features2,QueueFamilyProperties2,MemoryProperties2,FormatProperties2}`,
extension-list plumbing with a table so later packets enable names one at a time,
and real `vkGetPhysicalDeviceFormatProperties` for every format the profile
supports. Accept: direct + loader clients pass existing 44/14/957/883 regressions
plus new tests for chained structs, unknown `pNext` handling and unchanged
1.0 apps.

A2. Sync objects. Fences, semaphores (binary), `vkWaitForFences`,
`vkResetFences`, submit wait/signal lists (immediate since submit is
synchronous), `vkDeviceWaitIdle`. Accept: client sequences with fences and two
submits; teardown leaves zero objects.

A3. Graphics resources: UBO in graphics (descriptor set layout/pool/set/update
for uniform buffers), plus host protocol + translator support for uniform
binding groups. Accept: SPIR-V with a UBO and `gl_VertexIndex` draws a
known triangle; negative tests for binding out of range.

A4. Sampled images and samplers: combined image sampler, image upload via
`vkCmdCopyBufferToImage`/`vkCmdCopyImage`, sampler state (filter/wrap subset).
Accept: 4x4 texture sampled in the fragment shader, exact pixels.

A5. Depth and raster state: D16 (and D32) attachments, depth test/write,
compare ops, cull mode, front face, dynamic viewport/scissor, pipeline cache
objects (no-op). Accept: two overlapping triangles resolve by depth; culling.

A6. WSI: `VK_KHR_surface`, `VK_KHR_xcb_surface` (and/or xlib), `VK_KHR_swapchain`
with acquire/present, CPU-copy presenter through existing Xlib/xcb path. Needs
the loader to support extension entry points (typed instance/device tables).
Accept: a small swapchain client cycles three images and X11 `GetImage` matches.

A7. Build and run vkcube v1.3.231 (glslang for the two `.inc` files, static
loader, xcb) with `--c 60 --suppress_popups`; compare frames to a reference
render. This is the packet-A acceptance gate; likely needs D16 + dynamic state
tweaks discovered only when run (unknown).

### Track B: Zink screen creation

B0. (Do first, cheap.) Cross-configure Mesa 26.2.3 for wasm32 with the option
line above, write the cross file, and record which dependency (libdrm, xcb-dri3)
fails first. Accept: configure log + list of blockers. No compile.

B1. Zink screen creation on the native host against the ICD? Not possible, so
instead: build zink natively against a stock Vulkan driver (lavapipe if
available) with `MESA_LOG`/`ZINK_DEBUG=vk` to dump the exact required
extension/feature list at screen creation. Accept: an exact table replacing
sections 4.2 to 4.3 above (this study inferred from source only).

B2. Extended feature reporting in the ICD for the exact list from B1, each item
implemented, emulated or refused with a documented reason (logicOp,
fillModeNonSolid, alphaToOne, shaderClipDistance, robustness2 nullDescriptor,
timeline semaphore, maintenance1/3/5, create_renderpass2, dynamic rendering or
render-pass fallback, provoking vertex, line rasterization, custom border color).
Accept: `vulkaninfo`-style dump test and a Zink-compatible property probe.

B3. Static Mesa/Zink build for wasm32: patch `util_dl_open(VK_LIBNAME)` to use
the static `vkGetInstanceProcAddr`, static `libgallium_dri`, `GALLIUM_THREAD=0`.
Accept: `libGL`/`libEGL` (or an EGL headless) links; smoke program creates a
Zink screen and prints the GL renderer string in the guest; failures logged.

B4. Larger limits/memory and multi-attachment/multi-set support in ICD and host
protocol (4096 image, 8 attachments, at least 4 descriptor sets, >64 MiB heap).
Accept: regression at new limits; host budget checks.

B5. GLES 2/3 triangle through Zink (EGL with kopper on X11 or pbuffer plus
readback). Accept: exact-pixel triangle; then a textured, depth-tested cube.

### Track C: Firefox GL

C1. Choose the GL context type Firefox uses (EGL/GLES with WebRender on X11;
`gfx.webrender.software` currently used). Inspect Firefox 128 needs: GL 3.2+ core
or GLES 3.0 for WebRender hardware path, `GL_EXT_*` list, texture upload paths.
Accept: written requirement table against B-track capability.

C2. Rebuild Firefox with EGL/GLX linking against static Mesa (or provide
`libEGL` shim). Accept: `about:support` reports the GL renderer as Zink.

C3. Enable WebRender hardware with an allowlist; fallback to software on any
context loss. Accept: page render, screenshot compare, input works, no crash on
context loss. Expect WebRender to need features (geometry shader absence is
fine, but dual-source blending, `glClientWaitSync`, texture arrays, PBOs) that
the emulation layer may not deliver.

## 8. Top blockers and unknowns

1. Vulkan 1.0-only ICD with zero extensions/features; Zink needs 1.2-level
   feature set and swapchain WSI.
2. Nonconformant emulation of `logicOp`, `fillModeNonSolid`, `alphaToOne`,
   `shaderClipDistance` (not in WebGPU/WebGL2).
3. Graphics translator rejects resource bindings; UBO/texture/sampler support is
   prerequisite for both vkcube and Zink.
4. Static Mesa: `libgallium_dri` is a shared library, `loader.c` dlopen,
   Zink `dlopen(libvulkan)`, libdrm requirement, header version skew (231 vs
   Mesa 26.2).
5. Unknowns: exact Zink startup requirements (not executed), whether GLX/EGL
   picks zink without DRI3 in tinyx, wasm32 build size/time, host WebGPU
   feature availability on real GPUs (only SwiftShader tested), Mesa tarball
   signature.
