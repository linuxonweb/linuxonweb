# Guest Vulkan: uniform buffers in graphics (packet A3) — 2026-09-29

Scope: this packet covers the experimental guest ICD under `web/linux/tests/guest-vulkan/`,
its vsock host (`web/linux/tests/guest-gpu/host.mjs`), the WebGPU renderer and the WebGL2
fallback renderer, and both Naga translators. It is track A item A3 of
`docs/vulkan-gap-zink-vkcube-20260928.md`.

This is a bounded, nonconformant profile. The limits are:

- Rendering is SwiftShader software only.
- It makes no claim about a physical GPU, Zink, OpenGL, Firefox GPU, decoders or a native JIT.
- The accepted `web/linux` images and `web/sites` are unchanged, and nothing was deployed.

The work began from a previous agent's uncommitted edits. They were reviewed and kept. Three
defects were found by actual guest runs and fixed (see below).

## Implemented

### Guest ICD

The descriptor code is in the new `uniform.inc` (included from `compute.inc`). Submission changes
are in `graphics.inc`, `graphics-commands.inc`, `transfer.inc` and `icd.c`.

The whole profile is opt-in. It is enabled only when the host HELLO carries these fields:

- `uniformProfile:1`
- `maxUniformRange:16384`
- `uniformOffsetAlignment:256`
- `maxUniformBuffer:65536`

**Descriptor set layouts**

- Up to 4 bindings.
- Binding numbers below 16.
- Type `UNIFORM_BUFFER` only, with `descriptorCount` 1.
- Stages VERTEX and/or FRAGMENT only.
- Duplicate bindings, compute stage, arrays and immutable samplers are rejected with
  `INITIALIZATION_FAILED`.

**Pipeline layouts**

- 1 to 4 set layouts.
- At most 8 bindings in total.
- Push-constant ranges are rejected.

**Descriptor pools and sets**

- A pool's `maxSets` must be 1 to 8, and `UNIFORM_BUFFER` descriptors 1 to 32.
- Running out of sets or descriptors returns `VK_ERROR_OUT_OF_POOL_MEMORY`.
- Destroying a pool frees its sets.

**`vkUpdateDescriptorSets`**

- Writes only (no copies).
- Offset must be a multiple of 256.
- Range must be 16 to 16384 bytes, a multiple of 16, or `VK_WHOLE_SIZE`.
- The buffer must be a bound UNIFORM buffer.
- Any invalid write clears the whole set. Submitting with such a set is refused before any host
  effect.

**`vkCmdBindDescriptorSets`**

- The bound set must be compatible with the pipeline layout (set layout equality).
- The `firstSet + count` range must lie within the layout.
- Dynamic offsets are rejected at `vkEndCommandBuffer`.
- Missing or incompatible sets are rejected at the draw.

**Uniform buffers**

- `VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT` buffers must be 16 to 65536 bytes, in multiples of 16.
- Memory alignment is 256.
- The only buffer barrier accepted on a UBO is `HOST -> VERTEX/FRAGMENT` with
  `HOST_WRITE -> UNIFORM_READ` over the whole buffer.
- Host coherent memory is used, and the buffer maps to the new host opcode `GPU_UNIFORM_BUFFER` (23).

**Submit**

- The whole stream is prevalidated, including each draw's bound range against the host-reported
  minimum block size.
- Each used uniform buffer is then uploaded once per submit with `GPU_UNIFORM_UPLOAD` (24), as is
  each vertex buffer.
- Each draw carries its `uniforms` bindings `{group, binding, buffer, offset, size}`.
- The pipeline-create reply now carries one minimum std140 block size per declared uniform, so the
  guest can refuse short ranges locally.

### Transport (`guest-gpu.c`/`.h`)

- Adds opcodes 23 and 24.
- Raises the guest-side opcode bound to `GPU_UNIFORM_UPLOAD`.

### Translators

