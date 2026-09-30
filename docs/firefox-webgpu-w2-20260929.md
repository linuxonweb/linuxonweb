# Firefox WebGPU W2: guest GPU hostcall channel (2026-09-29)

Packet W2 of `docs/firefox-webgpu-design-20260929.md`: a private guest syscall
range that reaches a host GPU-owner Worker holding a real WebGPU adapter.
This is a runtime adapter only. It includes no Firefox, kernel or Mesa source
edits, and nothing was promoted into `web/linux` images or deployed.
Compact evidence: `docs/evidence/firefox-webgpu-20260929/w2-hostcall.json`.
Task root (ext4, disk-backed): `/mnt/p6/build/firefox-webgpu-w2-20260929/`.

## Files

| File | Change |
|---|---|
| `web/linux/dist/guest-gpu-hostcall.js` | new (463 lines): ABI constants, guest-side client, page-side host |
| `web/linux/dist/guest-gpu-owner.js` | new (429 lines): owner Worker (ops, WebGPU adapter, writeBuffer probe) |
| `web/linux/dist/worker.js` | +14/-1: intercept, per-thread client, hub forwarded to spawned threads, release at `worker_exit` |
| `web/linux/dist/index.js` | +9: create the host per machine, relay `gpu_hostcall` messages, pass the hub to `start`, close at finish; `spawnMachine({gpuHostcall:false})` disables it |
| `web/linux/tests/guest-gpu-hostcall/` | new: `gpu-hostcall-test.c` (150 checks), `build.py` (`--expect-vendor`), `run-guest.mjs`, `index.html` |

The owner Worker starts lazily at the first guest call. Machines that never
call it only allocate the 16.5 KiB hub.

## ABI

These syscall numbers are intercepted in the `linux.syscall` closure of
`worker.js`, next to the JIT range (0x6a49xxxx). They never reach the kernel.

| nr | Signature | Result |
|---|---|---|
| `0x6a470001` | `gpu_hostcall(op, a0, a1, a2, a3, a4)` | `>= 0` or `-errno` |
| `0x6a470002` | `gpu_hostcall_stats(u32 out[11])` | 0 or `-EFAULT`; answered locally, no owner round trip |
| `0x6a470003` | `gpu_hostcall_control(cmd, arg)` | test hooks; `-EPERM` unless the host enabled `testHooks` |

### Operations

| op | Name | Arguments | Result |
|---|---|---|---|
| 1 | ECHO | `(value)` | `value & 0x7fffffff` |
| 2 | CHECKSUM | `(ptr, len, out_u32)` | 0; FNV-1a-32 of the guest range written to `out_u32` |
| 3 | FILL | `(ptr, len, seed)` | 0; byte i = `((seed ^ i*0x9E3779B1) >>> 13) & 0xff` |
| 4 | ADAPTER_INFO | `(out, cap, len_out)` | JSON byte count, or `-ENOSPC` with `*len_out` = the size needed |
| 5 | WRITEBUFFER_PROBE | `(src, len, out, cap, len_out)` | JSON byte count (see the writeBuffer finding) |
| 6 | SLEEP | `(ms <= 10000)` | 0; asynchronous on the owner, used to test blocking |
| 0x100/0x101/0x102 | TEST_HANG / TEST_CLOSE / TEST_TERMINATE | none | owner-loss test hooks: spin, `self.close()`, ask the page to terminate |

The control commands (test hooks only) are `CTL_RESPAWN=1` and `CTL_SET_STALL_MS=2` (100..60000 ms).

**Stats words**, in order: version (1), owner_state (0 none, 1 starting, 2 alive, 3 dead), owner_gen, slot, heartbeat, calls, dead_reason (1 error, 2 stall, 3 terminated, 4 closed, 5 startup), flags, thread_calls, stall_ms, thread_yields.

**Errors**

| Error | Meaning |
|---|---|
| `-ENOSYS` | no hub; op 0 |
| `-EBUSY` | re-entered from a signal handler while this thread's call is in flight |
| `-ENODEV` | owner dead, request not taken |
| `-EIO` | owner lost after taking the request, which may have partially executed |
| `-EAGAIN` | no free slot (256 slots) |
| `-EFAULT` | NULL, beyond the end or crossing the end of the caller's current `WebAssembly.Memory` (re-read per access, so memory growth is honoured), in any pointer including output pointers |
| `-EINVAL` | length > 256 MiB, negative length, unknown op, sleep > 10 s, odd writeBuffer length, bad control command |
| `-ENOSPC` | output buffer too small |
| `-EPERM` | test hook not enabled |
| `-ETIMEDOUT` | respawn did not come up |

