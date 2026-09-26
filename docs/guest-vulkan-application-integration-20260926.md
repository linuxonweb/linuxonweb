# Application integration boundary — 2026-09-26

The next application-facing GPU step should exercise the ordinary Vulkan API
through a statically integrated loader and driver. Adding a Linux ICD manifest
alone does not address the installed wasm libc's dynamic-loading stubs. This is
a proposed bounded integration experiment, not an implemented loader or a claim
that the partial driver can run OpenGL applications.

## Installed toolchain evidence

The compiler wrapper's `nix-support/orig-libc` and `cc-cflags` select
`/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot`.
Its actual `lib/libc.a` is a 1,329,424-byte archive, SHA-256
`f2636fe6df25bd50e23a1726d9e28e6cdc82a03a4f000c693e569b6a65d5608b`.
The command agent inspected symbols and four extracted members, without
compiling, linking or executing them:

- `dlopen.o` supplies weak `dlopen` and local `stub_dlopen`, with the diagnostic
  `Dynamic loading not supported`.
- `dlsym.o` supplies strong `dlsym` referring to `__dlsym`; `__dlsym.o` supplies
  the weak symbol and local `stub_dlsym`. The inspected source returns null.
- `dlclose.o` supplies `dlclose`; the archive has no `__dls2` symbol.
- `libc.so` is a 1,691-byte Wasm module, not evidence of a working ELF-style
  dynamic loader. Its SHA-256 is
  `60166f829c4eacd8210bc82ced83d34c51c8102d4e2df07b31b4db474513f5d7`.

The archived musl source
`../.tmp-firefox-build/nix-local-store/nix/store/drmrcqyqqvyngx2jv0wp6hisphs738j1-source/ldso/dynlink.c`
excludes its implementation under `__wasm__`; `src/ldso/dlopen.c` and
`src/ldso/__dlsym.c` define the corresponding weak stubs. Weak symbols can be
overridden, and no linked Firefox executable was audited for such overrides.
The conclusion is limited to the installed archive and inspected source; it is
not proof that every possible Wasm loading mechanism is impossible.

Raw commands, object/source hashes and symbols are retained under
`/mnt/p6/build/guest-vulkan-failure-20260926/integration-libc-audit.json` and
`integration-audit/`. See the
[compact audit](evidence/runtime-graphics-20260926/guest-vulkan-libc-loading.json).

## Why loader integration needs a deliberate port

Khronos's Unix loader opens libraries through `dlopen` and resolves procedures
with `dlsym`. Its cross-compilation documentation also warns that unknown-function
fallbacks depend on tail calls. Neither normal dynamic discovery nor untyped
unknown-function trampolines should be assumed to work on this guest.
[Platform adapter](https://raw.githubusercontent.com/KhronosGroup/Vulkan-Loader/main/loader/vk_loader_platform.h),
[build guidance](https://github.com/KhronosGroup/Vulkan-Loader/blob/main/BUILD.md).

The inspected `v1.3.231` CMake file lists 13 normal Linux C sources and three C
fallback sources, and defaults Linux to a shared library. These are direct
translation-unit counts, not the full dependency closure or a build-time
estimate. The loader's instance creation calls `loader_icd_init_entries` and
rejects a driver whose required entrypoints cannot be initialized. A manifest
or successful direct ICD call does not establish this integration.
[Pinned build source](https://raw.githubusercontent.com/KhronosGroup/Vulkan-Loader/v1.3.231/loader/CMakeLists.txt),
[instance creation](https://raw.githubusercontent.com/KhronosGroup/Vulkan-Loader/v1.3.231/loader/loader.c).

## Concrete next experiment

1. Resolve the loader tag to an exact commit and preserve verified, allowlisted
   sources and matching official headers on build disk. Inspect the dependency
   closure before compilation; no broad upstream download or build has run here.
2. Build a static loader for the existing wasm-musl ABI. Implement an explicitly
   scoped built-in driver provider instead of pretending libc `dlopen` works.
   Retain typed core dispatch and reject unknown procedures. Do not enable
   untested assembly or generic function-pointer casts.
3. Trace the loader's actual required queries and implement accurate responses
   for the driver's supported subset. Missing features must remain disabled;
   do not claim full Vulkan support merely to pass loader initialization.
4. Compile a separate client against public `vulkan.h` and the loader library.
   It must not include `icd.h`, call `vk_icdGetInstanceProcAddr`, or depend on
   private guest audit functions. Require instance/device enumeration, proper
   public procedure lookup, two exact offscreen clear/readbacks and cleanup
   through ordinary Vulkan calls in the actual Linux guest. Include unsupported
   extension and unknown-procedure rejection.

Only that execution establishes application-facing loader integration. X11
presentation, shaders, general GPU buffers and broader Vulkan features remain
subsequent requirements.

## Full goal remains larger

Zink translates OpenGL to Vulkan, but its documented minimum requires features
and extensions absent from this driver, including shader and rendering support.
Clear/copy execution is not evidence that Zink will start. Any later GL port must
measure its actual requirements against honest driver capabilities rather than
enable unsupported feature bits. [Zink requirements](https://docs.mesa3d.org/drivers/zink.html).

The archived Firefox `third_party/rust/wgpu-core/src/lib.rs` explicitly excludes
its Vulkan backend on wasm32 and selects Empty when other backends are absent
(lines 230–241 in the inspected Firefox 128.14 source). Its
`gfx/wgpu_bindings/src/server.rs` has serialized device/encoder action entrypoints,
but wiring those to a functioning backend is separate work. An ANGLE/WebGPU
experiment would not replace the user's required OpenGL-through-Vulkan path.
Native Firefox JIT, WebGL host fallback and hardware video decode likewise remain
unimplemented. This audit narrows the next technical step; it does not complete
the user's objective.
