# Isolated experimental Vulkan command profile

This fixture exercises official Vulkan C signatures through direct procedure
lookup inside the real wasm32 Linux guest. `live` mode tests instance/device/queue
ownership; `unavailable` verifies failure without a host WebGPU API. The new
`clear` mode adds opt-in RGBA8 offscreen clear and exact readback using actual
host WebGPU commands. All three guest modes and the host regression passed
real-browser execution on 2026-09-26.

This is **not a conformant Vulkan implementation**, system loader integration,
OpenGL-through-Vulkan, Firefox acceleration or a decoder. Legacy mode retains a
zero-capability queue and NULL command/image entrypoints. Clear mode exposes an
explicitly partial COMPUTE|TRANSFER command profile: Vulkan clear requires a
compute or graphics queue, but dispatch and the rest of compute are absent.
Properties identify this incomplete scope without invented PCI IDs or physical
acceleration claims. SwiftShader can prove semantics only as a software fallback.

`icd.c`, `transfer.inc`, `lifecycle.c` and `clear-test.inc` use unmodified Khronos
1.3.231 C headers from the archived Firefox ANGLE source. `header-provenance.json`
pins each local header SHA-256 and source path; it does not claim fresh upstream
authenticity verification. Build copies those headers with their license notices
and freezes guest source hashes. No dependency download or shader compiler is
required for the clear profile.

`serveLifecycle` records host device and connection ownership while selecting the
host's opt-in clear capability only for `clear` mode. The existing triangle/legacy
host protocol behavior remains the default. A clear pass requires actual host
texture clear/copy/map results, exact guest pixel comparisons, explicit guest
cleanup, exact host operation order and one device created/destroyed. Host errors
and malformed inputs are covered independently by the browser host regression.
No overall goal score follows from this narrow experiment.

## Historical lifecycle baseline

The first build/package and both real guest runs passed on 2026-09-26: live
38 checks and unavailable 11 checks, each on its first attempt at actual 1 GiB /
2 CPUs. Chromium 150 used the Google SwiftShader fallback adapter; the live run
created and destroyed exactly one host device and finished with zero live guest
instances/devices. The unavailable run created no host or guest devices.
The guest artifact is
`/mnt/p6/build/guest-vulkan-20260926/build-run1/guest-vulkan-lifecycle.wasm`
(41,861 bytes; SHA-256
`0f2b0d4b611f2a8930e343ca1d6145824d1e48d4654307d322626b15c28e3c24`).
Raw results remain in `qa-live-run1/result.json` and
`qa-unavailable-run1/result.json` beneath that task directory. See the
[execution report](../../../../docs/guest-vulkan-lifecycle-20260926.md) and
[compact evidence](../../../../docs/evidence/runtime-graphics-20260926/guest-vulkan-lifecycle.json).
This fixture remains excluded from deployed Sites version 6.

Build and packaging are executed by a command agent, not the implementation
agent. First verify the target filesystem/capacity and export **all** temporary
environment variables. These scripts independently reject memory filesystems,
outputs outside the task directory, missing scratch paths and less than 1 GiB
free space. Use fresh output names on every attempt.

```sh
findmnt -T /mnt/p6/build -o TARGET,FSTYPE,AVAIL
df -h /mnt/p6/build
mkdir -p /mnt/p6/build/guest-vulkan-20260926/tmp
export TMPDIR=/mnt/p6/build/guest-vulkan-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR" PYTHONDONTWRITEBYTECODE=1
/usr/bin/python3 web/linux/tests/guest-vulkan/build.py \
  --output /mnt/p6/build/guest-vulkan-20260926/build-run1
/usr/bin/python3 web/linux/tests/guest-vulkan/package.py \
  --build /mnt/p6/build/guest-vulkan-20260926/build-run1/build.json \
  --output /mnt/p6/build/guest-vulkan-20260926/package-live-run1 --mode live
/usr/bin/python3 web/linux/tests/guest-vulkan/package.py \
  --build /mnt/p6/build/guest-vulkan-20260926/build-run1/build.json \
  --output /mnt/p6/build/guest-vulkan-20260926/package-unavailable-run1 --mode unavailable
```

The compile/link invocation is recorded exactly in `compile.command.txt`.
It uses the established wasm32-musl compiler, `-std=c11 -O2 -Wall -Wextra
-Werror -pthread -matomics -mbulk-memory -static`, the two new C files and
existing `guest-gpu.c`, with imported shared memory and exported function table.
Wasm validation and an import allowlist follow; no X11 dependency is needed.
The only permitted imports are shared `env.memory` and the existing Linux
syscall/thread/signal imports. Build success is not guest execution evidence.

Packaging hash-checks the accepted **plain** image against the current manifest,
changes only the test copy of `/init`, and adds one executable. All other CPIO
records and the archive tail are compared byte-for-byte. It never modifies the
accepted image. The test doesn't attach the persistent-home backend.

