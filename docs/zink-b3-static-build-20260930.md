# Zink B3-prep: static Mesa 26.2.3 Zink + EGL build for wasm32 (2026-09-30)

Result: Mesa 26.2.3 (Zink gallium driver, surfaceless EGL, GLES2 and desktop GL
via EGL) cross-compiles for `wasm32-unknown-linux-musl`. It links statically
with the guest Vulkan ICD into one wasm32 executable, `eglprobe.wasm`.

- The executable has **zero undefined symbols**. `wasm-validate` passes, and the
  imports are exactly the guest set: `env.memory`, `linux.syscall`,
  `linux.get_thread_area` and `linux.copy_siginfo`.
- **No upstream Mesa source patch was needed**. Everything is done with the
  cross-file, meson options, existing guest shims, one new link-time adapter
  and a link script.
- The executable has **not** been run in the guest; that was out of scope. It is
  not expected to get past `zink_create_screen` yet, because the ICD still lacks
  the device extensions and features Zink requires (see "Remaining").

Task dir (ext4, disk-backed): `/mnt/p6/build/zink-b3-20260930`. Every build,
cache, scratch and log file is there, with `TMPDIR`/`TMP`/`TEMP` and
`XDG_CACHE_HOME` pointing inside it. The B0/B1 tree
`/mnt/p6/build/zink-b0b1-20260928` was only copied from, never modified.

## Tracked files (new, `tools/zink/`)

| File | Purpose |
|---|---|
| `configure-wasm32.sh` | `meson setup` with all options. It generates the cross file and stub `.pc` files from the templates when they are missing. |
| `cross/wasm32-musl.ini.in` | Meson cross-file template (`@TASKDIR@`, `@ROOT@`). It is byte-identical, after substitution, to the tested `cross/wasm32-musl.ini`. |
| `stubs/pkgconfig/{xshmfence,xxf86vm}.pc.in` | Configure-only stub `.pc` files from B0/B1. No library sits behind them, and nothing links them. |
| `shims/zink_static_vk.c` | P2 adapter: a static replacement for `u_dl.c`. It provides a built-in `libvulkan.so.1` backed by the guest ICD. |
| `link-wasm32.sh` | P1 link script. It builds the static archives and links `eglprobe.wasm`. |
| `probe/eglprobe.c` | The B1 probe with two small wasm-only changes (see Step 4). |

`shims/include/` and `patches/` are empty on purpose: no header shims or source
patches were needed.

## Step 1: configure and compile

Source: `cp -a /mnt/p6/build/zink-b0b1-20260928/mesa-26.2.3 $T/mesa-26.2.3`
(the pristine 26.2.3 tarball tree plus `subprojects/libdrm-2.4.133`).

```sh
T=/mnt/p6/build/zink-b3-20260930
mkdir -p $T/tmp; export TMPDIR=$T/tmp TMP=$T/tmp TEMP=$T/tmp XDG_CACHE_HOME=$T/cache
tools/zink/configure-wasm32.sh $T h2           # -> $T/build/h2, log $T/logs/configure-h2.log
PATH=/mnt/p6/build/zink-gap-20260928/venv/bin:$PATH ninja -C $T/build/h2 -k 0 > $T/logs/ninja-h2-1.log 2>&1
```

The meson options, all in `configure-wasm32.sh`:

```
--wrap-mode=nodownload -Dbuildtype=release -Db_ndebug=true
-Dgallium-drivers=zink -Dvulkan-drivers= -Dllvm=disabled -Dgallium-rusticl=false
-Dopengl=true -Dgles1=disabled -Dgles2=enabled -Degl=enabled -Dglx=disabled -Dplatforms=
-Dgbm=disabled -Dbuild-tests=false -Dvalgrind=disabled -Dlibunwind=disabled -Dzstd=disabled
-Dshader-cache=disabled -Dzlib=disabled -Dxmlconfig=disabled -Dexpat=disabled
-Dallow-fallback-for=libdrm -Dlibdrm:tests=false -Dlibdrm:install-test-programs=false
```

