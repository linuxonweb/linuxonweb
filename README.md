# Build and deploy (release)

Current release: guest Firefox Nightly 159 (wasm32 musl) with the PBL JIT
(PBLIC wasm IC stubs + PBLBC method compiler), optimized with the original
`wasm-opt -O2` plus the `--fpcast-emu` ABI pass, no debug info.

## Build

Requirements: the existing Nightly build tree
`/mnt/p6/build/firefox-nightly-musl-jit-full-20261002` (source + `obj-nightly`),
the nix wasm32 toolchain from `tools/nightly-musl/recipe/environment.sh`,
binaryen `wasm-opt`/`wasm-validate` 131, Python 3 and Node.js 22. Use a
persistent disk directory for output (not `/tmp`, `/dev/shm` or tmpfs), with
about 3 GB free and 24 GB RAM for the optimizer.

```sh
tools/nightly-musl/release/build-firefox-release.sh /mnt/p3/codex-build/release/ff1
```

The script:

1. Compiles the JIT object from the upstream `PortableBaselineInterpret.cpp`
   plus `tools/nightly-musl/pbl-jit/` (patch, `PblIc.inc`, `PblIcOps.h`,
   `PblMethod.inc`).
2. Replaces that member in the Nightly `libjs_static.a`.
3. Builds `glremote.o` (`web/linux/tests/guest-glremote/build.sh`).
4. Links Firefox with `tools/nightly-musl/release/firefox-link.args`.
5. Runs `wasm-opt -O2`, then `wasm-opt --fpcast-emu`, and validates both.
6. Writes `report.json`, then builds the boot package
   (`package-firefox-native-gpu.py`, then `slim-firefox-package.py`) in
   `OUT/package`.

Total time is about 20 minutes (BINARYEN_CORES=4), mostly the optimizer. Test-only relinks may skip
`-O2` but must keep `--fpcast-emu`; an unoptimized build is noticeably slower.

## Deploy

Local dev server (serves `/linux/` on port 3000 and restarts itself when a
new build is published):

```sh
LINUX_WEB_PORT=3000 node web/desktop/dev-server.mjs     # if not already running
node web/desktop/publish-build.mjs /mnt/p3/codex-build/release/ff1/package
```

`publish-build.mjs` checks every manifest asset's size and sha256, copies the
package into `web/desktop/latest-build/`, and writes `latest-build.json` last.
Open pages offer the new build in-page; `update=1` in the page query accepts
new packages and root filesystems automatically. To roll back, publish the previous
package directory again.

Open http://localhost:3000/linux/index.html?firefox=1. Query options:
`pblic=0` (JIT off: the portable baseline interpreter only), `pblbc=0`
(IC stubs only, no method JIT), and `debug=1` (GL statistics in the console).

Public hosting (ChatGPT Sites) is built from `web/sites/`; follow
`web/sites/README.md` (`npm run build`, `npm test`, then upload). Keep the
previous Sites version for rollback.

# Quick start

From this repository, start the localhost HTTP server (Node.js required):

```sh
LINUX_WEB_PORT=3000 node web/desktop/dev-server.mjs
```

If port 3000 already serves this project, use that server. It supplies the
cross-origin isolation headers required by Wasm threads and the guest network
proxy; a generic static server without those headers is insufficient.

Open a clean URL:

| Mode | URL |
| --- | --- |
| Normal X11 desktop with Aurora WM | http://localhost:3000/linux/index.html?wm=1 |
| Firefox on the desktop | http://localhost:3000/linux/index.html?wm=1&firefox=1 |
| Vulkan test through Rust wgpu / WebGPU | http://localhost:3000/linux/index.html?wm=1&gputest=wgpu&wgpubackend=webgpu |
| Vulkan test through Rust wgpu / WebGL | http://localhost:3000/linux/index.html?wm=1&gputest=wgpu&wgpubackend=webgl |

On the normal desktop page, choose **Power → Start desktop WM**. Power also
offers **Start console**, **Start Firefox**, and **Stop guest** while running.
Use **Settings** to choose CPU, memory, resolution and display output. **More**
starts the selected GPU test in the same tab, using the normal X server and
Aurora WM. WebGPU needs browser support and an available adapter. The Vulkan
rendering path currently presents GPU readback with XPutImage; the displayed
frame rate is not a direct GPU presentation measurement. The served Firefox
baseline is separate from the pending Nightly 159 JIT startup acceptance.

The Linux display starts at the page top. Status appears below the display in
normal page flow. The floating **Tools** icon starts near the top and can be
dragged; click it to fold or expand the controls to its right. Tools start expanded.
**Paste** reads host text or a PNG image on your click and sets the real X11
clipboard before requesting paste in the focused Linux app. Text works in
console mode too; image paste requires an app that accepts PNG clipboard data.
**Copy** prefers the Linux X11 selection (PRIMARY), then CLIPBOARD, and writes
text or PNG to the host clipboard. Its notification shows a bounded text or
image preview. Browser permission and HTTPS/localhost restrictions still apply.

**More → Info** shows browser/GPU identity where exposed, and WebCodecs support
for tested codec configurations. Hardware preferences are hints; actual video
hardware use is unknown. Click a WebGPU/WebGL view to run its actual rendering
demo for 10 seconds. Closing Info releases its rendering resources.

The default desktop rootfs includes `/bin/glgears`, `/bin/vkgears`, `xclip`, and
the clipboard bridge through a checked desktop-extras overlay. In a guest
terminal, launch the OpenGL gears port with Mesa software rendering:

```sh
DISPLAY=:0 LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=softpipe glgears -info -readrgba -check -size 128x128 -seconds 10
```

For the Vulkan gears port, open
http://localhost:3000/linux/index.html?wm=1&gpu=1&gpubackend=webgpu
(use `gpubackend=webgl` for the fallback), start the desktop, then run:

```sh
DISPLAY=:0 vkgears -info -seconds 10
```

These are ports of the established Mesa `glxgears` scene. `glgears` uses EGL
and XPutImage; `vkgears` uses the public Vulkan API, a static Khronos loader,
and the guest ICD with a bounded render target and XPutImage readback. Stock
`glxgears` needs GLX and stock `vkcube` needs Vulkan WSI/swapchain entry points
that this guest does not provide. The ports do not establish full GLX/Vulkan
application compatibility. Their fresh default-overlay guest execution is
still being checked; compilation alone is not a runtime pass.

Rebuild the overlay using an existing completed static Mesa/Xlib and Vulkan
loader build, then package the four compiled applications:

```sh
python3 tools/guest-rootfs/build-desktop-extras.py --cc "$WASM_CC" --cxx "$WASM_CXX" --gl-build "$GL_BUILD" --mesa-source "$MESA_SOURCE" --vk-build "$VK_BUILD" --output "$EXTRAS_BUILD"
python3 tools/guest-rootfs/package-desktop-extras.py --build "$EXTRAS_BUILD"
```

The build command requires explicit dependency paths and a new output
directory; it reuses those archives without rebuilding Firefox or Mesa.

# Linux on Web

A wasm32 Linux guest with TinyX, Aurora WM, persistent home storage, and a
WebSocket network proxy. Runtime source and assets live in `web/linux/`;
`web/desktop/dev-server.mjs` serves both desktop entry points and `/linux/`.
