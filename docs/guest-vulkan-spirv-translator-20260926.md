# Real SPIR-V translation and host compute gate

The bounded Naga translator now accepts application SPIR-V bytes at runtime,
parses and validates them, emits WGSL, and executes both tested programs through
real browser WebGPU compute. The first visible browser attempt passed **167
assertions**. Its device was **Google SwiftShader fallback**, so this establishes
software execution through the GPU API. The Linux guest/public Vulkan compute
boundary is the next gate; it is not supplied by this host test.

Both GLSL fixtures were compiled by installed `glslangValidator` for Vulkan 1.0
and passed `spirv-val`. Their programs compute `x * 3 + 7` and
`((x ^ 85) + 17) * 5` over 64 varying input integers. The browser passes their
actual, different SPIR-V modules into the dedicated translator Worker. Generated
WGSL differs and matches the independently executed Node translation output.
WebGPU dispatches one 64-thread workgroup per program, and staging readback
matches all 64 results plus four unchanged tail sentinel words per dispatch.
Expected values are used only for comparisons. There is no recognition of fixed
shader bytes or CPU substitution for GPU output.

The 167 count includes 136 individual output/sentinel comparisons. One device,
two storage buffers and two staging buffers were created and destroyed, leaving
zero tracked native buffers/devices. Malformed SPIR-V rejection followed by a
valid second translation/dispatch, artifact hash mismatch and closed-translator
rejection passed. QA errors and Runtime exceptions were absent. One canceled
Fetch (`net::ERR_ABORTED`) remains in the raw CDP events; its URL was not recorded
and the cause is unresolved. Worker teardown is invoked by the wrapper, but no
independent worker-ownership counter was collected. The serving owner's browser
and server remain intentionally available for the next guest integration gate;
this report does not claim service cleanup.

The separate Node test passes 33 assertions against the actual translator Wasm,
including both runtime translations, zero imports, emitted entry names, malformed
header/instruction/truncation, unsupported workgroup, reserved-length mismatch,
stale output clearing and valid recovery. These are translation/ABI checks, not
additional GPU executions.

## Sources and restricted ABI

The adapter uses archived Naga 0.20 at wgpu revision
`c7458638d14921c7562e4197ddeefa17be413587`. Its
[pinned upstream manifest](https://raw.githubusercontent.com/gfx-rs/wgpu/c7458638d14921c7562e4197ddeefa17be413587/naga/Cargo.toml)
declares the SPIR-V frontend's petgraph/spirv dependencies. Only petgraph 0.6.5
and fixedbitset 0.4.2 needed retrieval; their official crate archives matched
pre-existing Cargo lock SHA-256 values. Every resolved archived dependency file
is verified against its vendor checksum before copying. The exact accepted
Cargo lock and full source/file-hash closure are preserved in the fixture's
`translator/provenance/` directory.

The isolated Naga manifest removes missing upstream test-only dependency tables
and the unused pp-rs GLSL dependency. Original manifest/checksum files, exact
patch and before/after hashes are retained. Naga algorithm sources and the
archived Firefox tree remain unchanged. The build helper resolves offline
against that archive before freezing the closure; the provenance records pin
the accepted result, but the helper does not yet use them as an enforced
resolver input. Cross-environment binary reproducibility is not claimed.

The accepted build is `translator-build-run4/translator.wasm`, **751,237 bytes**,
SHA-256 `e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea`.
It has no imports, a 1 MiB stack, and maximum linear memory of 128 MiB.
All build sources, Cargo caches, scratch, compiler logs, shader artifacts and
browser evidence remain on verified ext4 under
`/mnt/p6/build/guest-vulkan-compute-20260926/`, with explicit TMPDIR/TMP/TEMP.
Failed earlier build attempts are retained: missing test-manifest dependency,
inactive GLSL dependency, and Cargo metadata diagnostics sharing stdout. These
build-boundary failures preceded the successful compile; they were not shader
algorithm repairs.

The profile bounds SPIR-V input to 64 KiB and 16,384 IDs, one compute entry named
`main`, local size 64×1×1, one read/write storage descriptor at set 0/binding 0,
and no specialization constants or other bound resource types. Naga validates
all IR and emits at most 256 KiB WGSL. Actual output entry naming comes from the
pinned writer's naming policy. The JS wrapper checks the downloaded artifact
hash, runs translation in a dedicated Worker with a deadline, and discards the
instance on trap/worker failure/timeout. Normal malformed-input rejection is
recoverable. Timeout/trap recovery behavior is implemented but was not exercised
by deliberately forcing those conditions in this gate.

The [fixture README](../web/linux/tests/guest-vulkan-compute/translator/README.md)
records the raw ABI and reproduction workflow. The
[compact evidence](evidence/runtime-graphics-20260926/guest-vulkan-spirv-translator.json)
points to the retained build, Node, browser and shader records.

No shared guest host protocol or Vulkan ICD entrypoint changed in this step.
Actual guest shader transport, storage descriptor/pipeline binding, command
recording, dispatch/readback and public Vulkan client execution remain next.
The translator does not establish a conformant Vulkan device, graphics/Zink,
OpenGL, Firefox GPU integration, native Firefox JIT, hardware video decoding or
physical GPU acceleration. The accepted runtime images and public Sites release
are unchanged.