The same rules apply in both translators (`guest-vulkan-graphics/translator` for WGSL and
`guest-vulkan-webgl/translator` for GLSL ES 300):

- Uniform-space globals are accepted only when `set < 4` and `binding < 16`, with no duplicates and
  at most 8 per shader.
- Block members must be `vec4<f32>`, column-major `mat4x4<f32>` or `array<vec4<f32>, N>` with
  stride 16, and must be tightly packed. The block must be at most 16 KiB.
- `RowMajor` decorations are rejected before parsing.
- Reflection is emitted as `resources:[{group,binding,type:'uniform',size,members}]`. The GLSL
  output adds `blockName`.
- The Vulkan `gl_VertexIndex` built-in is accepted as a vertex-stage u32 input and includes
  `firstVertex`.
- Everything else outside the profile (samplers, storage, other built-ins) is still rejected.

New pinned builds:

| Backend | Build | Size (bytes) | SHA-256 |
|---|---|---|---|
| WGSL | `wgsl-translator-build-run1/translator.wasm` | 786,443 | `f1df2253…4542` |
| GLSL | `glsl-translator-build-run1/translator.wasm` | 887,995 | `31d062e7…a0bd` |

Both are pinned in `guest-vulkan-webgl/host.mjs` and `run-finite.mjs`.

### Host renderers

**Shared validation**

- The shared validation lives in `guest-vulkan-graphics/renderer.mjs` (`UNIFORM_LIMITS`,
  `validateUniformReflection`, `validateVertexIndex`, `validateDrawUniforms`,
  `validateUniformBufferDescriptor`).
- A pipeline declares its layout bindings with their stage masks.
- A shader uniform that is missing from the layout, or not visible to its stage, is rejected.

**WebGPU**

- Explicit bind-group layouts are built per set.
- Uniform buffers are uploaded with `queue.writeBuffer`.
- Bind groups are created per draw from `{buffer, offset, size}`.

**WebGL2**

- Each linked program must report exactly the reflected blocks, with sizes of at least the
  translator's std140 size.
- Block binding point = index of the declared pipeline uniform. Draws use `bindBufferRange`.
- Context limits are checked at creation: 8 bindings, 16 KiB blocks, alignment that divides 256,
  and 8 blocks per stage.
- ANGLE lists the `gl_VertexID` built-in as an active attribute. It is accepted only when the
  translator's reflection declared `vertex_index`.

**Enabling the profile**

- `serveFallback(..., {allowUniforms:true})` enables the profile and adds the HELLO fields.
- Without the option, every existing suite keeps its byte-identical HELLO and behaviour.

### Test application (`web/linux/tests/guest-vulkan-uniform/`)

The application uses only public Vulkan through the static Khronos loader (`client.c`).
`prepare.py` compiles six GLSL fixtures with glslangValidator. `check-translators.mjs` checks both
translators on them. `guest.html` is the finite page.

The shaders:

- `index.vert`: `gl_Position = transform.mvp * transform.positions[gl_VertexIndex]`, where
  `Transform { mat4 mvp; vec4 positions[6]; }` is at set 0 binding 0.
- `color.frag`: the colour comes from set 1 binding 0.
- `offset.vert` + `tint.frag`: a vertex-buffer triangle, shifted and tinted by a
  `Params { vec4 offset; vec4 tint; }` block at set 0 binding 1, visible to both stages.

Frames: eight 73x51 frames, each read back and checked pixel-exactly on the CPU.

| Frame | What it tests |
|---|---|
| R0 | MVP (w != 1), positions and colour are written after recording. |
| R1 | Only the UBO bytes change; the same command buffer is resubmitted. |
| R2 | Set 1 is rebound between two draws; the second draw uses `firstVertex=3`. |
| R3 | Two pipelines, two UBOs and a vertex buffer in one pass. |
| R4 | New offset, tint and colour, without re-recording. |
| R5 | `vkUpdateDescriptorSets` re-points a set to offset 512 with `VK_WHOLE_SIZE`. |
| R6 | Recovery after invalid writes. |
| R7 | Recovery after a too-short range. |

