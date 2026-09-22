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

## Staged native module verification

The Firefox guest image already contains a native Wasm executable at
`opt/firefox/firefox`. `tools/build-firefox-wasm.sh` materializes that member
to a caller-selected output, runs a freestanding `clang`/`wasm-ld` probe using
the installed Arch LLVM toolchain, and validates the Firefox module with WABT
(`wasm-validate --enable-all`). It requires the guest ABI imports
`linux.syscall`, `linux.get_thread_area`, and `linux.copy_siginfo`, a shared
`env.memory`, `_start`, and a `build_id` custom section. It never relinks or
rewrites the Firefox binary and exits nonzero if the archive does not contain
that exact native module.

For example:

```sh
tools/build-firefox-wasm.sh /tmp/firefox.wasm
```

The current staged module is a 148 MiB Wasm MVP binary (SHA-256
`b126f4e109b8bfc74aa6cd1414449b49c12777797f390dffa1fa1b740c666d68`). This is
an artifact verification/materialization path, not evidence that upstream
desktop Firefox can be rebuilt for Wasm: its authoritative configure rule
still rejects `--enable-project=browser --target=wasm32-wasi` with
`ERROR: Unknown OS: wasi`.

`probes/firefox-wasm-musl-configure-gate.sh` performs a bounded experiment
against a temporary archive overlay. It changes only the upstream target-gate
expression in that overlay to recognize `wasm32-unknown-linux-musl` for the
browser project, then runs Firefox's real `configure.py` with
`--disable-compile-environment`. The parser reaches
`checking for target system type... wasm32-unknown-linux-musl`; configuration
then stops because the intentionally bounded archive does not include
`js/ffi.configure`. This proves target-triplet recognition only. It is not a
Firefox build, and the pinned source checkout remains untouched.
