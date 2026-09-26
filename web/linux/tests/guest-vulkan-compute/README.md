# Isolated public Vulkan SPIR-V compute fixture

This fixture adds actual guest application compute to the earlier translator-only
host gate. It is a bounded, experimental, nonconformant Vulkan profile. It does
not modify accepted runtime images or Sites assets. See `translator/README.md`
for the separately frozen Naga source/ABI/provenance.

The first actual guest run passes 499 assertions on Google SwiftShader fallback:
three real dispatches, two shader programs, two uploads/readbacks, exact outputs
and sentinels, recoverable malformed shader and complete tracked resource
teardown. Actual kernel markers confirm 1 GiB/two CPUs. See the
[execution report](../../../../docs/guest-vulkan-compute-execution-20260926.md)
and [compact evidence](../../../../docs/evidence/runtime-graphics-20260926/guest-vulkan-compute-execution.json).
This result does not establish physical GPU acceleration or full Vulkan support.

## Profile and ownership

`host.mjs` explicitly opts into `allowCompute`. `serveGPU` initializes the pinned
translator before advertising `computeProfile:1` in HELLO. Default and clear-only
connections retain their prior operation limits. The compute protocol adds:

| Opcode | Input, little-endian uint32 unless stated |
| --- | --- |
| 10 SPIRV_SHADER | Actual SPIR-V bytes, 20–65,536 bytes, multiple of four |
| 11 COMPUTE_PIPELINE | Compute shader ID |
| 12 STORAGE_BUFFER | Allocation size, four-byte aligned, at most 65,536 |
| 13 STORAGE_UPLOAD | Storage ID, byte offset, byte count, exact bytes |
| 14 COMPUTE_DISPATCH | Pipeline ID, storage ID, offset=0, binding range, counts=1,1,1 |
| 15 STORAGE_READBACK | Storage ID, byte offset, byte count |

Resource-creation replies return one uint32 ID. Other replies return no bytes
except readback. IDs have distinct kinds and monotonically increase. Resource
count and byte budgets include compute storage and retained SPIR-V shader bytes.
The host uses explicit WebGPU storage bind-group/pipeline layouts and actual
Naga-generated WGSL with the writer's returned entry name. No shader fingerprint
or CPU output substitution exists. Staging buffers are destroyed in `finally`;
connection cleanup releases GPU resources/device and closes its translator.

The ICD adds typed shader, pipeline, layout, descriptor, bind and dispatch calls.
Shader bytes and descriptor values are copied, so caller structure mutation does
not alter retained state. Pipelines remain usable after their shader module is
destroyed. The profile supports exactly one equivalent descriptor-set layout:
set 0/binding 0, one read/write storage buffer, compute-only visibility. Descriptor
arrays, dynamic offsets, push constants, specialization and application pNext
chains reject. Storage buffers bind only host-visible coherent memory at offset
zero. The physical limits describe one 64×1×1 workgroup, one descriptor, and a
65,536-byte storage buffer. The 16,384-byte compute shared-memory limit follows
WebGPU's required default `maxComputeWorkgroupStorageSize` from the
[WebGPU limits table](https://www.w3.org/TR/webgpu/#limits).

Every recorded command and reference is validated before any host operation.
Host-write→compute barriers copy the current coherent bytes at submission time;
compute→compute barriers preserve GPU-written bytes without stale reupload.
Compute→host barriers read into temporary guest storage and copy mapped memory
only after an exact successful reply. Each bounded stream must make all GPU
writes host-visible before completion. Allocation bytes beyond the GPU buffer
remain untouched. Invalid command recordings require reset. Invalid complete
streams reject before effects. Recoverable -22 and -12 host errors become Vulkan
initialization and device-memory errors; transport corruption/loss or -19 poisons
the session with DEVICE_LOST.

## Build, package, execute

Only the assigned serving owner runs these commands. Verify disk filesystem and
capacity and export `TMPDIR`, `TMP`, and `TEMP` under the task before every command.
Never place build inputs, outputs, cache, logs, profiles or scratch in `/tmp` or a
memory filesystem. Use new run directories, preserving prior attempts.

```sh
python3 web/linux/tests/guest-vulkan-compute/build.py \
  --source-audit /mnt/p6/build/guest-vulkan-loader-20260926/source-audit \
  --shader-dir /mnt/p6/build/guest-vulkan-compute-20260926/translator-test-run1 \
  --output /mnt/p6/build/guest-vulkan-compute-20260926/compute-build-run1
python3 web/linux/tests/guest-vulkan-compute/package.py \
  --build /mnt/p6/build/guest-vulkan-compute-20260926/compute-build-run1/build.json \
  --output /mnt/p6/build/guest-vulkan-compute-20260926/compute-package-run1
```

The builder independently compiles the public-only application, pinned upstream
loader archive and ICD, verifies every public undefined application symbol is
provided by the upstream archive, validates Wasm and its Linux imports, and
freezes all compiled sources plus exact supplied shader hashes. The packager
hash-verifies the accepted plain rootfs and modifies only packed `/init`, adding
one test executable. Accepted source images stay unchanged. The serving owner
creates a verified `candidate-compute` link to the package. The existing verified
`translator/candidate` must serve the frozen 751,237-byte translator whose SHA-256
is `e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea`.

```sh
CDP_URL=http://127.0.0.1:9396 \
VK_QA_BASE=http://127.0.0.1:4182/linux/tests/guest-vulkan-compute/ \
VK_QA_OUT=/mnt/p6/build/guest-vulkan-compute-20260926/compute-guest-run1 \
node web/linux/tests/guest-vulkan-compute/run-browser.mjs compute
```

The application submits two distinct supplied SPIR-V modules. A transforms each
of 64 varying uint32 values by `x*3+7`; B transforms by `((x^85)+17)*5` and is
executed twice in one submission. Comparisons therefore cover three dispatches,
128 final shader-dependent values, four GPU-buffer tail words and four additional
allocation tail words per submission. It also exercises shader/source and
descriptor argument lifetime, writes after recording, malformed shader followed
by valid recovery, missing barrier and deleted-reference rejection, dispatch
bounds with otherwise valid bindings, command reset and teardown. Counts include
individual word comparisons, not distinct Vulkan capabilities.

The page verifies actual 1 GiB/two-CPU boot markers, host operations, translator
lifetime and native device/buffer ownership. The runner retains raw browser
results/events and screenshot and closes only its own tab/guest. Build success
alone is not guest execution evidence. SwiftShader results are software evidence,
not physical GPU acceleration.

## Application gaps

General dispatch dimensions/workgroup sizes, multiple resources/sets, descriptors,
shader features, graphics/render passes, graphics pipelines, sampler/texture
support, presentation, semaphores/fences and asynchronous submission are absent.
There is no system dynamic discovery, external layer support, conformance, Zink,
OpenGL/WebGL fallback, Firefox GPU integration, native guest JIT or hardware video
decoding. The static built-in loader remains a deliberate application boundary;
these APIs cannot currently run an unmodified general Vulkan application.
