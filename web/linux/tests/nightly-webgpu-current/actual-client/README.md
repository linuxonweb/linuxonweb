# Actual Nightly Rust client copy/map gate

The three retained runs use the actual current Nightly `wgpu_client_*`
implementation from the accepted native `libgkrust.a`. No Firefox executable
is launched. The earlier simple Vulkan → Rust wgpu rendering benchmark already
passed with matched readbacks and 18.1778× speedup over host SwiftShader; see
[its report](../../../../../docs/guest-zink-wgpu-resources-20261003.md).

Each standalone Linux/Wasm guest requests an adapter and device, creates two
64-byte buffers, writes 16 words, copies/submits, waits for submitted work,
maps/reads/verifies all words inside the actual FFI map callback, and unmaps.
All twelve serialized requests come from the real Rust client; complete host
responses return through `wgpu_client_receive_server_message`.

| Retained run | Actual host backend | Result |
| --- | --- | --- |
| `guest-run-hardware2` | Rust `BrowserWebGpu`, API NVIDIA/Maxwell | Pass |
| `guest-run-software1` | Rust `BrowserWebGpu`, API SwiftShader, Rust CPU adapter | Pass |
| `guest-run-webgl1` | Rust `Gl`, NVIDIA ANGLE / WebGL 2.0 | Pass |

The task is `/mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003`.
Final `guest.wasm` is 256,891 bytes, SHA256
`b5d45d6ae90e90591ca4aa025ece86a38c8b7d10b68c65d5c8d2612dfdf2d29f`.
All 155 indirect entries use the required 23-i64 → i64 fpcast signature.
Every run admitted six actual host/browser/kernel CPUs, 1 GiB guest memory,
zero core limit, owned dynamic endpoints, and finished with zero GPU owners,
empty Node/Chrome groups and a closed server.

`frozen-20261003` preserves byte-identical tested source, native commands and
bounded runners. Those snapshots retain their exact task paths and depend on
the pinned inputs recorded in the evidence; they are not general-purpose
build scripts. Large archive/module/browser snapshots stay in the disk-backed
task directory. Recheck the retained evidence without launching anything:

```sh
python3 web/linux/tests/nightly-webgpu-current/actual-client/review.py \
  /mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003 \
  --output /mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003/root-actual-guest-review.json
```

Outgoing bytes are adopted into real `ipc::ByteBuf` storage, which frees the
Rust Vec allocation. Incoming response views remain borrowed until dispatch
returns. Adapter strings are copied before the FFI callback returns. Map
bytes are published to the harness-owned array before delivering map success.
Equal adapter/device/queue numeric IDs are valid across distinct type
namespaces; both buffer IDs must differ within their namespace.

Retained failures matter: the first compile omitted the native WebAssembly
C++ ABI flag, and fatal linking rejected the real destructor mismatch. The
first hardware guest rejected an empty adapter name, although browser WebGPU
privacy permits that value. The corrected build keeps ID/limits/ownership
checks and uses real API identity plus Rust adapter classification. The
first review also checked the wrong driver flag spelling and normalized
CRLF log bytes; both review mistakes were corrected without changing runs.

This gate proves serialization, native FFI and copy/read-map execution. Actual
Firefox DOM promises/IPC mappings, indexed sidecars, write-map publication,
unmap/destroy/cancel/device-loss races, rendering and current-client compute
remain integration work. WebGL reports compute unsupported. These run times
are whole test durations, not FPS measurements or performance acceptance.
