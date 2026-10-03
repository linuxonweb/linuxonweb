# Nightly native shared-memory link adapter

Run42 resolves the bundled/static Expat collision but finds duplicate
`shm_open` and `shm_unlink` definitions in musl and the existing mapping shim.
The shim source and its original archive remain unchanged. A fresh native
archive builds the same source with exactly two compile-time symbol renames;
`build-native-mapping.py --wrap-shm` records the compiler and archiver calls.

The Linux/wasm browser link adapter selects that archive and wraps the two
symbols for Firefox, plugin-container and xpcshell. Forced actual make link
rows verify each program; gfxtest retains the original mapping archive and
has neither new linker flag. Actual native compilation and Wasm validation
pass. Independent review confirms the only changed definition names are the
shared-memory pair. The applied patch is `nightly-native-shm-wrap.patch`.

Run43 finishes with exit2: these duplicate definitions are gone, and all three
browser links now fail on the missing XPTCall stub implementation. This is
link preparation, not browser, guest, JIT or release acceptance. Evidence is
`tools/nightly-musl/evidence/native-shm-wrapper.json`. Existing build outputs
and unrelated services are preserved.
