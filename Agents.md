# Agent status

## wasm_kernel_research (2026-09-19)

- Repository was empty when inspected (no commits or source files).
- Arch Linux toolchain is present: Clang 22, `wasm-ld`, Zig 0.16, and Emscripten 6.0.6. A no-libc smoke test with `clang --target=wasm32-unknown-wasi -nostdlib` successfully produced a WebAssembly module.
- The installed Emscripten wrapper is not usable in this host image: its bundled Clang requires `GLIBC_2.44`, while the host `libm.so.6` does not provide that version. Do not make Emscripten a prerequisite until the toolchain is repaired or replaced.
- Upstream remotes are reachable: Linux (`torvalds/linux`), Firefox (`mozilla-firefox/firefox`), and X server (`xorg/xserver`). Their source trees should be pinned to recorded commits when fetched; avoid patching upstream files.
- Main feasibility finding: upstream Linux has no WebAssembly architecture port. Compiling an x86_64 kernel object set to `wasm32` cannot work because the kernel requires architecture-specific boot, MMU, interrupt, atomic, and device code. A real kernel implementation would require a new `arch/wasm` port plus a browser host ABI for timers, memory, input, display, and networking.
- Xorg and Firefox depend on POSIX processes, shared memory, sockets, filesystem, graphics, and (Firefox) a JIT/runtime that are absent from browser WASI. They cannot be made runnable by compiler flags alone. Keep upstream sources unchanged and put browser-specific behavior behind a small host adapter (WASI imports or JavaScript glue).
- Suggested staged acceptance: (1) compile and run a tiny `arch/wasm` kernel/host ABI proof of life; (2) run a small WASI libc/userspace test with framebuffer/input/network adapters; (3) port an X server backend to the same framebuffer; (4) evaluate a browser engine separately. A browser tab cannot safely host an unmodified Firefox engine, so “Firefox opens bing.com” should be treated as a separate feasibility gate, not assumed after kernel boot.
- Source checkout status: `sources/linux` is present at commit `40288c9206c17eb66a603262e06a58d300d0f279` (torvalds/linux `master`). The Firefox checkout had been initialized but had no material source revision when inspected; X server was not yet present. Record exact commits for both before building them.
- Added `docs/architecture.md`, which defines a small `linux_host` import ABI (clock, sleep, events, framebuffer, files, network, logging), a bounded browser event loop, and separate X/Firefox gates. Added `probes/wasm32-kernel-smoke.c` and `probes/Makefile`; `make -C probes` succeeds and `wasm-objdump -x` confirms the `linux_host.log` import plus exported `kernel_entry` and memory.

## browser_stack_probe (2026-09-19)

- Added `web/wasm_smoke`, a standalone native wasm32 browser-boundary probe. It
  compiles freestanding C with Clang and `wasm-ld` (no Emscripten, emulator,
  or JavaScript CPU interpreter), serves the module with the correct MIME type,
  and loads it with `WebAssembly.instantiateStreaming`.
- Chromium 150 headless verification passed via
  `web/wasm_smoke/run_smoke.sh`; the page reported
  `PASS: native wasm32 module instantiated (ABI LWEB v1)` and the exported
  handshake returned `0x4c574542` (`LWEB`).
- Host checks: `/usr/bin/clang` 22 and `wasm-ld` 22 work for freestanding
  wasm32; installed Emscripten remains unusable because its bundled compiler
  requires GLIBC 2.44, and the Firefox wrapper is broken because
  `/usr/lib/firefox/firefox` is absent.
