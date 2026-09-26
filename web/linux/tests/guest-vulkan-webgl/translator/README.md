# Isolated WebGL graphics translator

This new ABI (`0x474c0001`) translates supplied SPIR-V through pinned Naga
0.20.0 validation into GLSL ES 3.00 for WebGL 2. The backend uses
`Version::Embedded { version: 300, is_webgl: true }` and explicit
`WriterFlags::ADJUST_COORDINATE_SPACE`. It has no shader fingerprints, replacement
shaders, generated-source rewrites, GPU execution, renderer or guest integration.
The accepted WGSL and compute translators remain separate and unchanged.

`graphics-empty-webgl-v1` permits exactly one raw OpEntryPoint and one validated
vertex or fragment entry, original names of 1–128 UTF-8 bytes, no resources or
specialization constants, and float32 vec2/vec3/vec4 location bindings 0–7.
Vertex output requires position; fragment output requires one location-0 vec4.
Position may also be a fragment input. Other builtins, early depth tests,
nonprivate globals and unsupported capabilities reject. Varyings permit only
perspective or flat interpolation with center/null sampling. Linear/noperspective,
centroid and sample interpolation reject explicitly before backend emission.
Raw `OpDecorate` and `OpMemberDecorate` sampling are checked before IR parsing:
the pinned Naga default-interpolation pass otherwise replaces explicit centroid
sampling with center when the interpolation mode is implicit. The first runtime
check exposed this; its failed evidence is retained in `translator-check-run1`.
Inputs are bounded to 64 KiB, outputs to 256 KiB, metadata to 16 KiB and SPIR-V
ID bound to 16,384. Backend uniform, texture and push-constant reflection must
also be empty.

`createWebGLGraphicsTranslator({url, sha256, timeoutMs})` verifies the fetched
artifact and owns a disposable Worker. Call `translate(bytes, {stage, entryPoint})`
and `close()` on teardown. The optional requested entryPoint is the original
SPIR-V name, including punctuation or reserved words. The pinned writer's
`write_function` always names its emitted entry function `main`; there is no
identifier guessing or GLSL text parsing in translation/reflection. The result is:

```js
{
  glsl, schema: 1, profile: 'graphics-empty-webgl-v1', backend: 'glsl-es-300',
  stage: 'vertex', originalEntryPoint, entryPoint: 'main',
  coordinateAdjustment: true, backendCoordinateAdjustment: true,
  inputs: [{ location: 0, type: { scalar: 'f32', components: 2 }, interpolation: null }],
  outputs: [
    { builtin: 'position', type: { scalar: 'f32', components: 4 }, invariant: false, interpolation: null },
    { location: 0, type: { scalar: 'f32', components: 3 }, interpolation: { mode: 'perspective', sampling: 'center' } }
  ],
  resources: [], varyingBindings: []
}
```

`inputs` and `outputs` are validated IR reflection. `varyingBindings` is the
actual GLSL writer's `ReflectionInfo.varying` map converted to
`{name, location, index}` entries sorted by location, index and name. Names are
bounded to 160 bytes, locations to 0–7, index to zero, count to 16. This map is
**not** a list of all stage varyings. In the pinned ES 300 backend, vertex inputs
and fragment outputs carry explicit locations; stage varyings link through the
writer's generated names. The map can therefore be empty. A future renderer
must validate IR interface compatibility and WebGL program linking.

The SPIR-V frontend retains `adjust_coordinate_space: true`. The GLSL backend
explicitly emits Y inversion and `z = 2*z - w`. The pair is the planned coordinate
contract, not evidence of matching Vulkan/WebGPU pixels. No readback-row flip
is selected here. Required later tests compare asymmetric coverage, negative
z/w rejection, z/w > 1 rejection and non-unit-w perspective interpolation against
an independent oracle, using identical SPIR-V across both backends.

## Reproduction and storage

Only the designated command owner executes these commands, after verifying the
resolved filesystem is disk-backed with adequate capacity. All output directories
must be new. Never overwrite earlier attempts or modify predecessor trees.

