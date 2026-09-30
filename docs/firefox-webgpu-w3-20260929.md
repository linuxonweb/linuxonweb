# Firefox WebGPU W3: host wire decoder (2026-09-29)

Packet W3 of `docs/firefox-webgpu-design-20260929.md`. It provides a
host-side decoder for the GPU-owner Worker from W2. The decoder turns the
bincode `ByteBuf`s that Firefox 128's WebGPU child sends to `wgpu_server_*`
into JSON.

This packet is a host adapter only:

- No Firefox, wgpu or kernel source was edited.
- Nothing was promoted into `web/linux` images or deployed.

Supporting material:

- Compact evidence: `docs/evidence/firefox-webgpu-20260929/w3-decoder.json`.
- Task root: `/mnt/p6/build/firefox-webgpu-w3-20260929/`. It is ext4 on
  `/dev/nvme0n1p6`, and `TMPDIR`, `TMP`, `TEMP`, `CARGO_HOME` and
  `CARGO_TARGET_DIR` all pointed under it.

## Result

`gate-run3` **passes**:

- 21,098 checks, 0 failures, 0 traps.
- All 31 goldens decode to the expected JSON, with 1,286 field-level
  assertions. Every golden re-encodes byte-identically (`canonical: true`).
- 4,047 negative cases are rejected with a structured error. After each one,
  a canary golden decodes to identical text.
- 11,400 fuzz inputs never trap. They yielded 1,996 successful decodes and
  9,404 structured errors.

| Item | Value |
|---|---|
| Wasm | `decoder-build-run2/firefox-webgpu-decoder.wasm`, 377,315 bytes, SHA-256 `2f0c575b700a9220aea6365a60201f29600ff446c26eeeb78d703ccb11cd248e` |
| Toolchain | rustc 1.94.1 (e408947bf 2026-03-25), `wasm32-unknown-unknown`, opt-level 2, LTO, `panic=abort` |
| Imports | 0; validated with `wasm-validate --enable-all` |
| Resolved crates | all present in Firefox's `Cargo.lock` (SHA-256 `3a72a045...114d3f`), vendored `third_party/rust`, offline |
| Node | v22.22.2 |
| Compile / instantiate | 2.0 ms / 0.34 ms |
| Per-golden decode (median) | 2.1–83.6 us, mean 9.2 us, including JSON parse; the render pipeline is the slowest |
| 500k-command compute pass | 8.0 MB in, 10.5 MB JSON: Wasm decode, re-encode and serialize 63.6 ms; `JSON.parse` 218 ms; end to end 416 ms; memory grows to 105.5 MB |

Earlier runs are preserved:

- `gate-run1` failed only on the expected error substring. bincode says
  "Slice had bytes remaining", not "trailing".
- `gate-run2` passed. It showed a 2.0 s reviver-bound parse for the big pass,
  which led to the fast path described below.
- `decoder-build-run1` predates the float guard.

## Files

All new files are under `web/linux/tests/firefox-webgpu-decoder/`.