### Shared hub layout

The hub is one `SharedArrayBuffer` of Int32 words per machine:

- **Header:** magic `GPH1`, owner state, generation, heartbeat, doorbell, flags, next generation, dead reason, stall ms, startup ms, total calls, tokens. Words 16-23 are a pending bitmap.
- **Slots:** 256 slots of 16 words from word 32. Each slot holds token, state, seq, op, gen, args[5] and result/result2.

## Concurrency design

- **One slot per guest thread.** A thread claims the lowest free slot by CAS on its token at its first call. It releases the slot in `worker_exit`, where an in-flight call is abandoned. A thread has at most one syscall in flight, so slots need no lock and threads never contend.
- **Request path.**
  - The caller writes op/args, stores state `REQUEST`, sets its pending bit, bumps and notifies the doorbell, then waits on its own state word.
  - The owner waits on the doorbell with `Atomics.waitAsync`, so its event loop stays free. It scans the pending bitmap and runs slots concurrently: a slow asynchronous request (adapter request, `mapAsync`, `SLEEP`) of one thread does not delay others.
  - Each caller process's `WebAssembly.Memory` is relayed to the owner once per slot by the page (`attach`/`detach` messages), and the owner reads and writes guest memory directly. A request that arrives before its memory is parked.
- **Stale-completion protection.**
  - The state word is `(seq << 2) | state`, where seq is a per-slot counter of 30 bits that is never 0 and never reset.
  - The owner completes only by an exact `BUSY -> DONE` compare-exchange for the seq it served.
  - Its guest-memory writes are guarded by a `current(slot, seq)` check. An abandoned request's late completion can therefore never satisfy a later request, even after the slot passes to another thread or process.
- **Cooperative wait (the guest-run2 fix).** Guest user code is not preemptible. A Worker parked in `Atomics.wait` inside a syscall intercept never enters the kernel, so its vCPU was held hostage: timer interrupts, other runnable tasks on that CPU, and signal/exit delivery all waited for the GPU call. The wait is now:
  - 1 ms of pure `Atomics.wait` (covers ordinary synchronous ops);
  - then 1 ms wait slices alternating with a `sched_yield` (nr 124) kernel entry supplied by `worker.js`.

  The kernel entry services interrupts, schedules other tasks, delivers signals, and lets `exit_group`/SIGKILL unwind the thread; an unwinding call abandons its slot via `finally`. A signal handler that calls `gpu_hostcall` while the interrupted call is in flight gets `-EBUSY`, and the interrupted call still completes normally.

## Owner loss

- **Heartbeat.** The owner bumps a heartbeat every 50 ms.
- **Stall detection.** A waiting caller whose heartbeat has not moved for `stall_ms` (default 3000, test 1000) marks the owner dead and asks the page to terminate it. Startup uses a 20 s limit.
- **Page-side death.** The page also marks the owner dead on a Worker `error`, a terminate request or machine close.
- **Waking callers.** A dead owner wakes every slot:
  - a request the owner had already taken returns `-EIO`;
  - a request it had not taken returns `-ENODEV`;
  - later calls return `-ENODEV` immediately.
- **No automatic restart.** The owner stays dead for the machine; only the test hook respawns it with a new generation.

Measured on NVIDIA in guest-run5 (guest-run4 in parentheses):

| Loss | First call | Next call | dead_reason | Respawn |
|---|---|---|---|---|
| hang (spin, heartbeat stops) | -5 after 1001 ms (1002) | -19 after 0 ms | 2 stall | 31 ms (29) |
| terminate | -5 after 1 ms (2) | -19 after 0 ms | 3 | 28 ms (31) |
| `self.close()` without reply | -5 after 1000 ms (1002) | -19 after 0 ms | 2 stall | 25 ms (35) |
| another thread blocked in `SLEEP` during a hang | -5 after 118 ms (90) | n/a | n/a | n/a |

No path hangs. The stall detector bounds a silently closed owner at `stall_ms`.