The configure summary reports:
- OpenGL YES, ES2 YES;
- EGL drivers `builtin:egl_dri2`, platform `surfaceless`;
- gallium driver `zink`;
- libdrm from the subproject.

Desktop GL has no library of its own, because GLX is disabled. Desktop GL
contexts come from EGL (`EGL_OPENGL_API`) plus `eglGetProcAddress`.

The cross-file changes against B0/B1's `wasm32-musl-stubs.ini`:
- Removed a broken zlib pkg-config path (its `prefix=/` produced `zlib.h` not found). zlib is now also disabled.
- `c_args`: `-pthread -matomics -mbulk-memory -isystem tools/zink/shims/include -isystem web/linux/firefox-shims -Wno-error=format -Wno-format`.
- `cpp_args`: the same, preceded by the sysroot libc++ headers: `-isystem <sysroot>/include/wasm32-linux-musl/c++/v1` (it holds `__config_site`) and `-isystem <sysroot>/include/c++/v1`. The toolchain wrapper does not add these for C++.
- `cpp_link_args`: `-pthread -static -nostdlib++ -lc++ -lc++abi`. Without these, the wrapper asks for `-lstdc++`.

Compile fixes, all from the first build (`logs/ninja-h1-1.log`, 54 failures):

| Error | Fix (adapter, no source change) |
|---|---|
| C++ headers (`<new>`, `<vector>`, ...) not found | libc++ `-isystem` paths above |
| `mmap`/`PROT_*`/`MAP_*` undeclared (the sysroot `sys/mman.h` hides them under `__wasm__`) | `-isystem web/linux/firefox-shims` (Firefox `sys/mman.h` shim), plus linking `mmap-shim.c` |
| `-Werror=format` in libdrm (`intptr_t` is `long`) | `-Wno-error=format -Wno-format` |
| `zlib.h` not found | Drop the broken pkg-config path, `-Dzlib=disabled` (and xmlconfig/expat disabled) |

The second build, `h2`, takes 3 min 07 s. All 994 steps compile. The only
failure is the expected `libgallium-26.2.3.so` link: wasm-ld has no shared
libraries and rejects `--start-group`. The `libEGL.so`/`libGLESv2.so` edges
depend on it. The objects and archives for all three exist, so the link script
replaces those edges (P1). Build tree: `$T/build/h2` (110 MB).

## Step 2 (P1): static archives and link script

```sh
tools/zink/link-wasm32.sh $T h2 run3     # outputs in $T/link/run3
```

The script takes its inputs from the failing `.so` edges in `build.ninja`:

| Archive | Contents | Bytes | sha256 |
|---|---|---|---|
| `lib/libgallium_zink.a` | `dri_target.c.o` plus 25 archives flattened with `llvm-ar qcsL` (860 members): libdri, libmesa, libglsl, libglcpp, libmesa_util(+simd, c11), libblake3, libdrm, libnir, libcompiler, libvtn, libgalliumvl, libgallium, **libglapi** (shared-glapi), libpipe_loader_static, libloader, libxmlconfig, sw/kmsro/zink winsys, **libzink**, libvulkan_util | 30,629,562 | `c7216add6a70a2a3d94ccae7eefbbd9e7884e1cb2af2c4d257536de15a6b88aa` |
| `lib/libEGL_mesa.a` | 16 `libEGL.so.1.0.0.p` objects (egl main, dri2, platform_device, platform_surfaceless) | 152,038 | `b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8` |
| `lib/libGLESv2_mesa.a` | `libgles2_public.c.o` (public GLES2 entry points into glapi) | 37,896 | `77d10b095649bc5c24cb89cee6e5990e3cf6b4a7fee23bae62a531d51b0e4cba` |
| `lib/libglapi.a` | copy of shared-glapi (also inside libgallium_zink.a) | 61,048 | `77af462b336d5f6a0ab9df40a979d7f3889f73565d38e8f6f5fbe2810dd3625c` |
| `lib/libguest_vk_icd.a` | guest ICD `icd.o` + vsock transport `guest-gpu.o` | 279,874 | `4a227ece1385922b97a86af8e90a79a1ca63ab411e68aedc373ca36c80c9958b` |

