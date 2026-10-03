# Mesa Zink EGL through the Rust wgpu resource profile

Actual native Linux/Wasm Mesa26.2.3 now creates an EGL/GLES2 context and renders
an indexed, textured scene with uniforms and depth through browser Rust wgpu.
Hardware WebGPU, host SwiftShader WebGPU and genuine wgpu WebGL pass full pixel
checks and a depth-disabled overwrite control. This is an offscreen correctness
gate, not Firefox/compositor acceptance or a scene performance claim.

The broader module also passes the unchanged GPU-heavy Vulkan workload at
**38.657801 completed FPS on NVIDIA versus 2.126645 on SwiftShader**, an elapsed
ratio of **18.17783877119736×**. Hardware median/p95 are 24.4225/31.360 ms;
software median/p95 are 455.2625/718.810 ms. Both arms use identical guest, Rust
assets, served runtime sources, workload and six assigned CPUs. The hardened
checker passes all pair predicates. These are render-and-readback timings after
five warmup frames, with 30 measured frames, not submission or display FPS.
The workload and reference semantics remain those in
[the original benchmark](guest-vulkan-wgpu-20261003.md).

## Actual primitive and resource semantics

`egl-primitive.c` calls real EGL/GLES2 entrypoints from the retained static Mesa
archives; GLSL is compiled by Mesa Zink to actual SPIR-V, translated by Naga,
then executed by Rust wgpu. A 64×64 RGBA8 framebuffer has a depth16 attachment.
An indexed quad covers the left half. A 2×2 red/green/blue/yellow nearest texture
and a uniform red-channel tint produce asymmetric quadrants; the right half
keeps the distinct clear color. A second, farther black quad executes each
frame. Depth LESS rejects it in frames0–2; disabling depth makes it overwrite
the near quad in frames3–5. This control rejects an implementation that drops
the second draw or ignores depth.

Every frame calls `glFinish` and `glReadPixels`, and independently checks every
RGBA component against the C scene reference: **98,304 component checks across
six frames, tolerance two byte values, zero failures**. Checksums remain stable
within each phase and change at the control. Hardware/GL tinted checksums can
differ from SwiftShader within the allowed rounding tolerance. Each arm proves
12 Rust draws, six passes/readbacks, seven actual uniform uploads, one texture
upload and two shader translations. Native state closes with zero resources,
objects/bytes and cleanup errors; its translator closes and the owned browser
group/server is reaped and empty. Six dynamic host/browser/guest kernel CPUs
are bound by runner evidence. Six-frame elapsed includes shader compilation
and guest Zink overhead; no EGL performance ratio is inferred from it.

The opt-in `allowResources` profile implements real Rust uniform buffers,
explicit bind-group layouts and groups, texture/sampler objects and depth16/
depth32 attachments. It preserves Zink descriptor sets and uniform byte offsets;
combined samplers split into a texture binding and sampler binding+16. Dynamic
uniform ranges retain 256-byte alignment and actual draw snapshots. Guest
`GUEST_VK_ZINK` expands bounded 16/32-bit indices into vertex streams. Generic
Zink upload buffers are accepted only with the actual TRANSFER_SRC usage bit.
An attachment with sampled usage shares one real host target texture only after
the host advertises `sampledColorTargets`; legacy hosts retain their restriction.
Default simple profile does not enable these resources.

The existing Zink SPIR-V adapter removes dead graphics push constants and rejects
read push constants, preserves bounded uniform data offsets and bitcasts, and
removes unused GLES2 outputs. It does not substitute known shader hashes or CPU
pixels. Mesa's actual shader words and native commands are retained in raw logs.
Blending, MRT, stencil, mip/layer resources, storage images, general instancing,
geometry/tessellation and arbitrary push constants remain unsupported. The
device is explicitly experimental and nonconformant; broader Zink context
advertisement is not proof that every exposed GL operation works.

## Frozen inputs, reproduction and failures

