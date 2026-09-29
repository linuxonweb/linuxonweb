# Firefox WebGPU in the guest: research and design — 2026-09-29

Status: research and design only. Nothing in this document was built or run
in a browser. All evidence comes from reading the deployed rootfs, the
preserved build tree and the vendored sources. Scratch data is under
`/mnt/p6/build/firefox-webgpu-research-20260929` (ext4).

Question from the user: can guest Firefox's `navigator.gpu` pass straight
through to the host browser's WebGPU? Is that better than the chain
wgpu → Vulkan → guest ICD → host WebGPU?

**Answer:** yes, it is feasible, and it is the better route. The pass-through
belongs at Firefox's `wgpu_server_*` FFI boundary (route b below). The guest
keeps Firefox's DOM, IPC, client-side validation and canvas readback
presentation unchanged. The host executes the equivalent WebGPU calls and
performs the authoritative validation. Two prerequisites are required:

- a guest mmap-shim coherence fix;
- a rebuild with the release-channel WebGPU gates removed.

## 1. Is WebGPU compiled into the current guest Firefox?

The inputs inspected:

- Deployed rootfs: `web/linux/initramfs-firefox.cpio.gz`, 88,378,850 bytes,
  SHA-256 `d3d9afca272947ba1b6bb743585a6f0cf33de90c54adff1cd85b5c5bf9d8002b`.
- Its `opt/firefox/firefox`: 157,421,037 bytes, SHA-256
  `644ab48f01a8a588706d1ec1c3a97006469964c705edc0f5d599286c890c610f`.
  It has 513,810 functions and no name section; the binary is stripped and
  fpcast-processed.
- Panic paths in that binary point to the build tree
  `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/var/nix/builds/nix-721784-2625232085/build/firefox-128.14.0`
  (called `$FF` below). It uses objdir `obj-wasm-browser`.

### What is compiled

| Component | Present? | Evidence |
|---|---|---|
| `dom/webgpu` C++ | yes | `obj-wasm-browser/dom/webgpu/Unified_cpp_dom_webgpu{0,1,2}.o` |
| PWebGPU IPDL | yes | `ipc/ipdl/PWebGPU{,Child,Parent,Types}.cpp` |
| `wgpu_bindings` (client + server) | yes | `libgkrust.a` exports 57 `wgpu_server_*` and 38 `wgpu_client_*` T symbols (list: scratch `gkrust-wgpu-exports.txt`) |
| wgpu-core, wgpu-types, naga | yes | rlibs in `wasm32-unknown-linux-musl/release/deps`; strings such as "Identifier refers to disabled backend feature" are in the deployed binary |
| wgpu-hal backends | **Empty only** | `deps/wgpu_hal-*.d` lists only `src/{lib.rs,empty.rs,auxil/mod.rs}` |

Why only the Empty backend:

- The hal fingerprint features are `device_lost_panic, internal_error_panic,
  oom_panic, vulkan, windows_rs`.
- However, `wgpu-hal/build.rs` sets `vulkan: all(not(target_arch = "wasm32"),
  feature = "vulkan")`, and gles is not enabled.
- Patch `0023-wasm-wgpu-empty-backend.patch` edits wgpu-core `gfx_if_empty` so
  that it compiles on wasm32. Its comment reads: "runtime will use the stub HAL".
- `empty.rs` `enumerate_adapters` returns `Vec::new()`.

Build configuration:

- mozconfig: `--target=wasm32-unknown-linux-musl --disable-jit --disable-lto
  --disable-release --disable-webrtc --disable-sandbox`.
- Despite `--disable-release`, `config.status` has `RELEASE_OR_BETA: '1'`, and
  `mozilla-config.h:142` has `#define RELEASE_OR_BETA 1`. The ESR milestone
  is not nightly.

### Why WebGPU cannot be enabled today by prefs

1. `dom/webgpu/Instance.cpp` `Instance::RequestAdapter` begins with
   `#ifdef RELEASE_OR_BETA if (true) { reject "WebGPU is not yet available in
   Release or Beta builds." }`.
   - That string is in the deployed binary (strings line 286680).
   - The strings after it are absent: "WebGPU is disabled by blocklist" and
     "Failed to create WebGPUChild". The request path was removed as dead code.