Link flags are the guest flags from `guest-vulkan-graphics/build.py`, with two
changes:
- initial memory is 16 MiB, because 10.7 MB is needed for data and stack;
  run1 failed with the guest default of 2 MiB;
- stack is 1 MiB.

```
clang++ -pthread -matomics -mbulk-memory -static -nostdlib++
  -Wl,--gc-sections,--import-memory,--export-table,--shared-memory
  -Wl,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576 -Wl,--error-limit=0
  eglprobe.o zink_static_vk.o mmap-shim.o unwind-stubs.o
  libEGL_mesa.a libGLESv2_mesa.a libgallium_zink.a libguest_vk_icd.a -lc++ -lc++abi -lm
```

wasm-ld resolves archive members regardless of their order, so no group is
needed. `web/linux/firefox-shims/unwind-stubs.c` supplies the `_Unwind_*`
symbols that libc++abi references.

## Step 3 (P2/P3): no-dlopen adapters

What the Mesa 26.2.3 code does:

- **EGL to driver (P3).** It needs no adapter. `egl_dri2` calls the DRI
  frontend (`libdri.a`) and the gallium pipe loader directly. The pipe loader is
  `libpipe_loader_static` with `dri_target.c`, so Zink is built in. Mesa's only
  driver `dlopen` is `loader_open_driver_lib` (`src/loader/loader.c`), and only
  GBM uses it; GBM is disabled.
- **Two leftover lookups** resolve to the libc weak stubs, which return NULL.
  This is harmless:
  - `dri_helpers.c` does `dlsym(RTLD_DEFAULT, "opencl_dri_event_*")`;
  - Zink's renderdoc check does `dlopen("librenderdoc.so", RTLD_NOLOAD)`.
- **Zink's Vulkan library (P2).** `zink_create_screen` calls
  `util_dl_open(VK_LIBNAME)` with `"libvulkan.so.1"`. It then calls
  `util_dl_get_proc_address` for `vkGetInstanceProcAddr` and
  `vkGetDeviceProcAddr`; both must be non-NULL.
  - `tools/zink/shims/zink_static_vk.c` defines all five symbols of
    `u_dl.c.o`: `util_dl_open`, `util_dl_get_proc_address`,
    `util_dl_get_path_from_proc`, `util_dl_close` and `util_dl_error`. The shim
    is linked as an object, so `libmesa_util.a(u_dl.c.o)` is never pulled in.
    `link.map` confirms that `u_dl.c.o` is absent.
  - `libvulkan.so[.1]` maps to a built-in library. Any other name fails, as a
    missing `.so` would.
  - `vkGetInstanceProcAddr` negotiates the ICD interface version once, offering
    5. The ICD lowers this to 2, or to 3 with `GUEST_VK_WSI`. Every lookup is
    then forwarded to the ICD's `vk_icdGetInstanceProcAddr`.
  - `vkGetDeviceProcAddr` is a trampoline. The ICD only returns its
    `vkGetDeviceProcAddr` for the live instance, but Zink fetches it before
    creating one. The trampoline therefore resolves it from the last instance
    passed to `vkGetInstanceProcAddr`.
  - This bypasses the pinned Khronos 1.3.231 loader on purpose. Zink 26.2 uses
    post-231 entry points that the loader has no trampolines for (see
    `docs/zink-requirements-20260928.md`). The loader's dispatch-magic header is
    also unnecessary when there is a single static ICD.
  - A host unit test with a fake ICD passes 11/11 checks
    (`$T/shimtest/result.txt`): unknown library, NULL before an instance
    exists, global commands, `vkGetDeviceProcAddr` after `vkCreateInstance`,
    self-lookups. The shim also compiles with `-Wall -Wextra -Werror` for both
    host and wasm32.

## Step 4: eglprobe

`tools/zink/probe/eglprobe.c` is the B1 probe. It runs four contexts on a
surfaceless display: GL compat, GL 3.2 core, ES2 and ES3. Each prints
`GL_VERSION`, `GL_RENDERER`, GLSL version, extensions and max texture size, then
does an FBO `glClear`, a textured triangle draw and two `glReadPixels` checks.

