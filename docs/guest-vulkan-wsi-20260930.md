# Guest Vulkan A6a: WSI surfaces and swapchain objects (2026-09-30)

Packet A6a of the vkcube track (`docs/vulkan-gap-zink-vkcube-20260928.md`).
It adds window-system-integration *objects* to the experimental guest Vulkan
ICD: X11 surfaces, surface queries and swapchains whose images can be rendered
and read back. It does **not** present anything yet. Acquire and present are
A6b.

Task root (ext4, disk-backed): `/mnt/p6/build/guest-vulkan-a6a-20260930`.
Base commit `7943992` plus the uncommitted tree listed below.

## What A6a provides

The ICD is built with `-DGUEST_VK_WSI=1`. Only `guest-vulkan-graphics/build.py
--app wsi` sets it, together with `VK_USE_PLATFORM_XLIB_KHR` and
`VK_USE_PLATFORM_XCB_KHR` for the static Khronos loader. Code is in
`web/linux/tests/guest-vulkan/wsi.inc`.

- **Loader interface 3.** The WSI build requires and returns interface version
  3 in `vk_icdNegotiateLoaderICDInterfaceVersion`, so `VkSurfaceKHR` handles are
  driver-owned. The loader's `wsi.c` forwards `vkCreateXlibSurfaceKHR` and
  `vkCreateXcbSurfaceKHR` to the ICD. Non-WSI builds still negotiate version 2.
  The static provider (`guest-vulkan-loader/static-provider.inc`) accepts 2 or 3.
- **Instance extensions.** The WSI build lists `VK_KHR_surface` (spec 25),
  `VK_KHR_xlib_surface` (6) and `VK_KHR_xcb_surface` (6). Their procs resolve
  only when the extension was enabled at instance creation; otherwise
  `vkGetInstanceProcAddr` returns NULL.
- **Surfaces.** Up to 4 live surfaces, from Xlib (`Display*`, `Window`) or XCB
  (`xcb_connection_t*`, `xcb_window_t`).
  - `vkGetPhysicalDevice{Xlib,Xcb}PresentationSupportKHR` and
    `vkGetPhysicalDeviceSurfaceSupportKHR` report support on queue family 0.
  - Capabilities: `currentExtent` is the window size from `XGetGeometry` or
    `xcb_get_geometry`, clamped to [1,128]. Min/max extent are 1..128, 2 to 3
    images, one array layer, identity transform, opaque alpha, usage
    COLOR_ATTACHMENT|TRANSFER_SRC.
  - Formats: only `R8G8B8A8_UNORM` / `SRGB_NONLINEAR`. Present modes: `FIFO`
    and `IMMEDIATE`. Both list queries implement `VK_INCOMPLETE`.
  - Destroying a surface retires the swapchains created on it. Destroying the
    instance clears every surface.
- **Device extension `VK_KHR_swapchain` (spec 70).** It is listed only for a
  device with the graphics profile (`device_table()`); otherwise the device
  extension list stays empty, as before.
  - The swapchain procs are exposed through instance GIPA whenever graphics is
    supported, because the loader fills its dispatch table when the instance is
    created.
  - `vkGetDeviceProcAddr` for an app returns them only when the extension was
    enabled on that device.
- **Swapchains.** Up to 4 live swapchains with up to 3 images each.
  - Creation validates its parameters. The client exercises 16 rejection
    cases among format, colorspace, extent, image count, usage, layers,
    sharing, transform, alpha, present mode and surface.
  - Images are ordinary `R8G8B8A8_UNORM` color resources with bound device
    memory. They can be wrapped by image views and framebuffers, cleared or
    drawn, and copied to buffers like any A1-A5 image.
  - The swapchain owns its images and memory. `vkDestroyImage` and
    `vkFreeMemory` on them are ignored (`transfer.inc` marks
    `resource.swapchain`). `vkDestroySwapchainKHR` and device destruction
    release them and restore `allocated_bytes`.
- **oldSwapchain.** A valid `oldSwapchain` is retired. A retired swapchain's
  images stay usable until it is destroyed, but it can no longer be acquired.
  - Replacing an already-retired swapchain is refused.
  - A second active swapchain on the same surface returns
    `VK_ERROR_NATIVE_WINDOW_IN_USE_KHR`.
- **Acquire/present stubs.** `vkAcquireNextImageKHR` and `vkQueuePresentKHR`
  return `VK_ERROR_FEATURE_NOT_PRESENT`, or `VK_ERROR_OUT_OF_DATE_KHR` for a
  retired or surface-lost swapchain. Both are marked TODO(A6b).
- **Cleanup markers.** The ICD prints `GUEST_VK_WSI_LIVE swapchains=N leaked=N`
  and `GUEST_VK_WSI_SURFACES live=N leaked=N` at teardown.