2. `gfx/thebes/gfxPlatform.cpp:3158` `InitWebGPUConfig` has `#ifdef
   RELEASE_OR_BETA feature.ForceDisable(... "WEBGPU_DISABLE_RELEASE_OR_BETA")`.
   This sits at the runtime level, so `gfx.webgpu.ignore-blocklist` cannot
   override it. It feeds `gfxVars::AllowWebGPU`.
3. `dom.webgpu.enabled` defaults to `@IS_NIGHTLY_BUILD@`, which is false.
   `Navigator.webidl:80` exposes `gpu` only via `Instance::PrefEnabled`, with
   `SecureContext` and `Exposed=(Window, DedicatedWorker)`.
4. Even with the gates removed, the Empty HAL returns no adapter. wgpu-core's
   `Instance` has no Empty slot, so `requestAdapter` resolves to `null`.

**Conclusion:** you cannot enable WebGPU with a pref or by patching the
binary. A rebuild is required.

- **Minimal justified upstream hook:** two `#if defined(RELEASE_OR_BETA) &&
  !defined(__wasm__)` changes, one in Instance.cpp and one in gfxPlatform.cpp.
- **Prefs, via packed user.js/greprefs:**
  - `dom.webgpu.enabled=true`
  - `gfx.webgpu.ignore-blocklist=true`
  - optionally `dom.webgpu.workers.enabled`

### Single-process behaviour

Patch 0025 makes `BrowserTabsRemoteAutostart()` false.

`CanvasManagerChild::Get()` does the following:

- It takes `CompositorManagerChild::GetOtherPid()`, which is its own pid
  in-process.
- It creates `PCanvasManager` endpoints and calls `CreateParent`.
- `GetWebGPUChild()` sends the `PWebGPU` constructor.

As a result, `WebGPUParent` runs in the same process on the canvas/compositor
thread. The IPC structure itself works in-process.

**Blocking defect: shared memory is incoherent.**

- `DeviceCreateBuffer` and `QueueWriteAction` pass an
  `UnsafeSharedMemoryHandle`. The child uses `CreateAndMap`; the parent calls
  `WritableSharedMemoryMapping::Open` on the same fd.
- The Firefox mmap shim (`tools/wasm/userspace/firefox/shim/mmap-shim.c`, 143
  lines, nix source snapshot) implements file-backed `mmap` as
  `posix_memalign` + `pread`. That makes a private copy even for `MAP_SHARED`.
- So the child and the parent see different bytes: mapped writes, `writeBuffer`
  payloads and readbacks would all be lost.

This is the same root cause as the DevTools `cpmm` incoherence
(`docs/firefox-devtools-20260928.md`) and as patch 0037's MemMapSnapshot
workaround. It is fixed in the shim (packet W0), not in Firefox.

## 2. Firefox 128 WebGPU architecture (as built for the guest)

```
content JS  navigator.gpu / GPUDevice ...           (dom/webgpu/*.cpp, WebIDL)
   |  client-side id allocation + descriptor serialization
   v
WebGPUChild  (dom/webgpu/ipc/WebGPUChild.cpp)
   |  wgpu_client_* (client.rs, command.rs): bincode ByteBufs of
   |  DeviceAction / TextureAction / CommandEncoderAction / RenderPass /
   |  ComputePass / QueueWriteAction; raw ids allocated on the client
   v
PWebGPU IPC (PWebGPU.ipdl, managed by PCanvasManager) -- in-process here
   v
WebGPUParent (dom/webgpu/ipc/WebGPUParent.cpp, 1582 lines, canvas thread)
   |  47 distinct wgpu_server_* calls; error scopes live HERE in C++
   |  (mErrorScopeStackByDevice, ReportError); 100 ms timer -> MaintainDevices
   v
wgpu_bindings server.rs (60 wgpu_server_* fns incl. C++ callbacks)
   |  bincode::deserialize -> wgc::global::Global methods
   v
wgpu-core (validation, tracking, naga WGSL front-end)
   v
wgpu-hal  -> Empty (guest)  => zero adapters
```

