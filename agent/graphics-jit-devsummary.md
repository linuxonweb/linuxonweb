# Graphics and JIT work — GPT-6 Astra Pro / built-in agents / rubywebterm

Current graphics/JIT work-scope score: **32/100**. The verified host draw-dispatch optimization is shipped. The real-fence candidate failed native correctness and remains excluded. No full OpenGL/Vulkan, whole-Firefox JIT, or50%host performance acceptance is claimed.

## Iteration / build / test ledger

| Run | Start (UTC) | End (UTC) | Seconds | Exit | Finding |
| --- | --- | --- | ---: | ---: | --- |
| swizzle-baseline | 2026-11-03T07:11:36.546+00:00 | 2026-11-03T07:11:57.961+00:00 | 21.415 | 1 | Legacy launch: Unix socket path too long |
| b1 | 2026-11-03T07:12:30.861+00:00 | 2026-11-03T07:13:03.336+00:00 | 32.476 | 1 | Legacy page probe: no result; preview server timing |
| s1 | 2026-11-03T07:22:00.456+00:00 | 2026-11-03T07:22:02.866+00:00 | 2.409 | 1 | Real GPU sync:22/23; GLES error mapping expectation corrected |
| compile1 | 2026-11-03T07:22:11.555+00:00 | 2026-11-03T07:22:12.957+00:00 | 1.402 | 1 | Guest compile blocked by historical inaccessible Mesa headers |
| s2 | 2026-11-03T07:23:05.804+00:00 | 2026-11-03T07:23:08.213+00:00 | 2.409 | 0 | Real GPU sync:23/23 |
| compile2 | 2026-11-03T07:23:21.616+00:00 | 2026-11-03T07:23:26.026+00:00 | 4.410 | 0 | Native GL library/test compile pass with portable staged Khronos headers |
| g1 | 2026-11-03T07:26:07.519+00:00 | 2026-11-03T07:26:19.956+00:00 | 12.437 | 1 | Native guest ANGLE/Vulkan: final readback context-loss failure |
| g2 | 2026-11-03T07:27:59.846+00:00 | 2026-11-03T07:28:13.300+00:00 | 13.454 | 1 | Native guest ANGLE/OpenGL: same failure |
| abcompile1 | 2026-11-03T07:34:49.285+00:00 | 2026-11-03T07:34:56.706+00:00 | 7.421 | 0 | Isolated identical-fixture old/new native compile pass |
| old1 | 2026-11-03T07:34:57.452+00:00 | 2026-11-03T07:35:10.897+00:00 | 13.445 | 0 | Old driver + complete TF/readback/fence fixture passes |
| new1 | 2026-11-03T07:35:22.635+00:00 | 2026-11-03T07:35:36.073+00:00 | 13.439 | 1 | New driver same fixture fails; regression isolated |

Total owned build/test time: **124.717 seconds**. Each run samples owned-process CPU counters and RSS plus system CPU/RAM every second. RSS is a sampled sum and may count shared pages more than once. All listed owners were reaped with no remaining tracked identities.

## Evidence and implementation

- GPU identity: NVIDIA GeForce MX110. Host tests used explicit ANGLE/Vulkan1.4.312; production-aligned comparison used explicit ANGLE/OpenGL4.5. No automatic product fallback was added.
- New GL fence implementation uses real host WebGLSync objects, actual status and zero-timeout polls. Timed native waits sleep in the guest; deleted/arbitrary handles are checked without dereferencing them.
- Native guest uses a1,415,168-byte isolated BusyBox/glrtest initramfs,512MiB RAM, no persistent userhome. It exercises real shaders, texture readback, framebuffer blits and transform feedback before fence tests.
- Exact old/new comparison confirms a regression in the new fence path: old full fixture passes; new same fixture loses the GPU context at final readback. NVIDIA logs report a transform-feedback buffer map error. A specification-backed private-context wait optimization is prepared; its runtime result is pending.
- Khronos reference: https://registry.khronos.org/webgl/specs/latest/2.0/ — new fences may signal only after returning to the event loop; same-context serverwait is effectively a no-op when contexts cannot share syncs.

## JIT and build limits

- Read retained original-O2 results for archive60847f/native26e380d. Original GC/guard checks remain failed. The observed failures are missing in-window lifecycle coverage; no execution of freed code was established. Original checkers/workloads/deadlines were not edited.
- Firefox embeds glremote statically. Its native binary must be relinked for the driver change to affect Firefox. Exact Nightly159 inputs under/mnt/p6/build are owned by root mode0700 and unreadable to connected user1000. Access controls were not bypassed.
- Availablep3 final binaries/JITarchives do not replace the seven missing runtime/Mesa/C++ archives and the native object tree. The readable repository source tar is Firefox128ESR, not the required159 tree. A fresh complete159 build is not yet a justified within-budget route.
- Host bridge and standalone newlycompiled GLlibrary are independently deliverable after native regression passes. Current default Firefox archive remains unchanged.

## Accepted host dispatch iteration

The isolated candidate passed82 scalar/draw and24 existing swizzle checks plus
four native A/B/B/A runs; exact candidate SHA was requested and recorded by the
HTTP snapshot owner. Median100draw+readback time0.965→0.768ms (25.5% throughput
gain), with sample spread retained in the evidence. Pooled host comparison is
43.2% draw /72.2% surface throughput; this does not meet the whole50% goal.
Production now contains this reviewed host optimization only. Failed real-fence
changes are parked separately. Parent provisional overall score26/100;
graphics rubric6/25. Native159 relink and original JIT safety acceptance remain
blocked/unresolved respectively. Full test timing ledger is the companion JSON.

## Explicit guest backend controls — 2026-11-03

The product defaults guest Vulkan to WebGPU and requires an explicit WebGL choice. Presenter, guest OpenGL and experimental Vulkan status are separate. The 900 × 1200 portrait option is available. Twenty-eight unit checks and ten real-browser functional checks pass, including cancellation, saved choice, reload and URL override. These checks do not establish full Vulkan/OpenGL or whole-Firefox hardware acceleration. Exact sources and resource receipts: `tools/graphics-benchmark/evidence/gpt6-astra-backend-ui-20261103.json`.

## Bounded host JIT cache

The reviewed per-worker cache now retains at most1024 compiled-module references and8MiB of immutable Wasm source images. LRU eviction leaves installed callable code intact; the12-word native stats ABI is unchanged. Seven real-Wasm lifecycle groups and the explicit current native contract69/69 pass. Historical fixture failures are retained: flag1 is now supported PRIVATE, and private allocations cannot be freed through the shared-log free API. The fixture asserts that refusal and continued callability rather than inventing a new lifetime contract. This cap does not bound installed private code or engine-native compiled memory and does not establish Firefox native GC safety or faster startup. Evidence: `tools/graphics-benchmark/evidence/gpt6-astra-jit-cache-20261103.json`.
