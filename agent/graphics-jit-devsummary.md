# Graphics and JIT work — GPT-6 Astra Pro / built-in agents / rubywebterm

Current graphics/JIT scope score: **34/100**. This is not the whole-project score.
Accepted changes: host GLES dispatch, explicit backend UI, bounded host JIT
cache, and real bounded Vulkan WSI through explicitly selected WebGL. Full
OpenGL/Vulkan conformance, Firefox 30 s, complete native JIT acceptance, and 50%
host-browser performance remain unmet.

## Clock-correlated complete Firefox result

The final checked run uses the repaired single-member APK image and the same
320×240 WebGL2 cube as host Chromium. Host: **59.84828 fps**. Guest: **2.40575 fps**
(82 callbacks / 34,085 ms), **4.01975%** of host. Guest wall time is 34,084 ms;
its 17,301 ms interval remains in the sample. Peak PSS is **4.531 GiB**, not
4.865 GiB (the latter number is GB decimal). No 50% or 30-second acceptance.
Screenshots and persistent-profile writes overlap the measurement; correlation
is preserved without assigning cause. Next candidate measurements use the
new quiet observer mode and require a matched quiet control for attribution.
See the graphics/JIT matrix and clockcube JSON for exact hashes and boundaries.

## Current evidence and boundaries

- Host GLES draw-dispatch median0.965→0.768ms in balanced A/B/B/A samples;
 25.5% higher throughput for that workload,43.2% of its direct-host comparator.
 This is not whole-Firefox performance.
- JIT cache 69 native current-contract checks pass; 8 MiB cap counts source images,
 not all compiled memory or installed private functions. Original native
 Firefox GC/guard coverage gates remain unresolved and unchanged.
- Native Vulkan WSI gate passes real acquire/render/present, CLOSE=0, and zero
 guest resource leaks.32 real GPU checks cover pixels, resize, state, queued
 close, throwing sinks, and context loss. Both SDK compile profiles pass.
- Real-fence candidate is rejected and excluded; old/new native comparison
 exposed transform-feedback readback context loss. Its patch and failed logs
 are retained under tools/graphics-benchmark/candidates.
- Explicit WebGPU diagnostic reaches NVIDIA but loses the device at canvas
 image export. No product fallback occurs.
- Native Firefox integration requires a separate rebuild. The159 source export
 is readable; the historical incremental object/runtime graph is OS-protected.
 See docs/gpt6-astra-rubywebterm-firefox-jit-build-audit-20261103.md.

## Iteration / build / test ledger

The JSON ledger is canonical and retains receipts, sampled memory, exact
cleanup, and scope scores. Each monitored run samples CPU/RAM every second;
RSS sums may count shared pages more than once. All listed test owners are
reaped. Failed iterations remain included.

