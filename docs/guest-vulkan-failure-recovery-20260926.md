# Guest Vulkan loss and allocation recovery — 2026-09-26

The isolated real wasm32 Linux guest now passes the bounded transport/device-loss
and allocation-exhaustion gates identified by the earlier
[clear/readback report](guest-vulkan-clear-readback-20260926.md). All six guest
modes passed on their first attempt from one frozen build. Existing submission
and teardown behavior handled both injected failures correctly; no driver
failure-handling repair was needed. The implementation adds opt-in fixture
injection, allocation auditing, and actual guest regression coverage.

This remains a direct-call, partial, nonconformant Vulkan experiment. The observed
adapter is Google SwiftShader with `isFallbackAdapter=true`, so the result proves
software execution semantics. It establishes no performance improvement,
physical acceleration, full Vulkan/GL support, Firefox GPU integration, hardware
decoding, or native JIT. Accepted images and deployed Sites version 6 are unchanged.

## Failure boundaries and results

Both loss cases execute a real clear and receive its successful protocol reply
before the fault. The host records exactly HELLO, HELLO, TARGET and CLEAR as
successful commands, one clear, zero completed readbacks, and one fault event.
The host wrapper tracks header/payload phases explicitly, so a 16-byte payload
cannot accidentally be interpreted as a protocol header.

`loss-transport` closes the actual vsock connection when the first READBACK
header arrives. No staging buffer is allocated. `loss-device` begins the actual
staging map after the GPU copy is submitted, calls the actual WebGPU device's
`destroy()`, and awaits its native `lost` promise. The observed reason is
`destroyed`, and the host reports `device lost: Device was destroyed.`. This is
deterministic device-loss injection, not evidence of a spontaneous driver fault.

Each guest receives `VK_ERROR_DEVICE_LOST` (`-4`) from the first submit,
`vkQueueWaitIdle`, `vkDeviceWaitIdle`, re-submission, and submission of a freshly
recorded command buffer. All 212 mapped sentinel bytes remain exactly `0xa5`:
no successful or fabricated readback bytes reach guest memory. The expected
protocol CLOSE status is `-1`, separately checked from normal successful CLOSE.

Device destruction intentionally owns the remaining command pool, image, buffer
and memory cleanup. Guest resource count, allocated bytes, instances and devices
all finish at zero. The fixture tracks actual native object creation/destruction,
not only the shared host's released-entry counter:

| Mode | Device created/destroyed | Texture created/destroyed | Staging buffer created/destroyed | Live native objects |
|---|---:|---:|---:|---:|
| Transport loss | 1/1 | 1/1 | 0/0 | 0 |
| Device loss | 1/1 | 1/1 | 1/1 | 0 |
| Exhaustion then clear | 1/1 | 1/1 | 2/2 | 0 |

## Allocation exhaustion and reuse

The guest allocates sixteen actual host-visible 64 KiB blocks, reaching the
1,048,576-byte budget. Three further one-byte allocations return
`VK_ERROR_OUT_OF_DEVICE_MEMORY`, clear the supplied output handle, and preserve
both allocated-byte and resource counts. Freeing one block permits a new 64 KiB
allocation with a distinct handle. Every byte of retained allocations is
checked; the replacement's zero initialization is also checked.

A separate phase allocates thirty-two four-byte blocks to fill the shared
resource table while using only 128 bytes. Three further allocations return
`VK_ERROR_OUT_OF_HOST_MEMORY` without a handle or accounting leak. Freeing one
slot allows successful reuse with a distinct ID. Mapping the stale ID fails;
freeing that stale ID cannot delete the replacement. Full cleanup returns both
counters to zero.

The same device then runs the normal two-color clear/copy fixture: both 17×3
images return all 102 exact pixels, preserving the suffix sentinel. This verifies
useful GPU work after allocation recovery, beyond merely accepting a new handle.

## Executed gates and provenance

| Gate | Result |
|---|---|
| Compile, Wasm validation, ABI allowlist | Pass, first build |
| Six isolated CPIO packages | Pass; 3,846 original records and tail preserved; only `/init` changed and one executable added |
| Normal clear | 951 assertions, pass |
| Transport loss | 516 assertions, pass |
| Device loss | 516 assertions, pass |
| Exhaustion plus normal clear | 1,077 assertions, pass |
| Legacy live | 38 assertions, pass |
| Unavailable GPU | 11 assertions, pass |
| Frozen/current guest, host and header identities | 15/15 match |

Assertion counts include individual byte checks and are not independent feature
counts. All guest runs capture actual kernel memory and SMP lines confirming
1 GiB/two CPUs, visible foreground state and cross-origin isolation. There are
zero fixture errors or browser runtime exceptions. Each run completed within its
watchdogs; recorded durations are harness observations, not benchmarks.

The unchanged shared `guest-gpu/host.mjs` had 73 browser regression checks pass
in the prior clear/readback task. Those 73 were **not rerun** here. This task ran
normal clear, live and unavailable regressions through the changed fixture
wrapper, alongside the new cases. No shared host or accepted runtime code changed.

All binaries, packages, browser profiles, logs and screenshots are retained on
disk under `/mnt/p6/build/guest-vulkan-failure-20260926/`. The new `build-run1`
executable is 70,375 bytes, SHA-256
`c2bfea0d346dba4e0b1b493a49f29d528c48daeb6b014da1849089a1535cd0b9`.
The exact package sizes/hashes, raw result hashes, operation traces, native
ownership, source audit and runner identity are pinned in the
[compact evidence](evidence/runtime-graphics-20260926/guest-vulkan-failure-recovery.json).
Raw reports are `qa-MODE-run1/result.json`; `qa-summary.json` combines the checks.
The earlier `/mnt/p6/build/guest-vulkan-clear-20260926/build-run2` baseline and
its packages remain preserved. See the
[fixture README](../web/linux/tests/guest-vulkan/README.md) for reproduction.

The sole serving owner completed cleanup after acceptance: browser PID 64410
closed through `Browser.close`, adapter PID 64263 stopped on SIGTERM, and both
exited with status zero without escalation. Ports 4182/9396 have no listeners;
all six identity-checked candidate links were removed. The user's server PID
1591443 retained its command/start identity. Profiles, cache, executable, packages
and QA evidence remain on disk. The compact evidence pins `cleanup.json`.

## Assessment and remaining scope

The bounded failure-containment and allocation-reuse gate is assessed at 95/100.
This is a scoped engineering assessment, not a conformance rating or overall goal
score. Coverage is one deterministic boundary per failure type, one byte-budget
and one table-budget cycle, and software WebGPU. It does not cover every command
boundary, mid-body partial readback, reconnection/device recreation, concurrent
submission, random fault injection or extended soak.

Loader integration, ordinary Vulkan application discovery, queries and limits,
shaders, compute dispatch, draw pipelines, broader synchronization and conformance
remain substantive work. Native Firefox JIT, GL-through-Vulkan, Firefox GPU APIs,
WebGL fallback and hardware decoding are also unresolved. The full goal remains
active and below 95/100.