Key parent entry points and their FFI calls:

| Parent handler | Line | FFI |
|---|---|---|
| ctor | 216 | `wgpu_server_new`, timer → `MaintainDevices` → `wgpu_server_poll_all_devices(false)` (226) |
| `RecvInstanceRequestAdapter` | 295 | `instance_request_adapter`, `adapter_pack_info` (bincode `AdapterInformation` back to child) |
| `RecvDeviceCreateBuffer` | 444 | `device_create_buffer` + shmem mapping |
| `MapCallback` | 523 | `buffer_get_mapped_range` → copy into shmem |
| `RecvBufferMap` / `Unmap` | 579 / 626 | `buffer_map` (callback), `buffer_unmap` (flush shmem → mapped range) |
| `RecvQueueSubmit` | 751 | `queue_submit` |
| `RecvQueueWriteAction` | 798 | `queue_write_action(bytebuf, shmem ptr, len)` |
| `RecvDeviceCreateShaderModule` | 899 | `device_create_shader_module` (WGSL `nsCString` → compilation messages) |
| `RecvDeviceCreateSwapChain` | 853 | readback buffers allocated by parent |
| `RecvSwapChainPresent` | 1122 | `encoder_copy_texture_to_buffer`, `queue_submit`, `buffer_map` → `ReadbackPresentCallback` (957) |
| `RecvDevicePushErrorScope` / `Pop` | 1399 / 1423 | pure C++ |
| (shutdown) | 1322 | `poll_all_devices(true)` |

Server FFI signatures that matter for an adapter (server.rs):

- `wgpu_server_device_action(global, device, &ByteBuf, ErrorBuffer)` (1045)
- `wgpu_server_buffer_map(global, buffer, start, size, HostMap, BufferMapCallbackC)` (500)
- `wgpu_server_buffer_get_mapped_range(...) -> MappedBufferSlice` (539)
- `wgpu_server_queue_submit(global, queue, *ids, len, ErrorBuffer) -> u64` (1193)
- `wgpu_server_queue_write_action(global, queue, &ByteBuf, *data, len, ErrorBuffer)` (1226)
- `wgpu_server_device_create_shader_module(global, device, id, label, &nsCString, &mut msg)` (399)

`DeviceAction` variants (lib.rs:118) cover `CreateTexture`, `CreateSampler`,
`CreateBindGroupLayout`, `CreatePipelineLayout`, `CreateBindGroup`,
`CreateShaderModule`, `CreateComputePipeline`, `CreateRenderPipeline` (with
implicit layout ids), `CreateRenderBundle`, `CreateCommandEncoder`, and the
`*GetBindGroupLayout` variants. Their payloads are wgpu-core descriptor
types, serialized with serde.

**Presentation** is canvas `GPUCanvasContext`. It works as follows:

- The swap chain goes through `DeviceCreateSwapChain`.
- On every present:
  1. The parent copies the texture into a readback buffer.
  2. It submits and maps the buffer.
  3. `ReadbackPresentCallback` copies the bytes into a `RemoteTexture` that
     software WebRender composites.
- `dom.webgpu.allow-present-without-readback` defaults to true only on
  Windows, so Linux uses readback.

**Useful fact:** Firefox 128's wgpu is revision
`c7458638d14921c7562e4197ddeefa17be413587`. That is the same revision as the
Naga 0.20 dependency closure already archived for the project's SPIR-V→WGSL
translator. The exact serde descriptor types can therefore be compiled into a
host-side browser Wasm decoder.

## 3. Interception options

Shared facts for the host side:

- Host WebGPU is asynchronous and validates on the host.
- Guest threads are Workers that never return to their event loop. A guest
  call therefore reaches the host by posting to a host GPU-owner Worker and
  then blocking with `Atomics.wait`. This is done through a private hostcall
  syscall in `worker.js`, the pattern of the JIT design (worker.js:390–429),
  or through the existing vsock framing (`tests/guest-gpu/host.mjs`).
