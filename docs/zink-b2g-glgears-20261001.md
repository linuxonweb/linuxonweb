# Zink B2g: glgears on Zink over the guest ICD + S2 gears score table (2026-10-01)

**Task directories.** All are ext4 and disk-backed, with TMPDIR/TMP/TEMP under
each task's `tmp`:

- `/mnt/p6/build/glgears-zink-20261001`: iteration runs and eglprobe.
- `/mnt/p6/build/gears-s2-20261001`: the score runs.
- `/mnt/p6/build/zink-b2d-20261001`: the regression. This root is allowlisted
  in `storage.py`, so runs 3/4 were added there.

**Base and Mesa.** Base is `81c9722` (B2d). Mesa 26.2.3 is unchanged apart from
the B2c override patch `0001`.

## Result

Unmodified glxgears geometry renders through surfaceless EGL, Zink, the guest
Vulkan ICD and the gpu_hostcall virtual GPU onto a WebGPU or WebGL2 host device.
It runs in the real guest with:

- the same app as softpipe (`web/linux/tests/glgears/glgears.c`);
- a GL 2.x compat context;
- display lists, flat shading, lighting, depth testing and back-face
  culling.

**Pixel census.** `-check` reads the first frame (angle 0, 128x128) and gives
the same result on every path: `red=3139 green=866 blue=662 black=11717 other=0
glerr=0`. The paths are:

- softpipe;
- Zink on NVIDIA WebGPU;
- Zink on Intel WebGL2;
- presented and nopresent.

Iteration runs: `guest-webgpu-run8`, `guest-softpipe-run9`, `guest-webgl-run10`.

### S2 three-way score (128x128, page `?gputest=1`, 30 s bench phases)

Runner: `/mnt/p6/build/gears-s2-20261001/run-s2.mjs OUT QUERY 500 15`. The FPS
values are mean frames/seconds over the phase's `*_FPS` lines (present: 11
lines, ~55 s; nopresent: 5 lines, 25 s). All five runs pass:

- `presentFps`, `nopresentFps`, `rotation`, `noFailure` and `noPageErrors` all
  hold;
- each browser and server exits cleanly.

| Path | Host device | present FPS | nopresent FPS | Run dir |
|---|---|---|---|---|
| glgears softpipe (CPU, Mesa) | — (CPU only) | **166.9** | **443.2** | `softpipe-webgpu-run1` |
| glgears on Zink -> guest ICD | NVIDIA MX110 WebGPU | **85.5** | **233.1** | `zink-webgpu-run1` |
| vkgears -> guest ICD | NVIDIA MX110 WebGPU | **118.3** | **437.1** | `vkgears-webgpu-run1` |
| glgears on Zink -> guest ICD | Intel UHD 620 WebGL2 (ANGLE) | 51.8 | 116.0 | `zink-webgl-run1` |
| vkgears -> guest ICD | Intel UHD 620 WebGL2 (ANGLE) | 56.3 | 137.9 | `vkgears-webgl-run1` |

**Present vs nopresent.**

- *Present* includes the CPU readback and `XPutImage` into TinyX at 128x128.
  The window is shown in the Aurora desktop, as in `shot1b-full.png`.
- *Nopresent* still reads back (glgears `-check`/vkgears submit+wait) but skips
  X11.

**Backend evidence.** The backend is confirmed in each `page-log.txt`: `gpu-owner:
vk session 1 backend=webgpu adapter=nvidia/maxwell` or `backend=webgl2 ...
ANGLE (Intel ... UHD Graphics 620)`. `result.json.adapter` only records the
page's WebGPU probe.

**Reading.**

- **Zink vs native Vulkan.** At 128 px, GL on Zink runs at about 53-72% of
  native Vulkan gears on the same ICD (WebGPU: 233/437 nopresent, 85/118
  present).
- **Where the difference comes from.** Zink adds:
  - per-frame descriptor-set churn;
  - submit-time index expansion through the vertex ring (glgears is indexed);
  - more draws per frame (one per display-list primitive group);
  - `GALLIUM_THREAD=0`.
- **Softpipe wins at this size.** Softpipe is still faster than Zink, because a
  128x128 frame of three gears is cheap on the CPU. The ICD cost is per frame
  and per call (host round trips), not per pixel. vkgears nopresent now equals
  softpipe (437 vs 443).
- **Larger sizes.** The ICD's 128 px resource cap (Zink mode) prevents a
  larger-size comparison, which would favour the GPU paths. That is the "caps"
  packet.

## What changed (ICD adapter, all under `GUEST_VK_ZINK` unless noted)

### Indexed draws (`zink.inc`, `graphics-commands.inc`)

The host protocol only draws non-indexed triangle lists. The ICD handles indexed
draws as follows:

- `vkCmdBindIndexBuffer` and `vkCmdDrawIndexed` are recorded.
- At submit, every vertex binding is gathered through the index bytes (u16 or
  u32, plus vertexOffset) into the vertex ring, using the pipeline's own stride.
  The host pipeline is unchanged.
- The draw is then issued as `vertexCount=indexCount`.
- A gathered stream larger than one 64 KiB ring chunk is split on triangle
  boundaries.
- Stride-0 bindings are staged once per piece.

### Face culling (`graphics.inc`, `transfer.inc` + both host renderers)

