# Actual public Vulkan client through the static Khronos loader

A separate Vulkan application now runs through the real Khronos loader in the
wasm32 Linux guest. The first guest attempt passed **883 assertions**, including
ordinary public instance/device enumeration and creation, procedure lookup,
unsupported extension and unknown-function rejection, accurate bounded format
queries, and two exact 17×3 clear/readbacks. The colors were RGBA
`255,0,0,255` and `0,255,0,0`: 102 pixels, 408 returned bytes, plus eight untouched
mapped-memory sentinel bytes after each submission. The assertion count includes
individual byte comparisons; it is not a count of distinct Vulkan capabilities.

The guest kernel reports `Memory: 1000192K/1048576K available` and
`smp: Brought up 1 node, 2 CPUs`. The browser was visible and isolated. The host
used **Google SwiftShader fallback**, so this is software GPU execution evidence.
The host recorded nine successful protocol operations, two clears and two
readbacks, with no draws or host/browser errors. One device, one texture and two
staging buffers were created and destroyed, leaving zero native objects. Guest
resource accounting ended at zero objects/bytes and protocol CLOSE returned zero.

The compact [evidence](evidence/runtime-graphics-20260926/guest-vulkan-loader-integration.json)
links the full reports retained under
`/mnt/p6/build/guest-vulkan-loader-20260926/`. The accepted runtime/rootfs images
and public Sites version 6 are unchanged; the fixture is not deployed.

## What was integrated

Vulkan-Loader v1.3.231 is pinned to
`61187c40845c92a80bcd2216089dd01badcda7ac`; matching Vulkan-Headers are pinned to
`98f440ce6868c94f5ec6e198cc1adda4760e8849`. The allowlisted closure contains 38
loader files and 13 headers, including inspected files deliberately excluded
from compilation. Every source has an immutable URL, byte length and SHA-256 in
the fixture's `source-lock.json`. The four headers used by earlier direct ICD
tests match the official upstream bytes. Original source notices are retained.

The port compiles eleven upstream C translation units plus a small typed
unknown-procedure rejection module into `libvulkan-guest-static.a`. Public
trampolines, creation chains, terminators, interface negotiation, required ICD
entry initialization and typed dispatch remain upstream implementations. Only
driver discovery, layer discovery and NULL-handle library cleanup are adapted:
one built-in provider replaces manifest/dlopen discovery; external layers are
disabled. Provider names and arrays use the loader's normal allocation/free
path. No library handle is invented or passed to `dlclose`.

The untyped unknown-extension C/assembly trampolines are excluded. Unknown
names return NULL through functions with the upstream declared signatures.
Known upstream entrypoints remain available according to the loader's behavior;
their existence does not establish implementation by this partial ICD.

`client.c` includes only public Vulkan and POSIX headers. It compiles separately
from both the loader and ICD and calls no `vk_icd*` or private guest audit APIs.
The build checks its undefined public Vulkan symbols against the upstream
archive's definitions and retains `client-symbols.log`, `archive-symbols.log`
and `link.map`. Direct calls and public procedure lookup both execute in the
guest. Cleanup uses public Vulkan calls, with independent host ownership checks.
The final audit verified all 42 undefined public Vulkan symbols, 12 frozen/current
fixture sources, 51 upstream inputs and eight direct-regression sources, with no
unknown-call trampoline definitions. Python/Node syntax and scoped diff checks pass.

The required ICD format, image-format and sparse-image-format queries now
describe the existing restrictions accurately: optimal 2D RGBA8, combined
transfer-source/destination usage, maximum 128×128×1, one mip/layer/sample,
65,536-byte maximum image and no sparse support. Other tested formats, image
types and storage usage reject. Loader-private instance/device `pNext` nodes
are accepted without invoking callbacks; unsupported application nodes still
reject. Traversal is bounded to eight nodes, rejecting cycles and longer chains.

## Build and validation boundaries

