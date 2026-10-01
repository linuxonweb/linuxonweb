# Firefox WebGL F1a — Mesa EGL + Zink statically linked into guest Firefox (2026-09-30)

The F1a agent built and tested this packet. It was cut off by the 5 h usage
limit before writing this doc, so the root agent wrote it from the
agent's artifacts in `/mnt/p6/build/firefox-webgl-f1a-20260930`. The design is in
`docs/firefox-webgl-zink-design-20260930.md`. No Firefox or Mesa source was edited.

## What was added

- `web/linux/firefox-shims/zink-egl-static.c` is a constructor that registers NSPR
  static libraries `libEGL.so` and `libGL.so`.
  - `libEGL.so` holds all EGL 1.0-1.5 core entry points.
  - `libGL.so` holds an empty table, so `GLLibraryLoader` falls back to Mesa's
    `eglGetProcAddress`.
  - The constructor also sets `EGL_PLATFORM=surfaceless`,
    `MESA_LOADER_DRIVER_OVERRIDE=zink` and `LIBGL_ALWAYS_SOFTWARE=1`, each only
    when unset.
- `web/linux/firefox-shims/glxtest-egl.c` replaces `/opt/firefox/glxtest`.
  - `gfxPlatformGtk::InitX11EGLConfig` force-disables X11_EGL unless glxtest
    reports `TEST_TYPE EGL`, whatever `gfx.x11-egl.force-enabled` says.
  - The stock helper was never shipped (ENOENT), and it would dlopen libEGL/libGL.
  - The adapter runs no probe. It reports `ERROR` (this keeps the
    "glxtest failed" blocklist default) plus `TEST_TYPE EGL`.
- `tools/build-firefox-webgl-f1a.py` reuses the W1 link verbatim (`firefox-webgpu-w1-20260929/relink-run1`)
  and extends it with:
  - `zink-egl-static.o`;
  - `zink_static_vk.o` (`tools/zink/shims/zink_static_vk.c`);
  - copies of the B3 archives `libEGL_mesa.a`, `libgallium_zink.a` and
    `libguest_vk_icd.a`.
  `--diagnose` also links the baseline and the candidate without
  `--allow-multiple-definition` and diffs the duplicate definitions.
- `tools/guest-rootfs/package-firefox-webgl-f1a.py` builds the pinned candidate
  on top of gpu-check candidate-run5 (`d5103be54146`).
  - It replaces `opt/firefox/firefox`.
  - In `distribution.ini`, it adds `gfx.x11-egl.force-enabled=true` and
    `webgl.out-of-process=false` and keeps all earlier forced WebGL/WebGPU prefs.
  - It adds `pref("gfx.x11-egl.force-enabled", true)` to `defaults/pref/wasm.js`.
    The pref is a `once` static pref and is snapshotted before
    `distribution.ini` applies. guest-run1 showed the GLX path because of this.
  - It adds `opt/firefox/glxtest`.
- `tools/guest-rootfs/test-firefox-webgl-f1a.mjs` is the finite cold/warm guest
  runner, built on the gpu-check runner.

## Link

- Pulled members:
  - 656 from `libgallium_zink.a`;
  - 16 from `libEGL_mesa.a`;
  - 2 from `libguest_vk_icd.a`.
- Symbols: 13,220 defined by Mesa and 269 undefined in Mesa, all resolved
  (`collisions-run1/`).
- Compared with the W1 baseline, no new duplicate definitions appear
  (`relink-run3/duplicates-new.txt` is empty).
  - The overlaps that do exist are libc++ lazy/definition pairs and
    `std::piecewise_construct`, which Firefox already defines. They are
    identical libc++ ABI copies.
- Imports are unchanged: `env.memory`, `linux.{syscall,get_thread_area,copy_siginfo,audio_write}`.
- Size:

  | Firefox module | Bytes | SHA-256 |
  |---|---:|---|
  | W1 | 157,454,290 | `3a1af53d…` |
  | F1a (`relink-run3/firefox.wasm`) | 176,105,527 | `46d28cd851e13e6f561a6572db21b392d42935d911d55a0334fed0b503e2c9ca` |

  Growth is 18.65 MB. The link takes 76 s.

## Candidate

`candidate-run2` is version `2c3830fbec61`. The archive is 91,210,736 bytes,
SHA-256 `4c53f5064a5b2c47cecc4460c4bac5bb6bb998ba1a99e41dd354a5f9ee0762be`.
It is **not promoted**. `candidate-run1` (`361bc925a7a5`) lacked the `wasm.js` pref
and is kept as failed evidence.

## Guest results (NVIDIA host, main page Firefox mode serves vsock GPU sessions)

- **guest-run1** (candidate-run1) passes cold and warm startup.
  - WebGL fails with `tryNativeGL ()` / `FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`.
  - EGL was never tried because X11_EGL stayed off: the `once` pref came only
    from `distribution.ini`.
- **guest-run2** (candidate-run2) passes cold (observed 59.4 s) and warm (33.1 s
  with zero images). All startup, bookmark and config checks pass and there are
  no fatal lines.
  - Firefox now reaches Mesa. Zink starts and stops at the ICD:
    ```
    MESA: error: ZINK: CPU device requested but none found!
    MESA: error: ZINK: failed to choose pdev
    MESA-EGL: warning: egl: failed to create dri2 screen
    MESA-EGL: warning: DRI2: failed to create screen
    WebGL creation failed: * tryNativeGL (FEATURE_FAILURE_NO_DISPLAY)
                           * Exhausted GL driver options. (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS)
    ```
  - WebGPU still has a null adapter, as expected.

All owned browser and server processes exited, and user processes were untouched.

## Next

- **B2a:** the guest ICD must offer `VK_PHYSICAL_DEVICE_TYPE_CPU` under
  `LIBGL_ALWAYS_SOFTWARE`, plus Zink's 7 extensions, 4 features and limits.
- **B2b:** blocking waits.
- After that, relink F1a against the updated `libguest_vk_icd.a`. Then rerun
  the check page and expect the WebGL/WebGL2 renderer strings and pixels.
