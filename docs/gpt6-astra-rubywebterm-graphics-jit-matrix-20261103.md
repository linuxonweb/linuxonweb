# Graphics and JIT acceptance matrix — 2026-11-03

GPT-6 Astra Pro / built-in graphics_jit agent / rubywebterm.

**This is a partial improvement of an existing native Linux/Wasm desktop.**
The work does not establish full OpenGL/Vulkan conformance, a usable Firefox
within 30 seconds, or 50% of host-browser performance. Source implementation,
compilation, component tests, and complete-browser behavior are separated below.

| Layer / capability | Source or implementation | Runtime evidence in this session | Acceptance / remaining limit |
| --- | --- | --- | --- |
| Native Linux and Firefox | wasm32 Linux/musl and custom Firefox 159.0; no x86 emulation in this path | Real desktop, native Firefox, guest programs, input and storage exercised by startup/package owners | A usable desktop exists; desktop-class startup/performance targets are unmet |
| Host GLES bridge | 144-command WebGL2 transport; scalar uniform/direct draw dispatch optimized | 82 scalar/draw checks, 24 existing swizzle checks, four real guest balanced timing runs; NVIDIA MX110 | Accepted performance improvement for measured transport workload only |
| GL/EGL synchronization | Original simplified completion stubs remain | Proposed real-fence implementation failed native transform-feedback/readback regression; baseline passes | New fence candidate rejected; no GLES conformance claim |
| Full desktop OpenGL | Broader Zink/experimental source paths exist | No full desktop OpenGL acceptance; Zink profile compiles with warnings as errors | Missing runtime/pipeline behavior and conformance remain; compilation is not support |
| Native Vulkan API | Static pinned Khronos loader plus bounded project ICD; device name says NOT conformant | Fresh public Xlib surface/swapchain, acquire, submit and present using native vkgears-wsi | Accepted bounded 128×128 demonstration, not full Vulkan |
| Vulkan presentation over WebGL | GPU blit to exclusive OffscreenCanvas; initial ImageBitmap then transferred page canvas | 32 full-image/asymmetric pixel and lifecycle checks; native 170 frames/510 draws, CLOSE=0, zero guest leaks | Accepted explicitly selected WebGL path; GPU copying has no CPU pixel readback in the present implementation |
| Vulkan presentation over WebGPU | Direct WebGPU canvas implementation exists | Experimental Linux browser acquired real NVIDIA Maxwell; four native frames then Dawn device loss | Not accepted on this host; no automatic WebGL switch |
| Minimal WebGPU allocation diagnosis | Isolated current renderer and raw browser canvas |12 offscreen render-only passes with one 64 KiB texture succeed; first canvas export loses device; raw preferred-format export reproduces | Concrete current browser/device export limitation, not a proven native Vulkan protocol defect |
| Vulkan WSI semantics | Bounded acquired-image tracking and synchronous command acceptance | Real native acquire/present and teardown tested | Exhausted acquire does not wait; physical display completion and full WSI conformance remain unproved |
| Vulkan/Zink push constants | Zink accepts/records bounded layout ranges; non-Zink rejects ranges | Both source profiles compile; executable shader push-constant path not accepted | `vkCmdPushConstants`/shader push-constant blocks incomplete; no desktop OpenGL completeness claim |
| Rust wgpu backend | Optional explicit source/backend integration | No new complete runtime acceptance in this session | Source presence does not count as tested capability |
| JavaScript JIT inside Firefox | Custom portable-baseline loop/IC/method Wasm generation | Native compilation/entry logs prove real generated code runs; cube outer loops rejected as nested | Actual JIT exists, but coverage/performance are incomplete; no desktop-class JS claim |
| Host JIT module retention | Immutable source-keyed LRU, 1,024 entries and 8 MiB source images; 12-word ABI retained |69 real Linux current-contract lifecycle/replay checks; separate synthetic retention stress | Accepted bounded cache retention; does not bound installed private code or accept native Firefox GC guards |
| Original native JIT safety gates | Existing semantic/GC/mutation/guard suites retained | Mutation semantics passed; required GC/live-entry and some guard coverage still missing | Original failures remain unresolved; no evidence of freed-code execution was established |
| Backend controls | Explicit guest WebGPU or WebGL; real API/device/failure labels; 900×1200 option | 28 unit and 10 real-browser UI checks; later 7 backend/config tests | Accepted controls; screen presenter, guest GLES, and guest Vulkan are shown separately |
| Firefox DOM/compositor acceleration | Separate from rendering a WebGL canvas or native Vulkan demo | Not independently established | Do not infer it from an NVIDIA renderer string or the WSI demo |

