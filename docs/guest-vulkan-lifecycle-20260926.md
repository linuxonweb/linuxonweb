# Experimental guest Vulkan lifecycle — 2026-09-26

The isolated lifecycle now executes inside the native wasm32 Linux guest. Its
first live run passed 38 checks; its first deliberately unavailable-host run
passed 11 checks. These results establish official Vulkan C signature calls,
ICD procedure lookup, guest handle lifetime and a real browser WebGPU device
lifetime. They do not establish Vulkan rendering or a usable Vulkan driver.
The fixture remains excluded from public Sites version 6.

[Compact evidence](evidence/runtime-graphics-20260926/guest-vulkan-lifecycle.json)
records the raw report hashes, frozen source/header provenance, exact markers,
host ownership, package audits and cleanup. Full reports and logs remain under
`/mnt/p6/build/guest-vulkan-20260926/`; the compact report omits full boot logs.

## Implementation and provenance

The new `web/linux/tests/guest-vulkan/` fixture statically links `icd.c` with a
small C lifecycle client. The client calls `vk_icdGetInstanceProcAddr` and typed
Vulkan function pointers directly; it does not discover a driver through a
system Vulkan loader. Dispatch handles have the Khronos loader prefix, with
wasm32 handle-size assertions. The instance accepts a vsock connection and
performs HELLO; device creation performs a second HELLO; instance destruction
sends CLOSE. The existing `guest-gpu` C transport and host implementation are
reused without changes. The new host wrapper records actual device creation,
destruction and transport closure.

The build uses unmodified Khronos 1.3.231 C headers already vendored in archived
Firefox 128.14.0 ANGLE sources. Four header hashes and their local source path
are pinned in the evidence; license notices remain intact. This is local-byte
provenance, not a new upstream authenticity verification. No Dawn implementation
or shader compiler was built for this slice.

Compilation/linking, Wasm validation and the Linux-import allowlist passed. The
exact invocation and logs are retained under `build-run1/`. The guest artifact is
`/mnt/p6/build/guest-vulkan-20260926/build-run1/guest-vulkan-lifecycle.wasm`,
41,861 bytes, SHA-256
`0f2b0d4b611f2a8930e343ca1d6145824d1e48d4654307d322626b15c28e3c24`.
Its only imports are shared `env.memory`, `linux.syscall`,
`linux.get_thread_area` and `linux.copy_siginfo`.

Both test packages derive from the accepted plain image with SHA-256
`3abcabf273287eada1663c5fc4baedc7f7e28b379c580b796cfebea0f531d1be`.
Packaging changed only the copied `/init`, added `/bin/guest-vulkan-lifecycle`,
and preserved 3,846 other original records and the archive tail. Live and
unavailable archives are 40,537,640 and 40,537,660 bytes respectively; their
hashes are in the compact evidence. The fixture does not attach persistent home
or modify accepted boot images. Build, packaging, browser profiles, caches and
scratch stayed on `/mnt/p6` ext4 with `TMPDIR`, `TMP` and `TEMP` set to the task's
`tmp` directory.

## Actual execution

Both runs used visible Chromium 150.0.7871.114, cross-origin isolation, actual
1,073,741,824-byte guest memory and two CPUs. Kernel evidence independently
reports `smp: Brought up 1 node, 2 CPUs` and
`Memory: 1000512K/1048576K available (42560K reserved, 0K cma-reserved)`.
A fresh task browser profile used explicit software WebGPU/SwiftShader flags.
Preflight and both guest HELLO replies identify vendor `google`, architecture
`swiftshader`, and `isFallbackAdapter: true`.

| Gate | Observed result |
| --- | --- |
| Live lifecycle | 38 checks, exit status 0, no runtime errors |
| Wire calls | HELLO / HELLO / CLOSE; all three statuses 0 |
| Host ownership | One real WebGPU device created, one destroyed, one connection closed |
| Guest ownership | One instance/device created and destroyed; zero live instances/devices |
| Graphics operations | Zero draws/readbacks; no rendering resources created |
| Unavailable host | 11 checks, exit status 0, no runtime errors |
| Unavailable ownership | Zero host/guest devices created; one connection closed |

The live client also checks procedure visibility, loader-interface negotiation,
physical-device count/incomplete enumeration, stable queue handles and loader
magic. It rejects Vulkan 1.1 instance requests, unsupported instance/device
extensions, the geometry-shader feature, a feature `pNext` chain and queue
family 1. It confirms zero queue capability flags and NULL `vkQueueSubmit` and
`vkCreateImage` procedure results. Guest destruction ends with
`GUEST_VK_LIFETIME_PASS live_instances=0 live_devices=0` and
`GUEST_VK_EXIT status=0 checks=38`.

The negative fixture deliberately supplies `gpu:null` to the host despite the
browser exposing `navigator.gpu`. Instance creation returns
`VK_ERROR_INITIALIZATION_FAILED` with a NULL handle. No successful HELLO or
physical-device enumeration follows, and no instance or device is created.
`GUEST_VK_UNAVAILABLE_PASS` and `GUEST_VK_EXIT status=0 checks=11` confirm the
expected path. No WebGL or other fallback renderer is invoked.

The sole serving owner completed cleanup, recorded in task `cleanup.json`:
owned browser/adapter PIDs are absent, ports 4182 and 9396 are closed, and only
the exact candidate symlinks were removed. Browser shutdown was graceful. The
adapter closed its listener on SIGTERM but remained alive after the grace period;
root authorized SIGKILL after checking its exact identity, producing service
exit 137. This is post-test service cleanup, not a guest execution failure.
The unrelated user server PID 1591443 retained its start/command identity.

## Limits and the next executable slice

This experiment exposes one lifecycle queue with flags zero. All rendering
entrypoints are absent. The experimental device name, zero PCI identifiers and
`VK_PHYSICAL_DEVICE_TYPE_OTHER` avoid presenting a physical GPU. These passes do
not demonstrate system-loader integration, Vulkan conformance, OpenGL,
GL-through-Vulkan, Firefox GPU APIs, hardware video decoding, native guest JIT
or physical acceleration. SwiftShader provides software semantic evidence.
Runner completion times are not rendering or performance benchmarks; these
checks do not establish a 95/100 overall goal result.

The next bounded slice is a direct guest Vulkan offscreen clear and exact
readback. It needs typed image/buffer/memory operations, command recording and
submission, explicit resource ownership, synchronization and asynchronous
completion/failure handling. A guest program must submit the clear through the
Vulkan entrypoints and read bytes back into guest memory, compare exact expected
pixels, then destroy every guest/host resource. Unsupported descriptors,
unavailable/lost host devices, disconnects and teardown must also be checked.
Only implemented capabilities should be advertised. Loader discovery, shader
translation, presentation, OpenGL and Firefox integration remain later gates.
