# Guest Vulkan pixels presented through X11

The experimental public Vulkan application now has an optional Xlib presentation
path. Its rendered image crosses the browser GPU backend, guest readback buffer,
Xlib/Xfbdev and Linux framebuffer before an independent browser observer checks
the displayed pixels. This closes the earlier gap between readback correctness
and actually displaying the result in an X11 window.

This is an explicit CPU copy. It is not Vulkan WSI, Mesa/Zink, a GLX/EGL driver,
Firefox acceleration, hardware video decoding or a performance improvement claim.
The public runtime and rootfs are unchanged.

## Implementation and verification

Build the existing graphics client with `--host-profile webgl --present-x11`.
The build freezes and hashes the Xlib, XCB and Xau archives and Xlib/protocol
headers. Default builds do not link Xlib. The test archive still changes only
its isolated init and adds the public client.

`presentation-x11.inc` opens the guest X server, checks its TrueColor visual,
converts RGBA channels through the visual masks, and creates a 292×204 XImage
from the 73×51 readback using nearest-neighbor scaling. An override-redirect
window at (20,100) gives the fixture deterministic placement. Each of eight
rounds is drawn with XPutImage and compared using XGetImage. Exposures repaint
during bounded observation holds; image, GC, window and display close before
the application reports success. The Xlib image conversion and drawable-depth
rules are described in the [official Xlib documentation](https://www.x.org/releases/current/doc/libX11/libX11/libX11.html).

`x11-framebuffer.mjs` copies the actual displayed Linux canvas into a separate
observation canvas. It computes expected triangle coverage/interpolated colors
from the application geometry and checks the center of every scaled source
pixel away from rasterization edges. It receives no host GPU readback pixels.
The final complete Linux framebuffer is saved as a PNG, independently of the
viewport-limited page screenshot.

The initial guest run displayed the triangle and verified Xlib pixels but failed
the browser comparison after the desktop cursor overlapped the test rectangle.
Run2 moved the rectangle 16 pixels left, keeping the strict pixel checks; both
backends passed. Run3 additionally saves complete framebuffer captures. Preserve
the failed run1 and its screenshot rather than treating it as a successful run.

All builds, archives, Chromium profiles, scratch and evidence live under
`/mnt/p6/build/guest-vulkan-{graphics,webgl}-20260926/`. The runner owns a finite
HTTP server and browser, and closes both. No persistent service is introduced.

## Remaining OpenGL integration work

The [current upstream Zink requirements](https://docs.mesa3d.org/drivers/zink.html)
require Vulkan capabilities beyond this bounded driver, including logic operations,
non-solid fill, alpha-to-one, shader clip distances and several extensions even
for the minimum OpenGL version. The current ICD returns zero optional features
and device extensions and rejects enabling them. Its graphics path has one
color format, no sampled-image descriptors, no depth/stencil or blending, and
empty graphics shader resource layouts. Presentation alone cannot make it a
Zink device.

Before building or advertising Zink, pin the selected Mesa version and compare
its actual requirements and startup calls with this ICD. The implementation
needs shader resources/textures, broader graphics state and synchronization,
and real surface/swapchain integration or an explicitly supported Mesa software
presentation path. A successful standalone triangle must not substitute for
running an OpenGL X11 application or Firefox EGL/GL in the guest. Both current
browser test backends use SwiftShader; physical GPU and hardware-decoder evidence
still require a suitable environment and guest integration.