### Review fix in this packet

`wsi_create_swapchain` used to mark `oldSwapchain` retired only after the new
swapchain had been fully created. Vulkan says `oldSwapchain` is retired even
when the create fails. The retirement now happens immediately after the
surface-ownership check, before image allocation. Everything else I reviewed
was correct and left unchanged:

- surface and swapchain lifetime, and the image-then-memory release order;
- device and instance cleanup;
- capability queries;
- extension and proc gating;
- interface-3 negotiation;
- the unchanged non-WSI paths.

## Known limits (accepted for A6a)

- **No presentation.** Nothing reaches the X11 window yet: acquire and present
  return `FEATURE_NOT_PRESENT`. A6b adds acquire, plus present through
  `XPutImage` with FIFO pacing.
- Extents are capped at 128x128, like every guest render target. A larger
  window reports a clamped `currentExtent`, which is not the true window size
  that the spec requires.
- Only one format (RGBA8 UNORM, SRGB_NONLINEAR) is supported. The X visual is
  not inspected, so A6b must convert to the visual on present.
- `IMMEDIATE` is advertised, but it has no meaning until present exists.
- A retired swapchain keeps the window until it is destroyed. Creating a new
  swapchain with `oldSwapchain=NULL` in that state returns
  `NATIVE_WINDOW_IN_USE`.
- `vkGetDeviceGroup*`, `VK_KHR_display`, Wayland, `VK_EXT_swapchain_maintenance1`
  and `vkGetSwapchainStatusKHR` are absent.
- This is still the bounded, nonconformant profile. It is not vkcube, Zink or
  Firefox support.

## Test client

`web/linux/tests/guest-vulkan-wsi/client.c` (with `guest.html`) links the
public static loader. It checks:

- instance extension enumeration and `INCOMPLETE`;
- NULL procs without the extensions;
- Xlib, large-window Xlib and XCB surfaces;
- presentation support, capabilities including after a window resize, formats
  and modes;
- device-extension gating;
- 16 swapchain rejections;
- a 3-image FIFO Xlib chain: every image cleared through a render pass and read
  back pixel-exact, with `vkDestroyImage` on a swapchain image ignored;
- acquire and present stubs;
- `oldSwapchain` retirement, refused replace-of-retired and in-use cases;
- a 2-image IMMEDIATE chain;
- a 2-image XCB chain whose surface is destroyed first (`OUT_OF_DATE`);
- a clamped 128x128 chain;
- full teardown with zero leaked swapchains, surfaces, resources and bytes.

## Commands

All commands ran with `TMPDIR=TMP=TEMP=/mnt/p6/build/guest-vulkan-a6a-20260930/tmp`.

Pinned WSI headers come from Vulkan-Headers `98f440ce` (the same revision as
the existing headers) and live in `wsi-headers-run1/`, with `retrieval.json`.

| Header | SHA-256 prefix |
|---|---|
| `vulkan_xlib.h` | `e2efd24a...` |
| `vulkan_xcb.h` | `972d6d7f...` |

Rebuild every regression package. `rebuild-all.sh` in the task root calls
`rebuild.sh` (wsi, depth, texture, uniform, loader), then builds the direct,
compute and graphics packages. Every graphics-family build freezes `wsi.inc`,
so all packages have to be rebuilt after any ICD edit:

```sh
/mnt/p6/build/guest-vulkan-a6a-20260930/rebuild-all.sh 6 5   # log: rebuild-all-run6.log
```

Full regression (WebGPU on NVIDIA, headful `DISPLAY=:0`, Chromium
`/home/a/.local/archpkg/pacman/usr/bin/chromium --enable-unsafe-webgpu
--enable-features=Vulkan --ignore-gpu-blocklist`; ports 4203/9413):

```sh
cd web/linux/tests/guest-vulkan
HTTP_PORT=4203 CDP_PORT=9413 PKG_RUN=5 REQUIRE_WEBGPU_VENDOR=nvidia timeout 1500 \
  node run-finite.mjs /mnt/p6/build/guest-vulkan-a6a-20260930/all-run2 \
  /mnt/p6/build/guest-vulkan-a6a-20260930
```

## Results: `all-run2` (authoritative)

`all-run2/result.json`: `pass: true`, SHA-256 `490b6c1d...bb702`.

- Browser exit was 0 and the server closed. Ports 4203/9413 were closed
  afterward.
- The only HTTP error was `/favicon.ico`.
- Adapters:
  - WebGPU: `nvidia/maxwell`, not a fallback adapter.
  - WebGL2: ANGLE on Intel UHD Graphics 620 (Mesa, OpenGL 4.6).

