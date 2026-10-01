# vkgears V2: where the per-frame time goes (2026-10-01)

On NVIDIA WebGPU at 128x128, vkgears renders at 59.6 FPS with presentation and
184 FPS without it. Softpipe glgears at the same size reaches 202 and 452 FPS.
This packet measures where each vkgears frame spends its time and ranks fixes.
No shared source changed: all instrumentation is in copies under
`/mnt/p6/build/vkgears-v2-20261001`. Evidence is in
`docs/evidence/vkgears-v2-profile-20261001.json`.

## Method

The instrumented copies come from a `git archive 8af39db` snapshot (`snap/`):
- `guest-gpu.c`, with `GUEST_GPU_PROF=1`, times every `gpu_call` per op. It
  records the header+payload send, the wait until the reply header arrives
  (host work plus transport) and the reply read. It prints `GPUPROF_*` every 5 s.
- `vkgears.c` times record, `vkQueueSubmit`, `vkQueueWaitIdle` and
  `x11_present` per frame (`VKGEARS_PROF`).
- `host.mjs` times the idle wait for each request header (that is, guest time),
  the payload read, the per-op handler and the reply write.
- `renderer.mjs` splits every `checked()` into its action and its 3x
  `popErrorScope`, and also times readback repack.

These copies are served from a shadow root (`root/`, a symlink tree of
`web/linux` with the cpio, `host.mjs` and `renderer.mjs` replaced). The runner
`run-v2.mjs` reuses the V1 gate on ports 4211/9421, with headful Chromium and a
Vulkan Dawn adapter (NVIDIA maxwell). It reads `globalThis.__gpuProf` every 2 s.
The run `gate-webgpu-run1` passed (rotation, both phases, no page errors).
Instrumented FPS matched V1 within 3% (present 57-67, nopresent 178-191 per
5 s interval). Host load average was 0.7 to 2.6; the B2f agent may have been
running concurrently. WebGL2 was not measured.

## Per-frame cost sources

| Where | file:line (HEAD 8af39db) | Cost per frame |
|---|---|---|
| vkgears frame loop | `tests/vkgears/vkgears.c:499-522` render(): uniforms, record, submit, WaitIdle | record 0.01-0.03 ms |
| vkgears present | `vkgears.c:290-305` x11_present: 128->300 nearest upscale + RGBA->XRGB per pixel, XPutImage 360 KB, XSync | 4.0 ms |
| ICD submit | `tests/guest-vulkan/transfer.inc:327-460` execute_submit (calloc of prepared JSON, validation) | ~0.12-0.19 ms own CPU |
| Vertex upload | `graphics-commands.inc:238-249` sends all 2640x24 B every submit (static data) | 63.4 KB, 1 RT |
| Uniform upload | `graphics-commands.inc:250-260` | 0.8 KB, 1 RT |
| Pass | `transfer.inc:434` GRAPHICS_PASS JSON | 1.2 KB, 1 RT |
| Readback | `transfer.inc:441-442` GRAPHICS_READBACK + memcpy (+swap_rb) | 64 KiB back, 1 RT |
| Fences/idle | `transfer.inc:500, 581-582` guest-only, no host wait | ~0 |
| Transport | `tests/guest-gpu/guest-gpu.c:30` gpu_call: one synchronous RT per op; `dist/virtio/vsock.js:36` 2 KiB RX chunks | see below |
| Host loop | `tests/guest-gpu/host.mjs:175-466`, on the page main thread (`gputest.mjs:123-137`) | serial, one op at a time |
| Error scopes | `tests/guest-vulkan-graphics/renderer.mjs:406-425` checked(): 3 push + 3 awaited pop per op | 1.3 / 3.7 ms |
| Pass execution | `renderer.mjs:650-688` end(): bind groups per draw, submit, await onSubmittedWorkDone | 2.5 / 3.3 ms |
| Readback | `renderer.mjs:690-715`: new MAP_READ staging buffer each frame, submit, await mapAsync, repack, destroy | 2.6 ms + scopes |

## Measured breakdown (ms per frame, NVIDIA WebGPU, 128x128)

| | nopresent | present |
|---|---:|---:|
| Frame time (guest) | 5.23 | 16.8 |
| vsock round trips | 3 | 4 |
| Bytes guest->host | 65,367 | 65,387 |
| Bytes host->guest | 60 | 65,616 |
| Guest: record + ICD own CPU | 0.13 | 0.21 |
| Guest: send + receive on vsock | 0.22 | 0.40 |
| Guest: blocked waiting for host reply | 4.86 | 12.34 |
| Guest: x11_present | 0 | 4.0 |
| Host: idle, waiting for next guest request | 1.05 | 6.68 |
| Host: decode/validate + payload read + reply write | 0.41 | 0.70 |
| Host: encode (+bind groups) + writeBuffer | 0.13 | 0.20 |
| Host: queue.submit + await onSubmittedWorkDone (pass) | 2.54 | 3.31 |
| Host: readback staging create + submit + mapAsync + repack | 0 | 2.64 |
| Host: popErrorScope awaits (3 per op) | 1.27 | 3.70 |

Guest wait per op:

| Mode | VERTEX_UPLOAD | UNIFORM_UPLOAD | PASS | READBACK |
|---|---:|---:|---:|---:|
| nopresent | 0.76 | 0.57 | 3.44 | - |
| present | 1.79 | 0.78 | 4.78 | 5.01 |

The guest ICD itself is cheap, so `vkQueueWaitIdle` costs nothing. About 93%
of nopresent time and 73% of present time is the guest blocked on the host.
Most of that host time is awaited GPU-process round trips:
- `onSubmittedWorkDone` (2.5-3.3 ms for a tiny draw);
- `mapAsync`;
- 3 `popErrorScope` per op (0.3 ms each, and 1.05 ms around the staging-buffer
  create).

Presentation also slows the other ops. The pass goes from 3.47 to 4.38 ms and
the vertex scope pop from 0.32 to 0.84 ms. The host loop shares the page main
thread with framebuffer painting, and the GPU process is busier while it does
that work.

## Ranked optimisations

Savings are per frame. NP means nopresent; P means present.

1. **One error scope set per submit, or async error reporting.**
   - Saves NP ~1.2 ms (23%) and P ~3.6 ms.
   - Files: `renderer.mjs:406-425`, plus `host.mjs` to report deferred errors
     on the next reply or fence wait.
   - Zink conflicts: none in the guest. `host.mjs` is also being edited by B2f,
     so rebase after B2f.
2. **Pipelined fences.**
   - Reply to GRAPHICS_PASS right after `queue.submit`. Await completion only
     in a new FENCE_WAIT op (`vkWaitForFences`/`WaitIdle`) or before a
     readback map.
   - Saves NP ~2.5 ms (48%) and P ~2.5 ms (completion merges into `mapAsync`).
   - Needs a frames-in-flight cap.
   - Files: `renderer.mjs:650-688`, `host.mjs`, `transfer.inc:327-460`,
     `:500` (wait_fences) and `:581-582` (queue_idle/device_idle).
   - Zink conflict: this is the same work as **B2b blocking waits**. Implement
     it as B2b.
3. **Present path.**
   - Present at render size, or scale with a row-replicate memcpy instead of a
     per-pixel convert. Have the host emit BGRX, so `swap_rb` and the convert
     go away.
   - Use a persistent staging ring with async, one-frame-late `mapAsync`.
   - Saves P ~5 ms (x11 4.0 -> ~1.5; staging create, scopes and the map wait
     hidden).
   - Files: `vkgears.c:290-305` (app only, conflict-free),
     `renderer.mjs:690-715`, `host.mjs` GRAPHICS_READBACK and
     `transfer.inc:441-442`.
   - Zink conflict: the readback ring interacts with **B2f** mapped memory and
     with A6b WSI present.
4. **One round trip per submit.**
   - Batch the uploads, pass and readback into one SUBMIT message.
   - Saves NP ~0.7 ms and P ~1.0 ms: 2-3 fewer request/reply gaps of ~0.35 ms
     each.
   - Files: `transfer.inc:421-445`, `graphics-commands.inc:238-260`, the
     `guest-gpu.c` op enum and `host.mjs`.
   - Zink conflicts: same code as **B2f** buffers and **B2c** push constants
     (push data would ride in the batch). Do it after both.
5. **Dirty tracking for uploads.**
   - vkgears vertices never change after frame 1, but 63.4 KB is sent every
     frame.
   - Saves NP ~0.45 ms and P ~0.9 ms (the vertex op wait is 0.76 / 1.79 ms;
     part of that is counted under rank 1).
   - Files: `graphics-commands.inc:238-249` and the memory map/flush paths.
   - Zink conflict: strong overlap with **B2f suballocation**. Tracking must be
     per suballocated range, so build it into B2f's buffer layer (flush ranges
     or a shadow compare).
6. **Serve the GPU from a dedicated Worker.**
   - This isolates the host from main-thread framebuffer painting.
   - Saves P ~1 ms and NP ~0.2 ms.
   - Files: `gputest.mjs:107-150`, `host.mjs` and a vsock MessagePort bridge.
   - Zink conflicts: none in the guest.
7. **Bind group cache.**
   - Encode including `createBindGroup` costs only 0.07 ms, so this saves
     <0.05 ms.
   - Files: `renderer.mjs:666-671`.
   - Zink conflict: do it with **B2c**, since push constants via UBO and
     dynamic offsets change the cache key.
8. **Persistent host buffers.** Already in place: vertex and uniform buffers
   are created once, and `writeBuffer` costs 0.03-0.05 ms. No gain.

Projected results:
- Nopresent: 5.2 -> ~1.3 ms with ranks 1, 2, 4 and 5. GPU latency and the
  in-flight cap then set the bound.
- Present: 16.8 -> ~10.7 ms (~93 FPS) with ranks 1 and 2, and ~5.7 ms
  (~175 FPS, near softpipe's 202) after rank 3.

## Limits

- This is a single gate run. The figures are consistent across 16 five-second
  intervals and with V1, but there is no repeat run.
- The host per-op split for present comes from short snapshot windows next to
  phase changes; the guest numbers come from the steady intervals.
- The x11_present split (upscale versus XPutImage+XSync) was not measured.
- WebGL2 was not profiled.