| Iteration | Run | Start UTC | End UTC | Seconds | Exit | Scope score | Finding |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | swizzle-baseline | 2026-11-03T07:11:36.546+00:00 | 2026-11-03T07:11:57.961+00:00 | 21.415 | 1 | unknown | Legacy launch: Unix socket path too long |
| 2 | b1 | 2026-11-03T07:12:30.861+00:00 | 2026-11-03T07:13:03.336+00:00 | 32.476 | 1 | unknown | Legacy page probe: no result; preview server timing |
| 3 | s1 | 2026-11-03T07:22:00.456+00:00 | 2026-11-03T07:22:02.866+00:00 | 2.409 | 1 | unknown | Real GPU sync:22/23; GLES error mapping expectation corrected |
| 4 | compile1 | 2026-11-03T07:22:11.555+00:00 | 2026-11-03T07:22:12.957+00:00 | 1.402 | 1 | unknown | Guest compile blocked by historical inaccessible Mesa headers |
| 5 | s2 | 2026-11-03T07:23:05.804+00:00 | 2026-11-03T07:23:08.213+00:00 | 2.409 | 0 | unknown | Real GPU sync:23/23 |
| 6 | compile2 | 2026-11-03T07:23:21.616+00:00 | 2026-11-03T07:23:26.026+00:00 | 4.410 | 0 | unknown | Native GL library/test compile pass with portable staged Khronos headers |
| 7 | g1 | 2026-11-03T07:26:07.519+00:00 | 2026-11-03T07:26:19.956+00:00 | 12.437 | 1 | unknown | Native guest ANGLE/Vulkan: final readback context-loss failure |
| 8 | g2 | 2026-11-03T07:27:59.846+00:00 | 2026-11-03T07:28:13.300+00:00 | 13.454 | 1 | unknown | Native guest ANGLE/OpenGL: same failure |
| 9 | abcompile1 | 2026-11-03T07:34:49.285+00:00 | 2026-11-03T07:34:56.706+00:00 | 7.421 | 0 | unknown | Isolated identical-fixture old/new native compile pass |
| 10 | old1 | 2026-11-03T07:34:57.452+00:00 | 2026-11-03T07:35:10.897+00:00 | 13.445 | 0 | unknown | Old driver + complete TF/readback/fence fixture passes |
| 11 | new1 | 2026-11-03T07:35:22.635+00:00 | 2026-11-03T07:35:36.073+00:00 | 13.439 | 1 | unknown | New driver same fixture fails; regression isolated |
| 12 | glfix1 | 2026-11-03T07:42:56.579428+00:00 | 2026-11-03T07:43:10.032306+00:00 | 13.453 | 1 | 15 | Full native OpenGL backend still fails final fenced pixels; same-context waitSync ruled out |
| 13 | vkfix1 | 2026-11-03T07:43:10.081755+00:00 | 2026-11-03T07:43:23.531211+00:00 | 13.449 | 1 | 15 | Full native Vulkan backend still fails final fenced pixels |
| 14 | tfdiag1 | 2026-11-03T07:47:23.650854+00:00 | 2026-11-03T07:47:38.104172+00:00 | 14.453 | 1 | 15 | Temporary TF binding isolation failed, diagnostic code reverted |
| 15 | perfcompile1 | 2026-11-03T07:56:23.542215+00:00 | 2026-11-03T07:56:24.946971+00:00 | 1.405 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 16 | perfhost1 | 2026-11-03T07:56:25.400082+00:00 | 2026-11-03T07:56:34.923594+00:00 | 9.524 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 17 | perfguest1 | 2026-11-03T07:56:34.976136+00:00 | 2026-11-03T07:56:48.584795+00:00 | 13.609 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 18 | dispatch-scalar-1 | 2026-11-03T08:11:29.081446+00:00 | 2026-11-03T08:11:31.504393+00:00 | 2.423 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 19 | dispatch-swizzle-1 | 2026-11-03T08:11:31.558902+00:00 | 2026-11-03T08:11:34.991288+00:00 | 3.432 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 20 | dispatch-a1 | 2026-11-03T08:11:35.045999+00:00 | 2026-11-03T08:11:47.625766+00:00 | 12.580 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 21 | dispatch-b1 | 2026-11-03T08:11:47.668736+00:00 | 2026-11-03T08:11:59.221617+00:00 | 11.553 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 22 | dispatch-b2 | 2026-11-03T08:11:59.295451+00:00 | 2026-11-03T08:12:11.864193+00:00 | 12.569 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 23 | dispatch-a2 | 2026-11-03T08:12:11.915993+00:00 | 2026-11-03T08:12:23.478911+00:00 | 11.563 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 24 | perfhost-pooled1 | 2026-11-03T08:12:23.550956+00:00 | 2026-11-03T08:12:33.049757+00:00 | 9.499 | 0 | 30 | Verified real GPU correctness/performance; detailed evidence in dispatch summary |
| 25 | ui-unit1 | 2026-11-03T08:26:45.928438+00:00 | 2026-11-03T08:26:47.332178+00:00 | 1.404 | 1 | 30 | 26/27 passed; old default-fallback expectation requires explicit new WebGPU policy |
| 26 | jit-check1 | 2026-11-03T08:26:47.386029+00:00 | 2026-11-03T08:26:48.790338+00:00 | 1.404 | 0 | 30 | Seven real-Wasm lifecycle groups passed on isolated candidate |
| 27 | ui-unit2 | 2026-11-03T08:27:44.345476+00:00 | 2026-11-03T08:27:45.749468+00:00 | 1.404 | 0 | 30 | 27/27 explicit backend settings/status unit tests passed |
| 28 | fx-overlay-build1 | 2026-11-03T08:41:57.364414+00:00 | 2026-11-03T08:41:58.768692+00:00 | 1.404 | 1 | 32 | Bounded build/package/fixture receipt; result retained |
| 29 | fx-overlay-build2 | 2026-11-03T08:42:30.898569+00:00 | 2026-11-03T08:42:32.302924+00:00 | 1.404 | 1 | 32 | Bounded build/package/fixture receipt; result retained |
| 30 | fx-overlay-build3 | 2026-11-03T08:43:01.546268+00:00 | 2026-11-03T08:43:04.953130+00:00 | 3.407 | 0 | 32 | Bounded build/package/fixture receipt; result retained |
| 31 | ui-browser1 | 2026-11-03T08:44:18.231489+00:00 | 2026-11-03T08:44:21.668693+00:00 | 3.437 | 0 | 30 | 10 real-browser settings checks passed; no guest started; contention allowed for correctness |
| 32 | jit-retain-base1 | 2026-11-03T08:44:40.552764+00:00 | 2026-11-03T08:44:41.956820+00:00 | 1.404 | 0 | 30 | Synthetic baseline retains4224 images/17985728 sourcebytes; not Firefox measurement |
| 33 | jit-retain-new1 | 2026-11-03T08:44:42.032703+00:00 | 2026-11-03T08:44:43.437360+00:00 | 1.405 | 0 | 30 | Synthetic candidate retains64 images/8386688 sourcebytes; not native-code budget |
| 34 | jit-compile1 | 2026-11-03T08:48:02.584447+00:00 | 2026-11-03T08:48:03.988204+00:00 | 1.404 | 0 | 30 | Unchanged historical native JIT fixture compiled with accessible toolchain |
| 35 | jit-check2 | 2026-11-03T08:49:13.081039+00:00 | 2026-11-03T08:49:14.490609+00:00 | 1.410 | 0 | 30 | Seven lifecycle groups passed after peer-review counter hardening |
| 36 | jit-guest1 | 2026-11-03T08:49:14.580777+00:00 | 2026-11-03T08:49:21.064308+00:00 | 6.484 | 1 | 30 | Candidate original fixture61/62; stale flag1 rejection fails |
| 37 | jit-guest-base1 | 2026-11-03T08:49:47.572554+00:00 | 2026-11-03T08:49:56.133461+00:00 | 8.561 | 1 | 30 | Baseline original fixture61/62; identical stale flag1 rejection fails |
| 38 | jit-compile2 | 2026-11-03T08:51:20.809773+00:00 | 2026-11-03T08:51:23.216806+00:00 | 2.407 | 0 | 30 | Additional current-ABI fixture compiled |
| 39 | vulkan-fetch1 | 2026-11-03T08:56:12.011820+00:00 | 2026-11-03T08:56:43.461676+00:00 | 31.450 | 0 | 32 | Bounded build/package/fixture receipt; result retained |
| 40 | ui-unit3 | 2026-11-03T09:02:21.810420+00:00 | 2026-11-03T09:02:23.215033+00:00 | 1.405 | 0 | 30 | 28/28 final backend settings/status unit tests passed |
| 41 | fx-overlay-build4 | 2026-11-03T09:04:52.521939+00:00 | 2026-11-03T09:04:55.932825+00:00 | 3.411 | 0 | 32 | Bounded build/package/fixture receipt; result retained |
| 42 | fx-host1 | 2026-11-03T09:04:56.056829+00:00 | 2026-11-03T09:05:28.949194+00:00 | 32.892 | 0 | 32 | Exact cube host diagnostic59.901fps; guest comparison documented separately |
| 43 | jit-guest-current1 | 2026-11-03T09:17:38.067749+00:00 | 2026-11-03T09:17:44.546515+00:00 | 6.479 | 1 | 30 | Candidate67/68; added private-free expectation contradicted current contract |
| 44 | jit-guest-current-base1 | 2026-11-03T09:19:53.546883+00:00 | 2026-11-03T09:20:00.032814+00:00 | 6.486 | 1 | 30 | Baseline67/68; identical existing private-free refusal |
| 45 | vulkan-build1 | 2026-11-03T09:20:44.516032+00:00 | 2026-11-03T09:20:52.942852+00:00 | 8.427 | 1 | 32 | Failed non-Zink compile: recorded.level absent |
| 46 | vulkan-build2 | 2026-11-03T09:22:04.152775+00:00 | 2026-11-03T09:22:12.583494+00:00 | 8.431 | 1 | 32 | Failed-Werror on Zink-only unused helper |
| 47 | vulkan-build3 | 2026-11-03T09:23:08.898815+00:00 | 2026-11-03T09:23:21.348028+00:00 | 12.449 | 0 | 32 | Fresh current native SDK/sample compile+validate PASS |
| 48 | jit-compile3 | 2026-11-03T09:25:17.720307+00:00 | 2026-11-03T09:25:19.125832+00:00 | 1.406 | 0 | 30 | Explicit current-contract fixture compiled, original source preserved |
| 49 | jit-guest-current2 | 2026-11-03T09:25:19.234536+00:00 | 2026-11-03T09:25:25.693318+00:00 | 6.459 | 0 | 32 | Current-contract native fixture69/69 PASS; private1 supported, unknown2 rejected, privatefree refuses without invalidation; fork/exec/globalfree replay pass |
| 50 | vulkan-package1 | 2026-11-03T09:29:15.044122+00:00 | 2026-11-03T09:29:16.448085+00:00 | 1.404 | 0 | 32 | Bounded build/package/fixture receipt; result retained |
| 51 | vulkan-wsi-webgpu1 | 2026-11-03T09:29:16.571168+00:00 | 2026-11-03T09:29:23.052130+00:00 | 6.481 | 1 | 32 | Explicit WebGPU no adapter; no fallback |
| 52 | vulkan-wsi-webgl1 | 2026-11-03T09:30:00.240119+00:00 | 2026-11-03T09:30:07.776205+00:00 | 7.536 | 1 | 32 | Unsupported sampled-target option rejected before session |
| 53 | vulkan-wsi-webgl2 | 2026-11-03T09:38:28.207004+00:00 | 2026-11-03T09:38:36.750593+00:00 | 8.544 | 1 | 32 | Session opens; presentation capability not yet implemented |
| 54 | presentation-fixture-build1 | 2026-11-03T09:44:24.051598+00:00 | 2026-11-03T09:44:25.458072+00:00 | 1.406 | 0 | 32 | Bounded build/package/fixture receipt; result retained |
| 55 | presentation-check1 | 2026-11-03T09:44:36.356642+00:00 | 2026-11-03T09:44:49.851049+00:00 | 13.494 | 0 | 32 | 28 actual GPU pixel/lifecycle checks PASS |
| 56 | vulkan-wsi-webgl3 | 2026-11-03T09:44:58.067703+00:00 | 2026-11-03T09:45:32.381648+00:00 | 34.314 | 0 | 32 | Visible native WSI rendering passes; later inspected CLOSE=-1 prevents strict acceptance |
| 57 | vulkan-zink-compile1 | 2026-11-03T09:48:03.135113+00:00 | 2026-11-03T09:48:23.695644+00:00 | 20.561 | 0 | 32 | Zink profile compiles with-Werror; runtime support not implied |
| 58 | vulkan-wsi-package2-owner | 2026-11-03T09:48:58.153438+00:00 | 2026-11-03T09:49:00.574622+00:00 | 2.421 | 0 | 32 | Bounded build/package/fixture receipt; result retained |
| 59 | vulkan-wsi-package3-owner | 2026-11-03T09:49:20.729914+00:00 | 2026-11-03T09:49:22.137793+00:00 | 1.408 | 0 | 32 | Bounded build/package/fixture receipt; result retained |
| 60 | vulkan-wsi-webgl4 | 2026-11-03T09:49:22.266102+00:00 | 2026-11-03T09:49:42.529780+00:00 | 20.264 | 1 | 32 | Strict gate fails: target0 end message poisons transport; preserved |
| 61 | vulkan-wsi-webgl5 | 2026-11-03T09:51:46.030619+00:00 | 2026-11-03T09:52:16.154469+00:00 | 30.124 | 0 | 34 | Strict native acquire/render/present+close0+zero resources PASS |
| 62 | vulkan-wsi-webgpu2 | 2026-11-03T09:52:57.840800+00:00 | 2026-11-03T09:53:09.589393+00:00 | 11.749 | 1 | 32 | Explicit experimental Linux WebGPU reaches NVIDIA then device OOM; retained failure |
| 63 | presentation-check2 | 2026-11-03T09:56:13.875610+00:00 | 2026-11-03T09:56:29.717408+00:00 | 15.842 | 0 | 34 | 32 actual GPU checks PASS including context loss |
| 64 | fx-overlay-build5 | 2026-11-03T10:02:58.781995+00:00 | 2026-11-03T10:03:01.189171+00:00 | 2.407 | 0 | 34 | Exact cube endpoint-clock overlay prepared; original overlay4 preserved |
| 65 | webgpu-present-diagnostic1 | 2026-11-03T10:04:09.752424+00:00 | 2026-11-03T10:04:13.263178+00:00 | 3.511 | 1 | 34 | 12 render-only WebGPU passes succeed; first image export causes device loss |
| 66 | webgpu-canvas-preferred1 | 2026-11-03T10:04:49.380444+00:00 | 2026-11-03T10:05:01.980439+00:00 | 12.600 | 1 | 34 | Raw preferred-format WebGPU canvas export also causes device loss |
| 67 | fx-host2 | 2026-11-03T10:07:29.632465+00:00 | 2026-11-03T10:08:02.524782+00:00 | 32.892 | 0 | 34 | Quiet matched host59.84828fps, performance20000.575ms vswall20001ms; guest pending |
| 68 | archive-browser1 | 2026-11-03T10:16:49.895320+00:00 | 2026-11-03T10:17:03.491621+00:00 | 13.596 | 1 | 34 | Actual repaired gzip passes12 gates; fixture incorrectly required optional precompressed extras |
| 69 | archive-browser2 | 2026-11-03T10:18:41.394749+00:00 | 2026-11-03T10:19:15.269097+00:00 | 33.874 | 0 | 34 | Real Chromium20/20 decode/native identity/production extras+wrapper gates PASS; full guest acceptance separate |

| 70 | clockcube-evidence-and-matrix | 2026-11-03T10:36:15.503268+00:00 | 2026-11-03T10:36:15.507601+00:00 | 0.004 | 0 | 34 | Clock-correlated guest 2.40575 fps / 4.01975% host; original stalls and observer limits retained |

Total owned build/test time through this checkpoint: **684.891 seconds**. Elapsed wall time is recorded separately; do not sum parallel agents' wall times.