## Results

The test machine has 1 GiB / 2 CPUs; the guest verified its configuration from kernel lines.

**NVIDIA GeForce MX110 runs**

- Headful Chromium 150 on `DISPLAY=:0`.
- Flags: `--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist --window-size=1280,900`.
- Isolated disk profile/cache in the run dir, CDP 9408, HTTP 4198.
- No PRIME offload variables; the runner deletes them and records `browser-env.json`.
- The owner uses `powerPreference: 'high-performance'`.
- The run passes only if `adapter.info.vendor === "nvidia"` and `isFallbackAdapter === false` (guest-side `GUEST_GPUHC EXPECT_VENDOR` check plus the runner check).

| Run | Build | Backend | Result |
|---|---|---|---|
| guest-run1 | build-run1 | headless SwiftShader | pass 118/0 (older, smaller test; before the wait fix) |
| guest-run2 | build-run2 | headless SwiftShader | **fail** 116/2: "threads use distinct slots", "echoes finished before sleeper" (preserved) |
| guest-run3 | build-run3 | NVIDIA | **fail** 147/1: "four blocked callers overlap on two CPUs" (preserved) |
| guest-run4 | build-run4 | NVIDIA | **pass 150/0**, 28.5 s |
| guest-run5 | build-run4 | NVIDIA | **pass 150/0**, 21.7 s |

In both passing runs the browser exited 0, the server closed, and there were no console errors or CDP exception events.

**Diagnosis of the failures**

- **guest-run2 "distinct slots"** was a wrong expectation. A slot is legitimately reused after its thread exits, and short threads finished before the next started. The test now holds all four threads between barriers and still requires distinct slots, plus a stable slot per thread.
- **guest-run2 "echoes before sleeper"** was a real bug: the vCPU hostage described above. It was fixed by the cooperative wait, not by relaxing the check. The check now measures only after both sleepers have entered their calls. It also compares a 50 ms `nanosleep` against a control taken before the sleepers: control 50.76 ms vs 50.40 ms while two threads are blocked (run5).
- **guest-run3 "overlap"** measured `pthread_create` latency, not serialization. Each guest thread is a new Web Worker, and they started at 233-314 ms. The check was replaced with a stricter simultaneity condition: all four 500 ms calls outstanding at once (`last_start < first_done`) and a tail under 700 ms. run5 reports overlap 418 ms and tail 503 ms; run4 reports 335 ms and 502 ms.

**Latency (10,000 ECHO round trips, guest `clock_gettime`)**

| Run | p50 | p90 | p99 | p99.9 | max |
|---|---|---|---|---|---|
| NVIDIA guest-run5 | 40 us | 85 us | 455 us | 1.48 ms | 6.58 ms |
| NVIDIA guest-run4 | 45 us | 100 us | 870 us | 2.81 ms | 6.18 ms |
| SwiftShader guest-run2 (headless) | 20 us | 35 us | 80 us | 0.37 ms | 2.36 ms |

- The ECHO path does not touch the GPU, so the difference comes from host scheduling. The headful runs shared the host with other agents' browsers and builds (load average 6-10 on 8 cores).
- The first call, including the lazy owner Worker start, took 43-44 ms.

**Concurrency**

- **Throughput.** Four threads plus main, 2000 echoes each: 136,407 calls/s in run5 and 42,285 in run4 under load. The threads held slots 1-4 while main held slot 0.
- **Interleave.** While two threads were blocked 400 ms in `SLEEP`, main's 200 echoes completed at 288 ms, before the sleepers (565/600 ms), and each sleeper yielded 307-330 times.
- **Signals.** SIGUSR1 to a thread in a 1500 ms call ran its handler within 0-8 ms. The nested call returned -16 (`EBUSY`), and the original call returned 0 after 1501-1507 ms.
- **Exit while blocked.** A child process whose thread is blocked in a 3 s call `_exit`s; `waitpid` returns in 500-505 ms. A new thread reuses the same slot for 43k-80k calls with 0 wrong or stale results.
- **Bad pointers and lengths.** Every case returns the documented errno (see the ABI section).

## Adapter info (NVIDIA GeForce MX110, from the guest via ADAPTER_INFO)