Only the sole serving owner may expose these two directories as the fixture's
`candidate` and `candidate-unavailable` links, with no existing path replaced:

```sh
ln -s /mnt/p6/build/guest-vulkan-20260926/package-live-run1 web/linux/tests/guest-vulkan/candidate
ln -s /mnt/p6/build/guest-vulkan-20260926/package-unavailable-run1 web/linux/tests/guest-vulkan/candidate-unavailable
```

Wait for the current release VM to finish. Use an isolated disk-backed Chromium
profile with the existing server and CDP port owned by that serving agent. The
runner starts no browser/server; it creates and closes only its own tab and VM.
Set the URLs to that owner's actual endpoints, then run serially:

```sh
export CDP_URL=http://127.0.0.1:9394
export VK_QA_BASE=http://127.0.0.1:4180/linux/tests/guest-vulkan/
VK_QA_OUT=/mnt/p6/build/guest-vulkan-20260926/qa-live-run1 \
  node web/linux/tests/guest-vulkan/run-browser.mjs live
VK_QA_OUT=/mnt/p6/build/guest-vulkan-20260926/qa-unavailable-run1 \
  node web/linux/tests/guest-vulkan/run-browser.mjs unavailable
```

Acceptance requires both `result.json` files to report `pass:true`, actual host
adapter identity in the positive case, one host device destruction, no remaining
guest objects, no runtime exceptions, and successful unavailable-host failure.
Retain the screenshots, package/build reports and logs under the task directory.
The serving owner removes only its two exact symlinks after testing and cleans
up owned services under the existing ownership rules. Nothing here is deployed.

## Verified opt-in clear/readback continuation

The new `clear` package mode (`--clear` guest argument) adds a direct-call,
**nonconformant** Vulkan command profile. It negotiates `clearImage:true` through
HELLO and explicitly opts the isolated host into opcode 9. Legacy sessions still
reject that opcode, retain zero queue capability flags and expose no command
entrypoints. The new mode exposes partial COMPUTE|TRANSFER flags because
`vkCmdClearColorImage` requires a graphics or compute queue; **compute dispatch is
absent**, so these flags describe an incomplete experimental profile and must
never be represented as a usable/conformant Vulkan device.

Typed monotonically allocated guest image/buffer/memory IDs enforce ownership,
size, type and binding. Image memory owns an actual host WebGPU texture; mapped
host-coherent buffer memory is guest storage updated from actual WebGPU staging
buffer bytes before synchronous QueueSubmit completes. Recording copies values
without touching GPU state. Submission validates the entire command list before
host effects, checks image layouts and buffer host-read barriers, and poisons the
device on a host/transport failure. State is initial→recording→executable→pending
→executable, with reset recovery for rejected recording. Teardown releases host
textures and guest resources. The guest table is capped at 32 entries, memory at
1 MiB, images at 128×128, individual allocations/buffers at 64 KiB and recording
at 16 commands. These are test-profile bounds, not advertised Vulkan limits.

Supported profile: optimal RGBA8 UNORM 2D images, one mip/layer/sample, exclusive
ownership, TRANSFER_SRC|DST image usage and TRANSFER_DST buffers; whole-image
clears/copies with tightly packed zero-offset destination, no aliasing/offset
binding. Colors must be finite and in [0,1] (narrower than Vulkan clamping rules).
Only the explicit undefined/source→destination→source transitions and
transfer-write→host-read buffer barrier are accepted. One primary command buffer,
one pool, one submit, no fences/semaphores, no secondary buffers, no concurrent
calls, one-time/simultaneous flags, shaders, dispatch, rendering pipelines,
format-query implementation or loader discovery. Unsupported void commands poison
recording; unsupported create/submit arguments fail. No OpenGL, decoder, Firefox
GPU integration or physical acceleration follows from this test.

`clear-test.inc` verifies two colors on the same 17×3 image in separate submissions,
all 102 RGBA pixels, a preserved eight-byte buffer suffix, host 256-byte row padding
removed into 68-byte rows, command-value snapshots, explicit cleanup, stale handle
rejection, layout mismatch, map/bind failures, unsupported recording and reset.
The browser also checks the exact host operation sequence, so recording/rejected
submissions cannot silently execute additional GPU operations. Host regression
keeps the original real triangle and adds legacy refusal, malformed length,
nonfinite/out-of-profile color, wrong type, stale handle, exact pixels and device
loss cleanup. Byte assertion counts are not independent capability counts.

New output root is `/mnt/p6/build/guest-vulkan-clear-20260926`; the prior root
remains accepted for reproduction. Export TMPDIR/TMP/TEMP under the chosen root
and use fresh build/package/QA directories. Build freezes both `.inc` files.
Package with `--mode clear`, expose only the owned `candidate-clear` symlink and
run `run-browser.mjs clear`; also rerun `live`, `unavailable`, and the guest-gpu
host regression. The accepted production images and deployed Site remain untouched.