Negative checks:

- **Buffer sizes:** two bad UBO sizes are rejected.
- **Set layouts:** five are rejected (binding 16, count 2, compute stage, duplicate, five bindings).
- **Pipeline layouts:** three are rejected (push constants, five sets, 12 bindings).
- **Pools:** one pool with `maxSets` 9 is rejected, and two exhaustion cases return
  `OUT_OF_POOL_MEMORY`.
- **Translator:** two shaders are rejected by the host translator (binding 16; a `float` member).
- **Host pipeline:** two pipelines are rejected (a uniform missing from the layout; a uniform not
  visible to its stage).
- **Recording:** six recordings are refused at `vkEndCommandBuffer`:
  - dynamic offsets;
  - set 1 unbound at the draw;
  - an incompatible set;
  - `firstSet` past the layout;
  - `count` past the layout;
  - a `TRANSFER_WRITE -> UNIFORM_READ` buffer barrier on the UBO, recorded with an otherwise
    valid bind. Only whole-buffer `HOST_WRITE -> UNIFORM_READ` barriers to the vertex and/or
    fragment stages are accepted, because nothing can transfer-write a UBO.
- **Descriptor writes:** five invalid writes each cause the submit to be refused, with all 14,924
  readback bytes left at 0xa5 (offset 16; range 20; a vertex buffer; offset past the end; a missing
  binding).
- **Short range:** a range shorter than the shader's 160-byte block is refused at submit.

Pixel model:

- Each pixel centre is tested barycentrically. Pixels within 0.04 of an edge are skipped.
- Every other pixel is compared exactly in all four components, against either the triangle colour
  or the green clear.
- The 32 tail bytes must stay 0xa5.
- Every triangle must cover at least 20 inside pixels.

Per-round coverage:

| Round | inside0 | inside1 | outside |
|---|---|---|---|
| R0 | 256 | 0 | 3309 |
| R1 | 227 | 0 | 3355 |
| R2 | 227 | 248 | 2957 |
| R3 | 231 | 220 | 2990 |
| R4–R7 | 231 | 211 | 3010 |

The page (`guest.html`) also requires:

- the exact host counters: 8 passes, 14 draws, 5 vertex uploads, 13 uniform uploads, 8 readbacks,
  4 translations and 10 releases;
- exactly four refused host commands: shader (16, -22) twice and pipeline (17, -22) twice;
- two HELLOs with the uniform fields;
- zero live native objects, workers, buffers and textures before emergency cleanup;
- actual 1 GiB / 2 CPU boot evidence.

## Results

The authoritative run is `/mnt/p6/build/guest-vulkan-a3-20260928/guest-run1/result.json`:

- runner `web/linux/tests/guest-vulkan/run-finite.mjs`, HEAD `9154304`;
- the 28 HEAD-served routes are identical to the working tree, and the working-tree
  host sources are served from the build's pinned `hostSources`;
- the browser exited 0 and the server closed;
- the only HTTP error is `/favicon.ico`.

| Suite | Guest checks | Prior (A1/A2) |
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
| **uniform WebGL2** | **201,269** | new |
| **uniform WebGPU** | **201,269** | new |

Most of the uniform checks are individual pixel-component comparisons.

On both backends the uniform host report matches exactly: 61 commands and the four expected -22
refusals.

WebGL2 created and deleted equal numbers of each object type:

| Object type | Count |
|---|---|
| Buffer | 11 |
| Texture | 1 |
| Framebuffer | 1 |
| VertexArray | 8 |
| Program | 2 |
| Shader | 4 |
| Sync | 16 |

Adapters: WebGL2 ran on ANGLE SwiftShader, WebGPU on the google/swiftshader fallback adapter.

