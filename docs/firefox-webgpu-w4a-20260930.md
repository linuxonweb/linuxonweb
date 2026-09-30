# Firefox WebGPU W4a: host wgpu executor over gpu_hostcall (2026-09-30)

Packet W4a of `docs/firefox-webgpu-design-20260929.md`. It adds the host half of the
Firefox WebGPU passthrough: a WebGPU executor in the GPU-owner Worker. The executor
serves the `wgpu_server_*` operations that the guest wrapper will forward (W4b). It is
reached through a new gpu_hostcall op family, `0x10` (WGPU), on the W2 channel
(`docs/firefox-webgpu-w2-20260929.md`). Serialized ByteBufs go through the W3 decoder
(`docs/firefox-webgpu-w3-20260929.md`).

An actual Linux guest (1 GiB, 2 CPUs) passes **102/0** checks on the physical NVIDIA
GPU:
- adapter "nvidia maxwell", PCI vendor 0x10de, not a fallback adapter;
- Firefox-encoded device descriptor, 2 devices, 5 buffers;
- queue write 256 bytes, then copyBufferToBuffer, submit, map READ, and exact bytes;
- mapped_at_creation and map WRITE paths with write-back;
- stale-epoch and invalid-id errors, work-done, device destroy -> lost on poll;
- host object counts zero at the end.

The W2 channel regression still passes (150/0). Firefox itself is not relinked yet (W4c).

## Files

- `web/linux/dist/guest-gpu-wgpu.js` (new, 920 lines): the executor, the message codec and the id tables.
- `web/linux/dist/guest-gpu-owner.js` (+6 lines): `case OP_WGPU` in `serve()`.
  - It runs `handleWgpuCall(memory, a)`.
  - It completes with `completeWith(slot, seq, write)`, so a response is written only while the caller still waits.
- `web/linux/tests/firefox-webgpu-executor/`:
  - `wgpu-executor-test.c`: the guest test.
  - `build.py`: `--expect-vendor`; pins the runtime, decoder module and decoder wasm hashes.
  - `run-guest.mjs`: finite server 127.0.0.1:4201 + headful Chromium CDP 9411.
  - `index.html`.
- `web/linux/tests/guest-gpu-hostcall/{build.py,run-guest.mjs}`: optional `GPUHC_TASK` / `GPUHC_HTTP_PORT` /
  `GPUHC_CDP_PORT` environment overrides (defaults unchanged). They let W2 regress under another task and ports.

Decoder wasm: `getDecoder()` fetches `firefox-webgpu-decoder.wasm` next to the module, at
`web/linux/dist/firefox-webgpu-decoder.wasm`.
- That binary is **not in the repo yet**.
- The W4a runner serves that route from the hash-pinned W3 artifact
  `/mnt/p6/build/firefox-webgpu-w3-20260929/decoder-build-run2/firefox-webgpu-decoder.wasm`
  (SHA-256 `2f0c575b…cd248e`).
- W4c must ship it with the runtime (or `main.js` must serve it).
- The decoder module is imported lazily from `../tests/firefox-webgpu-decoder/decoder.mjs`. W4c should move it under `dist/`.

## Message format (version 1, little-endian)

Hostcall: `gpu_hostcall(0x10, req_ptr, req_len, resp_ptr, resp_cap, resp_len_out)`.

Request:

| offset | field |
|---|---|
| 0 | u32 magic `'WGQ1'` = 0x31514757 |
| 4 | u16 version = 1 |
| 6 | u16 call |
| 8 | u32 payload_len (multiple of 8; `16 + payload_len == req_len`) |
| 12 | u32 reserved = 0 |
| 16 | payload_len/8 × u64 arguments |

Response (written to `resp_ptr`; total length stored as u32 at `resp_len_out`):

| offset | field |
|---|---|
| 0 | u32 magic `'WGR1'` = 0x31524757 |
| 4 | u16 version = 1 |
| 6 | u16 call (echo) |
| 8 | u32 error_type (Firefox `ErrorBufferType`: 0 None, 1 DeviceLost, 2 Internal, 3 OutOfMemory, 4 Validation) |
| 12 | u32 payload_len (multiple of 8) |
| 16 | u32 message_len |
| 20 | u32 reserved |
| 24 | payload: u64 fields; strings are u64 length + bytes padded to 8 |
| 24+payload_len | UTF-8 error message (no NUL) |

Hostcall return value:
- `> 0`: total response bytes.
- `-ENOSPC`: `resp_len_out` holds the needed size. The call **was executed**; only its response is lost, so callers size buffers up front (the largest fixed response is pack_info, < 2 KiB).
- `-EINVAL`: bad header, unknown call or missing argument.
- `-EFAULT`: bad request/response/length pointer, including `resp_len_out == 0`.
- Other W2 transport errnos: `-ENODEV`, `-EIO`, `-EINTR`, `-EAGAIN`.

