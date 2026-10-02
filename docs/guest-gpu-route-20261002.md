# Guest GPU continuation route — 2026-10-02

This packet is read-only preparation. No GPU implementation, compilation,
browser test, promotion or deployment was performed. Scratch storage is
`/mnt/p6/build/guest-gpu-route-20261002`; future commands must set TMPDIR, TMP
and TEMP to its disk-backed `tmp` directory, or a new packet's equivalent.
Implementation remains held until the root agent releases it after JIT
acceptance.

## Recommended routes

Keep the guest Vulkan ICD and Zink for ordinary guest Vulkan/OpenGL apps.
Complete Firefox WebGPU through the existing `wgpu_server_*` FFI forwarder
and host WebGPU owner Worker. Complete Firefox WebGL through static Mesa
EGL/Zink and the current guest ICD. All guest executables remain native
wasm32 Linux programs.

| Consumer | Route | Evidence already available | Work remaining |
|---|---|---|---|
| Ordinary Vulkan apps | Vulkan C ABI → guest ICD → `gpu_hostcall` → owner Worker → host WebGPU; WebGL2 fallback | vkgears and Vulkan suites; H1 transport | Larger resources, complete synchronization and additional Vulkan operations/formats |
| Ordinary OpenGL apps | EGL/OpenGL → Zink → guest ICD → same host executor | ES2 and GL 2.x compatibility eglprobe; glgears pixels and gears timings at 128×128 | Texture/render-target interoperability, larger caps, formats, wider GL coverage |
| Firefox WebGL | Existing Firefox GL/EGL provider → NSPR static-library adapter → EGL/Zink → ICD | F1a linked and passed startup; reached Zink before subsequent ICD fixes | Relink onto accepted JIT with B2g ICD and Mesa override; establish actual WebGL context/draw/presentation |
| Firefox WebGPU | Existing DOM/IPC and wgpu client encoder → wrapped server FFI → W2 hostcall → W3 decoder/W4 host executor → host WebGPU | W0 shared mmap, W1 gates, W2 transport, W3 decoder, W4a buffer executor separately tested | Validate/link W4b wrapper, ship decoder, implement shaders/resources/passes/texture copies and prove Firefox canvas presentation |

The Firefox WebGPU route uses the host's WebGPU implementation directly. The
existing W4a executor requires host WebGPU; the Vulkan executor's WebGL2
fallback does not automatically provide a Firefox WebGPU fallback.

### What “use wgpu” would mean here

