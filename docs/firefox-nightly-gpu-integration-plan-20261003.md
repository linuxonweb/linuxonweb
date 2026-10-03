# Current Nightly159 GPU integration after the Vulkan/wgpu benchmark

The completed simple benchmark establishes a bounded guest Vulkan path through
Rust wgpu. It does not supply Firefox's GPU APIs. The user has authorized GPU
implementation and Firefox testing after this benchmark gate. The next work
must use actual Nightly159 source and its current native Wasm ABI once the build
owner has frozen available inputs. These build and primitive-test dependencies
require no new user permission. Do not modify the owner's active source/config;
no old128 relink or deployment is part of this engineering plan.

Three distinct paths need separate acceptance:

| Guest API | Current building blocks | Remaining implementation |
|---|---|---|
| Native Vulkan app | Public static loader, ICD, hostcall, Naga, Rust wgpu module | Broader Vulkan features require explicit implementation and capability gates; initial no-bindings profile already passes |
| Firefox WebGL/OpenGL | Guest Mesa26.2.3 Zink/EGL/glapi archives and static-library NSPR shim | Port and validate the complete Zink-required Vulkan profile on Rust wgpu, then integrate current Nightly EGL context creation and readback |
| Firefox WebGPU | Current gfx/wgpu_bindings and wgpu-core-remote, native hostcall transport, historical wrapper/executor | New current-revision remote codec/FFI adapter and real Rust host executor with buffers, bindings, compute, textures/render and asynchronous callbacks |

The native Nightly source at
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1`
pins gfx/wgpu_bindings/wgpu-core-remote to upstream revision
`4f4dc63098fae64a0e6d1d3dc6f4f328da8fd5c8`. Its current server exports include
`wgpu_server_messages`, buffer mapping/send callbacks, queue submit and remote
texture ownership messages. That is a different wire/ABI boundary from the
old128 wrapper in `web/linux/tests/firefox-webgpu-wrapper/wgpu-server-wrap.c`
and its Naga0.20-era decoder. Existing old decoder blobs and `AdapterInformation`
bincode layouts cannot be reused on the assumption that names still match.

The native build currently excludes Vulkan HAL selection in
`tools/nightly-musl/recipe/wgpu-core-native-backend-port.py`; its interop adapter
preserves Linux exports while returning fd=-1/invalid results for unsupported
dma-buf/semaphore paths. These are deliberate Empty-HAL build contracts, not
evidence of a working hardware guest adapter. Replacing them requires an isolated,
current-source port and natural rebuilding after the baseline owner has frozen.

For WebGL, the reusable static archives are under
`/mnt/p6/build/glgears-zink-20261001/link/egl2` (`libEGL_mesa.a`,
`libgallium_zink.a`, guest ICD and static Vulkan resolver), documented in
`docs/zink-b2g-glgears-20261001.md`. `web/linux/firefox-shims/zink-egl-static.c`
registers real Mesa EGL entrypoints with NSPR and selects surfaceless Zink.
`glxtest-egl.c` only reports that this static route exists; it explicitly does
not probe hardware and must never be used as acceleration evidence. The
unexecuted old128 relink draft is not a current-Nightly integration recipe.

The present Rust renderer rejects uniforms, textures, depth, indexed drawing
and descriptors, all of which Zink/Firefox may require. First extend genuine
wgpu resource/binding/render operations with matching guest ICD capability
advertisement, map Zink's actual SPIR-V descriptor/layout/index semantics and
retain explicit unsupported errors. Then run a bounded guest EGL/OpenGL app
with asymmetric pixels and completed readback through this Rust backend.
Earlier Zink tests through the direct JavaScript renderer are historical controls,
not proof that the new wgpu path supports those features.

For WebGPU, first freeze the actual current C++ header, Rust FFI, remote message
schema and archived crate hashes. Generate layout assertions and golden payloads
from that revision; compile a small native guest ABI harness against real headers
and validate transported bytes before linking Firefox. Implement a separate
current remote-message server using Rust wgpu, with versioned sessions, stale-ID
checks, error scopes, map/work-done/lost callbacks and finite teardown. Start with
adapter/device/buffer copy+map, then WGSL compute/storage, then textures and a
completed render/readback. Firefox consumes WGSL directly; routing this through
the bounded Vulkan SPIR-V pipeline would discard required WebGPU semantics.
Do not advertise unsupported WebGPU features or present fake adapter identities.

After these primitive gates and ordinary engineering review of the port, integrate
only current Nightly browser links/helpers using the existing native shared-memory,
23-slot fpcast/EH/TLS contracts. Re-run baseline startup/version/CPU/lifecycle
gates before enabling actual Firefox WebGL and WebGPU pages. Acceptance must
record the exact privileged159 version/artifact, supported APIs, real adapter,
correct pixels, completed timings and forced-software comparison. Presentation
and compositor acceptance are further gates beyond offscreen API rendering.
The baseline/JIT release owner retains control of the existing two-release plan.
