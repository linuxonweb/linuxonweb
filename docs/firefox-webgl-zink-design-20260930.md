# Firefox WebGL on guest Vulkan via Zink — adapter design (2026-09-30)

Goal: guest Firefox (128.14.0, single process, static wasm32) creates WebGL and
WebGL2 contexts on Mesa Zink, which runs on the guest Vulkan ICD. Firefox has no
Vulkan backend for WebGL, so OpenGL (EGL plus desktop GL/GLES) is required.
Read-only source audit of the preserved Firefox tree
`.tmp-firefox-build/nix-local-store/nix/var/nix/builds/nix-1-800818036/firefox-128.14.0`.

## How Firefox finds EGL/GL on GTK/X11

- `gfxPlatformGtk::InitX11EGLConfig` (`gfx/thebes/gfxPlatformGtk.cpp:155`)
  force-enables `Feature::X11_EGL` from pref `gfx.x11-egl.force-enabled` or env
  `MOZ_X11_EGL`. That sets `gfxVars::UseEGL`, and
  `GLContextProviderLinux.cpp:38` then routes `CreateHeadless` (WebGL) to
  `GLContextProviderEGL` instead of GLX. The guest TinyX has no GLX, so EGL is the
  only route.
- `GLLibraryEGL::Init` (`gfx/gl/GLLibraryEGL.cpp:512-546`) calls
  `PR_LoadLibrary("libEGL.so")`, then `"libEGL.so.1"`. For the GL library it tries
  `"libGL.so"`, `"libGL.so.1"`, `"libGLESv2.so"`, `"libGLESv2.so.2"`. Both handles
  must be non-null, otherwise it fails with `FEATURE_FAILURE_EGL_LOAD_3`.
- `GLLibraryLoader` (`gfx/gl/GLLibraryLoader.cpp:65-68`) resolves each symbol
  with `PR_FindFunctionSymbol(lib, name)` and falls back to `eglGetProcAddress`.
  Mesa returns core GL entry points from `eglGetProcAddress`
  (EGL_KHR_get_all_proc_addresses).
- Display: on X11 with a GDK display, `CreateDisplayLocked`
  (`GLLibraryEGL.cpp:931-958`) calls
  `GetAndInitDisplay(EGL_DEFAULT_DISPLAY)`, unless
  `!gfxVars::WebglUseHardware()`, in which case it first tries the
  software-device display. A Mesa EGL built with no window platforms resolves
  the default display through `EGL_PLATFORM=surfaceless`. WebGL is offscreen, so
  surfaceless is enough. Presentation goes through Firefox's existing readback
  and compositor path.

## Adapter (no Firefox source edit)

This uses the same mechanism as the FFVPX media shim
(`web/linux/firefox-shims/ffvpx-static.h`, `build-static-media.py`):

1. Link the static Zink+EGL+glapi archives from Zink B3 into the Firefox link.
2. Add a startup constructor that calls `PR_LoadStaticLibrary("libEGL.so", egl_table)`
   and `PR_LoadStaticLibrary("libGL.so", gl_table)`.
   - `egl_table` lists the EGL 1.5 entry points that Firefox's `SYMBOL()` list
     requires (`GLLibraryEGL.cpp` around lines 560-760).
   - `gl_table` can be minimal, since the loader falls back to
     `eglGetProcAddress`.
3. The constructor also does `setenv("EGL_PLATFORM","surfaceless")` and
   `setenv("MESA_LOADER_DRIVER_OVERRIDE","zink")` if needed.
4. Packed prefs (the gpu-check packager already forces the WebGL prefs):
   - `gfx.x11-egl.force-enabled=true`
   - `webgl.force-enabled=true`
   - `webgl.enable-webgl2=true`
   - `webgl.disable-fail-if-major-performance-caveat=true`
   - `webgl.out-of-process=false` (no GPU process in the single-process guest)
5. Guest runtime: the GPU host service (vsock 4050 `serveGPU`) must run on the
   main page in Firefox mode. Today it starts only with `?gputest=1`.

## Dependencies

- Zink B2a: device extensions/features Zink needs at screen creation (otherwise
  `zink_create_screen` fails, so EGL has no display).
- Zink B2b: blocking fences/timeline semaphores. Firefox and Mesa both wait.
- Zink B3: static Mesa archives + P2/P3 adapters, and eglprobe pixels in the guest.
- Then F1: link the adapter into Firefox, and use the check page
  (`package-firefox-gpu-check.py`) to report webgl/webgl2 renderer strings and
  pixels.

Open risks:
- glxtest/gfxInfo: blocklisting is bypassed by `webgl.force-enabled`.
- The Firefox wasm link size grows by roughly 10-20 MB for Mesa.
- The single-threaded Atomics wait inside Firefox's main thread is allowed in
  the guest worker.