18 of 18 suites pass. Every pre-existing count is identical to A5
(`/mnt/p6/build/guest-vulkan-a5-20260929/all-run1`), so the non-WSI behavior is
unchanged.

| Suite | Checks |
|---|---:|
| direct-live | 140 |
| direct-unavailable | 17 |
| direct-clear | 1,087 |
| direct-loss-transport | 640 |
| direct-loss-device | 640 |
| direct-exhaustion | 1,213 |
| loader | 901 |
| compute | 501 |
| graphics-webgl2 / graphics-webgpu | 232,753 / 232,745 |
| uniform-webgl2 / uniform-webgpu | 201,269 / 201,269 |
| texture-webgl2 / texture-webgpu | 18,182 / 18,182 |
| depth-webgl2 / depth-webgpu | 42,620 / 42,620 |
| **wsi-webgl2 / wsi-webgpu** | **276,963 / 276,963** (new) |

WSI guest markers (identical on both backends):

- `SURFACES_CREATED xlib=2 xcb=1 support_family0=1`
- `SWAPCHAIN_REJECTED count=16`
- `SWAPCHAIN_PASS images=3 extent=96x80 mode=fifo rendered=4
  acquire=feature_not_present present=feature_not_present`
- `RETIRE_PASS old=out_of_date replacement_images=2 replace_retired=refused
  in_use=refused`
- `XCB_PASS images=2 extent=64x48 surface_first=out_of_date`
- `CLAMPED_PASS images=2 extent=128x128`
- Teardown: `WSI_LIVE swapchains=0 leaked=0`, `WSI_SURFACES live=0 leaked=0`,
  `GUEST_VK_RESOURCES live=0 allocated_bytes=0`

Host counters for wsi-webgpu:

- 40 commands, 9 graphics passes, 9 readbacks, 0 draws (clears only), 18
  submits.
- 9 buffers and 9 textures were created, and all 9 of each were destroyed.
- One Worker and one device; every live count was 0 before emergency cleanup.

Canceled Fetch events (`ERR_ABORTED`, cause not established) occurred once in
wsi-webgl2 and twice in wsi-webgpu, as in earlier packets.

Artifacts:

- WSI build `wsi-build-run6`: client 1,308,644 bytes, SHA-256
  `2022abc1bd9a4f9924d02b515e3ca9e56ef88ab89604c742e5a95491e1765152`, with 53
  public Vulkan symbols.
- Package `wsi-package-run5`: initramfs 41,804,432 bytes, SHA-256
  `089460233d2162be5b7f601cb0bf5938c691aae70f11b7bb370409ce49fb8eb2`.
- All other packages: `*-build-run6` and `*-package-run5` (direct packages:
  `direct-package-<mode>-run5`).

Earlier runs, all preserved:

| Run | Outcome |
|---|---|
| `all-run1` | Passed a 6-suite subset with `package-run4`: wsi x2, depth-webgpu, loader, uniform, texture. |
| `wsi-run1` | Failed: page watchdog at 135 s, guest did not finish. |
| `wsi-run2` | Failed with `wsi client acceptance mismatch`, although the guest exited 0 with 276,963 checks. It used `wsi-package-run3`. `all-run1` used `wsi-package-run4` and passed with an identical marker set and runner snapshot. The exact cause was not re-established. |
| `wsi-build-run1-storage-guard-fail.log` | Failed: storage guard, before the task root was registered. |

Build runs 1-5 and package runs 1-4 are also kept.

## Source files

Modified:

- `web/linux/tests/guest-vulkan/icd.c`
- `web/linux/tests/guest-vulkan/transfer.inc`
- `web/linux/tests/guest-vulkan/run-finite.mjs`: `HTTP_PORT`/`CDP_PORT`
  overrides and the wsi suites
- `web/linux/tests/guest-vulkan-loader/static-provider.inc`
- `web/linux/tests/guest-vulkan-graphics/build.py`
- `web/linux/tests/guest-vulkan-graphics/package.py`
- the four `storage.py` files (guest-vulkan, loader, compute, graphics), which
  register the task root

New:

- `web/linux/tests/guest-vulkan/wsi.inc` (SHA-256 `2ba2b235...`)
- `web/linux/tests/guest-vulkan-wsi/client.c` (`75349154...`)
- `web/linux/tests/guest-vulkan-wsi/guest.html` (`ec3a3d38...`)

## Next: A6b

- Implement `vkAcquireNextImageKHR`: image rotation, semaphore and fence
  signaling, and timeouts consistent with the A2 non-blocking waits.
- Implement `vkQueuePresentKHR`: read back the presented image and convert it
  to the window visual. Reuse the `presentation-x11.inc` XImage path and
  `XPutImage` it.
- Add FIFO pacing, then a WSI vkcube-style loop (A7).