The final module pins wgpu30.0.1 and wasm-bindgen0.2.129. Its generated JS is
121,321 bytes; bindgen Wasm is 4,161,388 bytes, with no DWARF. Resource builds
retain release opt-level2/strip=debuginfo and bounded children. The final native
EGL app is 19,749,787 bytes. `build-egl.py` recompiles the current ICD/transport
and links the retained Mesa archives and shader compiler objects; it does not
rebuild Mesa. Their exact archive, object, header and command pins are in the
build report. A clean-machine dependency acquisition workflow remains absent.

```sh
export T=/mnt/p6/project/build/guest-vulkan-wgpu-20261003
export TMPDIR="$T/tmp" TMP="$T/tmp" TEMP="$T/tmp"
python3 web/linux/tests/guest-vulkan-wgpu/build-host.py --output "$T/resources-host-next"
python3 web/linux/tests/guest-vulkan-wgpu/build-egl.py --output "$T/egl-build-next"
python3 web/linux/tests/guest-vulkan-wgpu/package-egl.py --build "$T/egl-build-next/build.json" --wgpu-dir "$T/resources-host-next" --output "$T/egl-package-next"
node web/linux/tests/guest-vulkan-wgpu/run-egl.mjs hardware webgpu "$T/egl-hardware-next" "$T/egl-package-next"
node web/linux/tests/guest-vulkan-wgpu/check-egl.mjs "$T/egl-hardware-next/result.json" "$T/egl-hardware-next/validation.json"
node web/linux/tests/guest-vulkan-wgpu/run-egl.mjs software webgpu "$T/egl-software-next" "$T/egl-package-next"
node web/linux/tests/guest-vulkan-wgpu/check-egl.mjs "$T/egl-software-next/result.json" "$T/egl-software-next/validation.json"
node web/linux/tests/guest-vulkan-wgpu/run-egl.mjs hardware webgl "$T/egl-gl-next" "$T/egl-package-next"
node web/linux/tests/guest-vulkan-wgpu/check-egl.mjs "$T/egl-gl-next/result.json" "$T/egl-gl-next/validation.json"
```

First hardware EGL attempt created the real Mesa context but rejected texture
upload: Zink marked its image attachment+sampled and used a generic transfer
buffer, which the earlier narrower adapter rejected. Its explicit REJECT and
failed pixel evidence remain retained, with reaped exit1/empty group. The next
implementation negotiates shared sampled target storage and honors only actual
TRANSFER_SRC buffers. A Rust compile failure on the wgpu30 layout API is also
retained. No failed attempt is counted as acceptance.

The earlier three EGL arms used the pre-rustfmt module. Formatting changed only
the Wasm data section among noncustom sections, with identical generated JS;
execution bytes were not identical, so final-module confirmations bind the
accepted sources and binaries directly. Previous benchmark snapshots and the
171-check independent historical review remain immutable; that review did not
cover this resource extension or its EGL runs.

An independent read-only review found that the EGL checker accepted missing
requests/runner pins and empty CPU check maps. The scoped hardening requires
complete CPU/affinity identities, matching source/request/package/Rust hashes,
and independently reviewed runner pins. All three retained reports still pass;
210 bounded regressions reject missing, rebound or conflicting evidence and
retain harmless manifest ordering and identical duplicate requests. No browser
was rerun and the original reports are unchanged. The default runner pins come
from colocated files; frozen replay may supply independently reviewed snapshot
pins, never pins copied from the report being tested. Embedded package hashing
uses `package-egl.py`'s exact indent-two JSON plus newline byte contract, including
key order. This checks evidence consistency; it does not authenticate a wholly
fabricated report or extend rendering acceptance. The new review is pinned in
[the checker evidence](evidence/guest-zink-wgpu-checker-hardening-20261003.json).

Builds, raw logs, complete source snapshots, packages and checker results are
pinned in [the resource-profile evidence](evidence/guest-zink-wgpu-resources-20261003.json).
The actual Nightly159 ABI/static-EGL and public host-asset dependencies are in
[the integration plan](firefox-nightly-gpu-integration-plan-20261003.md).
Current Nightly inputs and public v10 are unchanged. Firefox API rendering and
presentation still require current-source integration and their own tests.
