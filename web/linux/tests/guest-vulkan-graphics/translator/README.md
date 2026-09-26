# Isolated graphics translation contract

This is a separate translator ABI (`0x47520001`). The accepted compute module,
its ABI, sources and provenance remain unchanged. It translates real supplied
SPIR-V with pinned Naga 0.20.0, validates IR, reflects the IR interface and emits
WGSL. It does not execute shaders, recognize fixture hashes or supply CPU pixels.
Build success alone is not graphics execution or guest Vulkan evidence.

Accepted graphics build-run2 is 771,221 bytes, SHA-256
`c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636`.
Node check-run3 passes 66 assertions, and separate browser renderer and byte
protocol gates pass shader-dependent pixels. See the
[execution report](../../../../../docs/guest-vulkan-graphics-transport-20260926.md).
The earlier build-run1 is retained but superseded: a duplicate raw OpEntryPoint
declaration could collapse in Naga IR and evade the original post-parse count.
The accepted source checks the raw declaration count before parsing as well.

The initial `graphics-empty-v1` profile permits one vertex or fragment entry
point, arbitrary original entry names up to 128 UTF-8 bytes, no resources or
specialization constants, and float32 vector locations 0–7 with 2–4 components.
Vertex output requires position; fragment output requires location 0 vec4.
Position is also an optional fragment input. Other builtins, early depth tests,
centroid/sample interpolation and unsupported capabilities reject explicitly.
The original stage/name requested by Vulkan must be matched before pipeline
creation; the emitted name is what the backend uses.

`createGraphicsTranslator({url, sha256})` verifies the module hash and owns one
deadline-bounded disposable Worker. Call `translate(bytes, {stage, entryPoint})`
and `close()` on teardown. The optional request `entryPoint` is the original
SPIR-V name. The result is a flat object:

```js
{
  wgsl, schema: 1, profile: 'graphics-empty-v1', backend: 'wgsl',
  stage: 'vertex', originalEntryPoint, entryPoint,
  coordinateAdjustment: true,
  inputs: [{ location: 0, type: { scalar: 'f32', components: 2 }, interpolation: null }],
  outputs: [
    { builtin: 'position', type: { scalar: 'f32', components: 4 }, invariant: false, interpolation: null },
    { location: 0, type: { scalar: 'f32', components: 3 }, interpolation: { mode: 'perspective', sampling: 'center' } }
  ],
  resources: []
}
```

Varying interpolation modes are `perspective`, `linear`, or `flat`; sampling is
`center` or null as represented in validated IR. Non-varying locations report
null interpolation. Builtins are in the same input/output arrays as locations.
The renderer must check stage interfaces and declarative vertex layouts. The
schema separates reflection from backend source so a later GLSL ES 3.00 backend
can have an explicit coordinate/output contract; no WebGL compute support is
implied. The current backend is WGSL only.

The SPIR-V parser uses `adjust_coordinate_space: true`. Entry names use the
exact pinned WGSL writer's `Namer::reset` policy, including reserved identifiers
and type-name collisions. Neither interface reflection nor name determination
parses WGSL text. Browser GPU acceptance must still verify asymmetric coverage,
depth clipping and the full coordinate transform; do not add another Y flip
based only on this flag.

## Reproduction

Only the designated command owner runs these commands. Verify the resolved
filesystem and free capacity first. All outputs, logs, Cargo cache and tool
scratch must be disk-backed. Never use `/tmp` or modify preserved run4 inputs.

```sh
mkdir -p /mnt/p6/build/guest-vulkan-graphics-20260926/tmp
export TMPDIR=/mnt/p6/build/guest-vulkan-graphics-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
/usr/bin/python3 web/linux/tests/guest-vulkan-graphics/translator/build.py \
  --output /mnt/p6/build/guest-vulkan-graphics-20260926/translator-build-next \
  > /mnt/p6/build/guest-vulkan-graphics-20260926/translator-build-next.log 2>&1
/usr/bin/python3 web/linux/tests/guest-vulkan-graphics/translator/prepare-fixtures.py \
  --output /mnt/p6/build/guest-vulkan-graphics-20260926/translator-fixtures-next \
  > /mnt/p6/build/guest-vulkan-graphics-20260926/translator-fixtures-next.log 2>&1
mkdir /mnt/p6/build/guest-vulkan-graphics-20260926/translator-check-next
node web/linux/tests/guest-vulkan-graphics/translator/check.mjs \
  /mnt/p6/build/guest-vulkan-graphics-20260926/translator-build-next/translator.wasm \
  /mnt/p6/build/guest-vulkan-graphics-20260926/translator-fixtures-next \
  /mnt/p6/build/guest-vulkan-graphics-20260926/translator-check-next/result.json \
  > /mnt/p6/build/guest-vulkan-graphics-20260926/translator-check-next/run.log 2>&1
```

`build.py` verifies the committed provenance and run4 source-lock SHA, copies
each exact pinned source file (including its previously documented Naga
manifest-only port), and reuses the byte-identical accepted Cargo.lock. No
dependency resolution update or download occurs. The root package identity is
retained only for lock identity; the new module lives in a separate output root.
Source freezes, tool versions, build commands, lock and artifact hashes remain
in the output. A broad vendor tree is never committed. This pins source inputs;
it does not promise arbitrary toolchain-independent binary reproducibility.

The fixtures are independently compiled GLSL vertex/fragment pairs. The helper
changes only each compiled module's `OpEntryPoint` string, preserves interface
IDs/instructions, then runs `spirv-val`. Pair A passes input positions and colors;
pair B changes geometry with scale/translation and independently swizzles colors.
The vertex declarations expose only position from `gl_PerVertex`. Punctuation,
reserved keyword `if`, and a `VertexPayload` type/entry collision exercise name
handling. Additional modules test interface mismatch and prohibited resources.

Use new output names for each attempt and preserve existing evidence. Build/ABI,
runtime rejection recovery, Worker/WebGPU shader-dependent pixels, separate and
interleaved layouts, interface rejection and asymmetric viewport landmarks pass.
Negative-depth/non-unit-w clipping, pending-operation/device-loss cases, actual
public-loader guest graphics and presentation remain required. No accepted
runtime or Site is changed by this subtree.
