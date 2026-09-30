# Guest Vulkan: sampled textures and samplers (packet A4) — 2026-09-29

This packet adds sampled textures to the experimental guest ICD in `web/linux/tests/guest-vulkan/`,
covering:

- the vsock host `web/linux/tests/guest-gpu/host.mjs`;
- the WebGPU renderer and the WebGL2 fallback renderer;
- both Naga translators.

It is track A item A4 of `docs/vulkan-gap-zink-vkcube-20260928.md`. It builds on A3 (uniform
buffers, `docs/guest-vulkan-uniform-buffers-20260929.md`).

This is a bounded, nonconformant profile:

- It makes no claim about Zink, OpenGL, Firefox GPU, decoders or a native JIT.
- The accepted `web/linux` images and `web/sites` are unchanged, and nothing was deployed.

**Hardware.** For the first time these guest suites ran on a physical GPU:

- **WebGPU** ran on the NVIDIA GeForce MX110 (Maxwell, driver 580.173.02) through Chromium's Dawn
  Vulkan backend.
- **WebGL2** ran on Intel UHD 620 through ANGLE/OpenGL.

A SwiftShader comparison run is included (see [NVIDIA versus SwiftShader](#nvidia-versus-swiftshader)).

## Profile and HELLO

The profile is opt-in and layered on the uniform profile. The host advertises it only when it is
started with `allowTextures` (which requires `allowUniforms` and `allowGraphics`). Its HELLO then
also carries:

```
textureProfile:1, maxSampledTextures:4, maxTextureDimension:128, maxSamplers:8
```

The protocol has three new opcodes:

| Opcode | Name | Payload |
|---|---|---|
| 25 | `TEXTURE` | u32 width, height |
| 26 | `TEXTURE_UPLOAD` | u32 hostId, w, h + RGBA8 bytes |
| 27 | `SAMPLER` | JSON `{magFilter,minFilter,addressModeU,addressModeV}` |

When a device is created without `textureProfile`, the texture calls are refused and the texture
limits are 0.

## Guest ICD (`texture.inc`, plus `icd.c`, `uniform.inc`, `compute.inc`, `transfer.inc`, `graphics*.inc`)

**Formats**

- Only `R8G8B8A8_UNORM` reports optimal-tiling `SAMPLED_IMAGE | SAMPLED_IMAGE_FILTER_LINEAR |
  TRANSFER_DST`.
- `vkGetPhysicalDeviceImageFormatProperties` accepts exactly the usages `TRANSFER_SRC|DST`,
  `COLOR_ATTACHMENT|TRANSFER_SRC` and `SAMPLED|TRANSFER_DST`. It reports maxExtent 128, 1 mip and
  1 layer.

**Images**

- 2D only, `SAMPLED|TRANSFER_DST`, at most 128x128, one mip and one layer, optimal tiling.
- Other formats (including sRGB), sizes, mips and usages return `FORMAT_NOT_SUPPORTED`.
- Views require bound memory.

**Uploads**

- Only whole-image `vkCmdCopyBufferToImage` outside a render pass is accepted.
- The source must be a `TRANSFER_SRC` staging buffer, and the image must be in `TRANSFER_DST_OPTIMAL`.
- The copy must meet all of these:
  - offset%4 == 0;
  - `bufferRowLength` and `bufferImageHeight` are 0;
  - it covers the full extent;
  - count is 1.
- Anything else makes the command buffer invalid at `vkEndCommandBuffer`.
- The staging bytes are read when the copy executes. Resubmitting the same command buffer therefore
  re-uploads the current contents.

**Barriers**

Only these barriers are accepted:

- `UNDEFINED->TRANSFER_DST` (TOP_OF_PIPE, no access);
- `SHADER_READ_ONLY->TRANSFER_DST`;
- `TRANSFER_DST->SHADER_READ_ONLY` (TRANSFER_WRITE to VS/FS SHADER_READ).

At submit, layouts and "has contents" are simulated across the command buffer. The whole submit is
refused before any host effect in these cases:

- a draw samples an image that is not `SHADER_READ_ONLY` or has no contents;
- a recorded `oldLayout` mismatches the simulated layout;
- a descriptor names a non-SRO layout;
- a descriptor names a colour-target view.

**Samplers**

- mag and min filter: `NEAREST` or `LINEAR`.
- U, V and W addressing: `REPEAT`, `CLAMP_TO_EDGE` or `MIRRORED_REPEAT`.
- mipmapMode: nearest or linear. Textures have one level, so it has no effect.
- `maxLod` must be in 0..1000.
- These are rejected with `FEATURE_NOT_PRESENT`: clamp-to-border, LOD bias, anisotropy, compare,
  minLod != 0 and unnormalized coordinates.
- At most 8 live samplers are allowed; the ninth returns `OUT_OF_HOST_MEMORY`.

**Descriptors**

- `COMBINED_IMAGE_SAMPLER`, count 1, VS and/or FS, with no immutable samplers.
- Set layouts allow at most 4 bindings, and pipelines at most 4 textures and 8 bindings in total.
- `SAMPLED_IMAGE` and separate `SAMPLER` types are rejected.
- Pools hold 1-2 distinct `UNIFORM_BUFFER`/`COMBINED_IMAGE_SAMPLER` sizes. Exhaustion returns
  `OUT_OF_POOL_MEMORY`.
- A CIS write requires:
  - a host sampler;
  - a view of a sampled image;
  - the `SHADER_READ_ONLY_OPTIMAL` layout.
- An invalid write invalidates the whole set, and a later submit using that set is refused.

**Limits**

- maxPerStageDescriptorSamplers, maxPerStageDescriptorSampledImages, maxDescriptorSetSamplers and
  maxDescriptorSetSampledImages are all 4.
- maxSamplerAllocationCount is 8, maxImageDimension2D is 128, maxSamplerLodBias is 0 and
  maxSamplerAnisotropy is 1.

**Transport**

`guest-gpu.c`/`.h`: the opcode bound now extends to `GPU_SAMPLER`.

## Host, renderers and translators

**`guest-gpu/host.mjs`**

- Handles `TEXTURE`, `TEXTURE_UPLOAD` and `SAMPLER` with size and extent validation.
- Counts `graphicsTextureUploads`.
- Requests the WebGPU adapter with `{powerPreference:'high-performance'}`.

**WebGPU renderer (`guest-vulkan-graphics/renderer.mjs`)**

- Textures are `rgba8unorm` and filled with `queue.writeTexture`.
- Samplers use the requested filters and address modes, with `mipmapFilter:'nearest'` and LOD clamp
  0..32.
- Each combined binding N becomes a `texture_2d<f32>` at N plus a filtering sampler at N+16 in the
  same bind group, visible to the declared stages.
- Draw-time texture bindings must match the pipeline layout and have uploaded contents.

**WebGL2 renderer (`guest-vulkan-webgl/renderer.mjs`)**

- Textures use `texStorage2D(RGBA8)`. Uploads call `texSubImage2D` with every unpack state reset
  (no flip, no premultiply, no colour conversion).
- Samplers are WebGL sampler objects.
- Each combined binding gets its own texture unit.

**Translators (`translator/src/lib.rs`, both backends)**

Pinned Naga 0.20 cannot express a combined `sampler2D` global, so an adapter pass runs before Naga;
Naga's source is unchanged. The pass:

- splits each combined variable into an image global plus a synthesized sampler at binding+16;
- rewrites each `OpLoad` into image load + sampler load + `OpSampledImage`.

Anything else is rejected with explicit messages:

- separate images or samplers;
- arrays;
- 3D, shadow or integer textures;
- function parameters;
- fetch without the sampler;
- set/binding out of range.

Inputs without samplers are byte-identical, which covers all A3 and earlier shaders. Build pins:

| Translator | SHA-256 |
|---|---|
| WGSL | `56b23200…2ebb2` |
| GLSL | `5bf9d0be…40c5` |

`translator-check-run2` passes 167 checks.

## Test application (`web/linux/tests/guest-vulkan-texture/`)

`client.c` is linked against the public static Khronos loader (62 public Vulkan symbols). It uses a
16x16 target, 4x4 and 8x2 textures, and a UBO in the same set.

**Rounds.** It runs 12 exact-reference rounds:

| Round | Mode | Coordinates | Tolerance |
|---|---|---|---|
| 0 | nearest repeat | uv -1..2 | exact |
| 1 | nearest clamp | uv -1..2 | exact |
| 2 | nearest mirror | uv -1..2 | exact |
| 3 | mixed filters (mag nearest) | uv -1..2 | exact |
| 4 | linear repeat | uv 0..1, 1/8 fractions | tolerance 2 |
| 5 | linear clamp | uv 0..1, 1/8 fractions | tolerance 2 |
| 6 | nearest clamp | uv 0..1 | exact |
| 7 | two-texture + UBO channel selection | — | exact |
| 8 | `SRO->DST` re-upload from staging offset 128 | — | exact |
| 9 | rewrite staging and resubmit without re-recording | — | exact |
| 10 | vertex-stage `textureLod` fetch with a flat varying | — | exact |
| 11 | recovery after the negatives | — | exact |

Every round also checks a 32-byte 0xa5 tail after the readback.

**Negatives.** In the guest:

- 6 refused samplers, 1 invalid, and exhaustion at 8;
- 4 rejected images;
- 8 rejected shaders (host -22 on both backends, with identical text);
- 5 rejected set layouts and 1 rejected pipeline layout;
- 3 host-rejected pipelines: texture missing from the layout, declared as a UBO, or wrong stage;
- 2 rejected pools, plus the sampler and set capacity checks;
- 6 invalid recordings;
- 5 refused submits: draw in DST layout, a barrier chain without a copy, a mismatched recorded
  `oldLayout`, a GENERAL-layout descriptor, and a colour-target view descriptor.

The final recovery round must then pass.

**Host-side acceptance (`guest.html`).** Both backends must report exactly:

- 12 passes, 12 draws and 12 vertex uploads;
- 12 uniform uploads: one per submitted pass, since the whole UBO is uploaded per submit as in A3;
- 4 texture uploads, 12 readbacks and 5 translations;
- 27 releases and 14 samplers;
- the 11 expected -22 refusals;
- zero live native objects before emergency cleanup. On WebGL2, every GL object kind, including
  `Sampler` (14/14), is balanced.

## Browser configuration

`run-finite.mjs` now owns a finite server on 4197 and a **headful** Chromium on CDP 9407:

- `DISPLAY=:0`, with an isolated profile under the run directory;
- `--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist --window-size=800,600`;
- PRIME offload variables are stripped from the child environment.

`REQUIRE_WEBGPU_VENDOR=nvidia` makes any WebGPU suite fail unless the adapter vendor is `nvidia`.
`CHROMIUM_MODE=swiftshader` reproduces the old headless SwiftShader flags, for comparison only.
`PKG_RUN=N` selects the package run directories.

## Results

The authoritative run is `/mnt/p6/build/guest-vulkan-a4-20260929/all-run1/result.json`:

- HEAD `0f3376c`, `REQUIRE_WEBGPU_VENDOR=nvidia`, packages `*-package-run4` from `*-build-run5`;
- `pass: true`, browser exit 0, server closed;
- the only HTTP error is `/favicon.ico`.

`web/linux/dist/index.js` and `worker.js` were served from Git HEAD. The working tree differs
because of the concurrent W2 edits.

WebGPU adapter on every WebGPU suite: `{vendor:"nvidia", architecture:"maxwell", isFallbackAdapter:false}`.
WebGL2: `ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)`.

| Suite | Guest checks | Prior (A3, SwiftShader) |
|---|---|---|
| direct live | 140 | 140 |
| direct unavailable | 17 | 17 |
| direct clear | 1087 | 1087 |
| loss-transport | 640 | 640 |
| loss-device | 640 | 640 |
| exhaustion | 1213 | 1213 |
| public-loader clear | 901 | 901 |
| compute | 501 | 501 |
| graphics WebGL2 | 232,753 | 232,753 |
| graphics WebGPU | 232,745 | 232,745 |
| uniform WebGL2 | 201,269 | 201,269 |
| uniform WebGPU | 201,269 | 201,269 |
| **texture WebGL2** | **18,182** | new |
| **texture WebGPU** | **18,182** | new |

All earlier suites, including exact-pixel graphics/uniform and compute, pass unchanged on NVIDIA
and Intel hardware. Per-suite elapsed time is 10-17 s, versus about 4-5 s in the A3 headless run.
That timing includes headful page and boot overhead and is not a GPU benchmark.

Texture artifacts:

| Artifact | Size (bytes) | SHA-256 |
|---|---|---|
| Client `texture-build-run5/guest-vulkan-public-client.wasm` | 441,998 | `bf402cde…5de7` |
| Package `texture-package-run4/initramfs.cpio` | 40,937,788 | `91cd3a54…4b6482` |

`texture-run3` is an additional passing texture-only run on the same hardware.

### NVIDIA versus SwiftShader

The comparison run is `texture-swiftshader-run1`: headless, ANGLE SwiftShader and the google/swiftshader
WebGPU fallback, with the same package. It passes 18,182 checks on both backends.

- Nearest filtering, all addressing modes, re-uploads, multi-texture and vertex fetch are bit-exact
  (max_delta 0) on NVIDIA, Intel and SwiftShader.
- Linear filtering (rounds 4 and 5) is compared against a double-precision CPU bilinear reference with
  tolerance 2. Every backend has max delta 1, but the number of exact components differs:

| Backend | Exact components (of 1024), round 4 / round 5 |
|---|---|
| NVIDIA WebGPU | 896 / 952 |
| Intel ANGLE WebGL2 | 901 / 956 |
| SwiftShader (both) | 1021 / 1022 |

  The hardware samplers use fixed-point filter weights and round differently from the reference.
  This is why the linear rounds need a tolerance on hardware. No component exceeded 1.
- Formats: no difference observed. Only `RGBA8_UNORM` is exercised.

## Defects found by guest runs, and fixes

All failed runs are preserved under `/mnt/p6/build/guest-vulkan-a4-20260929/`.

1. `translator-check-run1`: a wrong rejection regex in the check script. Fixed; run2 passes.
2. `texture-run1`: the first submit with textures failed with "unsupported texture binding field:
   stages".
   - Cause: `validateDrawTextures` returned a `stages` field, and the WebGPU renderer re-validates
     recorded draws at `end()` with the strict field check.
   - Fix: the return value now has the same field set as its input.
3. `texture-run2`: every pixel round passed on NVIDIA, but acceptance failed.
   - Cause: `guest.html` guessed `uniformUploads:1`, whereas the ICD uploads the UBO once per
     submitted pass, which gives 12.
   - Fix: this is a counter-definition issue, so the expected value was corrected. No behaviour
     changed.
4. `texture-run3` and `all-run1`: pass.

## Limitations

- The texture format is `RGBA8_UNORM` only: no sRGB, BGRA, depth, integer or float formats.
- There are no mipmaps, arrays, 3D/cube, multisampled or storage images, and no image-to-image,
  image-to-buffer or partial copies. Linear tiling is not supported.
- There are no separate sampled images or samplers, no immutable samplers, no descriptor arrays, and
  no clamp-to-border.
- Staging data is uploaded in full at every submit that contains the copy.
- There is no depth, no WSI and no `gl_InstanceIndex`.
- The profile is nonconformant and there is no CTS. Pixels near triangle edges are not compared,
  as in A3.
- WebGL2 runs on Intel ANGLE, not NVIDIA. PRIME offload was deliberately not used because it breaks
  WebGL2.

## Next: A5 (depth)

- Add `D32_SFLOAT` and `D16_UNORM` (and perhaps `D24_UNORM_S8_UINT` if it maps cleanly)
  `DEPTH_STENCIL_ATTACHMENT` images, with format queries and `vkGetImageMemoryRequirements`.
- Support render passes with a depth attachment (load/clear/store and `DONT_CARE`), including
  `clearValue.depthStencil`.
- Framebuffers with two attachments.
- Pipeline depth-stencil state: depthTest/Write and compareOp. Depth bias, bounds and stencil should
  initially be rejected.
- Host: a depth texture per target plus `depthStencilAttachment` on WebGPU; a depth renderbuffer on
  the WebGL2 FBO with `depthFunc`/`depthMask`.
- Protocol: an optional depth format and ops on pass/target; a `depthProfile` HELLO field.
- Readback stays colour-only. Tests should use overlapping triangles with exact expected winners on
  both backends, plus clear-value and LOAD persistence.
- Keep the 0.5-texel/edge exclusion rules, and run on NVIDIA headful as here.

## Files

**New:**

- `web/linux/tests/guest-vulkan/texture.inc`
- `web/linux/tests/guest-vulkan-texture/{client.c, guest.html, prepare.py, check-translators.mjs, shaders/*}`
- `docs/evidence/guest-vulkan-20260929/textures.json`

**Modified:**

- ICD: `icd.c`, `compute.inc`, `graphics.inc`, `graphics-commands.inc`, `transfer.inc`, `uniform.inc`
- Guest transport: `guest-gpu/guest-gpu.{c,h}`, `guest-gpu/host.mjs`
- Renderers and hosts: both `renderer.mjs`, `guest-vulkan-webgl/host.mjs`
- Translators: both `translator/{src/lib.rs, abi.mjs, build.py}`
- Build and storage: `guest-vulkan-graphics/{build.py, package.py}` and the `build.py`/`storage.py`
  files of the direct, loader, compute and graphics suites
- Runner: `guest-vulkan/run-finite.mjs`

The rebuild script is `/mnt/p6/build/guest-vulkan-a4-20260929/rebuild.sh`.