The accepted fixture build is `build-run2/guest-vulkan-public-client.wasm`,
349,179 bytes, SHA-256
`398747a18c68bf48b07a96cca33e829710add43be3816434eb72fcd8f64152fe`.
Wasm validation and the Linux import allowlist passed. The first compilation
attempt stopped on upstream generated beta object metadata. The second follows
upstream CMake's `VK_ENABLE_BETA_EXTENSIONS` setting for the loader only, using
pinned beta/video declaration headers. Client and ICD compilation remain
beta-free; no video capability is advertised. Failed build-run1 is preserved.

Targeted direct ICD regressions also passed on their first attempts: lifecycle
44 assertions, unavailable-host 14, and clear/readback 957. These include the
new loader-private chain acceptance, mixed unsupported-node rejection, cycle
and over-limit rejection gates. Each run independently captured 1 GiB/two-CPU
kernel markers; browser errors/exceptions were absent and host teardown passed.
The existing transport-loss, native-device-loss and allocation-exhaustion gates
were not rerun because those paths were unchanged.

The fixture [README](../web/linux/tests/guest-vulkan-loader/README.md) gives the
build/package/run workflow and the hash-verified `fetch.py` reproduction path.
The original source retrieval and build were executed; the new fetch helper was
syntax-checked but was not itself run as a fresh end-to-end source fetch.
All scratch, sources, logs, archives and browser profiles remain under the
disk-backed task root with explicit TMPDIR/TMP/TEMP. Packaging changes only
packed `/init` and adds the isolated public-client executable; original archive
records and accepted source images remain intact.

Cleanup passed: browser PID 86503 closed through Browser.close and adapter PID
86358 exited on SIGTERM, both with status zero. Both PIDs are absent, ports 4182
and 9396 have no listeners, and the four exact candidate links were removed.
The user's pre-existing server PID 1591443 kept its command/start identity.
Profiles, source copies, packages and evidence remain on disk. The compact
evidence pins both `qa-summary.json` and `cleanup.json` by SHA-256.

This proves the deliberately static loader/application boundary. It does not
provide dynamic discovery, a conformant Vulkan implementation, general GPU
buffers, compute dispatch, shaders, graphics pipelines, presentation, Zink,
OpenGL, Firefox GPU integration, WebGL fallback, native JIT or hardware video
decoding. The COMPUTE queue flag still denotes only clear eligibility in this
incomplete experimental profile.

## Next concrete application gate

The smallest useful shader gate is a public Vulkan compute client that supplies
two different real SPIR-V modules, creates a compute pipeline and one storage
buffer descriptor, dispatches 64 integers, and compares both shader-dependent
readbacks plus sentinels. This requires real runtime SPIR-V translation, GPU
storage buffer upload/readback, descriptor/pipeline state, dispatch recording
and barriers, including malformed shader rejection and full teardown.

An existing source candidate is archived Firefox's Naga 0.20.0, pinned by its
Cargo.lock to wgpu `c7458638d14921c7562e4197ddeefa17be413587`. Its vendored
`spv-in` parser (`parse_u8_slice`), validator and `wgsl-out` writer (`write_string`)
are present. The `petgraph`/`fixedbitset` SPIR-V-input dependency closure is not
present in that archived vendor tree and must be resolved and pinned before
compilation. This is a source inspection finding, not a compiled translator.
The inspected tree is
`../.tmp-firefox-build/nix-local-store/nix/var/nix/builds/nix-1-800818036/firefox-128.14.0/`:
`Cargo.lock` lines 3865–3867 records the revision; relevant paths are
`third_party/rust/naga/Cargo.toml`, `src/front/spv/mod.rs`,
`src/valid/mod.rs`, and `src/back/wgsl/mod.rs` within that crate. The Cargo.lock
pin was read; this continuation did not independently verify all translator
source/dependency hashes or execute its code.

The existing browser protocol accepts WGSL shaders but its buffer opcode is
restricted to packed triangle vertices, its pipeline/draw opcodes are graphics
triangle fixtures, and its readback copies images. The Vulkan buffer currently
stores guest readback bytes rather than a GPU storage allocation. A compute
gate therefore needs explicit bounded storage-buffer, compute-pipeline,
dispatch and buffer-readback operations; substituting a hardcoded WGSL shader
for an application's SPIR-V would not pass the intended application boundary.
