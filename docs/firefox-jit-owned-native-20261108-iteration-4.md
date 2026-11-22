# Firefox JIT owned native configuration, iteration 4

This checkpoint tracks the real Firefox source/configure/export path and two native translation units. The full Firefox link and guest execution gates remain open. Host compiler smoke results are not native execution acceptance.

## Owned inputs

- Tooling branch: `gpt-6-astra-pro_firefox-jit_20261108-native-4`, based on `aa44c9459135f0449bd27b23dde21ce875710cb3`.
- Tooling worktree: `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-4-tools`.
- Build root: `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-4`.
- Source and object roots: `source` and `obj` below that build root.
- Original source export: `/mnt/p3/codex-build/linuxonweb-org-push/firefox-src`, Git HEAD `525176a870d4ec4329e7decdb2ef7fdd5b87fb22`.
- Input packet: `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-preflight-3a`.

The source was copied with `cp -a --reflink=always`, including ignored and untracked content and Git metadata. Before applying the seven pinned tier files, the original and copied inventories matched: 483,425 regular files, 3,632,511,828 bytes, inventory SHA256 `286ed25bfd6be85375530ac993398c9930d5b85c7e784adb196eaac05bf096bf`. The inventory excludes Git metadata but retains file hashes, modes, directories and symlink targets. The original export was not modified.

The overlay includes all PBLIC, PBLBC and PBLJIT code and the validated nested compiler. Native source hashes are recorded in `status/bootstrap.json`. The canonical unadapted nested compiler SHA256 remains `ecfbb9d379893a7f8eb997b191d6d8488ff64449c8e13d6af2a05c0f3171fbb4`. The inherited Watchtower/ABI adaptation is described in the iteration 3 preflight report.

## Environment and link inputs

The exact recipe environment was relocated into owned paths. The unavailable historical Nix `LD_LIBRARY_PATH` entry was removed only from the task child environment; compiler wrappers retain their own runtime search paths. The resulting environment script SHA256 is `d2f00237d986a114925e3f288ed2a999b0f4c65f231a3bc3659b514a83ab613d`.

The recovered Mesa archive `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-mesa-build/artifacts/libEGL_mesa.a` has SHA256 `b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8`. `status/bind-link-1.json` records the actual historical EGL path replacement and relocated link files. The earlier bootstrap receipt retains an unused stale EGL mapping; the separate binding receipt is the correction, and preserves the original evidence. The link command metadata remains non-executable until its generated object and archive closure is rebuilt.

## Completed stages and observed failure

The full source-copy stage passed in 241.088 seconds, with 139,595,776 bytes peak owned-tree RSS. The host C++ compiler linked a real vector/printf program, and the resulting executable returned 0 with output `5`. Its bounded stage used 19,988,480 bytes peak RSS and left no owned descendants.

Firefox configure attempt 1 correctly detected Linux/wasm32 and the LLVM 22.1.8 target and GCC 15.2 host compilers. It failed after 16.258 seconds during build graph generation, reporting no TimeStamp implementation. The underlying `CLOCK_MONOTONIC` check uses the C++ linker. Its exact diagnostic is missing `libc++.a`, `libc++abi.a` and `libunwind.a` under the owned `deps/native-unwind/runtimes-build/lib` directory. The target detection and TimeStamp source need no workaround; the independent dependency task owns rebuilding those archives.

The failed configure generated log is retained as `logs/configure-1-config.log`, SHA256 `779f9c853609b582d23311d8f0cf5a8565ba23e233f209926101c1e66164f32f`; generated configuration snapshot `logs/configure-1-config.status` has SHA256 `a80dff2c64e768a86ffe9479225a961336a0bf5807b82f270011472a9d2b62d0`. All exact command arrays, environment identities, stage exits and log hashes are recorded under `status`.

## Continuation

Bind the independently verified native C++ archives using the driver `bind-runtime` phase, then run the target linker smoke, fresh configure, pre-export, export and the two real translation units. Each stage must use `tools/guest-packages/bounded.py` with a fresh evidence directory, finite deadline and the common capped CPU ancestor. The driver supports an individual `--tu` retry and records each object's full dependency manifest. No full Firefox build has been started here.

This report is an in-progress checkpoint and must be updated with the configure/export/translation-unit outcome before handoff.
