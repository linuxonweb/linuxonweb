# Bounded runtime SPIR-V translator

This test-only adapter compiles the archived Naga 0.20 SPIR-V frontend,
validator and WGSL backend to browser WebAssembly. It translates the actual
input instruction stream. There is no fixed-shader lookup, CPU shader executor,
guest JIT or direct use of SPIR-V by WebGPU.

The upstream source is pinned to wgpu
`c7458638d14921c7562e4197ddeefa17be413587` by archived Firefox's Cargo.lock.
The [pinned upstream manifest](https://raw.githubusercontent.com/gfx-rs/wgpu/c7458638d14921c7562e4197ddeefa17be413587/naga/Cargo.toml)
declares the SPIR-V frontend's petgraph and spirv dependencies. The local vendor
archive already supplies the required normal dependency closure except petgraph
0.6.5 and fixedbitset 0.4.2. Those two official crate archives are checked against
pre-existing lock hashes before extraction. Builds remain offline.

`build.py` verifies every checksum-listed archived source file before copying.
It records the resolved closure, package checksums, every copied file's hash,
the Firefox lock hash and fixture source hashes in the build's `source-lock.json`.
The isolated Naga manifest removes unavailable upstream test dependencies and
the unused pp-rs GLSL frontend. Original manifest/checksum files, exact patch and
before/after hashes are retained; no archived source or Naga algorithm is edited.
The adapter's workspace excludes the copied Naga package. All outputs, compiler
scratch and Cargo caches must remain below
`/mnt/p6/build/guest-vulkan-compute-20260926`, with exported TMPDIR/TMP/TEMP.

The current profile accepts little-endian SPIR-V 1.0–1.3, 20–65,536 aligned bytes,
at most 16,384 IDs, one compute entry named `main` with local size 64×1×1, one
read/write storage descriptor at set 0/binding 0, private/workgroup variables and
no specialization constants. Naga parses arbitrary supported instructions and
validates all IR before emitting at most 256 KiB WGSL. Unsupported resources,
capabilities and malformed inputs reject. These deliberate restrictions do not
establish Vulkan conformance or a generally usable shader driver.

The raw Wasm ABI exports `translator_version`, `input_reserve`, `translate`,
`output_ptr`, `output_len`, `entry_point_ptr`, `entry_point_len` and memory.
Version is 1. Reserve returns owned writable input storage or zero; translation
requires that exact length and returns zero on success or one on rejection.
Output holds WGSL or a bounded diagnostic. Entry metadata uses the pinned WGSL
writer's own naming policy, including collisions. Reserve and translate clear
stale output, and translate consumes its input. The module has a 128 MiB maximum
memory and requires no imports.

`createSpirvTranslator({url, sha256})` verifies the bounded artifact download,
instantiates it in a dedicated module Worker and returns `translate(bytes)` and
`close()`. Translation returns `{wgsl, entryPoint, workgroupSize}`. One request is
accepted at a time. Normal shader rejection preserves the instance; worker
failure, Wasm trap or deadline terminates it, and the next call initializes a
fresh instance. Call `close()` during session teardown.

The accepted translator build is `translator-build-run4/translator.wasm`,
751,237 bytes, SHA-256
`e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea`.
Its source-lock SHA-256 is
`5ccf7efcd90cacfefc6fda26986d4d2e9d48f774ba31ad26a4d91c4a925727d9`.
Exact run4 `Cargo.lock` and `source-lock.json` copies are retained in
`provenance/`. The Cargo lock SHA-256 is
`b1bf844ec13b2898eed1fa33686ca22dcd382de2cbb19373d040396ecc7b7b61`.
These records are authoritative for reproducing the accepted
dependency closure. The helper currently resolves offline against the supplied
archived vendor tree, then freezes/checksums that result; it does not consume
these provenance copies as an enforced resolver lock. This is not a claim of
bit-for-bit reproduction across different compiler or source environments.
The build validates Wasm; `check.mjs` then instantiates the actual artifact and
passes 33 assertions, including two distinct program translations, emitted entry
names, malformed input/profile rejection, output ownership and recovery.
Evidence is `translator-test-run1/check.json`. Earlier failed runs preserve
missing test/optional dependency and metadata stdout/stderr build-boundary errors.

Compile the two `.comp` fixtures with installed `glslangValidator -V
--target-env vulkan1.0 -S comp`, validate them with `spirv-val`, then pass the Wasm,
both SPIR-V paths and a task-disk report path to `node check.mjs`.
`prepare-qa.py` freezes those artifacts and all browser fixture hashes into a
fresh task directory. The serving owner links that directory as `candidate`.
`run-browser.mjs` connects to an already-owned CDP browser and server using
`CDP_URL` and `TRANSLATOR_QA_BASE`; set `TRANSLATOR_QA_OUT` to a fresh task
directory and `TRANSLATOR_MANIFEST_SHA` to the prepared manifest hash.
It creates and closes only its own tab. The page translates both programs in
the actual Worker, submits WebGPU compute and compares 64 varying integer
outputs plus four sentinel words per program, then releases buffers/device.
That browser gate is separate from the Node translation gate and from the
eventual Linux guest/public Vulkan application gate.

The first browser gate passed **167 assertions** in a visible, isolated page,
including all 128 computed integers and eight unchanged sentinel words. Both
programs were translated in the real dedicated Worker and executed by WebGPU
using Google SwiftShader fallback. One native device and four buffers were
created/destroyed, leaving zero tracked native allocations. Malformed SPIR-V
rejection followed by valid translation/dispatch, artifact hash mismatch and
closed-translator rejection passed. There were no QA errors or Runtime
exceptions. One canceled Fetch (`net::ERR_ABORTED`) remains in the raw browser
events; the runner did not retain its URL, so its cause is unknown. Worker close
is exercised, but there is no independent worker-ownership audit. This is
software host GPU evidence, not Linux guest integration. Raw evidence is
`translator-browser-run1/result.json` and `page.png` under the task root.