- `cullMode` NONE/FRONT/BACK and `frontFace` CCW/CW are accepted and sent to the
  host only when they differ from the NONE/CCW default. Non-Zink builds still
  reject them, unchanged.
- WebGPU passes them through, because both APIs decide winding in the final
  image.
- The WebGL2 renderer enables `CULL_FACE` with the front face **inverted**.
  - Guest row 0 is GL window row 0 (no Y flip), so the winding sign flips.
  - eglprobe CULL checks this: back culls CCW-in-image and front culls CW, on
    both backends.

### Descriptor pools

`vkResetDescriptorPool` and `vkFreeDescriptorSets` were added. Zink resets its
pools when a batch completes and frees sets at teardown. Without these, every
pool filled up within a few frames ("failed to allocate push set").

### Interpolation matching

- **The mismatch.** Vulkan takes Flat/NoPerspective/Centroid/Sample from the
  fragment input alone. WGSL and GLSL ES require the vertex output to match.
- **What Zink emits.** For GL flat shading (`glShadeModel(GL_FLAT)`), Zink
  decorates only the fragment input.
- **The fix.** The ICD re-creates the pipeline's vertex module so that its
  outputs at the same Location carry the fragment's decorations. This is done
  per pipeline, in SPIR-V, and supports up to 32 varyings.
- **Host message.** The host renderer's interface-mismatch error now names the
  location and both sides.

### App and packaging

- **`glgears.c`.**
  - `-readrgba` reads `GL_RGBA` instead of `GL_BGRA`. A BGRA readback through
    Zink needs a u_blitter blit that the ICD lacks. Using one read format for
    both drivers keeps the comparison fair.
  - `-check` prints the pixel census. Its readback buffer is now allocated in
    nopresent mode too.
  - The bug: a NULL `pixels` passed to glReadPixels gave an all-black softpipe
    census and, on Zink, a flood of push-set errors in the first nopresent runs.
- **`gputest-waiter`.** It passes `-readrgba` for both drivers and runs Zink
  with `GALLIUM_THREAD=0` (the measured configuration).
- **CPIO.** `web/linux/gpu/gputest-glgears.cpio` was rebuilt from link run11
  (final sources): 20,821,504 bytes, SHA-256
  `2f711c08b1ea474cab908f352daec8a2c8f6ab6647af89582180506285006e0a`. Link run8
  gave the identical hash.

## eglprobe (`tools/zink/probe/eglprobe.c`)

The new CULL test draws a CCW and a CW triangle with back and then front
culling. eglprobe `egl2` passes CLEAR/DRAW/CULL(back, front) for both gles2 and
gl-compat:

- on NVIDIA WebGPU, in `eglprobe/guest-webgpu-egl2`;
- on Intel WebGL2, in `eglprobe/guest-webgl-egl2`.

In both runs teardown reports `GUEST_VK_RESOURCES live=0 allocated_bytes=0`.

## Regression

`/mnt/p6/build/zink-b2d-20261001/all-run4` (NVIDIA WebGPU + Intel WebGL2) passes
20/20 with counts identical to B2d/H1: 140 / 17 / 1087 / 640 / 640 / 1213 / 901 /
501 / 232753 / 232745 / 201269×2 / 18182×2 / 42620×2 / 276963×2 / 91309×2.

Packages were built with `rebuild-all.sh 4 4` (`rebuild-all-b2g-4.log`).

## Failed runs kept

- `link/egl1-failed-softpipe-build` and `eglprobe/iter-egl1-failed-softpipe-build.log`.
  - The eglprobe link used build `s1`, which includes softpipe, and was
    missing `softpipe_create_screen`.
  - Fixed by linking against build `h2`.
- `zinkcaps-build-run3-failed-unused-var`, `zinkcaps-package-run3-failed-unused-var`,
  `wsi-build-run3-failed-unused-var` and `rebuild-all-b2g-3-failed-unused-var.log`.
  - The non-Zink `-Werror` build failed on an unused variable `bindings_at`.
  - Fixed by guarding it with `#ifdef GUEST_VK_ZINK`.
- `zink-b2g-20261001/zinkcaps-build-run1-failed-taskroot.log`. That directory is
  not an allowlisted task root.
- glgears iteration runs 1-7 (and their logs). These are the record of fixing, one by one, the ICD rejections that glgears hit (index draws, pool
  exhaustion, interpolation mismatch, cull, readback format).

## Limits / next

- **ICD caps.** Resources are capped at 128 px under Zink, the device has a
  256 MiB heap, and Z24S8 is not native. These block a size sweep and larger
  windows.
- **Blocking waits (B2b).** Fence waits still poll (`VK_TIMEOUT`).
- **Push constants (B2c).** They are still dropped only when unused.
- **Zink GL limits.** GL is still limited to 2.x compat / ES 2.0.
- **Not yet supported.** Textures on Zink images, BGRA readback blits,
  strip/fan topologies and the threaded context (`GALLIUM_THREAD=1`).
- **Per-frame overhead to reduce.** The Zink-specific costs are descriptor-set
  churn and indexed expansion. A host-side index buffer path would remove the
  gather.
- **Not a speed claim.** None of these numbers show a GPU speedup over CPU
  rendering. At 128x128 the guest/host round trip dominates.