Transport errors have no side effects. WebGPU/wgpu errors are **not** errnos; they come back in error_type + message.

Ids are full Firefox wgpu ids: `index | epoch << 32 | backend << 61` (u64). Each kind
(adapter, device, buffer, command encoder, command buffer) has one table per Global keyed by index:
- Creating on a live index is a Validation error: "already in use", or "reused with epoch X while epoch Y is live".
- Looking up an absent index is Validation "invalid <kind> id".
- A live index with a different epoch/backend is Validation "stale <kind> id".
- Ids inside ByteBufs (`SerialId::Id(index, epoch, backend)`) go through the same tables.

### Calls

| # | call | u64 arguments | payload |
|---|---|---|---|
| 1 | SERVER_NEW | – | [handle] |
| 2 | SERVER_DELETE | g | – (destroys all devices/buffers) |
| 3 | INSTANCE_REQUEST_ADAPTER | g, power_pref (1 low-power, else high-performance), force_fallback, adapter_id | [found 0/1] |
| 4 | ADAPTER_PACK_INFO | g, adapter | see below |
| 5 | ADAPTER_REQUEST_DEVICE | g, adapter, device_id, desc_ptr, desc_len (ByteBuf, W3 kind DeviceDescriptor) | – |
| 6 | ADAPTER_DROP | g, adapter | – |
| 7 | DEVICE_CREATE_BUFFER | g, device, buffer_id, size, usage, mapped_at_creation, label_ptr, label_len | – |
| 8 | BUFFER_MAP | g, buffer, start, size, mode (1 READ / 2 WRITE), callback, user_data | – (event later) |
| 9 | BUFFER_GET_MAPPED_RANGE | g, buffer, start, size, dst_ptr | [size]; bytes copied to dst |
| 10 | BUFFER_UNMAP | g, buffer, src_ptr (0 = no write-back), start, size | – |
| 11 | BUFFER_DESTROY | g, buffer | – |
| 12 | BUFFER_DROP | g, buffer | – (also destroys the GPU buffer) |
| 13 | DEVICE_CREATE_ENCODER | g, device, encoder_id, label_ptr, label_len | – |
| 14 | COMMAND_ENCODER_ACTION | g, encoder, ptr, len (ByteBuf CommandEncoderAction) | – |
| 15 | ENCODER_FINISH | g, encoder, label_ptr, label_len | – (command buffer takes the encoder id) |
| 16 | ENCODER_DROP | g, id | – (encoder or command buffer) |
| 17 | QUEUE_WRITE_ACTION | g, device, ptr, len (ByteBuf QueueWriteAction), data_ptr, data_len | – |
| 18 | QUEUE_SUBMIT | g, device, ids_ptr (u64[]), count | [submission index] |
| 19 | QUEUE_ON_SUBMITTED_WORK_DONE | g, device, callback, user_data | – (event later) |
| 20 | DEVICE_SET_LOST_CALLBACK | g, device, callback, user_data | – |
| 21 | POLL_ALL_DEVICES | g, force_wait | [count, still_queued, count × event] |
| 22 | DEVICE_DESTROY | g, device | – (lost event later, reason Destroyed) |
| 23 | DEVICE_DROP | g, device | – (releases its buffers/encoders; lost reason Dropped) |
| 24 | DEVICE_ACTION | g, device, ptr, len (ByteBuf DeviceAction) | – |
| 25 | STATS | g or 0 (all) | [globals, adapters, devices, buffers, encoders, command buffers, pending, queued events, mapped buffers, calls, errors, events dropped] |

ADAPTER_PACK_INFO payload has three parts.
- First: `[34, 34 × limit (wgt::Limits order, LIMIT_FIELDS), feature_bits, pci_vendor, pci_device(0), device_type, backend, is_fallback]`.
- Then 7 strings: name, driver, driver_info, vendor, architecture, description, and the comma-joined WebGPU feature names.
- Details:
  - The feature bits follow `wgt::Features` for the WebGPU features (FEATURE_BITS).
  - pci_vendor comes from the vendor string (nvidia 0x10de, amd, intel, …).
  - device_type is 4 Cpu for fallback, 1 for intel, otherwise 2. This is a heuristic: WebGPU hides the device type.
  - The name is `description` or `"vendor architecture"`.

POLL event = `kind, id, status, callback, user_data, message(string)`:
- kind 1 BUFFER_MAP (status 0 success, 3 error, 4 aborted, 5 context lost);
- kind 2 WORK_DONE;
- kind 3 DEVICE_LOST (status 0 unknown, 1 destroyed, 2 dropped);
- kind 4 UNCAPTURED_ERROR (status = ErrorBufferType).

