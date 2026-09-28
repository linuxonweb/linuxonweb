# Guest Vulkan: core 1.1 queries and fence/semaphore sync (packets A1/A2) — 2026-09-28

Scope: the experimental guest ICD under `web/linux/tests/guest-vulkan/`. This is a
bounded, nonconformant profile. SwiftShader software rendering only; no
physical GPU, Zink, OpenGL, Firefox GPU, decoder or native JIT claim follows.
Accepted `web/linux` images and `web/sites` are unchanged; nothing was deployed.

## Implemented

A1 — core 1.1 surface (`icd.c`):

- Instance and device report `apiVersion` 1.1. `vkEnumerateInstanceVersion`
  returns 1.1. The static Khronos loader port reports ICD api 1.1
  (`guest-vulkan-loader/static-provider.inc`, the provider hook; loader source untouched).
- `vkGetPhysicalDevice{Properties2,Features2,QueueFamilyProperties2,MemoryProperties2,
  FormatProperties2,ImageFormatProperties2,SparseImageFormatProperties2}`,
  `vkEnumeratePhysicalDeviceGroups`, external buffer/fence/semaphore queries
  (all report no external handle support), and `vkGetDeviceQueue2`.
  KHR aliases are not returned because the loader does not need them for a 1.1
  ICD and the matching extensions are not advertised.
- Bounded pNext walking: 64 nodes max, cycles rejected, known structures
  filled (ID, Vulkan11 properties/features, subgroup, maintenance3,
  point-clipping, multiview, protected-memory, draw-parameters, sampler-YCbCr, …),
  unknown sTypes left untouched and skipped; misplaced known sTypes are rejected.
- Instance and device extension tables are empty: nothing is advertised that is
  not implemented. Unknown enabled extensions fail with EXTENSION_NOT_PRESENT.
- Format properties are real per mode: clear exposes R8G8B8A8_UNORM optimal
  TRANSFER_SRC|DST; graphics adds COLOR_ATTACHMENT and vertex-buffer formats
  R32G32{,B32,B32A32}_SFLOAT; everything else, and every format in lifecycle-only
  mode, is zero. `FormatProperties2` equals `FormatProperties`.
- Device creation accepts `PhysicalDeviceFeatures2`, `Vulkan11Features`,
  `ShaderDrawParametersFeatures` and a one-device group naming this device; any
  requested true feature returns FEATURE_NOT_PRESENT; Features2 together with
  `pEnabledFeatures` or foreign/multi-device groups return INITIALIZATION_FAILED.

A2 — synchronization (`transfer.inc`), guest-only (no host protocol change):

- `VkFence` create (optionally signaled)/destroy/reset/wait/getStatus;
  binary `VkSemaphore` create/destroy (timeline type rejected; unrecognized
  extension structures such as export info are skipped, like other unknown pNext).
  Nothing is ever pending, so waiting on an unsignaled fence returns VK_TIMEOUT
  immediately instead of blocking.
- `vkQueueSubmit` validates the whole wait/signal/command-buffer list before
  executing. Submission is synchronous, so signal semaphores and the fence are
  set on completion; waits consume a signaled semaphore and signals require an
  unsignaled one (otherwise the whole submit is rejected); a signaled fence may
  not be resubmitted. After device loss
  all submit/wait/idle paths return DEVICE_LOST.
- `vkQueueWaitIdle`/`vkDeviceWaitIdle`; sync objects are counted
  (`guest_vk_live_sync`), and device destruction releases leftovers and reports
  `GUEST_VK_SYNC teardown_released=N`.
- Fence/semaphore entry points are only exposed on queue-capable profiles
  (clear/compute/graphics); the lifecycle-only profile has zero queue flags.

## Tests

- `lifecycle.c` core11 query test: 6 chained structures, an unknown node left
  untouched, 10 formats compared with FormatProperties2; malformed/cyclic/65-node
  instance and device chains, misplaced sTypes, enabled 1.1 features, invalid
  device groups, queue-create pNext and `vkGetDeviceQueue2` flags/index.
- `clear-test.inc`: two fences, two semaphores, two-batch submit, fence reuse
  after reset, fence-only submit, eight rejected submits; loss mode leaves four
  sync objects that teardown releases.
- Public loader client (`guest-vulkan-loader/client.c`) now uses apiVersion 1.1
  through the real loader: Properties2 chain with unknown node, Features2/
  Vulkan11 features, FormatProperties2, MemoryProperties2, QueueFamilyProperties2,
  device groups, `vkGetDeviceQueue2`, and a fence + semaphore across two submits
  with fence reuse. Compute and graphics clients stay at apiVersion 1.0 as the
  unchanged 1.0 regression.
- The direct page's unavailable-mode expectation was stale since `d4a1ed9`
  (host now reports `WebGPU API unavailable`); it now checks that exact text and
  that no WebGL fallback context was created.

## Actual guest results (1 GiB / 2 CPUs kernel markers on every run)

Runner `web/linux/tests/guest-vulkan/run-finite.mjs` owns one HTTP server
(127.0.0.1:4192) and one headless Chromium (CDP 9402) and closes both. Runtime
files are served from Git HEAD `7f27426` blobs (all 28 matched the working tree).
Authoritative run: `/mnt/p6/build/guest-vulkan-a1a2-20260928/guest-run3/result.json`.

| Suite | Before | Now |
|---|---|---|
| direct live | 44 | 140 |
| direct unavailable | 14 | 17 |
| direct clear | 957 | 1087 |
| direct loss-transport / loss-device | 522 / 522 | 640 / 640 |
| direct exhaustion | 1083 | 1213 |
| public loader clear | 883 | 901 |
| public compute (1.0 client) | 501 | 501 |
| graphics WebGL2 / WebGPU (1.0 client) | 232,753 / 232,745 | 232,753 / 232,745 |

All ten runs passed on the full-suite attempt; the browser exited 0 and the
server closed. Graphics runs each retain one `net::ERR_ABORTED` fetch event
of unestablished cause (as in earlier runs). Retained history: `guest-run1`
(live+clear smoke, pass); `guest-run2` (failed on the stale unavailable
expectation); `direct-build-run3` (pointer-type compile error); package
attempt logs with a wrong argument. `direct-build-run6` is byte-identical to run5.

## Limitations

- Nonconformant: Vulkan 1.1 requires `multiview`; this profile reports every
  1.1 feature false, subgroup size 1, no protected memory, no external handles.
- No timeline semaphores, no fence FDs, no multi-queue; sync is guest-only and
  trivially satisfied because submission completes synchronously.
- No extensions (including swapchain/WSI), so Zink still cannot start here.