- The GPU-owner can receive the guest memory SAB. Readback can then write
  directly into guest memory, and uploads can read from it.

| | (a) remote wgpu-hal | (b) `wgpu_server_*` forwarder | (c) WebGPUParent rewrite | (d) JS `navigator.gpu` override | (e) wgpu Vulkan on guest ICD |
|---|---|---|---|---|---|
| Where | new hal backend in wgpu-hal | link-time `--wrap` of the C++→Rust FFI | C++ Recv* handlers | chrome JS / WebIDL | enable hal Vulkan on wasm32 |
| New code | ~4–6k lines Rust (hal is Vulkan-like: barriers, fences, persistent mapped ptrs, SPIR-V/naga backend output) | ~2.5–4k: guest C/C++ adapter ~1.5k + host decoder (Rust, pinned wgc serde types → JSON) ~0.8k + host JS executor ~1.2k | ~same as (b) plus C++ inside Gecko | n/a | wgpu-hal glue + large ICD growth (see `docs/zink-requirements-20260928.md`: ICD today has no device extensions, waits return `VK_TIMEOUT`) |
| Upstream lines patched | wgpu-core Instance slot + cfg/feature edits in wgpu-core/hal (vendored, checksummed) — tens of lines in 3rd-party Rust | **0 beyond W1's two gate lines**; optional ≤5-line hooks (poll interval, error-scope forwarding) only if measured necessary | hundreds of lines in `WebGPUParent.cpp` | impossible without WebIDL/C++ changes | cfg edits in hal build.rs, ash/libloading dlopen on wasm32 (no dlopen in this libc) |
| Validation | guest wgpu-core (exact Firefox semantics) + host | client-side in guest + **host WebGPU authoritative** | host | host | guest wgpu-core + ICD + host |
| Mapping / readback | hal maps via hostcall into guest staging | adapter-owned guest staging; host writes/reads guest SAB directly; Parent's shmem copy unchanged (needs W0) | same | n/a | Vulkan host-visible memory emulation already in ICD, slow |
| Canvas | unchanged readback path | **unchanged readback path** | unchanged | cannot reach WebRender | unchanged, but needs ICD copies |
| Sync/async | hal is synchronous-by-design → every fence wait blocks | sync hostcall per FFI call; errors either synchronous (scoped round-trip) or deferred | same | n/a | ICD waits currently time out |
| Shader path | WGSL → naga → WGSL/SPIR-V → host | **WGSL passthrough** to host `createShaderModule` | passthrough | n/a | WGSL → naga → SPIR-V → (ICD) naga → WGSL: triple translation |
| Security | host validation + guest | host validation (guest only a client) | host | host | host |
| Performance | extra guest-side validation + Vulkan-ish chatter | one hostcall per FFI call; batchable | same as (b) | n/a | worst: two translation layers |
| Verdict | viable, heavier, touches 3rd-party Rust | **recommended** | viable but an upstream patch | **infeasible** (content needs real WebIDL objects; chrome JS cannot implement GPU interfaces for content windows; the IDL is compiled) | not suitable for WebGPU; stays the Zink/vkcube track |

Notes on (b), the chosen route:

- **Link adapter.** The build is not LTO, so C++ objects hold undefined
  references to `wgpu_server_*`. Linking `firefox` with `-Wl,--wrap=<sym>` for
  each of the ~47 parent-called FFI functions redirects them to
  `__wrap_<sym>` in a new adapter object. The Rust definitions remain as
  unused `__real_`. This is a link-wrapper change in the Firefox packaging
  (`browser.nix`/`package.nix`), not a source patch.
- **Ids.** Raw ids stay as the client allocates them. The host keeps
  `Map<rawId, GPUObject>`, as `tests/guest-gpu/host.mjs` already does with
  its own resource table.
- **Decoding.** The ByteBufs are bincode with wgpu-core descriptor types.
  - Preferred: forward the raw bytes and decode on the host with a small Rust
    crate at the pinned revision. It is built as a standalone browser Wasm
    module that emits JSON, the same pattern as the existing Naga translator.
  - Alternative: decode in the guest adapter by linking a private copy of
    wgpu-types and wgpu-core's serde types.