callback/user_data are echoed exactly, so the W4b wrapper can call the Firefox C callbacks in the guest.

A poll without force_wait yields one host task turn, so resolved promises run. force_wait waits up to 5 s for every live device queue and every pending map/work-done promise. At most 4096 events are returned per poll; 65,536 can be queued, and the rest are counted as dropped.

ByteBuf actions executed in W4a:
- DeviceAction: `CreateCommandEncoder`.
- CommandEncoderAction: `CopyBufferToBuffer`, `ClearBuffer`, `Push/PopDebugGroup`, `InsertDebugMarker`.
- QueueWriteAction: `Buffer`.

Other decoded variants return Internal "W4a does not execute …" (render/compute passes, textures, pipelines are W5+).

## Error policy (pinned)

1. **Synchronous per call.** Every device-side call runs inside `pushErrorScope` internal, out-of-memory and validation scopes. They are popped before the call returns. The first captured error becomes that call's error_type + message, so the wrapper can fill Firefox's `ErrorBuffer` directly. Uncaptured errors outside a call (e.g. from `mapAsync` range validation) are queued as UNCAPTURED_ERROR events.
2. **Error ids are bound, like wgpu-core.** A failed `createBuffer` or `finish` still inserts the id as an invalid object. The guest can then drop it normally, and later uses fail with Validation "… is invalid". Submitting an invalid command buffer consumes it and returns Validation.
3. **Encoder errors surface at finish.** WebGPU defers command-encoder validation to `finish()`, while wgpu-core reports it per command. Example: a 250-byte copy is accepted by COMMAND_ENCODER_ACTION and fails at ENCODER_FINISH with "Copy size (250) is not a multiple of 4". Firefox already reports errors on the device's error sink, so this changes only which call reports them.
4. **Device loss.** After the lost promise fires, calls on that device return DeviceLost ("device … is lost: …"). The lost event is delivered once on POLL with the callback registered by DEVICE_SET_LOST_CALLBACK. Pending maps on a lost device complete with status 5 (context lost).
5. **Transport vs. API.** Malformed ByteBufs (decoder status ≠ 0) are Validation "malformed <kind> byte buffer". Unknown calls, missing arguments and bad headers are `-EINVAL` with no side effects.
6. **Mapping.** get_mapped_range copies host bytes into guest memory only in the response commit, i.e. only if the caller still waits. Write-back at unmap is accepted only for a WRITE mapping and only for a `start:size` range previously returned by get_mapped_range. A READ mapping rejects write-back ("write-back into a READ mapping"). mapped_at_creation buffers are WRITE mappings.
7. **Queue write data.** Guest memory is passed directly to `writeBuffer` as a SharedArrayBuffer view (Chromium snapshots it at call time, verified in W2). The test clears its source buffer right after the call and still reads the original bytes back.
8. **Multiple devices per adapter.** A GPUAdapter yields one device, but wgpu adapters yield many. The executor requests a fresh host adapter with the same options for each additional device. Required limits are sent only when better than the WebGPU defaults. Required features must map to WebGPU names and be on the adapter; otherwise the call returns Validation.

## Results

Task root `/mnt/p6/build/firefox-webgpu-w4a-20260930` (ext4, TMPDIR under `tmp/`).
- Host: headful Chromium `/home/a/.local/archpkg/pacman/usr/bin/chromium`, `DISPLAY=:0`, with `--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist`.
- Adapter request: high-performance, PRIME variables removed.

| run | result |
|---|---|
| `build-run1` | wasm32 guest test 90,206 bytes, SHA-256 `bc288ddd…bcc55559`, `-Wall -Wextra -Werror`; test initramfs 40,586,052 bytes (`6c442a05…814d0ba`), only `init` changed + one binary added |
| `guest-run1` | **pass: 102 checks, 0 failures**, guest exit 0, 1 GiB / 2 CPUs verified from kernel lines, browser exit 0, server closed, no page exceptions; 3.9 s page time |
| `w2-regress-build-run1` / `w2-regress-guest-run1` | W2 gpu_hostcall suite rebuilt against the modified owner: **150/0** (same count as W2), 10,000-call latency p50 20 µs / p99 65 µs |

Adapter reported to the guest:
- name "nvidia maxwell", vendor `nvidia`, architecture `maxwell`, PCI vendor 0x10de, device type 2, fallback 0;
- maxBufferSize 4,294,967,292, maxTextureDimension2D 16384, maxStorageBufferBindingSize 2,147,483,644;
- feature bits 0x140000000000767 (10 wgt feature bits set). Chromium hides the description string.
- Note: `guest-run1/result.json` parsed the hex `pci_vendor`/`features_bits` fields as 0 (runner parse bug; the pass check uses the vendor string). The values above come from the recorded guest line.