| File | Purpose |
|---|---|
| `Cargo.toml`, `src/lib.rs` | cdylib ABI: `alloc`, `free`, `decode(kind, ptr, len)`, `result_ptr`, `result_len`, `max_input` |
| `src/guard.rs` | validating `DeserializeSeed` wrapper; see [Guard](#guard) |
| `src/wire_dispatch.rs` | maps kind numbers to wire types |
| `adapters/js-sys`, `adapters/web-sys` | empty stand-ins so wgpu-core's wasm32 `web-sys` dependency resolves; Firefox itself patches these crates to its `dummy-web` crates |
| `build.py` | builds offline into `TASK/decoder-build-runN` |
| `decoder.mjs` | browser, Worker and Node wrapper: `createDecoder`, `KINDS`, `parseWireJson` |
| `make-goldens.py`, `golden-harness/`, `goldens/` | host-native golden generator plus 31 `.bin` files and `manifest.json` |
| `check.mjs` | the Node gate (`node check.mjs WASM OUT_DIR`) |

`build.py` assembles its workspace in the following steps:

1. Copy the decoder crate.
2. Generate `wire_generated.rs`, which contains 11 private
   `gfx/wgpu_bindings` items copied verbatim: `ErrorBufferType`,
   `SwapChainId`, `ImplicitLayout`, `DeviceAction`, `QueueWriteAction`,
   `TextureAction`, `BasePass`, `RecordedRenderPass`, `RecordedComputePass`,
   `RenderCommand` and `ComputeCommand`. The file is written only into the
   build workspace.
3. Copy Firefox's `Cargo.lock` and its `[patch]` tables.

The decoder uses wgpu-core, wgpu-types and wgpu-hal from Firefox's vendored
tree at wgpu rev `c7458638`.

Kinds, numbered 1 to 7:

| Kind | Name | Wire type |
|---|---|---|
| 1 | `DeviceAction` | `DeviceAction` |
| 2 | `CommandEncoderAction` | `wgc::device::trace::Command` |
| 3 | `RenderPass` | `RecordedRenderPass` |
| 4 | `ComputePass` | `RecordedComputePass` |
| 5 | `QueueWriteAction` | `QueueWriteAction` |
| 6 | `TextureAction` | `TextureAction` |
| 7 | `DeviceDescriptor` | `wgc::device::DeviceDescriptor` |

Status codes:

| Status | Meaning |
|---|---|
| 0 | ok |
| 1 | decode error |
| 2 | bad kind |
| 3 | input larger than 16 MiB |
| 4 | pointer out of bounds |

On success the output is
`{"ok":true,"kind":K,"canonical":B,"value":V}`. On failure it is
`{"ok":false,"kind":K,"error":"..."}`.

## How the goldens were produced

`make-goldens.py TASK native-run4` builds a host-native workspace:

- verbatim copies of Firefox 128.14.0esr `gfx/wgpu_bindings` and
  `xpcom/rust/nsstring`;
- a stub `static_prefs`, which only `server.rs` reads and which is never
  called;
- `golden-harness/`.

The harness calls the real client functions the content process uses:

- `wgpu_client_serialize_device_descriptor`;
- `wgpu_client_create_texture`, `wgpu_client_create_sampler` and the other
  `wgpu_client_*` creators;
- the `wgpu_command_encoder_*` functions;
- `wgpu_recorded_render_pass_*` and `wgpu_recorded_compute_pass_*`, then
  `wgpu_client_*_pass_finish`;
- `wgpu_queue_write_*`.

It uses layout-identical `#[repr(C)]` mirrors for descriptors that have
private fields, the same way the C++ cbindgen structs reach those functions.
The bytes therefore come from Firefox's own `make_byte_buf` and
`bincode::serialize` path.

Ids come from the real `IdentityHub`: each object is epoch 1 on the Vulkan
backend, and the indices are recorded in the manifest `ids` map.

One golden, `device-create-shader-module`, is different. Firefox 128 never
serializes `CreateShaderModule`, because shader modules and buffers use the
direct FFI calls `wgpu_server_device_create_shader_module` and
`wgpu_server_device_create_buffer`. That golden therefore comes from a mirror
of the `DeviceAction` enum. The mirror was checked by re-serializing
`CreateCommandEncoder` and `CreateSampler` and confirming the output is
byte-identical to the real client's.

`check.mjs` does not take its expected values from decoder output. It
transcribes them from three sources:

- the harness inputs;
- the manifest ids;
- `wgpu-types` constants: `Limits::default()` (34 fields), the
  `DEPTH_CLIP_CONTROL|TIMESTAMP_QUERY` feature bits (33), usage and
  shader-stage bits, and `ColorWrites::ALL`.

## Gate coverage (`check.mjs`)

Positive checks:

- All 31 goldens, compared field by field, with key sets checked at every
  object. They are also decoded by numeric kind and parsed through both the
  reviver and tokenizer paths.
- `multisample.mask = 18446744073709551615n` must arrive as a BigInt.
- Id boundaries that must decode: epoch 2^29-1, index 2^32-1, id (0,0,Vulkan),
  and backends 0 (Empty), 2 (Metal), 3 (Dx12) and 4 (Gl).
- Exactly 8 colour attachments.
- A finite `-0.0` pipeline constant.

Negative checks (4,047):

| Category | Cases |
|---|---|
| Truncation | every strict prefix of every golden: 3,933 |
| Trailing garbage | 1 byte and 7 bytes: 62 |
| Oversized | `alloc(max+1)`, `alloc(0)` and a 16 MiB+1 wrapper input give status 3; raw `decode(4, 8, 0xffffffff)` gives status 3 |
| Bad pointer | out-of-bounds and null pointers give status 4 |
| Bad kind | 0, 8, 9, `0x7fffffff`, `0xffffffff` and an unknown name give status 2 |
| Huge claimed lengths | 2^62, 2^64-1, 2^32 and 10^6 for Vec and label lengths; `string_data` 2^63; WGSL 2^64-1 |
| Bad enum tags | Command, `SerialId`, Option tag 2, `DeviceAction`, `ComputeCommand` 10, `QueueWriteAction`, `TextureAction` |
| Id guard | epoch 2^29 and 2^32-1; backend 5 and `0xffffffff`; the all-zero id; nested ids inside bind-group entries |
| Zero `BufferSize` | `SetVertexBuffer` and bind-group entry sizes |
| Colour attachments | 9 real, a claimed 9 with 8 present, a claimed 2^40 |
| UTF-8 | `0xff`, a lone continuation byte, overlong NUL, a surrogate, a truncated 2-byte sequence |
| Texture format | `rgba8unorz`, invalid UTF-8, empty string |
| Non-finite floats | f32 NaN and +Inf in sampler LOD; f64 -Inf in the clear colour; f64 NaN in a pipeline constant |

Fuzz: 300 seeded 1–4-byte mutations per golden, plus 300 random buffers of
0–256 bytes per kind. Each result must be status 0 or 1 with no trap.

## Design notes and divergences

- **Trailing bytes.** Firefox's `bincode::deserialize` ignores trailing
  bytes. The decoder uses
  `DefaultOptions::with_fixint_encoding().with_limit(len).reject_trailing_bytes()`,
  so it is stricter than Firefox.
  - The limit bounds every allocation to the input size, so huge claimed
    lengths fail instead of reserving memory.
  - The client always produces an exact-length `ByteBuf`, so rejecting
    trailing bytes loses nothing.
- <a id="guard"></a>**Guard (`src/guard.rs`).** wgpu-core's
  `SerialId -> RawId::zip` and `Backend` conversion would panic, which traps
  under `panic=abort`. The guard wraps every nested deserializer and checks
  each `SerialId` before replaying it. It rejects:
  - an epoch of 2^29 or more;
  - a backend above 4;
  - the all-zero id.
- **Non-finite floats.** The guard also rejects non-finite f32 and f64
  values. WebIDL WebGPU floats are restricted, and `serde_json` would
  otherwise turn them into `null`.
- **Canonical flag.** `canonical` re-serializes the decoded value with the
  same options and compares it to the input. All goldens are canonical.
- **JSON integers.** `u64` values above 2^53 are exact.
  - `parseWireJson` calls plain `JSON.parse` unless the text contains a run of
    16 or more digits.
  - If it does, it uses the `JSON.parse` source-text reviver (V8 11.4 and
    later, Firefox 135 and later).
  - Otherwise it falls back to a string-aware tokenizer.
  - The gate checks both slow paths on every golden. The fast path cut the
    big-pass parse from 2.07 s to 218 ms.
- **JSON shapes.**
  - An `Id` is `{"Id":[index,epoch,"Vulkan"]}`.
  - Unit variants are bare strings, for example `"PopDebugGroup"`.
  - `TextureFormat` and other wgpu-types enums use their WebGPU string names.
  - Bitflags are numbers.
  - Debug-group and marker strings in passes are `{color, len}` references
    into `string_data`, which is a byte array.
- **Extra exports.** wgpu-core's `bundle_ffi` defines 12 `#[no_mangle]`
  `wgpu_render_bundle_*` functions. They survive as exports. They are harmless,
  and the wrapper never calls them.
- **Not decoded here.** Three kinds of server payload are out of scope:
  - server-to-client `ByteBuf`s: `AdapterInformation` from
    `adapter_pack_info`, and `DropAction` from `*_free`;
  - the direct-FFI argument structs;
  - `QueueWriteAction` payload bytes, which travel separately as
    `data`/`data_length`.

## W4 plan / blockers

These are the Firefox 128.14.0 `gfx/wgpu_bindings/src/server.rs` exports that
C++ calls (`dom/webgpu/ipc/WebGPUParent.cpp`). They come from the 57
`wgpu_server_*` definitions in
`/mnt/p6/build/firefox-webgpu-w3-20260929/server-signatures.txt`.

The build is not LTO, so each one is an undefined C++ reference that
`-Wl,--wrap=` can redirect to `__wrap_<sym>` in an adapter object. The
`ErrorBuffer` type is `{ *mut ErrorBufferType, *mut c_char message, usize capacity }`,
passed by value.

**ByteBuf entry points. The W3 decoder covers these payloads:**

```
wgpu_server_adapter_request_device(global: &Global, self_id: AdapterId, byte_buf: &ByteBuf, new_id: DeviceId, error_buf: ErrorBuffer)   // kind 7
wgpu_server_device_action(global: &Global, self_id: DeviceId, byte_buf: &ByteBuf, error_buf: ErrorBuffer)                              // kind 1
wgpu_server_command_encoder_action(global: &Global, self_id: CommandEncoderId, byte_buf: &ByteBuf, error_buf: ErrorBuffer)             // kind 2
wgpu_server_render_pass(global: &Global, encoder_id: CommandEncoderId, byte_buf: &ByteBuf, error_buf: ErrorBuffer)                      // kind 3
wgpu_server_compute_pass(global: &Global, encoder_id: CommandEncoderId, byte_buf: &ByteBuf, error_buf: ErrorBuffer)                     // kind 4
wgpu_server_queue_write_action(global: &Global, self_id: QueueId, byte_buf: &ByteBuf, data: *const u8, data_length: usize, error_buf: ErrorBuffer) // kind 5
wgpu_server_texture_action(global: &Global, self_id: TextureId, byte_buf: &ByteBuf, error_buf: ErrorBuffer)                            // kind 6
```

**Direct-FFI entry points. W4 must marshal their argument structs itself:**

```
wgpu_server_new(owner: *mut c_void) -> *mut Global
wgpu_server_delete(global: *mut Global)
wgpu_server_poll_all_devices(global: &Global, force_wait: bool)
wgpu_server_instance_request_adapter(global: &Global, desc: &wgc::instance::RequestAdapterOptions, ids: *const AdapterId, id_length: usize, adapter_luid: Option<&FfiLUID>, error_buf: ErrorBuffer) -> i8
wgpu_server_adapter_pack_info(global: &Global, self_id: Option<AdapterId>, byte_buf: &mut ByteBuf)
wgpu_server_adapter_drop(global: &Global, adapter_id: AdapterId)
wgpu_server_device_destroy(global: &Global, self_id: DeviceId)
wgpu_server_device_drop(global: &Global, self_id: DeviceId)
wgpu_server_set_device_lost_callback(global: &Global, self_id: DeviceId, callback: wgc::device::DeviceLostClosureC)
wgpu_server_device_create_shader_module(global: &Global, self_id: DeviceId, module_id: ShaderModuleId, label: Option<&nsACString>, code: &nsCString, out_message: &mut ShaderModuleCompilationMessage, error_buf: ErrorBuffer) -> bool
wgpu_server_device_create_buffer(global: &Global, self_id: DeviceId, buffer_id: BufferId, label: Option<&nsACString>, size: BufferAddress, usage: u32, mapped_at_creation: bool, shm_allocation_failed: bool, error_buf: ErrorBuffer)
wgpu_server_buffer_map(global: &Global, buffer_id: BufferId, start: BufferAddress, size: BufferAddress, map_mode: wgc::device::HostMap, callback: wgc::resource::BufferMapCallbackC, error_buf: ErrorBuffer)
wgpu_server_buffer_get_mapped_range(global: &Global, buffer_id: BufferId, start: BufferAddress, size: BufferAddress, error_buf: ErrorBuffer) -> MappedBufferSlice
wgpu_server_buffer_unmap(global: &Global, buffer_id: BufferId, error_buf: ErrorBuffer)
wgpu_server_buffer_destroy(global: &Global, self_id: BufferId)
wgpu_server_buffer_drop(global: &Global, self_id: BufferId)
wgpu_server_get_device_fence_handle(global: &Global, device_id: DeviceId) -> *mut c_void
wgpu_server_device_create_encoder(global: &Global, self_id: DeviceId, desc: &wgt::CommandEncoderDescriptor<Option<&nsACString>>, new_id: CommandEncoderId, error_buf: ErrorBuffer)
wgpu_server_encoder_finish(global: &Global, self_id: CommandEncoderId, desc: &wgt::CommandBufferDescriptor<Option<&nsACString>>, error_buf: ErrorBuffer)
wgpu_server_encoder_drop(global: &Global, self_id: CommandEncoderId)
wgpu_server_render_bundle_drop(global: &Global, self_id: RenderBundleId)
wgpu_server_encoder_copy_texture_to_buffer(global: &Global, self_id: CommandEncoderId, source: &wgc::command::ImageCopyTexture, dst_buffer: BufferId, dst_layout: &crate::ImageDataLayout, size: &wgt::Extent3d, error_buf: ErrorBuffer)
wgpu_server_queue_submit(global: &Global, self_id: QueueId, command_buffer_ids: *const CommandBufferId, command_buffer_id_length: usize, error_buf: ErrorBuffer) -> u64
wgpu_server_on_submitted_work_done(global: &Global, self_id: QueueId, callback: wgc::device::queue::SubmittedWorkDoneClosureC)
wgpu_server_compute_pipeline_get_bind_group_layout(global: &Global, self_id: ComputePipelineId, index: u32, assign_id: BindGroupLayoutId, error_buf: ErrorBuffer)
wgpu_server_render_pipeline_get_bind_group_layout(global: &Global, self_id: RenderPipelineId, index: u32, assign_id: BindGroupLayoutId, error_buf: ErrorBuffer)
wgpu_server_{bind_group_layout,pipeline_layout,bind_group,shader_module,compute_pipeline,render_pipeline,sampler,texture_view}_drop(global: &Global, self_id: <Id>)
wgpu_server_texture_destroy(global: &Global, self_id: TextureId)
wgpu_server_texture_drop(global: &Global, self_id: TextureId)
```

**Do not wrap:**

- `wgpu_server_*_free(id, drop_byte_buf: &mut ByteBuf)`, for adapter, device,
  shader_module, pipeline_layout, bind_group_layout, bind_group,
  command_buffer, render_bundle, render_pipeline, compute_pipeline, buffer,
  texture, texture_view and sampler. These are pure: they take no `Global` and
  only serialize a `DropAction` back to the child.
- `wgpu_server_use_external_texture_for_swap_chain`,
  `wgpu_server_ensure_external_texture_for_swap_chain` and
  `wgpu_server_get_external_texture_handle`. These are C++ functions that
  Rust calls, not wrap targets. They matter for presentation in W6 and later.

**W4 blockers and decisions:**

1. **`adapter_pack_info` goes the other way.** It must write a bincode
   `AdapterInformation<String>`: id, 34-field `Limits`, `Features`, name,
   vendor, device, `DeviceType`, driver, driver_info and `Backend`, followed
   by a trailing `u64` 0 when there is no adapter. The decoder only decodes.

   Recommendation: build this `ByteBuf` in the guest wrapper, in Rust linked
   into Firefox, by calling `bincode` on the real type. Fill it from host
   adapter limits and features returned through `gpu_hostcall`. The
   alternative is to add an encode kind to this crate.
2. **Callbacks.** `BufferMapCallbackC`, `DeviceLostClosureC` and
   `SubmittedWorkDoneClosureC` are C function pointers plus `user_data`. The
   wrapper must queue them host-side and invoke them on the parent thread
   inside `__wrap_wgpu_server_poll_all_devices`, as the design specifies.
3. **Mapped memory.** `buffer_get_mapped_range` returns
   `MappedBufferSlice { ptr, length }` into memory Firefox then reads or
   writes through shmem.

   The wrapper needs a guest-side staging allocation per mapped range. It must
   be copied from the host at map time, and copied back at `unmap` for WRITE
   maps. The `shm_allocation_failed` and `mapped_at_creation` semantics must
   be kept.
4. **Direct-FFI structs.** The wrapper serializes these into its own
   hostcall message, not the Firefox wire format:
   - `RequestAdapterOptions`, `CommandEncoderDescriptor`,
     `CommandBufferDescriptor`, `ImageCopyTexture` and `ImageDataLayout`;
   - `nsACString` labels and `nsCString` WGSL.
5. **Errors.** Each wrapped call must fill `ErrorBuffer` (type plus
   NUL-terminated message truncated to capacity) from the host result.
   WebGPU validation is asynchronous on the host, so W4 needs a policy.
   Options:
   - surface host validation errors on the next poll, through device-lost or
     `uncapturederror`;
   - make `device_action` round trips synchronous.

   W4 tests should pin which one is used.
6. **Trailing-bytes strictness.** If a future Firefox client ever appends
   padding, the decoder rejects it where Firefox would accept it. The 128
   client always sends exact-length buffers, so W4 can treat any status 1 as
   a client/wire bug.
7. **Id mapping.** Firefox ids are `(index, epoch, backend)`; the goldens use
   the Vulkan backend. The host executor must key its WebGPU objects by the
   full id triple. It must also reject reuse of a live id with a different
   epoch, because the guard only checks id ranges.