## Measured transport improvement

The same 100-draw 64×64 workload plus one-pixel readback ran on three effective
CPUs with the same NVIDIA MX110/ANGLE OpenGL backend. Balanced A/B/B/A medians
were 0.9645575 ms before and 0.768444 ms after: 20.3% less time and 25.5% more
throughput in this sample. Baseline samples ranged 0.918981–1.128837 ms;
candidate samples 0.598236–1.079439 ms. The direct-host comparator was 0.331633 ms,
so the candidate reached 43.2% of that comparator. This falls below 50% for this
workload and is not a whole-browser metric.

A separate 320×240 surface allocation/clear/full-readback workload reached 72.2%
of an equivalently pooled host comparator. An earlier unpooled host comparison
was unfair and is explicitly excluded. The small before/after surface-time
change overlaps the sample spread, so no strong optimization claim is made.

## Complete Firefox comparison

The first exact same-page diagnostic used the existing 320×240 WebGL2 cube,
10-second warmup, 20-second sample, identical shaders/geometry, 3 effective CPUs,
and NVIDIA MX110. Host Chromium 150 achieved 59.901 fps. Guest Firefox 159 achieved
1.6341 fps over 22,030 ms, including a genuine 14,150 ms frame interval: approximately
2.73% of the host callback rate. A center pixel and GL error state were correct,
and the page was visibly rendered. This is a first-run diagnostic; exact guest
sample UTC endpoints were absent, and startup/home activity overlapped it.
The stall is retained, not filtered out.

A revised identical page adds only first/sample-start/sample-end wall-clock
metadata. The page SHA256 is
`e610e6b07da7622ed0724308dd5867b93330ad2a740c515dea46bfa1b1a929c0`.
Both sides used three effective CPUs, 1280×720 desktop/browser viewports, a
320×240 WebGL2 cube, 10-second warmup and nominal 20-second measurement.

| Metric | Host Chromium 150 | Guest Firefox 159 |
| --- | ---: | ---: |
| Frame callbacks | 1,197 | 82 |
| Monotonic elapsed | 20,000.575 ms | 34,085 ms |
| Wall-clock elapsed | 20,001 ms | 34,084 ms |
| Callback rate | 59.84828 fps | 2.40575 fps |
| Frame interval p50 | 16.710 ms | 150 ms |
| Frame interval p95 | 18.780 ms | 502 ms |
| Frame interval p99 | 24.285 ms | 17,301 ms |
| Longest frame interval | 39.990 ms | 17,301 ms |
| GL error | 0 | 0 |

The guest achieved **4.01975% of the host callback rate**, well below the 50%
target. It sampled from **10:21:56.299 to 10:22:30.383 UTC**. The host sampled
from **10:07:41.527 to 10:08:01.528 UTC**. Compilers and uploads were paused for
these measurements. The wall/monotonic differences are under 1 ms; hidden clock
dilation does not explain the low guest rate. The sample ends on the first
callback after 20 seconds, so the long interval is retained and extends its
total duration. The cube is visibly rendered with nonempty center pixels and
zero GL error. Different final cube phases produce different center pixels;
this test does not establish complete image equivalence.

