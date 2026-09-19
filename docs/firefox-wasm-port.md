# Firefox native-Wasm port gate

The Firefox source is kept at `sources/firefox` and is not modified. The
project’s own `build/moz.configure/init.configure` accepts a `wasm32-wasi`
triplet only when `project == "js"`; `build/moz.configure/toolchain.configure`
then creates a separate WASI compiler description for the JS shell. This is
not a target for the desktop browser, which still assumes Unix processes,
shared memory, native graphics, sockets, filesystem APIs, and its native JIT
and sandbox.

Run the reproducible gate report with:

```sh
tools/check-port-gates.sh
```

The report deliberately fails while any required port is absent. It also runs
the native `wasm32` adapter smoke test so progress cannot be confused with a
Firefox build. The next source-preserving implementation step is an
`arch/wasm` Linux port and a framebuffer/input/process host ABI; only after
that ABI exists is a Firefox desktop port meaningful.

For a source-level Firefox check that does not materialize its large sparse
working tree, run:

```sh
probes/firefox-wasi-helper-gate.sh
```

At revision `b16f852ba66d190cacd42d0d43ac4d38bd07c4bd`, this verifies the
`project == "js"` WASI configure rule and successfully `cargo check`s
`build/rust/wasi` for `wasm32-unknown-unknown`. That crate is only a small
WASI binding used by Firefox's Rust tooling; it is not the browser or the JS
shell. Selecting `FIREFOX_WASM_TARGET=wasm32-wasip1` currently fails on this
host because Rust's `wasm32-wasip1` standard library is not installed
(`error[E0463]: can't find crate for core`).
