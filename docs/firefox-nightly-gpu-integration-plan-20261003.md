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

The Rust renderer now has an explicitly negotiated resource profile with real
uniform buffers, bind groups, sampled RGBA textures/samplers and depth16/depth32
attachments. Actual retained Mesa26.2.3 creates a GLES2 context and executes an
indexed, textured, tinted asymmetric scene through Rust wgpu on hardware WebGPU,
SwiftShader WebGPU and wgpu WebGL. All six frames receive full pixel reference
checks; disabling depth makes the second far black draw overwrite the near
textured draw. The guest Zink adapter expands bounded index buffers into vertex
streams before genuine host drawing. This validates that primitive, not general
Firefox WebGL or the compositor. See the separately pinned resource-profile
evidence and reproduction in `guest-zink-wgpu-resources-20261003.md`.

The adapter preserves actual Zink SPIR-V descriptor sets and byte offsets,
splits combined samplers into texture/sampler bindings, and rejects read push
constants. Sampled color targets share real target texture storage only after
explicit capability negotiation. Blending, MRT, stencil, mip/layer resources,
storage images, geometry/tessellation, general instancing and arbitrary push
constants remain unsupported. The complete set of operations used by current
Firefox must be observed and implemented before enabling its GL context.

The current Nightly link needs a scoped native Linux/Wasm recipe for the fresh
Zink ICD/transport/static Vulkan resolver, Mesa EGL/GLES/gallium archives and
NSPR registration shim. Verify their C++ ABI, native Wasm exception/TLS and
23-slot fpcast compatibility with the current Nightly runtime before linking;
the primitive's retained Mesa shader compiler objects do not establish that
whole-browser compatibility. Ensure static constructors and registrations survive
both main and child links. Apply and naturally rebuild only after the build
owner's source/object freeze; do not change a live baseline or JIT graph.

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

## Host runtime and later release assets

The public launch path is `web/linux/main.js` → `dist/index.js` →
`dist/guest-gpu-hostcall.js` → the GPU owner Worker `dist/guest-gpu-owner.js` →
`dist/guest-gpu-vk.js`. `main.js` currently passes only
`gpuHostcall.ownerConfig.vk.backend = gpuBackend`; its parameter parser selects
the existing direct backend. The private primitive selects
`{backend:"wgpu", wgpuBackend:"auto", allowResources:true}` in ownerConfig.
Promoting that configuration requires accepted current-Nightly guest libraries
and the supported-operation gates, rather than merely changing the selector.

The Rust bridge currently imports a private `candidate/guest_vulkan_wgpu_host.js`
route supplied by the benchmark server. Promote the accepted bindgen JS/Wasm
and bridge to a stable, versioned runtime directory with recorded hashes and
matching bindgen versions. Preserve its translator Worker, Naga Wasm, graphics
validators and teardown closure. The public release helper
`web/sites/release-runtime.mjs` has a reviewed route allowlist and import/Worker
dependency traversal; its current closure does not admit this Rust candidate.
Extend that explicit closure and regenerate `web/sites/runtime-assets.mjs` and
`web/sites/runtime-lock.json` from frozen accepted assets as part of the later
release. Serve Wasm with the correct MIME type and retain cross-origin-isolated
shared-memory Worker headers. No public assets or Sites deployment are changed
by this primitive work.

Firefox's current remote WebGPU executor needs its own versioned codec/host
assets and owner configuration. `dist/guest-gpu-wgpu.js` still exposes the
historical executor and is not made current by selecting the Vulkan Rust bridge.
