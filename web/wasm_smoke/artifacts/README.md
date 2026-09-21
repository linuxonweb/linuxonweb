# Out-of-tree Aurora/Xvfb payloads

This directory is intentionally empty in source control. Generated Emscripten
payloads belong here only for a local run and must be accompanied by SHA-256
checksums and upstream license notices when redistributed.

Expected files:

- `xvfb/Xvfb.js`, `xvfb/Xvfb.wasm`, `xvfb/Xvfb.data`
- `aurora/aurora-wm.js`, `aurora/aurora-wm.wasm`
- optional `firefox/firefox.js`, `firefox/firefox.wasm`

Build from `/home/a/project/aurorawm` (Aurora commit
`86a97cd910b285e30fc4b2d12497c9288eede4de`) using the source-build scripts
described in `docs/aurora-wasm.md`.
