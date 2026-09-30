# gputest G2: rotating-cube Vulkan demo (2026-09-30)

`?gputest=1` on `web/linux/index.html` now boots straight into an animated,
depth-tested Vulkan cube in the guest's X11 desktop. G1 (`7e69a15`, `55055a2`)
added the page wiring; G2 adds the demo archive it appends.

## How it works

- `web/linux/tests/gputest-demo/vkcube-lite.c` is an ordinary public-Vulkan C
  app. It is linked statically with the hash-locked Khronos loader, the guest
  ICD and Xlib by `build.py` in the same directory (wasm32 musl). Each frame it
  writes a per-frame MVP into a UNIFORM_BUFFER. It renders 36 flat-coloured
  vertices (six face colours) into a 128x128 RGBA8 colour attachment plus a D32
  depth attachment, reads the colour back and presents it with nearest scaling
  (x3, or x2 in Firefox mode) through `XPutImage`. The window is titled
  "Vulkan cube (guest)". This is a CPU copy, not Vulkan WSI.
- It prints `GPUTEST_FPS <fps> frames=<n> backend=<webgpu|webgl2> frame_ms= uptime=`
  about every 2 s. It retries the first X connection for up to 60 s. Exit
  codes: 3 means the GPU session was refused or lost, 4 means X11 failed, 5
  means Vulkan setup failed. Each exit also prints a `GPUTEST_CUBE_EXIT` line.
- `/gputest-init` (rdinit) starts `/bin/busybox sh /gputest-waiter &` and then
  runs `exec /init "$@"`. It uses no subshells, so busybox never has to re-exec
  before `/proc` exists. The rootfs `/init` is unchanged.
- `/gputest-waiter` waits for `/tmp/.X11-unix/X0`, then reads `/proc/cmdline`.
  This packet moved that read after the X wait, so it no longer races `/init`
  mounting `/proc`. It then runs `DISPLAY=:0 /bin/vkcube-lite` and retries up
  to 3 times after a non-zero exit. When the command line has `firefox=1`, it
  waits 20 s longer and runs `--scale 2 --max-fps 15`, so Firefox keeps most
  of the guest CPU.
- `tools/guest-rootfs/package-gputest-demo.py --wasm BUILD/vkcube-lite.wasm`
  writes `web/linux/gpu/gputest.cpio` and its `.json`. The archive is
  uncompressed newc with no directory entries, owner 0:0 and mtime 0, and it is
  byte-reproducible.

Archive: 1,316,864 bytes, SHA-256
`1a65cf4b5430d3adabe3ee817b23313268a7915f277a316d2b47dba0d0b14fd7`.
`vkcube-lite.wasm`: 1,314,503 bytes, SHA-256
`e32798061c254aeb89103a9a692d94b78894f6f4bce447dc46bf55dce3135b91`.

## Gate results

Runs used the real page through `web/desktop/dev-server.mjs` on port 4202,
with headful Chromium on DISPLAY=:0 (`--enable-unsafe-webgpu
--enable-features=Vulkan`). The runner is
`/mnt/p6/build/gputest-g2-20260930/run-g2.mjs`. "Rotation diff" is the
fraction of pixels that changed inside the cube window between two
screenshots taken 3 s apart.

| Run dir | Query | Host backend | Frames observed | FPS mean (min–max) | Rotation diff |
|---|---|---|---|---|---|
| `gate-webgpu-run1` | `?gputest=1` | WebGPU, NVIDIA maxwell (MX110), not fallback | 3,499 over 72 s | 48.3 (46.3–58.9), about 19–21 ms/frame | 0.464 / 0.461 |
| `gate-webgl-run1` | `?gputest=1&gpubackend=webgl` | WebGL2, ANGLE Intel UHD 620 | 1,960 over 50 s | 39.1 (37.4–39.7) | 0.472 / 0.475 |
| `gate-firefox-run1` | `?gputest=1&firefox=1` | WebGPU, NVIDIA | 841 over 59 s, capped at 15 fps | 14.3 (10.5–15) | 0.445 / 0.458 |

All three runs:
- recorded no page exceptions and no console errors;
- had only benign failed requests: `favicon.ico`, a canceled request and, in
  Firefox mode, `dns?name=(none)` 404s;
- closed the browser and server with exit 0 (ports 4202 and 9412 are free);
- were checked by looking at the screenshots: the cube window shows different
  face pairs between the `a` and `b` shots.

In Firefox mode, the Firefox window (New Tab plus the privacy notice tab)
shares the desktop with the cube. Firefox's own `fork() failed` and glib
warnings are the usual single-process messages.

## Limits

- Attachments are 128x128 and are upscaled on the CPU. There is no Vulkan WSI
  and no swapchain.
- The ICD profile is experimental and not conformant. There is no OpenGL demo
  until Zink.
- Forced WebGL2 ran on the Intel iGPU through ANGLE, because Chromium picks
  that GPU for WebGL. Only the WebGPU path used NVIDIA.
- The rotation diff clips to the window geometry the demo requested. aurora-wm
  adds decorations and places the window slightly differently, but the clip
  still covers the cube window.
- The exit after host session loss (status 3, `GPUTEST_CUBE_GPU_LOST`) is
  implemented but was not exercised by a gate.
- Build outputs are in `build-run1`. `package-run1` holds the previous waiter,
  which read `/proc/cmdline` before the X wait. `package-run2` holds the
  current archive.
