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