- **Adapter:** `info`: vendor `nvidia`, architecture `maxwell`, device "", description "", subgroupMinSize/MaxSize 32, isFallbackAdapter false, subgroupMatrixConfigs []. The owner runs in worker scope with crossOriginIsolated true, Chrome/150. The preferred canvas format is `rgba8unorm`.
- **Features (21):** including `texture-compression-bc`, `timestamp-query`, `subgroups`, `float32-filterable`, `dual-source-blending`, `clip-distances` (`shader-f16` is not exposed).
- **Adapter limits:** maxBufferSize 4294967292, maxStorageBufferBindingSize 2147483644, maxTextureDimension2D 16384, maxBindGroups 4, maxComputeInvocationsPerWorkgroup 1024.
- **Device:** creation succeeds with default limits, maxBufferSize 268435456.
- **Driver:** Chromium picks the NVIDIA Vulkan driver without PRIME offload variables; the host's Intel UHD 620 iGPU (lspci 00:02.0) is not the adapter returned for high-performance.
- **SwiftShader, for comparison:** vendor `google`, architecture `swiftshader`, subgroups 4, isFallbackAdapter true.

## writeBuffer / SharedArrayBuffer finding

The question was whether the owner can pass a guest range to `GPUQueue.writeBuffer` directly. Guest memory is a shared `WebAssembly.Memory`, so the range is backed by a `SharedArrayBuffer`. The alternative is copying it into a non-shared buffer first.

`WRITEBUFFER_PROBE` tests three ways of passing the range:

1. a `Uint8Array` view on the SAB (`sharedView`);
2. `writeBuffer(buf, 0, sab, byteOffset, len)` (`sharedBufferOffset`);
3. `slice()` into a fresh ArrayBuffer (`copySlice`).

For each, the probe overwrites the source immediately after the call, then reads the GPU buffer back.

- **Result on both NVIDIA and SwiftShader:** all three are accepted, the data is snapshotted at call time, and there are 0 mismatches.
- **Cost of copying:** a copy only adds cost.

| Size | sharedView | sharedBufferOffset | copySlice |
|---|---|---|---|
| NVIDIA, 64 KiB | 0.02-0.04 ms | 0.025-0.07 ms | 0.13-0.26 ms |
| NVIDIA, 4 MiB | 2.6-3.1 ms | 2.4-3.0 ms | 7.4-8.4 ms |
| SwiftShader, 64 KiB | 0.01 ms | 0.01 ms | 0.055 ms |
| SwiftShader, 4 MiB | 0.97 ms | 0.99 ms | 2.28 ms |

Figures are median call ms over 9 rounds (runs 4/5 on NVIDIA, run 2 on SwiftShader). The first, cold call of each case is slower and noisier; on NVIDIA 4 MiB it was 8-19 ms for all three cases. Only the medians are compared.

**Consequence for W4:** `queue_write_action` can hand the guest SAB range to `writeBuffer` without an intermediate copy. The call returns only after snapshotting, so the guest may reuse its buffer as soon as the hostcall returns. This behaviour is Chromium's. The WebGPU spec's `AllowSharedBufferSource` permits SAB, but W4 should keep the probe as a runtime check.

## Regressions

All regressions ran on the current `worker.js`/`index.js`, in the same task root, on ports 4198/9408.

| Gate | Run dir | Result |
|---|---|---|
| JIT runtime primitive (copied runner) | `regress-jit-run1` (build `regress-jit-build-run1`) | pass 62/0; native 25.9 ns vs installed 25.1 ns |
| Aurora readiness (existing test) | `regress-aurora-run1` | pass 23 |
| Real UI console boot (new runner `regress-tools/console-boot/run.mjs`) | `regress-console-run1` | pass; prompt at 11.4 s, `W2CON_42` echoed at 12.6 s |
| Firefox W1 startup, candidate `c27a1a7c6e6a` (copied W1 runner) | `regress-firefox-w1-run1`, `regress-firefox-w1-run4` | pass cold/warm; requestAdapter resolved null x4 (expected Empty HAL); warm zero images (runs 2/3 failed under load, see below) |

**Firefox timing and the load-sensitive input check.** The W1 runner types
`wasmperf` into the guest page after the probe.

