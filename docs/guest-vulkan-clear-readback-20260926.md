# Guest Vulkan clear/readback execution — 2026-09-26

The isolated guest now executes typed `vkCmdClearColorImage`,
`vkCmdCopyImageToBuffer` and synchronous `vkQueueSubmit` through the browser's
real WebGPU implementation. Two submissions clear the same 17×3 RGBA8 image to
different colors; all 102 pixels return correctly to mapped guest memory.
This extends the earlier lifecycle-only prototype. It is not a conformant or
loader-integrated Vulkan driver, and it is not included in deployed Sites v6.

The host used Google SwiftShader (`isFallbackAdapter=true`) in Chromium
150.0.7871.114 with explicit software WebGPU flags. This establishes execution
semantics, not physical GPU acceleration or a performance improvement.

## Implementation and scope

The guest owns typed image, buffer and memory handles, binding checks, recorded
command values, image layouts, host-read barriers and bounded allocations.
Recording produces no GPU effects. Submission validates the complete recorded
list, performs real WebGPU clears and staging-buffer readbacks, and copies the
returned bytes into guest buffer memory before reporting completion. Vulkan
buffers here are guest allocations; they are not general host GPU buffers.

The existing isolated transport adds opt-in opcode 9, advertised by
`clearImage:true` in HELLO. Legacy sessions reject it. The host clears an actual
texture using a WebGPU render pass and awaits completion. Readback strips
padding from 256-byte host rows to produce 68-byte packed rows. No CPU-generated pixel
substitute is used.

The profile accepts one primary command buffer, whole optimal RGBA8 images,
specific barriers and synchronous submissions without fences or semaphores.
Images are bounded to 128×128, allocations to 64 KiB each and 1 MiB total, and
the table to 32 resources. Unsupported arguments fail explicitly. A rejected
void recording command invalidates the recording until reset.

`vkCmdClearColorImage` requires a graphics or compute queue. Consequently the
opt-in profile exposes partial COMPUTE|TRANSFER flags; **compute dispatch is
absent**, so this remains explicitly nonconformant. It must not be described as
a generally usable Vulkan device. See the official
[clear command requirements](https://docs.vulkan.org/refpages/latest/refpages/source/vkCmdClearColorImage.html),
[copy requirements](https://docs.vulkan.org/refpages/latest/refpages/source/vkCmdCopyImageToBuffer.html)
and [synchronization examples](https://docs.vulkan.org/guide/latest/synchronization_examples.html).

## Executed validation

| Gate | Result |
|---|---|
| wasm32 C build | `-Wall -Wextra -Werror`, Wasm validation and four-import ABI allowlist pass |
| Isolated packages | Clear/live/unavailable preserve 3,846 original CPIO records and tail; only `/init` changes and one executable is added |
| Browser host | 73 listed checks pass: original triangle, two real clears, exact pixels, legacy refusal, malformed/nonfinite/wrong-type/stale requests and device-loss cleanup |
| Guest lifecycle | 38 checks pass, one host device created/destroyed, no draws or readbacks |
| Guest unavailable | 11 checks pass, no host or guest device created |
| Guest clear/copy | Two clears, two readbacks, one released texture; exact red `(255,0,0,255)` and green `(0,255,0,0)` pixels |
| Guest memory and recording | Eight-byte suffix retained; no mapped changes before submission; recorded color snapshot, stale resource, layout, mapping, binding and reset checks pass |
| Teardown | Zero guest resources, instances and devices; one host device destroyed and connection closed |

All three successful guest runs captured actual kernel 1 GiB/two-CPU markers,
cross-origin isolation, and zero guest errors or browser runtime exceptions.
The clear fixture reports 951 checks, most of which are individual byte
comparisons; this is not a count of supported Vulkan features. Its 3.625-second
runner duration is not a benchmark. Live and unavailable runner durations were
3.612 and 3.513 seconds respectively.

The first live attempt failed **before guest boot** because the runner accessed
`document.documentElement.dataset` during navigation while the document element
was null. The result (`guest:null`, 76 ms) is retained in `qa-live-run1`. A
null-safe pending-page snapshot fixed the harness without changing the guest or
host. Live retry 2, unavailable run 1 and clear run 1 then passed. The current
runner SHA-256 is
`f0a435af2340bcd50d22323dd322a24ec37720a774cb276f5af9428727ca7f35`.

## Reproduction and provenance

All scratch, profiles, cache, logs, binaries and packages reside under
`/mnt/p6/build/guest-vulkan-clear-20260926/` on ext4. Export `TMPDIR`, `TMP` and
`TEMP` to its existing `tmp` directory in every shell. The
[fixture README](../web/linux/tests/guest-vulkan/README.md) documents build,
package and browser commands. Use fresh output names; the runner starts no
services. The sole serving owner exposes `candidate-clear` only for testing.

The verified `build-run2/guest-vulkan-lifecycle.wasm` is 64,334 bytes, SHA-256
`c0ede2c1cfb39896bcf5aafce7df2be74c96eeb2c7e08018f16d598cf6d9e730`.
The clear archive is 40,560,136 bytes, SHA-256
`3cd4d8e2803b04add5aef11c68842dff621f922d17cca3702266b29f6d74ce94`.
Build 1 also passed; build 2 records corrected scope descriptions and produces
the same executable bytes. The audit rehashed package bytes and matched 14
current/frozen C, header and host source entries against build provenance.

Raw results are `qa-host-run1`, `qa-live-run2`, `qa-unavailable-run1` and
`qa-clear-run1`; `qa-summary.json` records the combined audit. The
[compact evidence](evidence/runtime-graphics-20260926/guest-vulkan-clear-readback.json)
pins these paths and identities.

The final compact-evidence audit passed 36 checks. The owned browser and server
then exited cleanly, both test ports closed, and all three candidate links were
removed after identity checks. `cleanup.json` records preservation of the user's
pre-existing server; no task service remains running.

## Remaining work

The bounded actual-guest transport/device-loss and allocation-exhaustion/reuse
gates subsequently passed; see the [failure/recovery report](guest-vulkan-failure-recovery-20260926.md).
Broader loss points, reconnection and soak remain untested. The implementation lacks loader discovery,
format queries, shaders, dispatch, general GPU buffers, concurrency, fences,
semaphores, aliasing and general image layouts. These are substantive driver
requirements, not preference settings. This step establishes a reusable typed
image/copy/completion path but does not run Zink, OpenGL, Firefox WebGL/WebGPU,
WebGL host fallback or hardware decoding. Native Firefox JIT also remains
unimplemented. The full user goal remains active and below 95/100.
