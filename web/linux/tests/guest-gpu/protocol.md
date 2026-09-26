# Isolated guest GPU command prototype

This is a real guest C application commanding browser WebGPU through Linux
AF_VSOCK. The returned GPU pixels are verified by the guest, then drawn into its
own X11 window. It is not a Vulkan ICD, EGL/GLES implementation, Firefox backend,
or physical-GPU claim. XPutImage/readback is a correctness path, not fast WSI.
The accepted rootfs, default boot and persistent home are not modified.

The existing kernel enables virtio-vsock but disables DRM. Host vsock currently
initiates connections, so the guest library binds port 4050 and accepts one host
connection. A future service can broker more guest clients, with one resource
namespace per connection. No guest pointer or native driver handle crosses it.

## Wire ABI version 1

All numbers are little-endian. Header: magic `0x31555047` u32, version 1 u16,
opcode u16, strictly increasing nonzero request ID u32, payload length u32.
Requests are serialized. Reply opcode has bit 15 set; reply payload starts with
signed status i32 (0 success, -22 rejected request, -19 unavailable device), then
data or a bounded UTF-8 diagnostic. Structural errors close the session.

Requests are at most 1 MiB. READBACK may return 1 MiB data plus four status bytes;
the largest reply frame is 1 MiB + 20 bytes. Maximum 64 live resources, 16 MiB
resource allocation, 64 KiB shader/vertex payload, and 512x512 RGBA8 targets.
Readback staging is counted against the same 16 MiB budget. Resource IDs are session-local, monotonic,
typed and never reused. Disconnect/deadline/device loss destroys all resources.

| Op | Request | Reply data |
|---|---|---|
| 0 HELLO | empty | JSON capabilities and observed adapter identity |
| 1 SHADER | UTF-8 WGSL, vertex `vs`, fragment `fs` | resource ID u32 |
| 2 BUFFER | packed float32 x,y,r,g,b vertices | resource ID u32 |
| 3 PIPELINE | shader ID u32 | resource ID u32 |
| 4 TARGET | width,height u32 | resource ID u32 |
| 5 DRAW | target,pipeline,buffer IDs and vertex count u32 | empty |
| 6 READBACK | target ID u32 | tightly packed top-to-bottom RGBA8 |
| 7 DESTROY | resource ID u32 | empty |
| 8 CLOSE | empty | empty; close after reply |
| 9 CLEAR (opt-in only) | target ID u32 + RGBA float32 little-endian (20 bytes total) | empty after GPU completion |

CLEAR is enabled only by the isolated host's explicit `allowClear:true` option;
only then does HELLO include `clearImage:true`. With the default host option,
opcode 9 is a structural error that closes the connection. Clients must inspect
the capability before issuing it. It accepts a live TARGET ID and four finite
components in [0,1]; wrong types, stale IDs, malformed lengths and nonfinite or
out-of-range components are rejected. The host performs a real WebGPU render-pass
clear, submits it, and waits for queue completion before replying. READBACK still
performs a real texture-to-staging copy/map and removes WebGPU row padding. This
extension supports the separate experimental Vulkan-shaped clear/copy fixture;
it does not change the default triangle path into a Vulkan implementation.

The C library closes/poisons its descriptor after framing, I/O or caller-capacity
errors, so an unread response cannot desynchronize a subsequent call.
The host awaits GPU submission and mapping completion. No Canvas2D shader/raster
fallback exists. Missing WebGPU reports an explicit host error and closes the
stream. Guest SIGALRM bounds its entire process to 90 seconds, host RPC lifetime
to 60 seconds, and the isolated launch page closes the machine after 120 seconds.
The app verifies both a black clear corner and interpolated center color,
creates a real X11 window, checks stale-ID rejection and releases all resources.

## Build and acceptance (commands run by the command agent)

After review, verify the filesystem is disk-backed and has sufficient free space,
then build into fresh directories. Stop if the storage is tmpfs/ramfs or full:

```sh
findmnt -T /mnt/p6/build -o TARGET,FSTYPE,AVAIL
df -h /mnt/p6/build
mkdir -p /mnt/p6/build/guest-gpu-reproduce-20260926/tmp
export TMPDIR=/mnt/p6/build/guest-gpu-reproduce-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR" PYTHONDONTWRITEBYTECODE=1
python3 web/linux/tests/guest-gpu/build.py --output /mnt/p6/build/guest-gpu-reproduce-20260926/build-run1
python3 web/linux/tests/guest-gpu/package.py --build /mnt/p6/build/guest-gpu-reproduce-20260926/build-run1/build.json --output /mnt/p6/build/guest-gpu-reproduce-20260926/package-run1
```

The package script verifies the accepted plain rootfs hash, modifies only the
test copy of `/init` to start the helper after X11 readiness, adds one executable,
and compares every other original record byte-for-byte. No archive mutation has
occurred merely by adding these scripts. Builds validate Wasm, and the ABI log
must contain only the existing shared-memory/Linux imports.

