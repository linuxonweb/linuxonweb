# Firefox native dependencies — 2026-11-08

## Result

Five of the six required missing native dependency archives were rebuilt from the verified inputs and validated. The three adapters, libc++abi, and libunwind are available at the paths below. The dependency set is **incomplete** because libc++.a remains absent. No Firefox link, browser execution, guest acceptance, or full JIT performance result is claimed.

Owned worktree: `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps`. Owned output: `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build`. Base commit: `aa44c9459135f0449bd27b23dde21ce875710cb3`.

`tools/nightly-musl/recipe/replay-native-dependencies.py` provides prepare, configure, build, adapters, and verify phases. Every observed write/build/verification phase ran through the existing bounded owner helper. The helper and resource policy were not changed.

## Ready archives

| Archive | Bytes | Wasm members | SHA-256 | Historical identity |
| --- | ---: | ---: | --- | --- |
| libnightly-native-mapping.a | 6134 | 1 | `d83706cc69d4dc478930c1d73584dd9469547c29fb7ce0bbb70f70d4e2f683fa` | Source + flags pinned; historical archive hash unavailable |
| libnightly-native-runtime.a | 1960 | 1 | `f5dd22ed404f36a9be25b9bb87665e3d9601dd49969cea23dec5b25a4c58d725` | Exact |
| libnightly-native-stack.a | 1016 | 1 | `9a4fc27adfbc60dd1bf3752a36e46a1f6655fb000c0f240a63f65bb70fa7285f` | Exact |
| libc++abi.a | 393478 | 27 | `5019f48eb0ac1c57f3ac94d1ba1f03f8f6b0d1363f54b565d4c06d7fd93af1f5` | Exact |
| libunwind.a | 6164 | 9 | `39003fecea73e2fc9c810026f80b6b1cb3171e0d259fb801ed365e3cdb0d4d4b` | Exact |

All 39 members have the Wasm object header and passed `wasm-validate --enable-all`. Required symbols were checked with `llvm-nm --defined-only`. The observed Wasm unwind ABI exports `_Unwind_RaiseException`, `_Unwind_DeleteException`, and `_Unwind_CallPersonality`; `_Unwind_Resume` is not a symbol of this pinned archive. An initial verifier incorrectly required that generic unwind symbol, failed, and was corrected from the real source and symbol evidence. Both verification receipts remain preserved.

| Relative artifact | Replacement path |
| --- | --- |
| `native-mapping-wrapped-shm/libnightly-native-mapping.a` | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-mapping-wrapped-shm/libnightly-native-mapping.a` |
| `native-runtime-accepted-run1/libnightly-native-runtime.a` | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-runtime-accepted-run1/libnightly-native-runtime.a` |
| `native-stack-accepted-run1/libnightly-native-stack.a` | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-stack-accepted-run1/libnightly-native-stack.a` |
| `native-unwind/runtimes-build/lib/libc++abi.a` | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-unwind/runtimes-build/lib/libc++abi.a` |
| `native-unwind/runtimes-build/lib/libunwind.a` | `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-unwind/runtimes-build/lib/libunwind.a` |

`replacement-paths.json` maps these five available files from both historical roots and the preflight packet paths. It intentionally omits missing libc++.a and the incomplete runtime-library directory. `planned-replacement-paths.json` includes the eventual complete mapping and **must not be treated as readiness**.

Generated headers are already available: `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-unwind/include` (8 files) and `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-unwind/runtimes-build/include/c++/v1` (1,679 files). `header-replacement-paths.json` gives their relocation map. These headers can support native source compilation independently of libc++ archive completion.

## Pinned inputs and behavior

The source export is `/mnt/p3/codex-build/linuxonweb-org-push/firefox-src`. The packet is `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-preflight-3a/preflight.json`, SHA-256 `1c28693371cc897123e31a02c010a4af27b397b0f5e30e604642061ebf18ea01`. The five original build recipes in the export were byte-compared to the integrated repository recipes. Compiler wrappers, target sysroot libc, adapter sources, environment input, and the relocated environment are pinned in `inputs.json`.

LLVM runtime sources: `/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source`. Musl private headers: `/nix/store/drmrcqyqqvyngx2jv0wp6hisphs738j1-source`. The runtime configuration produced the same 168 compile-command entries as the historical configuration receipt. The actual requested targets are `cxx_static`, `cxxabi_static`, and `unwind_static`; 168 entries are configuration inventory, not a claim that every entry was built.

The mapped-memory adapter uses the exact historical source from Git commit `91c80e0570d94c3ead166f2ec91fce4c69b9d15e`. Its SHA-256 is `cf9f7592186c95dbe9589d8e86bd86fd724b8f06f9c539826ca3a3707c621e97`. The current expanded mmap shim differs from that source, so it was not silently substituted. The wrapped adapter keeps the recorded `shm_open`/`shm_unlink` macro wrapping. The produced 6,134-byte archive has no independently located historical wrapped-archive digest; identity claims are restricted to its pinned source, flags, object validation, and required symbols.

