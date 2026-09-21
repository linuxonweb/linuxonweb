# Xserver browser boundary

This directory is an out-of-tree adapter slice for the pinned X server at
`sources/xserver` (`306071c0b9683ef0dfadcfc2dbb78d369680542b`). The upstream
tree is never patched. `build-probe.sh` attempts a real Meson cross configure
and records the first dependency/target failure; a zero exit means the source
unexpectedly gained a wasm target and is treated as a test failure. At this
pin there is no wasm display backend, OS event loop, or X server process model.

`x11_client.c` is a freestanding wasm32 client using core X11 requests
(`CreateWindow`, `MapWindow`, `CreateGC`, `PolyFillRectangle`, and
`ImageText8`). Its `x11_host.send` import carries those bytes to the
authenticated relay in `web/x11_proxy/server.mjs`; it does not emulate X11.

The relay listens on loopback, requires `X11_PROXY_TOKEN` (at least 16
characters), checks an exact browser `Origin`, and has a fixed loopback TCP
destination. It cannot become an open TCP relay. Start it with
`node web/x11_proxy/server.mjs`, serve `web/x11_proxy` from the origin in
`X11_PROXY_ORIGIN`, and open `index.html?token=...`.