Open `host-test.html` on the isolated development server first. It exercises
actual WGSL rendering/readback, fragmented transport, malformed headers, bounds,
stale resources, unavailable API and forced device loss. Then open `index.html`
and click its boot button. Acceptance requires all three guest PASS markers,
host draw/readback counts, no host error, and a screenshot showing the guest
X11 triangle. A SwiftShader adapter proves semantics only, not physical GPU use.
Use a fresh test profile: importing the runtime can read that profile's cached
kernel selection, although this test never opens the home database.

`run-browser.mjs host|guest` is the reproducible Node 22 CDP runner. Set
`GPU_QA_OUT` to a fresh directory under the verified task disk and export
`TMPDIR`, `TMP`, and `TEMP` there before each test invocation; optional `CDP_URL` and `GPU_QA_BASE` select the
owned browser and server. It does not launch a browser or alter GPU flags.
The runner records current state every poll, a 60-second checkpoint, browser
errors and a final screenshot even on failure, then stops its guest and closes
only its own tab. The guest deadline is 125 seconds. The third guest acceptance
run used this checked-in runner and passed in 3.231 seconds.

## Connection to the full guest graphics goal

Firefox 128's archived `gfx/wgpu_bindings/src/server.rs` receives serialized
DeviceAction, QueueWriteAction and command encoder actions; its shader creation
accepts WGSL. That is an integration boundary for replacing the explicitly
patched wasm32 Empty HAL, with full capability/error/callback handling and
readback presentation first. This protocol tests transport, driver-side object
lifetime, shader execution and readback needed by that backend; it does not yet
implement the large Firefox binding/HAL surface.

For guest EGL/GLES, Firefox is built with EGL as default GL provider. ANGLE's
WebGPU renderer is a potential porting input, but upstream does not advertise
completed WebGPU platform support. A C WebGPU implementation or custom ANGLE
proc table would have to use this transport and implement its broader calls.
WebGL host fallback can use the same connection/lifetime rules but requires a
separate shader language/capability negotiation; do not silently reinterpret
WGSL as GLSL or claim a missing WebGPU device was WebGPU-backed.

Venus/virgl are not drop-in browser drivers. Venus requires host Vulkan external
memory and virtio-gpu facilities; Zink requires Vulkan features/extensions beyond
this deliberately small bridge. No Vulkan/OpenGL conformance is advertised.
Hardware decode similarly requires a separate compressed-video/WebCodecs path,
not a triangle renderer or framebuffer upload.

Primary references reviewed:

- [Mesa Venus requirements](https://docs.mesa3d.org/drivers/venus.html)
- [Mesa Zink requirements](https://docs.mesa3d.org/drivers/zink.html)
- [Mesa VirGL architecture](https://docs.mesa3d.org/drivers/virgl.html)
- [wgpu WebGPU backend boundary](https://wgpu.rs/doc/wgpu/struct.Backends.html)
- [ANGLE platform support](https://chromium.googlesource.com/angle/angle/+/refs/heads/main/README.md)

Historical triangle baseline: Wasm build/ABI and isolated archive preservation passed. The host passed
38 checks with Google SwiftShader (software semantics, not physical GPU use).
Actual guest acceptance passed on the third attempt: all three guest markers,
center RGBA `63,66,126,255`, 13 host commands, one draw, one readback, four
releases, no host/guest errors or browser runtime exceptions, and a screenshot
of the real guest X11 triangle. The adapter reported fallback SwiftShader.
The first attempt exposed a runner readiness race and lost diagnostics; the
second exposed TextDecoder rejecting shared console memory. Both fixture fixes
were in place for the passing run; no guest binary/archive rebuild was needed.
[Result](../../../../docs/evidence/runtime-graphics-20260926/guest-gpu-qa3.json)
and [screenshot](../../../../docs/evidence/runtime-graphics-20260926/guest-gpu-qa3.png)
record the bounded prototype proof, not EGL/GL/Vulkan/Firefox support.
See [pinned ANGLE/Dawn feasibility notes](../../../../docs/guest-gpu-angle-feasibility-20260926.md)
for the remaining EGL/Firefox integration work.


The later clear/readback continuation reran this host regression and passed
**73 checks**, preserving the original real triangle gates and adding explicit
CLEAR negotiation/default refusal, malformed input, wrong/stale resource type,
two complete 17×3 pixel comparisons and device-loss resource cleanup. It used
Google SwiftShader fallback, with no browser runtime exceptions. This does not
supersede or rerun the historical X11 triangle guest: the new real guest proof is
the separate direct Vulkan-shaped clear/copy profile. See the
[clear/readback execution report](../../../../docs/guest-vulkan-clear-readback-20260926.md)
for the exact scope, artifact identities and results.
