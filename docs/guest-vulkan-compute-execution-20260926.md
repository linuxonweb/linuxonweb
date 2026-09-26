# Actual guest application SPIR-V compute through public Vulkan

The separate public Vulkan application now executes real compute shaders in the
wasm32 Linux guest through the pinned Khronos loader, experimental ICD, vsock
protocol, frozen Naga translator and browser WebGPU. The first guest attempt
passed **499 assertions**, with no browser exceptions or reported QA errors.
The host adapter was **Google SwiftShader fallback**. This is software GPU API
execution evidence, not physical acceleration.

The application supplied the exact two independently compiled SPIR-V fixtures.
Formula A computes `x * 3 + 7`; formula B computes `((x ^ 85) + 17) * 5`, with
uint32 arithmetic over 64 varying input words. A ran once. B ran twice within one
submission, separated by a compute-write→compute-read/write barrier. Three real
WebGPU dispatches produced 128 exact final output words. Four extra GPU-buffer
words and four allocation-only suffix words remained unchanged per submission.
Expected values are used only for comparisons; output comes from staging-buffer
readback. Neither the guest nor host recognizes fixed shader bytes to substitute
results.

The guest reports actual `Memory: 1000192K/1048576K available` and
`smp: Brought up 1 node, 2 CPUs`; the browser was visible and isolated. The host
recorded two successful runtime translations, two uploads, three dispatches and
two readbacks. Malformed SPIR-V returned the expected recoverable -22 before a
valid second shader/pipeline succeeded. One native device, one storage buffer,
two staging buffers and one translator instance were created and released.
Translator counts instrument the wrapper creation/close path; Worker ownership
was not independently counted. Native device and buffer ownership was tracked
separately. Guest teardown reported `live=0 allocated_bytes=0`, and CLOSE returned zero.
The assertion total includes individual data/sentinel comparisons and is not a
count of distinct Vulkan capabilities.

The [compact evidence](evidence/runtime-graphics-20260926/guest-vulkan-compute-execution.json)
pins source/build/package and raw browser records. Raw evidence is retained at
`/mnt/p6/build/guest-vulkan-compute-20260926/compute-guest-run1/result.json`,
SHA-256 `b588f148bb4eadfdcd1ad68aa85ad19cd6aa9494fa101386452937d6a6780da0`.
The retained `page.png` shows the completed fixture. The accepted runtime/rootfs
and public Sites version 6 are unchanged; this fixture is not deployed.

## Application and driver boundary

The application includes only public Vulkan and POSIX headers. Its separately
compiled object links the actual pinned upstream Khronos loader archive, and
build-time symbol checks verify all 47 undefined public Vulkan symbols resolve
to that archive.
There are no private ICD audit or transport calls in the application. The
existing static built-in provider remains the only driver discovery mechanism.
The loader/header source pins and original source notices are unchanged from the
[previous loader integration](guest-vulkan-loader-integration-20260926.md).

`vkCreateShaderModule` copies application SPIR-V bytes and sends those bytes to
the translator. The test overwrites the original caller buffer after creation.
The pipeline uses the translated entry name and explicit WebGPU storage binding
layout and remains usable after the Vulkan shader module is destroyed.
Descriptor writes copy their values; the application overwrites its descriptor
write and buffer-info structures after the call. No retained caller pointers
supply shader code or descriptor state.

The command recorder validates the entire bounded stream and all references
before host effects. Missing host-write barriers reject submission without
changing any of the 288 mapped bytes. Dispatch counts exceeding the supported
profile invalidate recording even with otherwise valid pipeline/descriptor
bindings. Reset recovers the command buffer. Destroying the recorded pipeline
before submission rejects that stream, and all 288 mapped bytes remain exact.
The application writes coherent input bytes after recording, before submission;
the host-write barrier uploads those current bytes. The second B dispatch keeps
GPU-written storage data through its compute barrier, avoiding a stale CPU
reupload. Final readback copies to mapped memory only after an exact successful
reply; allocation suffix bytes never belong to the GPU storage buffer.

The host initializes the frozen translator before HELLO advertises
`computeProfile:1`. Six new typed binary operations carry SPIR-V, compute pipeline,
storage allocation/upload, dispatch and storage readback. Default and clear-only
profiles retain their previous protocol limits. Error diagnostics are bounded
by encoded byte count. Validation -22 and resource-budget -12 remain recoverable;
transport corruption/loss or device -19 poisons the session. Separate resource
kinds, bounded IDs/budgets and connection cleanup cover the new objects.