`net::ERR_ABORTED` was seen once on graphics-webgl2 and once on uniform-webgpu. Its cause was not
established, and the same pattern appears in earlier graphics runs.

Translator check `translator-check-run1/result.json` passes 58 checks: WGSL and GLSL translation of
the four accepted shaders, and matching rejection text for both bad shaders in both translators.

Uniform artifacts:

| Artifact | Size (bytes) | SHA-256 |
|---|---|---|
| Client `uniform-build-run5/guest-vulkan-public-client.wasm` | 417,338 | `7c77ff15…753e` |
| Package `uniform-package-run4/initramfs.cpio` | 40,913,128 | `cb19242d…afe` |

The other suites were rebuilt from the same sources into `*-build-run5` / `*-package-run4`
(see `rebuild.sh`).

## Defects found by guest runs, and fixes

All failed runs are preserved.

1. `uniform-build-run1`: the build failed because `guest-vulkan-uniform/guest.html` was missing.
   The page was written.
2. `uniform-run1`: `vkBindBufferMemory` failed for the UBO. The guest transport refused to send any
   opcode above `GPU_GRAPHICS_READBACK`. Fixed with a one-line bound change in `guest-gpu.c`.
3. `uniform-run2`: the bad-pipeline negative returned `DEVICE_LOST` instead of
   `INITIALIZATION_FAILED`. The pipeline reply buffer in `graphics.inc` (36 bytes) was smaller than
   the host's -22 error text, so the session was poisoned. The buffer was raised to 512 bytes.
4. `uniform-run3`: WebGL2 failed with "unexpected built-in attribute". ANGLE reports `gl_VertexID`
   as an active attribute. The WebGL renderer now skips it only when `vertex_index` was reflected.
5. `uniform-run4`: passed on both backends. `guest-run1` is the final full regression, with all 12
   suites passing.

## Limitations

**Not supported (rejected):**

- dynamic offsets (`UNIFORM_BUFFER_DYNAMIC`);
- push constants;
- descriptor copies, update templates and push descriptors;
- freeing or resetting individual sets.

**Profile limits:**

- UBO members are limited to `vec4`, `mat4` and `vec4[N]` (tightly packed std140 subset). There are
  no scalars, vec2/vec3, nested structs or row-major matrices.
- At most 4 sets and 8 bindings per pipeline; 16 KiB range; 64 KiB buffer; 256-byte offset
  alignment.
- The whole UBO is uploaded per submit and per used buffer, not just dirty ranges.

**Graphics features not yet present:**

- No samplers, textures, storage buffers or images in graphics. Those are A4.
- `gl_VertexIndex` is the only new built-in; there is no `gl_InstanceIndex`.
- There is no depth and no WSI.

**Test coverage:**

- Pixels within 0.04 of a triangle edge are not compared, because rasterization-rule differences
  between backends are not asserted.
- Everything ran on SwiftShader only. The profile is nonconformant, and there is no CTS.

## Files

**New:**

- `web/linux/tests/guest-vulkan/uniform.inc`
- `web/linux/tests/guest-vulkan-uniform/{client.c, prepare.py, check-translators.mjs, guest.html, shaders/*}`

**Modified:**

- ICD: `icd.c`, `compute.inc`, `graphics.inc`, `graphics-commands.inc`, `transfer.inc`,
  `build.py`, `storage.py`, `run-finite.mjs`
- Transport: `guest-gpu/{guest-gpu.c, guest-gpu.h, host.mjs}`
- Graphics renderer and translator: `guest-vulkan-graphics/{renderer.mjs, build.py, package.py,
  storage.py, translator/*}`
- WebGL renderer and translator: `guest-vulkan-webgl/{host.mjs, renderer.mjs, translator/*}`
- Build plumbing: `guest-vulkan-{compute,loader}/{build.py, storage.py}`

Neither the Khronos loader nor the Naga vendor sources were modified.

Evidence: `docs/evidence/guest-vulkan-20260929/uniform-buffers.json`.