| Run | Code | Host load (1-min avg) | Result | Launch cold / warm |
|---|---|---|---|---|
| `regress-firefox-w1-run1` | W2 | not recorded | pass cold/warm | 24.4 s / 31.3 s |
| `regress-firefox-w1-control-run1` | original HEAD (`regress-tools/control-root`) | 5.6 -> 14.0 | pass cold/warm | 26.2 s / 22.4 s |
| `regress-firefox-w1-run2` | W2 | 14.0 -> 13.0 | **fail** warm: field shows `wasmpperf` | 24.4 s / - |
| `regress-firefox-w1-run3` | W2 | 12.7 -> 10.7 | **fail** cold: field shows `waasmperf` | - |
| `regress-firefox-w1-run4` | W2 | 2.9 -> 8.3 | pass cold/warm; null x4; warm zero images | 15.6 s / 14.5 s |

Runs 2 and 3 ran while the A4 Vulkan suites loaded the host. In both, the
probe completed and resolved null x4, but a guest keystroke was duplicated, so
the fixture's exact-input check never ran. Firefox never issues the private
GPU syscalls, and run4 on the same W2 code passes at low load. The
duplication is therefore attributed to input timing under host load (probably
X autorepeat when a delayed key-up arrives late), not to the hostcall channel.
That cause is not proven; keep the failed runs.
Launch times are single observations under different loads, not a
performance comparison. The earlier W1 gate recorded 7.9 s / 6.7 s at lower load.

## Known limitations

- **Long waits keep the Worker busy.** A long wait is a polling loop of 1 ms slices plus `sched_yield`; the thread is not put to sleep in the kernel. A thread in a long call therefore keeps its Worker busy and re-enters the scheduler about every 1 ms. That is correct, but the thread is not idle, so W4 should keep long waits (fences, `mapAsync`) short or use completion events.
- **Race window on abandon.** There is a microsecond window between the owner's `current(slot, seq)` check and its guest-memory write. An abandoned request's final write could land in memory the caller already owns again. Only exited or killed threads and signal-unwound calls abandon.
- **Unsynchronized yield path.** The internal `sched_yield` is not followed by JIT replay or the exec check that normal syscalls get. This is harmless for W2, but W4 should route the yield through the normal post-syscall path if JIT code can be installed while a GPU call is in flight.
- **Probe resources on abandon.** GPU buffers created by the probe on an abandoned request are not tracked for cleanup. The real W4 executor needs per-process object tables freed on detach.
- **Thread start cost.** Guest thread start is a Web Worker spawn (about 150-460 ms here), which dominates short multi-thread tests.
- **Dead owner is final.** It stays dead for the machine; Firefox would see a device loss. Automatic respawn is not implemented.

## W3/W4 blockers and next steps

- **W3 (host decoder).**
  - The owner has no wgpu-core action decoder yet. W3 must build the serde types at wgpu `c7458638` into browser Wasm or JS and decode `DeviceAction`/`CommandEncoderAction`/pass/`QueueWriteAction` ByteBufs.
  - Golden inputs need a host-built `wgpu_client_*` harness at the same revision.
- **W4 (`--wrap` link adapter).**
  - **Firefox relink:** Firefox must be relinked with a `--wrap` shim for the `wgpu_server_*` entrypoints that issues these syscalls. This needs the W0/W1 relink pipeline plus the JIT packet 2 table splice if both are to coexist.
  - **Batched ops:** the channel carries one request per call and a result word. W4 needs batched ops with an in/out buffer in guest memory, which ADAPTER_INFO/WRITEBUFFER_PROBE already demonstrate. It also needs per-process object ID tables in the owner, freed on detach/death.
  - **Async completions:** asynchronous completions (`mapAsync`, `onSubmittedWorkDone`, device lost) must be surfaced as polled events rather than long blocking calls. This is because of the busy-wait and yield limitation above.
  - **Adapter limits:** the adapter request must pass through the real NVIDIA limits and features shown above; `adapter_pack_info` must encode them.
  - **Firefox thread model:** Firefox's GPU process is disabled in this single-process build, so the wgpu server runs on a content/parent thread that calls the hostcall. Its thread must tolerate the -EIO/-ENODEV loss results as device loss.
- **Test hooks:** these (hang/close/terminate/respawn/stall) are enabled only by `createGpuHostcallHost({testHooks:true})`. Production defaults keep them off (`-EPERM`).