The repaired single-member APK image `d35dbfeb2a15` booted through the actual
production frontend, extras and init wrapper. Its compressed image SHA256 is
`bbbae5dc2fde312fdb1b95d28d47cc5cf7f8290a79e023c0cec50d6d394855db`.
The earlier pair on the multi-member APK image produced **no guest FPS**:
Chromium rejected concatenated gzip before boot. That failure is retained as
a loader failure. An independent 20-check real-Chromium gate verified the
single-member repair and exact decoded CPIO/native/init identity before this
successful full boot. A separate post-benchmark manual package-command gate
expired without issuing commands; it does not establish package acceptance
and does not invalidate the already completed graphics sample.

### Observation and resource limits

The guest owner captured screenshots every 20 seconds and polled logs every
5 seconds. Captures inside the sample completed at about 10:22:08.357 and
10:22:28.127 UTC, no more than 1.010 and 0.781 seconds after their scheduled
thresholds. The latter overlaps the late measurement window. Those bounds
cannot explain a 17.3-second gap by themselves, but remaining observer effects
are not ruled out. A quieter owner mode now defers screenshots, evaluation,
log polling and tracing until a fixed 150-second boundary for the next
candidate run. Any claimed candidate improvement requires a control using
that same quieter mode.

The resource monitor runs in a separate worker: CPU/RSS/quota every second,
PSS every five seconds. All sampled effective quotas were three CPUs. During
the guest sample, CPU usage had median 129.37% and maximum 215.70% (300% is the
three-core ceiling); at least 24.43 GB of host RAM remained available. Peak
PSS across the full run was **4,864,962,560 bytes = 4.531 GiB**, sampled every
five seconds. The earlier 3.229 GiB compression result used a different image,
workload and observation period, so these are not a matched memory comparison.

Home I/O bins covering 10:22:17–32 UTC contain 4.19–4.42 seconds of aggregate
write wait per five seconds, mainly the remote-settings WAL and startupCache.
This is a useful correlation, not proof that one file caused the 17.3-second
frame interval. Guest per-frame timestamps were not captured through the
console, so the exact UTC start of that interval is not asserted. The evidence
JSON preserves sampled resources, observer timing bounds, per-file bins,
source hashes, original failures and the independently checked screenshot.

The host is approximately display-vsync capped. Callback rate is neither
unrestricted GPU throughput nor physical-presentation timing. These results
do not support 50% whole-Firefox performance, and they are not a matched
before/after attribution to the host cache, APK image or storage changes.

## Native build and source boundary

The protected historical 159 object/runtime graph cannot be relinked by the
connected account. A complete readable 159 source export was found and audited,
but a clean build plus all original runtime gates does not fit the measured
remaining budget. No access control was bypassed, no binary was patched blindly,
and no untested native candidate replaced the existing Firefox executable.
See `gpt6-astra-rubywebterm-firefox-jit-build-audit-20261103.md` for exact source,
archive identities, permitted rebuild routes, and remaining safety evidence.

## Evidence index

- `tools/graphics-benchmark/evidence/gpt6-astra-dispatch-20261103.json`
- `tools/graphics-benchmark/evidence/gpt6-astra-backend-ui-20261103.json`
- `tools/graphics-benchmark/evidence/gpt6-astra-jit-cache-20261103.json`
- `tools/graphics-benchmark/evidence/gpt6-astra-vulkan-wsi-20261103.json`
- `tools/graphics-benchmark/evidence/gpt6-astra-webgpu-export-20261103.json`
- `tools/graphics-benchmark/evidence/gpt6-astra-chromium-archive-20261103.json`
- `tools/graphics-benchmark/evidence/gpt6-astra-firefox-clockcube-20261103.json`
- `tools/graphics-benchmark/evidence/gpt6-astra-firefox-clockcube-20261103.png`
- `agent/graphics-jit-devsummary.json`: per-iteration timestamps, duration,
  result, scope score, one-second resource samples, and cleanup receipts.