## Build and profile limits

The accepted compute application is
`compute-build-run1/guest-vulkan-public-client.wasm`, **360,103 bytes**, SHA-256
`ff6cc69182ff0f11f5677c64d566ebd7e1c1997128cfa5176b1e08e54ce83865`.
Compilation, linking, public-symbol checks, Wasm validation and the Linux import
allowlist passed on the first compute build. Its package is 40,855,904 bytes,
SHA-256 `3ed24fa8f87139ff66c4acd8eeb358057014e022384e0cb8fb101655a7364770`.
Packaging changes only packed `/init` and adds the isolated application. Every
other original archive record remains unchanged. The frozen translator is the
previously tested 751,237-byte module, SHA-256
`e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea`;
its sources and provenance were not modified.

All build inputs, frozen sources, compiler scratch, artifacts, packages, logs,
browser profile and evidence remain on disk under the task directory, with
explicit TMPDIR/TMP/TEMP. An earlier shared-loader regression build was stopped
before compilation by the output guard because the new task root was absent
from its allowlist. The authorized task root was added while retaining filesystem,
free-space and scratch checks; the next loader regression compile passed. No
compiler or shader execution repair was needed for the first compute build/run.

The profile supports one equivalent descriptor layout at set 0/binding 0, one
read/write storage buffer at offset zero, 65,536-byte storage, and one 64×1×1
workgroup. Shader specialization, dynamic offsets, descriptor arrays, push
constants and unsupported application chains reject. Shared-memory limit 16,384
bytes follows the required default `maxComputeWorkgroupStorageSize` in the
[WebGPU limits table](https://www.w3.org/TR/webgpu/#limits). Submission is synchronous,
limited to one primary command buffer and 16 recorded operations. Every stream
must make its shader writes visible to the host before completion.
The [fixture README](../web/linux/tests/guest-vulkan-compute/README.md) documents
protocol layouts, exact reproduction commands, ownership and remaining gaps.

## Shared-path regression evidence

All seven guest regressions passed on their first runtime attempts with the new
shared C/transport: public-loader clear 883 assertions; direct lifecycle 44,
unavailable host 14, clear 957, transport loss 522, native device loss 522 and
allocation exhaustion/recovery 1,083. All captured actual 1 GiB/two-CPU kernel
markers and released every independently tracked native object. The existing
host regression also passed 73 checks. No runtime failure-path repair was needed.
Raw reports and exact commands are pinned by the compact evidence's
`regressions` section and retained `regression-batch.json`.

The loss/exhaustion regressions exercise the earlier image-clear path after the
shared submit/transport changes. They do not establish injected compute-submit
loss or compute-specific allocation exhaustion. Native device loss is explicit
`GPUDevice.destroy()` during staging map, not a spontaneous physical-driver
failure. The direct regression artifact is 80,696 bytes, SHA-256
`0ce6215597db0ec6641482ce893ffa661de7453138ed7d75f933b1adbfad2766`.
The complete native-device and transport-loss logs remain preserved.

Cleanup passed: owned Chromium PID 111111 closed through Browser.close and
adapter PID 110736 exited on SIGTERM, both status zero. Both PIDs and listeners
on 4182/9396 are absent. Nine task-owned candidate links were removed only after
exact identity/target checks; disk artifacts and profiles remain. User server
PID 1591443 retains its exact command/start identity. The compact evidence pins
`cleanup.json`. After testing, one trailing space was removed from the compute
build helper. Frozen build records retain the actual original helper bytes;
compiled C, host modules and executable bytes are unchanged.

## Remaining application work

This is actual guest shader execution, but remains a partial, nonconformant
Vulkan device. General dispatch shapes, multiple resources/sets, descriptor
features, graphics pipelines/render passes, sampler/texture support, presentation,
semaphores/fences, asynchronous submission and dynamic system discovery are
absent. Compute-only connections share some transfer entrypoints even though
image-format queries advertise no image support; procedure presence alone is
not a capability claim. No unmodified general Vulkan application support follows.

Zink would require broad graphics Vulkan and presentation coverage plus Mesa
integration. Firefox additionally needs its guest EGL/GL/window/compositor path.
There is still no OpenGL, WebGL fallback, native guest Firefox JIT or hardware
video decoding, and no overall goal-completion claim follows from this gate.