### Clear/readback acceptance on 2026-09-26

The frozen `build-run2` artifact passed Wasm validation and import checks:
64,334 bytes, SHA-256
`c0ede2c1cfb39896bcf5aafce7df2be74c96eeb2c7e08018f16d598cf6d9e730`.
All new artifacts are under `/mnt/p6/build/guest-vulkan-clear-20260926/`.
`package-clear-run2` changes only the isolated init and adds the test executable;
accepted production images remain untouched. `qa-clear-run1` passed its first
actual guest attempt: two clears and two readbacks of the same 17×3 image,
102 exact pixels (red RGBA 255,0,0,255; green RGBA 0,255,0,0), eight unchanged
suffix bytes, nine ordered host commands, one texture released and one real
Google SwiftShader fallback WebGPU device created/destroyed. Guest resources,
instances and devices ended at zero; errors and runtime exceptions were absent.
The 951 guest checks mostly count individual byte assertions, **not 951 GPU
capabilities**. The observed 3.625-second fixture run is not a benchmark.

`qa-host-run1` passed 73 browser checks covering the original triangle plus clear
and failure paths. Legacy `live` passed 38 guest checks in `qa-live-run2`;
`unavailable` passed 11 in `qa-unavailable-run1`. The first live harness attempt
failed before guest boot because navigation briefly had a null document element;
that retained `qa-live-run1` evidence led to a null-safe runner snapshot. The
retry retained all acceptance gates and used the same guest/host sources.

See the [clear/readback report](../../../../docs/guest-vulkan-clear-readback-20260926.md)
and [compact evidence](../../../../docs/evidence/runtime-graphics-20260926/guest-vulkan-clear-readback.json).
For reproduction use fresh output directory names, explicit disk-backed scratch,
`build.py --output .../build-run3`, `package.py --build .../build-run3/build.json
--output .../package-clear-run3 --mode clear`, and the sole serving owner's
`candidate-clear` link before `run-browser.mjs clear`. Keep `live`, `unavailable`
and the guest-gpu host regression as release gates for this isolated profile.

## Verified fault and allocation-recovery gates

Three additional isolated package/runner modes use
`/mnt/p6/build/guest-vulkan-failure-20260926/` with explicit task-local
`TMPDIR`, `TMP`, `TEMP` and `PYTHONDONTWRITEBYTECODE=1`:

- `loss-transport`: the fixture closes vsock when the first READBACK header
  arrives, after a completed real GPU clear and its successful guest reply.
- `loss-device`: after the real copy is submitted and staging map begins, the
  fixture destroys the actual WebGPU device and awaits its native `lost`
  promise. The pending map has a rejection handler before destruction.
- `exhaustion`: actual guest allocations reach the 1 MiB byte budget, reject
  three further allocations without handles/accounting changes, free and reuse
  one allocation, then reach the independent 32-entry resource table limit,
  reject three further allocations, and free/reuse a slot. Preserved bytes and
  stale handles are checked before normal two-color clear/copy execution on the
  same device.

Fault modes reuse the clear fixture's actual recording/submission path. They
require `VK_ERROR_DEVICE_LOST` from submit, both idle functions, re-submit and a
newly recorded submit; all 212 mapped sentinel bytes must remain unchanged.
Device teardown must free the remaining guest pool/image/buffer/memory state,
leaving zero resource entries and zero allocated bytes. Fault close status is
`-1`, explicitly separate from successful normal protocol CLOSE.

Only the fixture wrapper injects faults. It tracks actual created/destroyed
textures, staging buffers and devices, with idempotent destruction. Acceptance
requires zero live host objects, exactly one injection after one completed
clear, zero completed readbacks, exact command order, and no page exceptions.
A transport fault does not allocate a staging buffer; device fault must create
and destroy one. Neither mode returns fabricated readback pixels. These gates
do not test arbitrary loss points, driver recovery or physical GPU behavior.

Build/package/run as above with `--mode loss-transport`, `--mode loss-device`
or `--mode exhaustion`, corresponding sole-owner candidate symlinks, and
`run-browser.mjs MODE`. Run normal `clear`, `live`, `unavailable`, and the host
regression from the same frozen sources. Preserve prior clear-run2 artifacts.
All six modes passed their first actual guest attempt from frozen build-run1:
clear 951, loss-transport 516, loss-device 516, exhaustion 1,077, live 38 and
unavailable 11 assertions. Counts include individual bytes, not distinct
features. Native loss reason was `destroyed`; actual guest configuration was
1 GiB/two CPUs. Fifteen guest/host/header identities matched frozen provenance.
The unchanged shared host's earlier 73 checks were not rerun in this task. See the
[execution report](../../../../docs/guest-vulkan-failure-recovery-20260926.md) and
[compact evidence](../../../../docs/evidence/runtime-graphics-20260926/guest-vulkan-failure-recovery.json).