The stack object also matches its accepted object digest: `46c762f103d7f09c899afccd9997a96e9da21db466fc75b58f5c10e0c4d00cda`. The runtime adapter preserves the accepted destructor/TLS behavior and explicit exhausted backtrace behavior. No fake success or replacement runtime stubs were added.

Allowed replay adjustments were owned source/output paths, disk temporary/cache paths, removal of obsolete `LD_LIBRARY_PATH` only from owned child environments, and build concurrency at or below three. The parent/global environment and HOME were not modified. Source and compiler settings retain pthread support, Wasm exceptions, and the WebAssembly C++ ABI. The readable LLVM and musl source trees were not edited.

`source-closure.json` hashes 846 current source/dependency files. It combines the planned compile source entries and dependencies recorded by Ninja so far. Because libc++ is incomplete, refresh this closure after finishing its remaining commands; the current closure is not proof of all future include dependencies.

## Remaining libc++ blocker

The first compile attempt ran with three Ninja jobs and stopped after 11.135 seconds when PID 2842029/startTicks 88727853 changed cgroup membership. The second attempt used one compiler job and stopped after 6.357 seconds when PID 2846665/startTicks 88733160 changed membership. Both report `owned_process_shared_cpu_quota_policy_failed` and zero owned processes remaining.

At both stops the observed groups were `cpulimit-70.slice` and `cpulimit-80.slice` beneath the same `/sys/fs/cgroup/cpulimit.slice`, whose observed `cpu.max` was `300000 100000` (3 CPUs). The helper nevertheless correctly applied its stricter fail-closed membership rule. No cgroup movement, guard relaxation, global environment change, or blind repeated compile attempt was used to evade the stop.

The second partial run completed libc++abi.a. A separate bounded finalization of only `cxxabi_static` and `unwind_static` passed. Their hashes match the historical pins exactly. The independent adapter phase also passed.

`libcxx-remaining-dry-run.txt` records **52 remaining Ninja steps** for `cxx_static`, including its final archive step. Expected historical libc++ archive: 1,533,772 bytes, 63 Wasm members, SHA-256 `5265c4a1fec02eeb62648d21479c9b06a1d5e5e3599fea4aea89534963f7463c`. Its planned output is `/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-native-deps-build/native-unwind/runtimes-build/lib/libc++.a`. Resolve the legitimate host process migration/owner-policy interaction before retrying this remaining target; do not accept the full dependency set yet.

The script supports explicit `--targets`, `--jobs` (1–3), and `--attempt` to retain independent evidence. After resolving the blocker, resume the owned configured tree under the bounded helper with a fresh owner receipt and unused attempt number, then run verify with a fresh attempt number. Do not rerun prepare/configure into this existing tree.

## Resource receipts

Every completed owner receipt reports zero remaining owned processes. CPU, RSS, available RAM, and quota were sampled each second; PSS every five seconds. Peaks below are sampled lower bounds, particularly for phases shorter than the sample interval. RSS may count shared pages more than once.

| Phase | Seconds | Pass | Peak RSS bytes | Peak PSS bytes | Stop reason |
| --- | ---: | --- | ---: | ---: | --- |
| owner-adapters | 2.003 | True | 323584 | 372736 | — |
| owner-build | 11.135 | False | 394117120 | 260191232 | owned_process_shared_cpu_quota_policy_failed |
| owner-build-attempt-2 | 6.357 | False | 197619712 | 130974720 | owned_process_shared_cpu_quota_policy_failed |
| owner-configure | 7.753 | True | 106696704 | 44232704 | — |
| owner-prepare | 1.504 | True | 323584 | 219136 | — |
| owner-unwind-abi | 2.003 | True | 454656 | 306176 | — |
| owner-verify | 2.003 | False | 454656 | 194560 | — |
| owner-verify-attempt-2 | 1.502 | True | 454656 | 195584 | — |
| owner-verify-attempt-3 | 1.252 | True | 454656 | 364544 | — |
| owner-worktree | 2.254 | True | 316989440 | 332800 | — |

All raw logs, object outputs, the generated build graph, failed attempts, and validation files remain in the owned output directory. The evidence committed with this report includes full artifact/member validation, source/input manifests, path maps, remaining work, and owner receipts. Mesa was already resolved by its separate owned handoff and was not rebuilt here.

## Acceptance limits

`validation.json` records `presentArtifactValidation=true`, `passArtifactValidation=false`, and the exact missing libc++ path. Full dependency readiness, Firefox native browser link, full JIT behavior, guest runtime correctness, and the user performance targets remain unproven by this task.
