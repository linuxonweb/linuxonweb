# Nightly musl recovery recipe

This is the frozen recipe for `/mnt/p6/build/firefox-nightly-musl-recovery-20261002`, using genuine native Wasm objects and Firefox 159.0a1 source. It requires the Nix store paths recorded in `recipe/environment.sh`. Source provenance is in `evidence/source-identity.json`; the official reference build and local custom build ID are distinct.

The source was copied from the preserved musl port packet, which already contains five configure patches and the selective libc 0.2.186 Wasm/time64 port. Those baseline changes are retained in `patches/initial-nightly159-port-all.patch`; apply it only to an unpatched initial-pin tree. The verified latest-source overlay is owned by `/mnt/p6/build/firefox-nightly-musl-metadata-20261002`; its apply script and pinned hashes are recorded in that packet. The patches here are the subsequent static library graph and Rustix libc backend corrections. Refresh vendored checksums after source edits; do not change Cargo.lock or use x86 generated types.

Replay configured phases with `python3 tools/nightly-musl/recipe/run-phase.py configure UNIQUE_RUN`, then `pre-export`, `export`, `mfbt`, and `build`. The driver sources the owned environment, records the exact PGID/log/status, limits each phase to twelve minutes, and enforces a combined 20 GiB task allowance and 20 GiB free reserve. Full build accepts `NIGHTLY_JOBS=2` or `4`. It refuses to overwrite previous evidence.

Configure, export, MFBT, 33 C/Rust layout checks, and ten native C/UAPI constant checks pass. Full browser compilation is still in progress; this recipe does not claim a complete Nightly binary or runtime acceptance. No custom JIT is included.