The current upstream wgpu documentation supports browser wasm applications
through WebGPU and an optional, less complete WebGL2 backend. Its examples
use `wasm32-unknown-unknown` and wasm-bindgen. This is useful for host-side
browser applications. It does not supply a guest Linux Vulkan driver.
[Official browser platform documentation](https://wgpu.rs/doc/wgpu/documentation/platforms/web/index.html).

`BROWSER_WEBGPU` belongs to the higher-level `wgpu` crate, rather than
`wgpu_core`, and selection occurs when creating the instance. The current
`webgpu` feature brings in web-sys and wasm-bindgen; those dependencies
expect a surrounding JavaScript context. Integrating it directly into the
guest Firefox server would require a new runtime bridge and a different
dependency/ABI arrangement. This is an inference from the upstream backend
and dependency definitions, together with the local guest ABI.
[Backend definitions](https://wgpu.rs/doc/wgpu/struct.Backends.html),
[official Cargo manifest](https://github.com/gfx-rs/wgpu/blob/trunk/wgpu/Cargo.toml).

Firefox 128.14 uses pinned wgpu revision
`c7458638d14921c7562e4197ddeefa17be413587`. Its `wgpu-hal/build.rs` explicitly
excludes wasm32 from the Vulkan configuration. A Vulkan route would need
cfg/dependency changes, a static Vulkan loader/proc adapter, and enough ICD
features/limits for that revision's adapter checks. It would also add
WGSL→SPIR-V→host shader translation to the current command path. Completing
the existing server forwarder avoids those particular porting steps while
retaining the Firefox DOM/IPC implementation and raw client IDs.
[Pinned upstream cfg](https://github.com/gfx-rs/wgpu/blob/c7458638d14921c7562e4197ddeefa17be413587/wgpu-hal/build.rs).

The route choice is an implementation-cost recommendation, not a measured
claim that passthrough is faster. Replacing the working host JavaScript GPU
executor with a new Rust/wgpu executor has no performance evidence here.
Keep the pinned Firefox decoder/ABI; upgrading to current wgpu is a separate
port, since serialization and descriptors are revision-dependent.

## Acceptance state and limits

JIT8 default candidate `test-pbl-de48d07e6051b575` passed one bounded original
fixture smoke: actual property/Math loop compilation, expected checksums,
and major-GC epoch eviction/recompilation were observed. This is not final
JIT performance/startup/update acceptance. The isolated handler-policy run
missed one fixture navigation; the combined JIT8/handler candidate subsequently
passed cold/warm startup, profile-preserving update and six-boot safety gates.
Safety identified repeated Math compilation from a bytecode-only cache hash.
A script-aware cache revision passes its safety smoke and full original
benchmark semantics, but deep/error exception throughput still regresses.
An explicit-throw fallback smoke also leaves that issue unresolved. Cached
eligibility rejection candidate `ce0d881dec8cea07` passes the full original
six-boot comparison: all eight median ratios are at most one, with deep/error
throws exactly one. It also passes cold/warm startup and profile-preserving
update. Full safety passes six boots with 8,408 assertions per boot and
positive compilation of all 18 required helpers in every candidate boot.
Numeric coverage is still under review; host variance
precludes an exception/JSON speedup claim. No candidate is yet an accepted
GPU baseline. Select the
final accepted JIT candidate and exact archive only after its gates finish. See
[JIT8 packet](guest-jit-spec8-20261002.md).

F1a candidate `2c3830fbec61` is also unpromoted. Its cold/warm startup success
and Zink startup diagnostics do not prove Firefox WebGL. B2g proves ordinary
GL apps, not Firefox's canvas/compositor path. W4a's 102-check guest buffer
test does not exercise the draft Firefox wrapper or render a WebGPU cube.

The current ICD advertises 128-pixel images, framebuffers and viewports.
`MAX_RES=1024` in Zink builds is a resource-count cap, not image resolution.
The B2g 256 MiB heap and larger buffer support do not remove the pixel cap.
Depth formats are D16/D32; packed depth/stencil is unfinished. Zink colour
attachments created with sampled usage currently become host render targets
without sampled capability. BGRA readback/blits also remain incomplete.
These are real implementation gaps; expanding advertised limits alone is
insufficient.

The original check page at
`tools/guest-rootfs/firefox-gpu-check/gpu-check.html` uses 320×240 canvases.
Its WebGL cube needs shader compilation, vertex buffers, a uniform matrix,
depth testing, RGBA pixel readback and presentation. Firefox may additionally
need framebuffer copies and texture sampling to present that WebGL canvas.
The first useful F1b diagnostic can use a clearly labeled 128×128 test;
acceptance of the original page needs larger working resources. The exact
next Firefox rejection must determine the next adapter packet.

WebGL2 requires many features beyond the proven GL2.x/ES2 path. The local
Firefox `WebGL2Context::InitWebGL2` checks textures/storage, depth formats,
instancing, queries, transform feedback, samplers and UBO support, among
others. First prove WebGL1 through Zink, then implement enough genuine GL3/ES3
coverage for WebGL2; preserve the existing Firefox capability checks.

The WebGPU cube uses `layout: "auto"`, pipeline bind-group-layout retrieval,
vertex/uniform buffers, RGBA/BGRA attachments, `depth24plus`, texture views,
render passes, draw calls and texture→buffer readback with padded rows.
Firefox's `GPUCanvasContext` presentation itself also copies textures to a
buffer and maps them when external fences/textures are unavailable. All of
these must work even if an offscreen triangle has already rendered.

## Link lineage: preserve JIT, add W0/W1 explicitly

The current JIT8 link descends from the promoted TLS/packed-DevTools lineage.
It uses the TLS response list and the older aligned mmap object. The W1 link
uses a newer W0 mmap object and a response list with exactly two Firefox
object replacements. Reusing the old F1a binary would lose the new JIT;
extending the current JIT command without merging W0/W1 would retain the old
mmap behavior and WebGPU gates.

The link commands inspected are:

- `/mnt/p6/build/guest-jit-spec8-20261001/build-run1/link.command.txt`;
- `/mnt/p6/build/guest-jit-spec8-20261001/build-handlers-run1/link.command.txt`;
- `/mnt/p6/build/firefox-webgpu-w1-20260929/relink-run1/link-command.json`.

The W0/W1 inputs below were hashed directly during this review. Full paths
are intentional: these are existing immutable artifacts to copy into a new
packet, not source/build trees to modify.

| Unit | Existing artifact | SHA-256 |
|---|---|---|
| Old mmap in current JIT/TLS link; replace for GPU merge | `/mnt/p6/project/linux/.cache/reliability-performance-20260926/firefox-mmap-aligned/mmap-shim.o` | `67280507c69b8a87901e293f625aa9ea95a03d2d97b627ce139babac39ecbad1` |
| W0 MAP_SHARED mmap unit | `/mnt/p6/build/firefox-mmap-w0-20260929/relink-run1/mmap-shim.o` | `ebb24527743326bddd9a5aa50addcc3a798651351b696c35c50f6b726262f1ca` |
| W1 WebGPU DOM gate unit | `/mnt/p6/build/firefox-webgpu-w1-20260929/relink-run1/webgpu0-patched.o` | `c2d44d7711ae142646dca356fb72d84fbb94d7b42963521ff90485abaf647bb1` |
| W1 gfxPlatform gate unit | `/mnt/p6/build/firefox-webgpu-w1-20260929/relink-run1/gfxPlatform-patched.o` | `064197359b89f4163c267e03104c47b243e2d2619a9a01bb64e38458cce28f7e` |
| TLS NSS response list | `/mnt/p6/build/firefox-tls-20260926/resume-build-run1/firefox-nss.list` | `c70cbf6acb95679d32cd525a6180857d57feee4f7466499cca8ccedcfe3b6ba8` |
| W1 response list | `/mnt/p6/build/firefox-webgpu-w1-20260929/relink-run1/firefox-nss.list` | `d592462fdf4efbaaaef777bebb3beef28bb54a755a7d7bdd2804bcb1836c8cc8` |
| Default8 JIT archive, acceptance pending | `/mnt/p6/build/guest-jit-spec8-20261001/build-run1/libjs_static.a` | `55492ada71c3737831459b93c9d3046e455aaa99ea15301caa87478d92700fa5` |
| Combined8 handler-policy archive, acceptance pending | `/mnt/p6/build/guest-jit-spec8-20261001/build-handlers-run1/libjs_static.a` | `c9b34d690d92ff0d5ffbaeffd9eba61a80e89744cb79bb12ddd9550e9818aa0a` |

The W1 response list replaces only
`../../gfx/thebes/gfxPlatform.o` and
`../../dom/webgpu/Unified_cpp_dom_webgpu0.o` with the two W1 units above. It
preserves the other 2,376 response-list entries. Relative paths require the
recorded Firefox link working directory. Snapshot a private response list
with absolute replacement paths; do not edit either original list.

W0 fixes aliasing of file-backed `MAP_SHARED` mappings needed by Firefox IPC
and WebGPU mapped-buffer staging. W1 changes two release-gate lines under
`__wasm__` in copied upstream units and supplies the enabled prefs. They are
separate requirements. Keep the packed-DevTools workaround carried by the
current promoted lineage unless its removal is explicitly gated later.

### F1a additions must use B2g, including its Mesa override

`tools/build-firefox-webgl-f1a.py` is a recipe reference, not a suitable
unmodified merge command: it hardcodes the old W1 command and old B3 ICD
archives. The B3 ICD predates the B2a–B2g fixes. The B2g eglprobe inputs below
were successfully exercised in the recorded NVIDIA and Intel probe runs in
[B2g](zink-b2g-glgears-20261001.md).

| B2g input | Existing artifact | SHA-256 |
|---|---|---|
| Current Zink-mode ICD archive | `/mnt/p6/build/glgears-zink-20261001/link/egl2/lib/libguest_vk_icd.a` | `2e4b3a7e3854f8191f0252ad22aae35effa6eac1fdc1ba4fad2cf09fa9655c90` |
| Mesa EGL | `/mnt/p6/build/glgears-zink-20261001/link/egl2/lib/libEGL_mesa.a` | `b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8` |
| Mesa Zink/Gallium | `/mnt/p6/build/glgears-zink-20261001/link/egl2/lib/libgallium_zink.a` | `c7216add6a70a2a3d94ccae7eefbbd9e7884e1cb2af2c4d257536de15a6b88aa` |
| Required B2c member-pointer override | `/mnt/p6/build/glgears-zink-20261001/link/egl2/obj/ovr-builtin_functions.o` | `0488d82beb24a3bf55a87852e5a206f604e68244748ba7a1999869804b3d20c6` |

The Gallium archive still contains the original Mesa builtin-functions
member. Link `ovr-builtin_functions.o` before the archive so the patched
definitions win. The old F1a builder predates that override and omits it;
otherwise the same wasm32 C++ member-function-pointer odd-table-index trap
can recur during shader compilation. Copy only the known override object,
or regenerate it from a copied source with the exact B2c recipe. Firefox
also uses that toolchain, so a similar trap elsewhere remains an audit item.

### Concrete future relink recipe

1. Select the fully accepted JIT build and its command, exact
   `libjs_static.a`, PBL policy and frozen JIT source hash. Copy these into a
   new packet directory and fingerprint them. Preserve that exact archive;
   an old W1/F1a command's default JS archive is not a substitute.
2. Copy its TLS response list and replace only the two W1 objects; replace
   the old mmap argument with the W0 object. Assert exactly one occurrence
   of each input being replaced. Keep TLS/NSS, thread/TLS adapters and the
   current rootfs/DevTools lineage.
3. For F1b, add the existing NSPR adapter
   `web/linux/firefox-shims/zink-egl-static.c`, static Vulkan proc adapter
   `tools/zink/shims/zink_static_vk.c`, B2c override object, and copied B2g
   EGL/Gallium/ICD archives. Retain the F1a ordering that places Mesa archives
   after Firefox's libc++/libc++abi selections. Trace actual symbol ownership
   and compare duplicate-definition diagnostics; allowing duplicates alone
   can silently displace Firefox or Mesa implementations.
4. For W4b, add verified wrapper objects and wrap exactly the server ABI
   entry points used by this Firefox revision. Resolve every parent-side
   server call to the wrapper, while retaining original wgpu client encoding
   and the Rust allocation/ByteBuf helpers. Add shaders/resources in later
   packets without mixing native server IDs and forwarded IDs.
5. Preserve imported shared memory, Linux syscall imports, atomic/TLS ABI
   and fpcast conventions. Run fpcast on the new linked binary, then splice
   the resulting function table with its actual new minimum and no maximum.
   Do not hardcode JIT8's old table size: adding GPU objects changes it.
   Validate imports/exports and the 23-i64 JIT invocation ABI again.
6. Package from the accepted rootfs, retaining home/profile/update behavior
   and the packed-DevTools workaround. Add the F1a `glxtest` adapter and
   early default prefs, rather than relying only on distribution.ini for
   `gfx.x11-egl.force-enabled` (a once-read pref). The adapter must report
   `TEST_TYPE EGL`; TinyX has no GLX route. Main-page Firefox GPU sessions
   already default on (`?gpu=0` opts out).
7. Record source/object/archive/list hashes, complete link argv/cwd,
   diagnostics, fpcast/table metadata and archive audit. Run startup/update
   and JIT coverage/correctness/performance gates on the GPU merge as well
   as its GPU gates. Keep this candidate separate until accepted.

These are proposed steps, not commands executed in this packet.

## Minimal Firefox WebGPU packets

W4a's executor is `web/linux/dist/guest-gpu-wgpu.js`, reached through W2
hostcall operation `0x10` and `WGQ1`/`WGR1` messages. The untracked
`web/linux/tests/firefox-webgpu-wrapper/` is a draft, not accepted code.
Its ABI mirror lists 43 functions taking/creating a WGPUGlobal; the broader
design's approximate call count must not be used as a wrap completeness
check. Compare the actual generated header and linker references.

| Packet | Scope | Decisive gate |
|---|---|---|
| W4b | Verify wrapper ABI against Firefox generated header; adapter info/device creation, map staging, poll callbacks and lifetime; link onto merged JIT+W0+W1 | Real guest Firefox buffer write/copy/map byte check, async work-done/loss callbacks, errors and teardown; startup/update remain passing |
| W4c | Ship pinned decoder wasm and its JavaScript loader in production paths; remove dependence on test routes/build-directory serving | Run the same Firefox buffer test using only packaged `web/linux` inputs, including an offline/cache-aware startup |
| W5 | WGSL shader module and compilation messages; pipeline/bind-group layouts, bind groups and pipeline creation; a small compute operation can provide an intermediate readback test | Actual Firefox shader error details and known compute-output bytes with lifetime/ID checks |
| W6 | Textures/views, render attachments, render-pass decode/execute, texture→buffer copies; first genuine GPUCanvasContext clear | Readback pixel bytes and visible canvas clear in guest Firefox, including normal parent presentation callbacks |
| W7 | Cube's vertex/uniform bindings, draw/state commands, auto pipeline layouts/getBindGroupLayout, depth24plus and RGBA/BGRA canvas textures | Original 320×240 cube: visible rotation, depth ordering, non-clear pixel readback, no scope/loss errors |
| W8 | Complete failure/lifetime behavior used by these paths; capability intersections and loss/recreate handling | Invalid descriptors/IDs, mapped-buffer restrictions, error scopes, dropped resources, device loss, owner loss and repeated recreate tests |
| W9 | Presentation/callback pacing, batching and profiling after correctness; final merge gates | Timed rendered frames/readbacks with backend evidence plus JIT/startup/update regressions |

Compute in W5 is an intermediate diagnostic, not a prerequisite for the cube.
Cube packets can be split into smaller buffer/layout/texture/pass increments
without claiming unsupported operations. The present draft explicitly rejects
shader modules, texture actions, render/compute passes, texture→buffer copy
and pipeline getBindGroupLayout; supporting these calls is required before
the cube can work. Its no-op drops are suitable only for object kinds it
never creates and must acquire real lifetime handling as creation is added.

The pinned decoder artifact is
`/mnt/p6/build/firefox-webgpu-w3-20260929/decoder-build-run2/firefox-webgpu-decoder.wasm`,
377,315 bytes, SHA-256
`2f0c575b700a9220aea6365a60201f29600ff446c26eeeb78d703ccb11cd248e`.
The intended `web/linux/dist/firefox-webgpu-decoder.wasm` is not yet shipped.
The executor currently imports the decoder loader from a test directory;
W4c must make both decoder and loader explicit production artifacts. The
decoder must continue to match Firefox's exact bincode enum/descriptor
revision and reject malformed/unsupported inputs before host allocation.

### FFI and callback correctness requirements

Keep the full Firefox ID (index, epoch, backend) and per-kind/device
ownership checks. Reserve failed object IDs consistently; stale callbacks
or reuse must not resolve a later object. Guest pointers belong only to guest
linear memory; host GPU objects belong only to the owner Worker. Queue
callback tokens on the host and invoke guest function pointers only from
the guest poll path with exact wasm/fpcast signatures. Owner loss must wake
waiters and settle pending callbacks once, with no late SAB-slot write after
reuse.

Real generated C++ prototypes, wasm32 structure offsets, return conventions,
and string ownership are the ABI authority. The draft mirror pins header
SHA-256 `a9cd7efc43830cd3d07f6728fb037bf6c9d34e1d0b78ab544575904a606b8fdd`;
recheck it against the build selected for the merge. Shader source reaches
the FFI as `nsCString`; compilation diagnostics contain an owned `nsString`
with UTF-16 offsets. A small C++ ABI adapter should construct/copy those
strings with Firefox's rules; memcpy of a host string or a guessed C layout
does not establish safe ownership.

Map staging must preserve validated nonoverlapping mapped ranges, writeback
on unmap and invalidation on destroy/drop/loss. The current draft limits
read ranges and allows only one write range; such restrictions are not
general WebGPU mapped-range acceptance. Host validation errors must reach
the existing Firefox ErrorBuffer/scopes, with validation/OOM/internal/device
loss classified correctly. Advertise only features/limits supported by the
host, the pinned Firefox API and the implemented forwarder.

`WebGPUParent.cpp` polls devices on a 100 ms timer. Its readback presentation
path needs copyTextureToBuffer, map callbacks, mapped range and unmap. This
is a likely pacing cost, not a measured FPS limit: inspect actual callback
delivery and in-flight presentation before changing timers or adding waits.
Returning no external device fence deliberately selects that readback path.

## Gates before claiming Firefox GPU acceptance

Require actual guest Firefox operation logs and page pixel results, plus
owner-side adapter/backend evidence. Keep WebGL1, WebGL2, WebGPU canvas and
offscreen readback results separate. The check page can fall back from a lost
WebGPU canvas device to readback into a 2D canvas: that proves GPU rendering
and CPU presentation, but does not prove GPUCanvasContext presentation. Take
two separated guest screenshots/pixel captures to show rotation and verify
that readback pixels agree with the rendered frame.

Run the existing ordinary-app Vulkan suites and EGL/Zink probes whenever
their shared ICD/executor is changed. Exercise `?firefox=1` alone and beside
`?gputest=1`, WebGPU-first/WebGL2 fallback for the ICD, and `?gpu=0` behavior.
Preserve user home/profile/downloads and image-cache/update guarantees. Do
not run performance measurements alongside heavy builds or other task
browser sessions. Public Sites v9 remains unchanged; deployment needs the
existing separate approval step after concrete accepted artifacts.

Cube acceptance is a bounded rendering milestone. It does not establish
full WebGPU/Vulkan conformance, GPU acceleration of Firefox's compositor,
general GL3/WebGL2 support or hardware video decoding.

## Local evidence consulted

- [Firefox WebGPU design](firefox-webgpu-design-20260929.md)
- [Firefox WebGL/Zink design](firefox-webgl-zink-design-20260930.md)
- [WebGPU-default virtual GPU / H1](guest-vulkan-webgpu-backend-20261001.md)
- [F1a link and startup evidence](firefox-webgl-f1a-20260930.md)
- [W0 shared mmap](firefox-mmap-shared-20260929.md),
  [W1 gates](firefox-webgpu-w1-20260929.md),
  [W3 decoder](firefox-webgpu-w3-20260929.md),
  [W4a executor](firefox-webgpu-w4a-20260930.md)
- [B2g gears/probe evidence](zink-b2g-glgears-20261001.md)
- Real Firefox 128.14 headers, `WebGPUParent.cpp`, WebGL capability checks,
  local wrapper/executor/ICD code, recorded link commands and direct artifact
  hashes; no new GPU acceptance run.


## W4b bounded ABI gate plan (read-only review)

This plan has not been compiled or run. The draft remains untouched. The
pinned generated-header hash above matches its stated ABI; the real
`gfx/wgpu_bindings/src/server.rs` hash is
`cda17e93b018088d68abc79d7a90b9efe49fccc9d2013a4c18222ad9ac5bfb31`.
The reviewed wrapper and mirror hashes are respectively
`de39ef1cadd1e78fc8b4bea30afb47fd144b0133d24b5f0516fa1fd5ef831550`
and `bfaa62b45819c9ab2f5ddda02332db7e29805f7c526c5bec679ab8fefa8ff84f`.
Freeze these inputs again after any fixes and regenerate the 43-name wrap
list from the mirror's macro. The 14 client-side `*_free` helpers are not
server wrappers and must retain their original Rust/client implementations.

### Blockers found in the draft

- Device destroy/drop at wrapper lines 780–785 only forwards the host call;
  it does not invalidate local buffer records or mapped staging. Device loss
  callbacks also leave this staging intact. `buffer_get_mapped_range` at
  lines 911–921 returns a matching cached pointer before checking local
  validity or asking the host. After destroy/drop/loss, a repeated request
  can therefore return stale data for an invalid resource. Track each
  buffer's device and invalidate/free its ranges on these transitions.
- Buffer-create failure at lines 838/843 marks `get_buf(id)` invalid even
  when that record belongs to an existing live buffer. A duplicate-ID create
  failure can corrupt the old record. Reject duplicate live IDs without
  replacing their local state; test subsequent reads and unmap of the old
  buffer as well as epoch-separated reuse.
- Uncaptured events at lines 509–513 are printed and discarded. They do not
  enter Firefox's `WebGPUParent::ForwardError` path, so page error delivery
  is incomplete. Add a small typed C++ adapter using the real parent/owner
  API; verify error scopes and uncaptured-error events independently.
- Host poll removes events with `events.splice` at executor line 786 before
  the response-capacity check at line 904. An ENOSPC response loses events;
  the wrapper counts loss but neither resizes/retries nor settles their
  closures. Make poll dequeue transactional or provide a nondestructive
  size query. Test oversized event batches and exactly-once settlement.
- Map-error classification relies partly on message matching rather than
  the native status distinctions. Verify alignment, range, usage,
  already-mapped, pending-map, aborted and lost-device results against the
  pinned Rust ABI. Asynchronous map failure must clear local mapping state.
- The draft permits only one write range and eight read ranges. This is a
  declared W4b limitation, not general mapped-range support. Reentrancy
  across poll callbacks also needs a lifetime rule: deletion during callback
  dispatch would leave the poll loop relocking freed state. Match the real
  Firefox destruction/threading contract and test legal reentrant operations.

### Compile and link gate

Use a fresh disk-backed `/mnt/p6/build/firefox-webgpu-w4b-20261002` task,
export all three temp variables to its `tmp` directory, and copy sources,
generated header, goldens and command inputs before compiling. Record hashes
and complete argv/cwd. The following is the intended command shape; harness
sources and a packager still need implementation after GPU release:

```sh
CC=/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang
"$CC" -std=gnu11 -O2 -Wall -Wextra -Werror -pthread -matomics -mbulk-memory \
  -c "$OUT/wgpu-server-wrap.c" -o "$OUT/wgpu-server-wrap.o"
"$CC" -std=gnu11 -O2 -Wall -Wextra -Werror -pthread -matomics -mbulk-memory \
  -c "$OUT/wgpu-wrapper-test.c" -o "$OUT/wgpu-wrapper-test.o"
"$CC" -pthread -static "$OUT/wgpu-wrapper-test.o" "$OUT/wgpu-server-wrap.o" \
  @"$OUT/wrap.args" \
  -Wl,--import-memory,--export-table,--shared-memory \
  -Wl,--initial-memory=4194304,--max-memory=4294967296,-z,stack-size=262144 \
  -o "$OUT/wgpu-wrapper-test.wasm"
wasm-validate --enable-all "$OUT/wgpu-wrapper-test.wasm"
wasm-objdump -x "$OUT/wgpu-wrapper-test.wasm"
```

`wrap.args` must contain exactly 43 `-Wl,--wrap=wgpu_server_NAME` arguments.
The harness calls the ordinary `wgpu_server_*` names, not `__wrap_*` names.
Add trap/abort definitions for any original server entry point so incorrect
link routing fails decisively. Do not allow duplicate definitions in this
small gate. Audit imports for guest memory/Linux syscalls only and inspect
all 43 symbol resolutions with llvm-nm/link-map evidence.

Separately compile a C++ ABI probe with the real generated header using a
copied real Firefox DOM/WebGPU compile argv (same target, defines and include
paths). Replace only its source/output arguments. Verify all function types,
by-value structs, enum widths, callback signatures and the 16-byte/alignment-8
mapped-range return convention, then add a typed C++ caller to the guest
harness for the latter and callback closures. C mirror assertions alone
cannot independently prove the C++ ABI. Owned nsString diagnostics must be
constructed/destroyed through Firefox string support in the later Firefox
integration; a fake string destructor is not an acceptable substitute.

### Guest harness cases and acceptance

Use the W4a raw-transport test only as a reference. This new harness must
call every one of the 43 wrapped ABI functions and emit a named per-function
coverage record, expected status, callback count and final allocation stats.
Do not claim textures/shaders/passes supported merely because their explicit
unsupported-error paths were invoked.

| Group | Required actual-ABI cases |
|---|---|
| Server/adapter (new, delete, poll, request-adapter, pack-info, request-device, adapter-drop) | Backend-encoded candidate IDs, null-adapter result, repeated pack-info, exact bincode consumption with real Firefox pack-info golden verifier, supported limits/features, invalid/stale IDs, two globals, final teardown |
| Device (destroy, drop, lost-callback, fence-handle) | Loss callback exactly once from guest poll, replacement callback, null fence selecting Firefox readback path, device ownership, mapped resources invalidated after destroy/drop/loss |
| Buffers (create, map, mapped-range, unmap, destroy, drop) | mapped-at-creation write/unmap, async read map/copy exact bytes, duplicate-ID rejection preserving old buffer, epoch reuse, alignment/range/usage errors, overlapping ranges, pending-map cancellation, invalid buffer, staging cleanup |
| Encoding/queue (device-action, create-encoder, encoder-action, finish, encoder-drop, submit, work-done, queue-write-action) | Pinned Firefox-generated bincode goldens for copy/clear/write, bytes after submit/map, submission index, multiple command buffers, cross-device rejection, work-done exactly once, reentrant poll callback, invalid action atomic rejection |
| Unsupported calls (shader-module, texture-action, render/compute-pass, texture-to-buffer-copy, two pipeline-get-layout calls) | Explicit Internal/unsupported error, shader false result with caller-owned diagnostic intact, no host allocation or ID publication |
| Eleven no-op drops | render-bundle, bind-group-layout, pipeline-layout, bind-group, shader-module, compute/render-pipeline, texture-destroy/drop, texture-view, sampler: exercise harmless cleanup only for unsupported object kinds and document their unimplemented lifetime semantics |
| Fault/cleanup | Owner termination, poll response too small, malformed/mismatched response and callback object/token, failed create, callback cancellation, recreate loop; live globals/buffers/ranges/pending callbacks return to zero |

Use the pinned W4b `pack-info-harness` verifier and W3 client-generated action
goldens; do not hand-encode a newer wgpu bincode schema. Include callback
user-data canaries, ErrorBuffer sentinel bytes/UTF-8 truncation and guard
bytes around mapped-range results. Host loss is a separate failure test, not
a simulated physical GPU reset. Record hardware adapter evidence, wrapper
stats and W4a/W2 regressions alongside the gate results.

### Transport, owner and Firefox integration

The guest sends private syscall `0x6a470001`, op `0x10`, WGQ1/WGR1 version 1
through W2 shared-memory hostcalls. Set machine `gpuHostcall: {}`; isolated
fault tests alone may enable `testHooks: true`. This WebGPU route does not
require the Vulkan `ownerConfig.vk` opt-in. Serve COOP same-origin, COEP
require-corp and CORP same-origin on a secure origin with SAB/atomics enabled.
Freeze/hash worker.js, hostcall.js, owner.js, wgpu executor, decoder JS/wasm,
boot inputs and all test routes. W4a currently serves the decoder from a
build/test route; retain an explicit private route for W4b, then remove that
dependency in W4c. Copy the W4a runner to the new task and change task roots,
program/tag and ports/profile; never overwrite its old evidence or start a
concurrent browser during JIT performance gates.

After the standalone gate, follow the concrete relink recipe above: accepted
JIT command and exact libjs archive, two W1 response-list replacements, W0
mmap replacement, verified wrapper object plus all 43 wrap arguments, current
TLS/NSS/thread adapters, and (when merging F1b) current B2g ICD/EGL/Gallium
plus B2c override. Preserve Rust client/free helpers. Re-run fpcast, derive
the new table minimum and remove its maximum, then package/audit against the
accepted rootfs. First Firefox acceptance is a DOM-created device with
write/copy/map byte equality, error/callback delivery and repeated cleanup,
plus existing startup/update/JIT gates. Cube acceptance waits for W4c/W5–W7.
