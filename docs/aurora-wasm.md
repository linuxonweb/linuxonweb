# Aurora/Xvfb browser artifacts

Open `web/desktop/index.html?wm=1` to run
`web/wasm_smoke/aurora_startup.js`. It starts source-built X.Org Xvfb and
Aurora in order (display `:11`). Firefox is attempted only after WM readiness
when `?firefox=1` is also present; missing artifacts are shown in the page.
Payloads are intentionally out-of-tree.

Run `tools/build-aurora-wasm.sh` with Node.js and the Emscripten SDK active;
it invokes the sibling `webos/scripts/build-aurora.mjs` and
`webos/scripts/build-xvfb.mjs`, copies outputs under
`web/wasm_smoke/artifacts/{aurora,xvfb}`, and writes `SHA256SUMS`. You can set
`AURORA_SRC`, `WEBOS_ROOT`, or `AURORA_OUT` for another checkout. Do not commit
generated binaries and retain upstream notices.

Aurora provenance: `https://github.com/ecooxai/aurora-wm`, checkout
`/home/a/project/aurorawm`, commit
`86a97cd910b285e30fc4b2d12497c9288eede4de`, version `0.3.0`.