- **Adapter info.** The adapter answers `instance_request_adapter` and
  `adapter_pack_info` itself. It bincode-encodes `AdapterInformation` from
  host `GPUAdapter.limits/features/info`, intersected with what Firefox 128
  understands.
- **Mapping.** `buffer_get_mapped_range` returns a pointer into adapter-owned
  guest staging (malloc).
  - MAP_READ: the host `mapAsync` result is copied straight into that staging
    through the guest memory SAB.
  - Unmap: the host receives the staging range and uses `writeBuffer` (or
    `mappedAtCreation`/`getMappedRange` + copy).
  - `WebGPUParent`'s existing shmem ⇄ mapped-range copies are unchanged. They
    need W0 so that the child and parent shmem mappings alias.
- **Completions.** Map callbacks, `onSubmittedWorkDone` and device-lost are
  queued by the host. They are drained inside `__wrap_wgpu_server_poll_all_devices`,
  which runs on the 100 ms `POLL_TIME_MS` timer, and additionally on entry
  to every wrapped call. Callbacks therefore run on the parent thread, at the
  same point where wgpu-core would call them.
  - Risk: frame pacing is bounded by the 100 ms timer when nothing else
    enters the FFI.
  - Mitigation: an adapter C++ file that dispatches a drain runnable
    (`NS_DispatchToCurrentThread`), or, if that is insufficient, a one-line
    `POLL_TIME_MS` hook.
- **Errors.** The FFI reports errors synchronously in `ErrorBuffer`; host
  errors are asynchronous.
  - Correct first mode: for each validating call, the host runs
    `pushErrorScope(validation)` + `pushErrorScope(out-of-memory)`, the op,
    and both `popErrorScope` calls. It returns the message in the same
    hostcall, which the adapter writes into `ErrorBuffer`. Firefox's C++
    error scopes and uncaptured-error events then behave exactly as upstream.
  - Fast mode (later): pipeline encoder and pass calls without scopes, and
    attribute host `uncapturederror` on the next `ErrorBuffer`-bearing call.
    Tolerating that imprecision is a decision for packet W8.
- **Shader compilation info.** The host `getCompilationInfo()` is mapped into
  `ShaderModuleCompilationMessage`.
- **Host prerequisite.** The host must expose `navigator.gpu` in a Worker.
  Chrome does; SwiftShader in tests. Otherwise the adapter reports no adapter,
  which matches today's behaviour.
- **To verify in W2:** whether `GPUQueue.writeBuffer` accepts a
  SAB-backed view (the spec types it as `AllowSharedBufferSource`). If it does
  not, copy into a non-shared ArrayBuffer.

## 4. Recommendation and packet plan

**Route (b).** Justification:

- Zero upstream logic changes (only the two unavoidable compile-time gates).
- Guest Firefox keeps its exact DOM, IPC, client and presentation code.
- The host WebGPU implementation provides the security boundary and runs on
  the physical GPU when the host has one.
- WGSL passes straight through.
- The decoder reuses the already archived, same-revision wgpu closure.
- It does not depend on the Vulkan ICD's maturity or on Zink.
- (e) remains the correct path for Vulkan apps and GL, but not for Firefox
  WebGPU.

Every packet has these common rules:

- Task dir `/mnt/p6/build/<task>` with a `tmp` subdirectory, and
  `TMPDIR`/`TMP`/`TEMP` exported.
- Finite owned browser/server only; preserve PIDs 1591443 and 1441390.
- A real-guest gate. Pixel gates use a local fixture page opened in guest
  Firefox. The result is verified from a guest-downloaded JSON (the existing
  fixture pattern) and from a host framebuffer PNG compared against expected
  pixels.

