# Actual current Rust-client compute benchmarks, 2026-10-03

The standalone Linux/Wasm application passes actual Nightly159 Rust-client compute, queue completion and mapped-readback correctness at two arithmetic intensities. **The original 1,024-round workload measures 0.7518183896561359× hardware/software; the second 16,384-round workload measures 4.017058321814064×.** Software is faster at the first point; hardware is faster at the second. Both measurements remain retained. The earlier actual guest Vulkan-loader render/readback result of 18.1778× is a separate offscreen workload and remains unchanged.

| Integer rounds per word | NVIDIA completed operations/s | SwiftShader completed operations/s | Hardware/software |
| ---: | ---: | ---: | ---: |
| 1,024 | 101.609666 | 135.151877 | 0.751818× |
| 16,384 | 117.643599 | 29.286007 | 4.017058× |

Each point comprises four sequential ABBA arms, hardware2/software1/software2/hardware3, with five warmups and 30 measured frames per arm. Actual backend identities are API NVIDIA/maxwell with Rust `Other`, and API Google/swiftshader with Rust `Cpu`. All actual host/browser/guest CPU counts and affinity checks match six CPUs. Sources, native module, CPIO, executor and served/requested bytes are identical between backend arms within each point. No sample or outlier is removed from an accepted arm.

| Rounds | hardware2 | software1 | software2 | hardware3 |
| ---: | ---: | ---: | ---: | ---: |
| 1,024 | 104.975856 | 133.034744 | 137.337484 | 98.452652 |
| 16,384 | 117.679363 | 28.923747 | 29.657456 | 117.607856 |

The native client is linked from the accepted independent archived `libgkrust.a`; it uses current `wgpu_client_*` shader, asynchronous pipeline, compute-pass, submission and map exports. Messages come from the real client serializer, and actual returned bytes enter `wgpu_client_receive_server_message`. Current protocol types bind pinned Nightly159 sources and wgpu revision `4f4dc63098fae64a0e6d1d3dc6f4f328da8fd5c8`. The browser-host executor uses genuine Rust wgpu 30.0.1. Asynchronous compute-pipeline creation returns success or validation-error responses; synchronous creation returns no response, matching current `server.rs`. This isolated correction changes no production executor.

Each frame processes 2,048 u32 words in an 8,192-byte storage buffer, dispatches 32 workgroups of 64 invocations, and applies the wrapping recurrence `x = (x ^ (x >> 13)) * 1664525 + 1013904223`. The second point changes exactly two round constants, in the C++ CPU reference and WGSL loop, from 1,024 to 16,384: 33,554,432 round updates per frame. Buffer size, parallelism, frame-dependent input, protocol, callbacks and timer remain unchanged. There is no Rust rebuild; the Rust executor module and JavaScript remain identical to the original point.

**Each point** retains all 140 raw frame samples, 286,720 mapped-word checks with zero failures, 140 actual map and work-done callbacks, four adapter/device/shader/asynchronous-pipeline callbacks, and 1,852 serialized messages. Across the two accepted points there are 280 frames and 573,440 verified words. Map bytes enter the isolated harness's mapped storage before the actual client callback. This establishes standalone current-client correctness, without establishing Firefox DOM promises or IPC shared-memory publication.

Timing uses guest `CLOCK_MONOTONIC` immediately before real queue write and native encoding through the actual map callback, before CPU verification. It includes encoding, hostcall transport, real Rust wgpu compute, copy, submitted-work completion and map publication/callback. Shader/pipeline compilation, CPU input/reference generation, verification and unmap are outside the timer. Each backend rate is 60 operations divided by the summed measured duration of its two arms. These are completed end-to-end operations/s, with no GPU-kernel timing or presentation-FPS attribution. Raw load observations remain pinned; no causal performance attribution is asserted. The second point establishes acceleration for that arithmetic workload, not a universal GPU advantage.

Artifacts are retained at `/mnt/p6/project/build/nightly-current-rust-gpu-compute-20261003` (C) and `/mnt/p6/project/build/nightly-current-rust-gpu-compute-rounds16384-20261003` (D). The [repository evidence packet](../tools/nightly-musl/evidence/actual-current-rust-client-compute-20261003.json) preserves the complete original point and comparison identity, and adds the second point's all-sample handoff, backend/CPU/callback/cleanup evidence and root review. Binary archives, Wasm modules and raw logs remain outside Git. A checkout alone is not a self-contained rebuild.

