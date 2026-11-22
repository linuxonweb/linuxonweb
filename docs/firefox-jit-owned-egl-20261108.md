# Firefox JIT: owned Mesa EGL closure, 2026-11-08

The clean native build's Mesa EGL dependency is recovered. Public Mesa 26.2.3 source, the repository's recorded WASM cross configuration, and readable target toolchain inputs produced **exactly the historical `libEGL_mesa.a` bytes**. The denied historical source and archive were not read or modified.

## Native build handoff

Use this owned archive in place of the denied historical EGL input:

| Field | Verified value |
|---|---|
| Archive | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-mesa-build/artifacts/libEGL_mesa.a` |
| SHA-256 | `b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8` |
| Size | 152,038 bytes |
| Contents | 16 genuine WebAssembly v1 objects |
| Source | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-mesa-build/mesa-26.2.3` |
| Build directory | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-mesa-build/build/headless` |
| Full runtime evidence | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-mesa-build/evidence` |

The replaced path is `/mnt/p6/build/glgears-zink-20261001/link/egl2/lib/libEGL_mesa.a`. The native build owner must wire the owned archive into its new link graph. This change adds no compiler, preflight, or shared-checkout edits.

The historical archive hash is recorded in [the static Zink build receipt](zink-b3-static-build-20260930.md). The owned artifact's [identity receipt](evidence/firefox-jit-mesa-20261108/egl-artifact.json) matches it exactly.

## Source and configuration pins

| Input | Provenance | SHA-256 |
|---|---|---|
| Mesa 26.2.3 tarball | [Official archive](https://archive.mesa3d.org/mesa-26.2.3.tar.xz) and [official release checksum](https://docs.mesa3d.org/relnotes/26.2.3.html) | `1628058a8d2c0615975de5a15ab7bbb9638c50000b5bed9456ff423ea034a81f` |
| libdrm 2.4.133 tarball | [Freedesktop release](https://dri.freedesktop.org/libdrm/libdrm-2.4.133.tar.xz), pinned by the verified Mesa tarball's `subprojects/libdrm.wrap` | `fc68f9d0ba2ea63c9432a299e14fea09fad7a8a66e8039fcd7802ca59f77b4f5` |

Mesa's SHA-512 is also retained in [handoff.json](evidence/firefox-jit-mesa-20261108/handoff.json). Its source hash agrees with [the earlier requirements lock](evidence/zink-20260928/requirements.json).

The readable port configuration is in `tools/zink/configure-wasm32.sh`, `tools/zink/cross/wasm32-musl.ini.in`, and `tools/zink/link-wasm32.sh`. The isolated runner preserves their headless flags and object-archive packaging. The target C/C++ wrappers are the recorded Nix LLVM 22.1.8 WASM-musl toolchain. [pins.json](../tools/zink/owned-egl/pins.json) hashes 22 repository inputs, including the cross template, target shim headers, resource supervisor, and existing GLSL override patch.

No source patch is necessary for the 16 EGL objects. The existing `0001-glsl-builtin-image-memfnptr-wasm.patch` and `mesa-overrides.sh` remain pinned context for the companion Gallium port. This build did not rebuild Gallium or apply its GLSL patch. The headless configuration enables EGL, GLES2, OpenGL, and Zink, with surfaceless/device platform objects; it disables X11/GLX, GBM, LLVM, shader cache, and optional compression/XML dependencies. No configure-only X11 stub packages were created, and no fake EGL implementation was linked.

## Reproduce in a new owned directory

Run from the repository worktree using the required rubywebterm MCP task `Linuxonweb Firefox full JIT 20261108`:

```sh
env -u LD_LIBRARY_PATH python3 tools/zink/owned-egl/run.py \
  --out ../linuxonweb-firefox-jit-20261108-mesa-replay \
  --download-cache ../linuxonweb-firefox-jit-20261108-mesa-build/downloads \
  --preflight ../linuxonweb-firefox-jit-20261108-preflight-1b-v2/preflight.json
```

Omit `--download-cache` to fetch both official tarballs. Cached and downloaded bytes are verified before use. The output directory must be new and outside the checkout; the runner refuses to reuse or delete an existing directory. `--preflight` is optional and reads a retained final159 inventory only for direct symbol closure. It never edits the inventory.

The runner requires CPython 3.12 on Linux x86_64 for the committed wheel hashes, plus the target Nix toolchain recorded in the cross template and native `curl`, `cc`, `ninja`, `llvm-ar`, and `llvm-nm`. It creates a private virtual environment with hashed binary dependencies: Meson 1.12.0, Mako 1.3.10, MarkupSafe 3.0.3, packaging 25.0, PyYAML 6.0.3, and ply 3.11. Host environment cleanup is confined to child processes, including removal of stale `LD_LIBRARY_PATH` and inherited compiler overrides for configuration. A native C compile/link/run smoke must pass before Mesa configuration.

Every heavy phase runs through the existing `tools/guest-packages/bounded.py` supervisor with a deadline, resource telemetry, common CPU-cap verification, and owned-process cleanup. Temporary and cache files remain on the output disk. Ninja compiles only the 16 pinned EGL targets with two jobs, after a bounded dry run; the archive must match the historical hash. Arrange the shared heavy-run slot with other active agents before invoking the recipe. Its file lock serializes its own EGL build, not unrelated agents' workloads.

A read-only input check is available:

```sh
python3 tools/zink/owned-egl/run.py --check-inputs
```

## Verification and limits

The original owned extraction, dependency bootstrap, configuration, EGL compilation, and symbol check all completed under the shared `300000/100000` CPU quota with successful supervisor receipts and no surviving owned processes. The EGL compile/archive phase took 3.504 seconds. [supervision.json](evidence/firefox-jit-mesa-20261108/supervision.json) preserves the exact measurements; short-run RSS/PSS samples are observations, not asserted process peaks.

[The direct symbol closure receipt](evidence/firefox-jit-mesa-20261108/symbol-closure.json) reports 45 EGL exports and all 44 public EGL symbols requested by readable graphics companions present. Of 100 direct external imports, 95 have providers among 57 verified provider inputs, including target musl; the remaining five are expected LLVM WebAssembly linker symbols: `__indirect_function_table`, `__memory_base`, `__stack_pointer`, `__table_base`, and `__tls_base`. Missing required exports and missing external providers are both empty.

The reusable runner packages those successful phases with parameterized output/repository paths and hashed Python dependencies. Its Python syntax and 22 pinned repository inputs were checked. The full packaged runner was not replayed after packaging because the heavy slot was released to the fresh native Firefox agent. The successful artifact and receipts come from the preceding bounded execution of the same phase operations.

No full Firefox native link or guest execution was attempted here. The EGL source/configuration gap is closed; those broader native-build and runtime acceptance steps remain with the integration agent.