```sh
mkdir -p /mnt/p6/build/guest-vulkan-webgl-20260926/tmp
export TMPDIR=/mnt/p6/build/guest-vulkan-webgl-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
/usr/bin/python3 web/linux/tests/guest-vulkan-webgl/translator/build.py \
  --output /mnt/p6/build/guest-vulkan-webgl-20260926/translator-build-run1 \
  > /mnt/p6/build/guest-vulkan-webgl-20260926/translator-build-run1.log 2>&1
mkdir /mnt/p6/build/guest-vulkan-webgl-20260926/translator-check-run1
node web/linux/tests/guest-vulkan-webgl/translator/check.mjs \
  /mnt/p6/build/guest-vulkan-webgl-20260926/translator-build-run1/translator.wasm \
  /mnt/p6/build/guest-vulkan-graphics-20260926/translator-fixtures-run1 \
  /mnt/p6/build/guest-vulkan-webgl-20260926/translator-check-run1/result.json \
  > /mnt/p6/build/guest-vulkan-webgl-20260926/translator-check-run1/run.log 2>&1
```

The builder copies the original dependency closure from the accepted graphics
build-run2 and verifies every copied file against the original pinned closure
and graphics source lock. Naga revision is
`c7458638d14921c7562e4197ddeefa17be413587` (0.20.0). Its `glsl-out` feature has no
extra dependencies. Root package identity is retained; features are exactly
`spv-in` and `glsl-out`. Cargo runs `--offline --locked`; Cargo.lock remains
byte-identical. Existing vendor trees, artifacts and provenance are read-only.
Pinned identities are:

- Original dependency source lock: `5ccf7efcd90cacfefc6fda26986d4d2e9d48f774ba31ad26a4d91c4a925727d9`.
- Graphics source lock: `a62ae7cbbbbd4fb77d277b6d52b657c4733da60569c79bd2c233cbe8a9d03c02`.
- Cargo.lock: `b1bf844ec13b2898eed1fa33686ca22dcd382de2cbb19373d040396ecc7b7b61`.
- Predecessor graphics Wasm: `c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636`.

The new output freezes all twelve source/docs/fixture files and their actual
hashes, both ancestor source locks, dependency files, generated manifest/config
hashes, Cargo.lock, tool version, commands and build logs. No new artifact hash
or source-lock hash is declared before the corresponding bytes exist.

Node checks run the actual translator on all four independently compiled graphics
pair fixtures, mismatch reflection, reserved/punctuated original names, resource
rejection, malformed headers/instructions, raw duplicate entry declarations,
location/size bounds, interpolation rejection and error recovery. They write real
emitted GLSL and hashes. These are translator checks only; they do not compile or
link WebGL shaders, execute pixels or prove Worker lifecycle in a browser.

The new source-only fixtures are not part of the archived fixture manifest.
`clip-negative.vert` has z/w=-0.25; `clip-far.vert` has z/w=1.25. The perspective
fixture uses w=1.5+0.5*x, projected xy equal to the input positions, and z/w=0.25.
For vertices within [-1,1], w is positive; independent expected colors must use
`sum(lambda_i*color_i/w_i)/sum(lambda_i/w_i)`. `unsupported-linear.vert` supplies
noperspective interpolation for explicit rejection. All retain the original
position(vec2)/color(vec3) attributes and location-0 vec3 color varying.

Compile them independently in a later command gate (do not replace existing
SPIR-V). With the same disk environment, one example is:

```sh
mkdir /mnt/p6/build/guest-vulkan-webgl-20260926/coordinate-fixtures-run1
for fixture in clip-negative clip-far perspective unsupported-linear; do
  glslangValidator -V --target-env vulkan1.0 -S vert \
    web/linux/tests/guest-vulkan-webgl/translator/fixtures/"$fixture".vert \
    -o /mnt/p6/build/guest-vulkan-webgl-20260926/coordinate-fixtures-run1/"$fixture".vert.spv \
    > /mnt/p6/build/guest-vulkan-webgl-20260926/coordinate-fixtures-run1/"$fixture".compile.log 2>&1
  spirv-val --target-env vulkan1.0 \
    /mnt/p6/build/guest-vulkan-webgl-20260926/coordinate-fixtures-run1/"$fixture".vert.spv \
    > /mnt/p6/build/guest-vulkan-webgl-20260926/coordinate-fixtures-run1/"$fixture".validate.log 2>&1
done
```

Record independent source/SPIR-V hashes, compiler identity and results before
later translation/pixel gates. Build and check execution is pending at initial
source handoff. No runtime images or public Site are changed by this subtree.
