# Current Nightly159 remote primitive

This isolated preparation uses the actual selected Firefox159 remote message definitions, not the Firefox128 wrapper. `prepare.py` extracts entire enums and exact native FFI structs, and pins selected source files. The browser implementation is genuine Rust `wgpu` with WebGPU preferred and an explicitly selected WebGL copy/map fallback. It does not launch or link Firefox.

Task outputs are disk-backed under `/mnt/p6/project/build/nightly-webgpu-current-abi-20261003`. Native compilation uses the current generated whole FFI header and actual Mozilla string headers, LLVM22 native Wasm/musl with Wasm EH, and a separate 23-slot fpcast transform. `run-layout.mjs` reproduces real native execution using `node --disable-wasm-trap-handler` under the 4GiB address-space bound. The C++ probe checks pointer32/time64, native ID/layouts, independently writes the complete fixed-int bincode golden payload, and executes a real indirect map callback before and after fpcast. Rust browser `time_t` is unspecified; only native C++ establishes time64.

Preparation commands:

```sh
python3 web/linux/tests/nightly-webgpu-current/prepare.py
python3 web/linux/tests/nightly-webgpu-current/run-bounded.py release-next cargo build --offline --locked --release --manifest-path web/linux/tests/nightly-webgpu-current/Cargo.toml --target wasm32-unknown-unknown -j2
```

Exact executed native compile/link/transform and bindgen arguments are retained in task `native-layout5.json`, `native-link2.json`, `fpcast.json`, `native-validate.json`, and `bindgen3.json`. `run-bounded.py` can replay an argument vector with a fresh output name. Generated bindings must match wasm-bindgen0.2.129. Run `run.mjs hardware NAME` or `run.mjs software NAME` with TMPDIR/TMP/TEMP set to the task `tmp` directory; names must be fresh. Check final reports with `python3 web/linux/tests/nightly-webgpu-current/check.py REPORT_NAME REPORT_NAME`.

Accepted profile: no optional features, ≤1MiB per buffer/4MiB live buffers, ≤128 messages/1MiB batch, ≤256 IDs/session, bounded compute dispatch, copy/map readback and one storage-buffer WGSL pipeline. Maps and submitted work complete actual callbacks. The session rejects unsupported messages and fails closed after an operation error. Resource counts measure owned registries/device/queue/surface handles before/after explicit cleanup; they do not measure driver reclamation. Actual unsolicited loss/error handlers are implemented but loss/OOM/internal-error delivery is not runtime accepted. DestroyDevice, write-map/shared-memory, textures, rendering/presentation, general binding/pipeline layouts, full requested limits/power preference and frontend promise resolution remain outside this primitive. Adapter selection currently occurs when creating the host server; the current RequestAdapter payload does not dynamically select another adapter.

Public wgpu30.0.1 and Firefox Git wgpu-types30.0.0 are deliberately distinct. Actual compile exposed type differences; conversions are explicit, without transmutation. See the dated documentation and evidence packet for current pins and acceptance limits. Guest transport, whole Firefox GPU and deployment acceptance remain false.
