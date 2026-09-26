# Experimental guest graphics fallback

`../guest-gpu/host.mjs` connects the bounded renderer to the guest protocol.
Callers must explicitly enable `allowGraphics` and `allowWebGL` and supply the
pinned GLSL translator options. WebGPU is preferred. WebGL2 is selected only
when initial WebGPU acquisition fails; initialization and device loss after
acquisition remain failures on the selected backend.

WebGL HELLO advertises SPIR-V graphics, stride 252 and integer viewports. It
does not advertise compute or the older clear profile. Private WGSL, compute
and clear operations receive recoverable rejection. Context, Worker, native
objects and transport are owned by the session; pending acquisition has bounded
waiting and late-resource disposal.

The experimental C ICD reads the negotiated limits. Its separate public Vulkan
client checks those limits, rejects unsupported stride/fractional viewports,
and runs the same eight shader/layout rounds on either backend. This is a
partial static built-in ICD, not a conformant Vulkan implementation.

## Reproduce the guest gate

Use verified disk-backed `/mnt/p6/build` paths and export `TMPDIR`, `TMP`, and
`TEMP` to the matching task's short `tmp` directory before each command. Build
and package with the existing graphics scripts, passing `--host-profile webgl`
to `../guest-vulkan-graphics/build.py`. The source audit and shader fixture
arguments are the same as the original graphics gate.

Run with Node 22 or later:

```sh
node web/linux/tests/guest-vulkan-webgl/run-guest.mjs \
  /mnt/p6/build/guest-vulkan-webgl-20260926/fresh-run \
  /mnt/p6/build/guest-vulkan-graphics-20260926/webgl-integration-package-run2
```

The runner freezes and checks package/source/translator hashes, owns one finite
HTTP server and Chromium process, runs both actual Linux guests, records native
ownership before emergency cleanup, captures screenshots, and closes its owned
processes. Passing a verified compute package instead runs only the shared
compute regression. The fixed local compiler/browser paths are recorded in
the build/run evidence; this fixture is not a deployment command.

`host-initialization.test.mjs <fresh-output-directory>` tests acquisition failure,
late resource disposal and wire rejection with synthetic contexts. Its results
do not establish native rendering. See the compact verified evidence in
`docs/evidence/runtime-graphics-20260926/guest-vulkan-webgl-integration.json`.

## Current limits

Actual guest graphics and compute pass under SwiftShader. Default builds verify
returned pixels in guest memory and show the ordinary Aurora desktop.
Optional `--present-x11` graphics builds now present readback through Xlib and
independently verify the displayed Linux framebuffer on both browser backends.
See `docs/guest-vulkan-x11-presentation-20260926.md`; this is a CPU copy and not
Vulkan WSI. Mesa/Zink/OpenGL, Firefox acceleration, hardware decoding, native
JIT and physical GPU performance remain separate unfinished work.
No experimental fixture is included in the public release.
