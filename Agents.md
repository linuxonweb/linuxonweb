# Agent status

## wasm_kernel_research (2026-09-19)

- Repository was empty when inspected (no commits or source files).
- Arch Linux toolchain is present: Clang 22, `wasm-ld`, Zig 0.16, and Emscripten 6.0.6. A no-libc smoke test with `clang --target=wasm32-unknown-wasi -nostdlib` successfully produced a WebAssembly module.
- The installed Emscripten wrapper is not usable in this host image: its bundled Clang requires `GLIBC_2.44`, while the host `libm.so.6` does not provide that version. Do not make Emscripten a prerequisite until the toolchain is repaired or replaced.
- Upstream remotes are reachable and snapshots are kept under `sources/`:
  Linux is pinned to `40288c920` and X server to `306071c0b` with materialized
  shallow trees; Firefox is pinned to `b16f852ba` in a partial clone whose
  large working tree did not finish materializing before the network fetch
  stalled. See `sources/README.md`; avoid patching upstream files.
- Main feasibility finding: upstream Linux has no WebAssembly architecture port. Compiling an x86_64 kernel object set to `wasm32` cannot work because the kernel requires architecture-specific boot, MMU, interrupt, atomic, and device code. A real kernel implementation would require a new `arch/wasm` port plus a browser host ABI for timers, memory, input, display, and networking.
- Xorg and Firefox depend on POSIX processes, shared memory, sockets, filesystem, graphics, and (Firefox) a JIT/runtime that are absent from browser WASI. They cannot be made runnable by compiler flags alone. Keep upstream sources unchanged and put browser-specific behavior behind a small host adapter (WASI imports or JavaScript glue).
- Suggested staged acceptance: (1) compile and run a tiny `arch/wasm` kernel/host ABI proof of life; (2) run a small WASI libc/userspace test with framebuffer/input/network adapters; (3) port an X server backend to the same framebuffer; (4) evaluate a browser engine separately. A browser tab cannot safely host an unmodified Firefox engine, so “Firefox opens bing.com” should be treated as a separate feasibility gate, not assumed after kernel boot.
- Source checkout status: `sources/linux` is present at commit `40288c9206c17eb66a603262e06a58d300d0f279` (torvalds/linux `master`), and `sources/xserver` is present at `306071c0b9683ef0dfadcfc2dbb78d369680542b` (xorg/xserver `master`). `sources/firefox` resolves to `b16f852ba66d190cacd42d0d43ac4d38bd07c4bd` (mozilla-firefox/firefox `main`), but its large working tree did not finish materializing in this environment. Record exact commits and complete that checkout before building Firefox.
- Added `docs/architecture.md`, which defines a small `linux_host` import ABI (clock, sleep, events, framebuffer, files, network, logging), a bounded browser event loop, and separate X/Firefox gates. Added `probes/wasm32-kernel-smoke.c` and `probes/Makefile`; `make -C probes` succeeds and `wasm-objdump -x` confirms the `linux_host.log` import plus exported `kernel_entry` and memory.
- Existing `web/wasm_smoke/run_smoke.sh` also passes in headless Chromium: the 623-byte module instantiates through `instantiateStreaming`, reports `data-result="pass"`, and writes its adapter message to the page.

## browser_stack_probe (2026-09-19)

- Added `web/wasm_smoke`, a standalone native wasm32 browser-boundary probe. It
  compiles freestanding C with Clang and `wasm-ld` (no Emscripten, emulator,
  or JavaScript CPU interpreter), serves the module with the correct MIME type,
  and loads it with `WebAssembly.instantiateStreaming`. Its C adapter imports
  only `linux_host.log` and `linux_host.clock_monotonic_ns`, and the HTML page exposes a
  small terminal output surface.
- Chromium 150 headless verification passed via
  `web/wasm_smoke/run_smoke.sh`; the page reported
  `PASS: native wasm32 module instantiated (ABI LWEB v1)` and the exported
  handshake returned `0x4c574542` (`LWEB`).
- Host checks: `/usr/bin/clang` 22 and `wasm-ld` 22 work for freestanding
  wasm32; installed Emscripten remains unusable because its bundled compiler
  requires GLIBC 2.44, and the Firefox wrapper is broken because
  `/usr/lib/firefox/firefox` is absent.

## api_test (2026-09-19)

- Added `web/api_test`, a localhost/HTTPS HTML5 capability test bench.
- It has user-triggered checks for camera, microphone, `MediaRecorder`, screen
  capture, clipboard, file picker, geolocation, notifications, vibration, Web
  Share, Canvas/WebGL/WebGPU, Web Audio, localStorage/IndexedDB, workers,
  WebSocket, timers, and WebAssembly.
- Permission-bearing APIs are never invoked during page load. The page reports
  unsupported APIs and denied permissions as explicit failures, and presents
  stream/recording output for inspection.

## Additional source check (wasm_kernel_research, 2026-09-19)

- Firefox `build/moz.configure/init.configure` gates its WASI/wasm32 triplet parsing behind `project == "js"`; this supports the SpiderMonkey/JS shell tooling path, not a full desktop Firefox target. The browser engine therefore still needs a substantial target port beyond the adapter smoke test.
