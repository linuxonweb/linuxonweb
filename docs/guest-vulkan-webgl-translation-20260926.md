# WebGL shader translation and coordinate verification

The supplied Vulkan SPIR-V now translates to GLSL ES 3.00 and executes in a
real WebGL2 context. Fourteen shader/layout cases match an independent pixel
oracle. This establishes the shader and coordinate contract needed for the
planned fallback. It does **not** yet connect WebGL to the guest Vulkan driver
or accelerate Firefox. The public runtime and Site remain unchanged.

## Implementation and evidence

The isolated translator is in
`web/linux/tests/guest-vulkan-webgl/translator/`. ABI `0x474c0001` uses pinned
Naga 0.20, with the original offline dependency closure and unchanged Cargo.lock.
It translates supplied SPIR-V, retains original entry names, emits the actual
backend's GLSL and reflection, and enforces a bounded empty-resource profile.
It does not substitute known shaders or rewrite emitted source.

All build outputs, logs, compiler scratch and browser profiles are under
`/mnt/p6/build/guest-vulkan-webgl-20260926` on ext4. The accepted WebGL build is
`translator-build-run2`: 869,592 bytes, SHA-256
`4fcdabf05d9e9cc0003e299739d809a7360256b405a3bb588e5a5771b410aa49`.
Its source-lock SHA-256 is
`dbcfbc02aa437989a1bf85142684395c79095607febd50d6e28decfa3b5e6fc7`.

| Gate | Result | Evidence directory |
| --- | --- | --- |
| Actual Wasm translator/ABI | 94 checks | `translator-check-run2` |
| Independent GLSL → SPIR-V compiler and validator | 8 shaders | `coordinate-fixtures-run1` |
| Coordinate inputs and sampling rejection | 185 checks | `coordinate-check-run1` |
| Real WebGL2 shader compile/link and pixels | 14 cases, 50,021 mostly pixel checks | `coordinate-browser-run1` |
| Current source/artifact/ownership audit | 78 checks | `checkpoint-run1` |

The browser tests use the existing two vertex programs, two fragment programs
and two vertex layouts, plus negative clip depth, far clip depth and varying
positive clip-w in both layouts. The target is 73×51 with an offset viewport and
scissor. An independent barycentric oracle checks interior colors with a
two-byte tolerance, exact clear-color exterior and alpha. Boundary bands are
excluded for normal triangles; clipped cases require every pixel to remain
clear. Perspective cases use reciprocal-w interpolation rather than affine
colors. Direct `readPixels` row order matches this positive-height Vulkan
viewport oracle without an additional flip.

The finite headless Chromium command uses ANGLE **SwiftShader**. It proves API
behavior, not physical GPU acceleration. It starts no HTTP or persistent browser
service. The browser exits after the test; the audit finds no remaining process
for its owned profile and verifies the user's existing server identity.

Before emergency cleanup, normal-path ownership is balanced: 28 shaders,
14 programs, 14 textures, 14 framebuffers, 14 vertex arrays and 21 buffers were
created and deleted. Live native objects are zero. This is direct test-harness
ownership; production renderer/context-loss ownership still requires testing.

## Sampling bug discovered and fixed

The first translator check failed on centroid sampling. The pinned Naga
`front/interpolator.rs` sets center sampling when it supplies an implicit
perspective interpolation mode, overwriting an explicit sampling declaration.
Thus checking only normalized IR could silently accept an unsupported input.

Both GLSL and WGSL graphics translator sources now reject raw Centroid/Sample
`OpDecorate` and `OpMemberDecorate` before parsing, then retain their IR checks.
Independent compiler inputs cover direct and interface-block decorations.
The failed `translator-check-run1` and its build remain intact.

`predecessor-sampling-audit-run1` confirms the immutable WGSL predecessor
incorrectly accepts the two direct declarations and reflects center sampling.
It already rejects the member cases during IR validation. This diagnostic is
not a passing acceptance result.

The corrected WGSL build is under the **graphics** task:
`/mnt/p6/build/guest-vulkan-graphics-20260926/translator-build-run3`.
It is 771,589 bytes, SHA-256
`a530270fb7ae3099fbcf60964cff494987fdf608720ce34b936e52a545b3335b`.
`translator-check-run4` passes 72 checks. The WebGL task's
`wgsl-sampling-check-run1` passes 31 checks: all four independent sampling
inputs reject explicitly, and five existing shaders retain byte-identical WGSL
and identical reflection. The old WGSL and compute artifacts are preserved.
The corrected WGSL artifact still needs Worker/host/guest regression before
replacing the previously tested candidate in those gates.

## Reproduction and remaining work

Use the environment setup in `AGENTS.md` and fresh output names. Translator
build/check commands are in its README; accepted output identities above
supersede initial source-handoff notes. Additional commands are:

```sh
python3 web/linux/tests/guest-vulkan-webgl/prepare-fixtures.py --output "$TASK/coordinate-fixtures-run1"
node web/linux/tests/guest-vulkan-webgl/check-coordinate.mjs "$TASK/translator-build-run2/translator.wasm" "$TASK/coordinate-fixtures-run1" "$TASK/coordinate-check-run1/result.json"
python3 web/linux/tests/guest-vulkan-webgl/run-coordinate-browser.py --output "$TASK/coordinate-browser-run1"
node web/linux/tests/guest-vulkan-webgl/check-wgsl-sampling.mjs /mnt/p6/build/guest-vulkan-graphics-20260926/translator-build-run3/translator.wasm "$TASK/wgsl-sampling-check-run1/result.json"
```

Here `TASK` is `/mnt/p6/build/guest-vulkan-webgl-20260926`. Create new result
directories before Node checks. The browser and WGSL sampling helpers currently
default to the specific accepted input directories; update arguments/code and
record hashes if using a different reproduction layout. Never overwrite a run.

Compact source/artifact and ownership evidence is in
[the audit JSON](evidence/runtime-graphics-20260926/guest-vulkan-webgl-translation.json).
The full next steps remain in [the fallback plan](guest-vulkan-webgl-plan-20260926.md):
implement the bounded WebGL renderer, test lifetimes and whole-pass validation,
select the backend accurately in the protocol, and run the same public Vulkan
client in real Linux with WebGPU unavailable. Fragment-position semantics and
same-input WebGPU parity for the new coordinate cases are also pending.

Mesa/Zink/OpenGL/X11 integration, Firefox WebGL/WebGPU, native JIT, hardware
decoding, performance acceptance and final redeployment remain incomplete.
The overall goal has not reached the requested 95/100.

Fresh agent creation and both attempted resumptions were rejected by the tool's
thread limit during this continuation. Root performed the bounded build/test
and fix work directly; do not describe those executions as delegated. No
additional serving agent or persistent service was created.
