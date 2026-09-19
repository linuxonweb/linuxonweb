# Native WebAssembly boundary smoke test

This tiny module is a build and browser wiring check for the Linux-on-web
project. It is compiled directly to `wasm32-unknown-unknown` with Clang and
`wasm-ld`; no emulator or JavaScript CPU interpreter is involved. The page
uses `WebAssembly.instantiateStreaming`, so a correctly configured web server
must serve `.wasm` as `application/wasm`. The module imports the documented
`linux_host` clock, logging, framebuffer, and event calls. The page renders the
RGBA framebuffer to a canvas and copies DOM keyboard/pointer events into wasm
memory; the smoke test checks both a rendered pixel and a synthetic key event.
These calls are intentionally small enough to implement later from a browser
kernel ABI without changing upstream Linux, X, or Firefox sources.

Run from the repository root:

```sh
web/wasm_smoke/run_smoke.sh
```

The equivalent Make target is `make -C web/wasm_smoke smoke`.

On the current Arch host this prints a 1,194-byte module and
`PASS: native wasm32 module instantiated (ABI LWEB v1, framebuffer + events)`
in Chromium 150 headless.

`BROWSER=/path/to/chromium` and `PORT=8765` can override the defaults. The
probe's `runtime_probe()` return value (`0x4c574542`, ASCII `LWEB`) is the
adapter ABI handshake that a larger kernel-derived module can retain while its
implementation grows.