Coverage of the 102 checks (see `wgpu-executor-test.c`):
- Transport: NULL/short/mismatched requests, bad magic/version, unknown call, missing argument, NULL response/len pointers, and ENOSPC with the needed length.
- Hand-built bincode for CopyBufferToBuffer, QueueWriteAction::Buffer and CreateCommandEncoder is byte-identical to the W3 Firefox-encoded goldens.
- Adapter request, duplicate/other-epoch adapter id, stale/invalid adapter on pack_info, 34 limits and real values.
- Device from the W3 golden `wgpu_client_serialize_device_descriptor` bytes (features patched to 0; the golden asks for timestamp-query, which is fine on NVIDIA but not needed here). Rejections: an unmappable feature bit, a truncated descriptor, an invalid adapter, a duplicate device id. A second device comes from the same adapter.
- Buffers:
  - other-epoch reuse and an invalid device are rejected;
  - MAP_READ|MAP_WRITE returns a synchronous Validation error with Dawn's message, and its id stays bound.
- queue write 256 known bytes:
  - a stale buffer epoch and a malformed ByteBuf are rejected;
  - copy src→dst (encoder from a DeviceAction ByteBuf), submit (index 1), map READ, one poll, event echoes callback/user_data, exact 256 bytes, unmap.
- mapped_at_creation MAP_WRITE:
  - zeroed range, write-back on unmap, and unmap when not mapped is rejected;
  - copy (DEVICE_CREATE_ENCODER path) and exact bytes.
- map WRITE:
  - a second map while pending is rejected;
  - force_wait poll, write-back, copy and exact bytes.
- READ mapping write-back is rejected. An out-of-range map completes via the event with status 3 plus an uncaptured validation event.
- Deferred encoder error at finish. Submitting the invalid command buffer is rejected. Copy to an invalid buffer id is rejected, as are ops on a dropped encoder, a stale buffer map and get_mapped_range on an invalid buffer.
- Work-done event echoes callback/user_data. Buffer destroy/drop, double drop rejected, index reuse with a new epoch.
- Dropping device 2 gives a lost event with reason Dropped. Device destroy gives DEVICE_LOST with reason Destroyed plus the registered callback 0x1234/0x5678. A call on the lost device returns DeviceLost. Device drop releases its remaining buffer, then adapter drop.
- End state: STATS shows 0 adapters, devices, buffers, encoders, command buffers, pending, queued events and mappings, and 0 dropped. After SERVER_DELETE: 0 globals, and the deleted global is rejected.

Mean round trip over the 99 API calls is 1.23 ms. This includes adapter/device creation (23/24 ms), force-wait polls and map completions; it is not a hot-path benchmark. The W2 null-call latency (20 µs p50) is the channel floor.

## Limitations

- **No Firefox integration yet.** Nothing in the guest Firefox calls op 0x10; the relinked binary still has the Empty HAL. This packet provides and tests the host side and message format only.
- Only the actions listed above are executed. There are no textures, render/compute passes, bind groups, pipelines, shader modules, samplers, query sets, presentation or `adapter_pack_info` Rust bincode.
- The decoder wasm is served by the test runner from the W3 build dir, not shipped in `web/linux/dist`.
- PCI device id is always 0 and the device type is heuristic (WebGPU hides both). Chromium hides the description, so the adapter name is "vendor architecture".
- Encoder validation errors arrive at finish, not per command (documented policy 3).
- The executor runs on the single GPU-owner Worker. Every call awaits its error scopes, so throughput is bounded by host round trips; W4b should batch where Firefox already batches (ByteBuf actions).
- The mid-call owner loss/respawn path is the W2 mechanism (-ENODEV/-EIO). W4a adds no respawn-specific test, and all executor state (globals, ids) is lost with the owner.

## Next packets

- **W4b guest wrapper.** `--wrap`-style `__wrap_wgpu_server_*` forwarders in a guest shim library build this message format and call op 0x10. They also pack `adapter_pack_info` in Rust bincode (the `AdapterInformation<nsString>` layout Firefox's parent reads) from the ADAPTER_PACK_INFO payload. `wgpu_server_poll_all_devices` drains POLL events into the Firefox C callbacks (map, work done, device lost, uncaptured errors). The ErrorBuffer is filled from error_type/message.
- **W4c Firefox relink and fixture gate.**
  - Relink Firefox with the wrapper.
  - Ship `firefox-webgpu-decoder.wasm` + `decoder.mjs` under `web/linux/dist`.
  - Run the guest Firefox WebGPU check page: `requestAdapter()` returns the NVIDIA adapter, then buffer write/copy/map readback in page JS.
  - Keep startup/update regressions.
- Then W5+: textures, shader modules via WGSL passthrough, render/compute passes and presentation (design doc W5-W9).