It has two wasm-only changes:
1. Under `__wasm__` it defaults `MESA_LOADER_DRIVER_OVERRIDE=zink` and
   `LIBGL_ALWAYS_SOFTWARE=1`, without overriding values that are already set.
   There is no DRM render node, and Zink must report a CPU device type for
   surfaceless.
2. The ES2 context calls 14 core functions through the libGLESv2 public symbols,
   for example `glClear`, `glReadPixels` and `glGetString`. This means those
   symbols are actually linked and exercised. All other functions, and the
   desktop GL contexts, still go through `eglGetProcAddress`.

| Artifact | Bytes | sha256 |
|---|---|---|
| `$T/link/run3/eglprobe.wasm` | 19,387,254 (code 9.4 MB in 22,311 functions, data 9.0 MB, name section 0.9 MB) | `5000a51ac81571bb7f3608a0f9b62d7b41923b857d7af31bd917ef80e13aa246` |

Checks on the executable:
- **Undefined symbols: none.** `link.log` contains only the wrapper's
  unused-argument warning.
- **One weak-undefined stub**:
  `undefined_weak:thread-local initialization routine for _mesa_glapi_tls_Context`.
  It is the normal C++ `thread_local` init hook for a variable with no dynamic
  initializer; the caller tests the address before using it.
- **wasm-validate passes.** Imports: `env.memory`, `linux.copy_siginfo`,
  `linux.get_thread_area`, `linux.syscall`.
- **`link.map` contents:** `zink_screen.c.o`/`zink_create_screen`, `nir_to_spirv`,
  `egl_dri2`, `platform_surfaceless`, `dri_target`, `libgles2_public`, the ICD
  and its transport, and `mmap-shim.o` are all present. `u_dl.c.o` is absent.

Input hashes:
- ICD sources were copied from commit `056172b`/`7136d3b`
  (`web/linux/tests/guest-vulkan` is unchanged): `icd.c` `777dee6d…`,
  `guest-gpu.c` `986f533e…`. Full list: `$T/icd/src-sha256.txt`.
- Vulkan headers are v1.3.231, from `gputest-g2-20260930/build-run1/headers-source`.
- `zink_static_vk.c` `5dcf2e0e…`, `eglprobe.c` `772ddcef…`.

The run history is kept:
- `link/run1`: initial memory too small;
- `link/run2`: the original probe, which links fine but whose GLESv2 public
  objects are dropped by gc;
- `link/run3`: final.

The optional host-native Mesa sanity build was not repeated; B0/B1 already
covers host Zink.

## Remaining / next steps

1. **Runtime capability (B2a/B2b, in progress elsewhere).** The current ICD
   advertises no device extensions. Zink 26.2 needs:
   - Vulkan 1.1+ with the 7 extensions and 4 features listed in
     `docs/zink-requirements-20260928.md` (maintenance1/5,
     descriptor_update_template, create_renderpass2, dynamic_rendering,
     robustness2, timeline_semaphore, nullDescriptor);
   - `VK_PHYSICAL_DEVICE_TYPE_CPU` for surfaceless;
   - at least 3 descriptor sets.

   Until the ICD has these, `zink_create_screen` will reject the device at
   runtime. The link proves only that the code paths exist and resolve.
2. **Guest run (B3 proper).** Package `eglprobe.wasm` into a CPIO in the style of
   gputest. Serve the vsock GPU host (graphics/uniform/texture/depth translators).
   Run `eglprobe es2` with `ZINK_DEBUG`/`MESA_DEBUG` output captured.
   - Watch the threads: util_queue and Zink's flush thread need guest pthreads.
   - Watch memory: Vulkan memory maps go through the ICD's coherent heap.
3. **Size.** 19.4 MB unstripped. Possible reductions:
   - `llvm-strip`/`wasm-opt -Oz` and dropping the name section;
   - `-Dvideo-codecs=` (the vl codecs currently link into libgalliumvl);
   - checking whether glcpp and the GLSL builtins can be trimmed.
4. **Shared use.** Firefox would need these archives linked into its own
   executable, or an EGL/GL shim, because static wasm has no `libEGL.so`. This
   ties into the Firefox GL track (C).