The read-only retained-result rechecks are:

```sh
python3 -B /mnt/p6/project/build/nightly-current-rust-gpu-compute-20261003/check-comparison.py
python3 -B /mnt/p6/project/build/nightly-current-rust-gpu-compute-rounds16384-20261003/check-comparison.py
```

For reproduction, each task's `plan.json` pins exact bounded phase commands and inputs. C records eight native/Rust phases, including offline/locked Rust with two jobs. D reuses C's archived inputs read-only and runs seven compile/link/raw-validation/fpcast/final-validation/ABI/package phases; all terminate/reap exit0 with owned groups empty. The native build binds 937 compiler dependencies, shared imported memory, exported table, maximum 4 GiB memory, 8 MiB stack, native Wasm exceptions, fatal link warnings and 174 uniform 23-i64→i64 indirect entries. D's package differs from C only in the encoded `bin/current-gpu-native` record; 3,849 other encoded records remain byte-identical. Exact source/module/package/executor pins are included.

Completed arm directories must remain intact. A new execution needs fresh owned output directories, frozen pins and reviewed quiet-window admission. Guards retain aggregate C+D task usage below 1 GiB, disk reserve 20 GiB, RAM floor 4 GiB, group RSS 12 GiB and core zero. Native phases use AS 16 GiB/120 seconds; Chromium uses AS 2 TiB, outer 540 seconds, inner 480 seconds and guest 440 seconds for D. Heavy optimizer/postlink work was terminal before timed arms. Each accepted arm reaped exit0, closed its server and left both owned process groups physically empty. D's independent final review checks all eight groups, and the quiet slot was released before the comparison check.

C's first hardware1 attempt failed before GPU work because Chromium's singleton socket path exceeded 108 bytes. Root's initial preflight missed the longer temporary-environment path. Its before-source, failed result and reviewed alias repair remain retained: `ngc-20261003` resolves to C/t, bounding the socket at 80 UTF-8 bytes including NUL. The initial comparison also rejected optional unsupported `/favicon.ico`; the preserved correction permits only that exact URL/error pair while requiring every pinned runtime request and rejecting every other HTTP error. Neither repair changes workload or timing.

D retains a different hardware1 failure: all 35 frames/readbacks completed correctly, but strict cleanup failed after Chromium leader exit0 because remaining owned descendants were forcibly terminated. It is excluded solely for cleanup and is not replaced by a performance-selected exclusion. The preserved original cleanup used `Promise.race` with an already-resolved leader-exit promise, skipping the intended natural group-drain grace. The reviewed repair polls the entire owned group, including zombies, for the existing four-second natural grace; existing three-second SIGTERM and SIGKILL graces also wait for group emptiness. Before/after states and elapsed drain times are retained. Forced cleanup, remaining members, nonzero exit or an unclosed server still fail. The fixed accepted arms drain naturally in 228.054, 214.520, 303.921 and 244.246 ms, with no signal required.

D also retains before-sources and a narrow repair for disappearing owned profile/cache/scratch paths during whole-task `du` accounting: both guards allow at most three retries only for exact owned ENOENT diagnostics, retain numeric whole C+D totals and reject every other error. A source-local JavaScript numeric-parser failure and its corrected literal parser are retained; no browser was launched during that failed preparation. Alias `ngc16-20261003` resolves to D/t and bounds the socket at 82 bytes including NUL. All launch/repair/probe pins remain in the packet.

Root reviews `C/root-actual-compute-review.json` and `D/root-actual-compute-review.json` independently bind eight result/supervisor pins per point, all 140 samples, actual backend/six-CPU/callback evidence, cleanup and recomputed ratios. D's accepted review SHA256 is `618c5656dcf6a5d062bc9c91c9c07d62ef2010ffe86b8758406c94f1fe52fb33`; it preserves C comparison SHA256 `1bd8832dc6fb7573f5bb7335581afce707e8f60a5af725c004f78bbebb32c878`.

WebGL has no compute stage; its earlier genuine copy/map and bounded render acceptance remain separate. No Firefox was executed by these benchmarks. Firefox GPU, full Nightly GPU, compositor, presentation and release acceptance remain false. Production ports and public Sites remain unchanged.