| # | Packet | Kind | Gate (real guest) |
|---|---|---|---|
| W0 | mmap-shim `MAP_SHARED` aliasing: key file-backed shared maps by (dev, ino, offset, len) with refcount, return the same pointer; relink Firefox only | shim | guest C test: two fd maps alias, write/readback, unmap refcount; DevTools regression (`cpmm` path) still passes; Firefox startup/home gate |
| W1 | Rebuild with the two `RELEASE_OR_BETA` gates relaxed under `__wasm__` + prefs in packed user.js; package candidate | minimal upstream hook + pref | fixture: `navigator.gpu` exists, `requestAdapter()` resolves `null` (reaches `WebGPUParent` / Empty HAL) with no crash |
| W2 | Host GPU-owner Worker + private `gpu_hostcall` syscall in worker.js (SAB request ring, `Atomics.wait`), guest memory SAB shared with owner | runtime adapter | guest C test: 10k echo round-trips, latency histogram, guest-memory read/write by owner, owner loss → error |
| W3 | Host decoder: Rust crate at wgpu `c7458638` (wgpu-core serde types only) → browser Wasm, bincode → JSON for `DeviceAction`, `CommandEncoderAction`, `RenderPass`, `ComputePass`, `QueueWriteAction`, `TextureAction` | host adapter | Node: golden ByteBufs produced by a host-built `wgpu_client_*` harness at the same rev decode to expected JSON; malformed input rejected |
| W4 | `--wrap` link adapter part 1: new/delete, request adapter + `adapter_pack_info`, request device, buffer create/map/unmap/get_mapped_range/destroy, `queue_write_action`, `queue_submit`, `poll_all_devices` drain, device lost | link wrapper + host executor | guest Firefox fixture: `requestAdapter` non-null with host limits; `writeBuffer` + `copyBufferToBuffer` + `mapAsync(READ)` returns exact bytes |
| W5 | Shader modules (WGSL passthrough, compilation info), bind group layouts, implicit layouts, pipelines, bind groups, compute pass, `onSubmittedWorkDone` | adapter | **compute readback**: WGSL compute doubles 4096 u32; all words exact; compile-error page reports message |
| W6 | Textures/views/samplers, render pass, swap chain via existing readback present | adapter | **canvas clear**: `<canvas>` cleared to 4 colours in sequence; host framebuffer pixels exact inside canvas rect |
| W7 | Vertex/index buffers, render pipeline draw, `copyTextureToBuffer` | adapter | **triangle**: canvas triangle pixel-verified (inside/outside/edge samples) + `copyTextureToBuffer` readback exact |
| W8 | Error scopes, uncaptured errors, device loss/destroy, resource limits; decide fast-vs-exact error mode | adapter (hook only if proven necessary) | fixture: invalid bind group caught by `popErrorScope`; uncaptured event fires; `device.destroy()` → `lost` resolves; guest survives host device loss |
| W9 | Performance (batched hostcalls, drain runnable), small WebGPU CTS/sample subset, candidate promotion via existing update gate | adapter + release | frame-time measurements recorded; home/profile/update/warm gates pass; no public deploy without explicit request |

Expected size: roughly 10 packets of a few hours each. The critical path is
W0 → W1 → W2 → W3/W4 → W5 → W6 → W7.

## Risks and open items

- **W0 aliasing.** The shim must also handle mappings that do not match
  exactly (different length or offset) and `ftruncate` after mapping. Fall
  back to a private copy only when non-shared.
- **Frame pacing.** Frames are paced by the 100 ms poll unless drain-on-entry
  or the drain runnable suffices.
- **Frame copies.** Each frame copies: host GPU → guest memory → Parent shmem
  → software WebRender → X11 → host canvas. That is acceptable for
  correctness. Later optimizations are a host overlay or
  present-without-readback.
- **Feature/limit mismatches.** Firefox 128 wgpu-types may not know every
  current host feature or limit, so the reported set must be intersected. The
  WGSL dialect accepted by the host (Tint) may differ from naga 0.20 on edge
  cases. Client-side naga validation in the guest content process does not
  run (the server parses shaders), so host errors are what the page sees.
- **Workers.** WebGPU in guest Web Workers (`dom.webgpu.workers.enabled`) is
  out of the first scope.
- **Hardware claims.** SwiftShader-based host tests prove no physical GPU
  acceleration. On a host with a real GPU, route (b) executes on that GPU.
