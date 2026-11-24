# Firefox JIT native preparation — 2026-11-10

## Result and acceptance

**Latest preparation:** the final guarded replay uses `../linuxonweb-firefox-jit-20261110-native-source-4` and `../linuxonweb-firefox-jit-20261110-native-build-4`. It passed in9.254s after77 focused regression checks and independent source/artifact review. This supersedes the recipe guard, while preserving the original source2/build2 evidence described below.

The two reviewed preparation branches are integrated, a complete isolated Firefox159 source tree is prepared with the reviewed nested-loop candidate, and the missing helper mapping archive is reconstructed **byte-for-byte** from an existing owned object. The original six-archive dependency set still lacks `libc++.a`. No compiler, native Firefox link, package, guest, or new performance benchmark ran in this iteration. The project acceptance remains **45/100**.

`preparationComplete: true` means paths and source inputs were prepared. `compiled`, `nativeIntegrationReady`, `fullBuildReady`, and `guestRuntimeAcceptance` remain false. The custom PBLIC/PBLBC/PBLJIT tiers are not upstream SpiderMonkey native JIT: the preserved target configuration contains `--disable-jit` and `--enable-portable-baseline-interp`.

This work explicitly binds the **pre-array nested-loop candidate**. An independent array extension is being developed separately. It is absent from this prepared source and packet. The preparation recipe intentionally pins packet3a and its exact candidate; integrating a changed compiler requires a new complete host packet, including every new fixture/header/runner, fresh native-source adaptation and independent review. Do not relabel this receipt as covering a later candidate.

## Reviewed input closure and replay guards

Independent review found a preparation reproducibility gap: the earlier recipe authenticated `preflight.json` and the host manifest, but then consumed mutable configuration, commands, copied recipe files and dependency maps without authenticating all those bytes first. Recording output hashes afterward did not establish input identity. No actual packet corruption was found. The old packet, preparations and failure receipts remain unchanged.

The corrected recipe requires the separate fixed manifest `tools/nightly-jit-prep/final159-preparation-inputs-20261110.json`, **481,428 bytes**, SHA-256 **`b0f250c47e5938dbf3d4728a2ba43541207eda270b7be4f23779cda3092d0d49`**. This is a new reviewed closure of the existing **pre-array packet3a**, not a new host-test result or retrospective native acceptance.

| Authenticated input group | Files | Scope |
|---|---:|---|
| Packet |29|Preflight, configuration, native commands, link arguments, complete recipe/native-source/host-packet trees|
| Dependencies |1,699|1,687 headers, validation and mapping metadata, provenance metadata, five original present archives and the separate helper archive/receipt|
| Owned EGL |1|Exact previously validated Mesa EGL archive|
| Repository |3|Canonical pre-array compiler and the two independent derivation/dependency review receipts|
| External regular files |64|Already-declared toolchain, library and object pins from the previous successful preparation|
| **Total** |**1,796**|Preparation inputs, not all future configured Firefox build outputs|

The five recursively consumed trees have exact file and directory membership. Added, missing, nonregular or symlink members fail closed. Every original host-manifest file and compiler-source binding is checked, including the native mock's equality with the host mock. The dependency metadata must name exactly five present original archives and the missing `libc++.a`; the separately reconstructed helper remains a distinct artifact. Both generated header trees are bound to the earlier pinned 1,687-file inventory.

Independent review reproduced all ten generated configuration, wrapper, target, shim, native-command and link-argument classes from already pinned source or historical command evidence. This supports their derivation, rather than merely accepting freshly observed hashes. The separate snapshot also pins the current reviewed dependency validation and replacement maps. Directory availability for external toolchain search paths remains an availability check; this is not a claim of recursive immutability for all future compiler or system inputs.

`input_closure.py` reads regular files through one descriptor, checks content and read identity, and caches all bytes that the recipe later parses or copies. Explicit immutable toolchain aliases must resolve to their recorded targets. Owned packet trees cannot contain symlinks. The recipe checks the complete closure before source Git inspection or any source/output mutation, then checks exact source destination identities: four original files must match their recorded prior bytes and six originally absent destinations must remain absent. Cached inputs replace unchecked `copytree` traversal and subsequent packet rereads. A final identity/membership check precedes the first output directory. I/O failures during later writes still leave preserved incomplete attempts; only the final receipt declares preparation complete.

Copied packet permissions remain strict, including executable mode0755 for `recipe/cargo` and `recipe/rustc`. Repository evidence/compiler files are read-only inputs, never copied or executed by this stage. Their manifest modes are observations, while their content, ownership, regular-file type and stable read identity are required; this permits the normal0600→0644 permission difference after a Git checkout. The preparation receipt records the exact main recipe and its verifier/preflight/owned-path module hashes.

The helper reconstruction's static `helperOnlyLinkage` claim now first requires the exact independently reviewed historical preparation receipt **`9facb1ee3c8fc27af2d75d0954cbd342b8c1dd374900f3ae0494cf94d7a40a90`**, its `source-changes.json` pin, and both current `defs.mk` after-pins. Existing guard substrings are insufficient if those files have changed. `--verify-linkage-only` performs that read-only check for the old source2/build2 preparation. It deliberately does not accept an arbitrary new preparation receipt; changing that binding requires a new independent review. The exact helper object/archive reconstruction algorithm and original wrapped browser artifacts are unchanged.

Historical preparation receipts still identify the recipe bytes at Git commit `a03223f78b0fcefb45022e0da2c006baea0366fe`; they must not be audited as if the current live recipe file were those old bytes. New preparations and their exact code/module pins are recorded separately. The original preparation2 and intermediate preparation3 remain preserved.

A separate array candidate is documented on branch `gpt-6-astra-pro_linuxonweb-array-jit_20261110` in `docs/firefox-jit-nested-arrays-20261110.md`. It is absent from packet3a and this closure. Its future integration requires a new completely validated host/preflight packet containing its shared proof header, every runner and fixture, both native and host overlays, and a new reviewed closure identity. The existing seven-member compiler binding deliberately rejects a SHA-only candidate substitution. Earlier array test counts do not accept the final refactored array source.

### Focused validation and final replay

The final production code passed **77/77** focused checks in32.532s inside the unchanged bounded owner (34.008s total). The suite mutates each packet file, dependency metadata and declared archives, representative files from both header trees, and membership/type/mode conditions. It checks exact source/output preservation on rejection, cached-copy identity, repository mode portability with content tampering still rejected, and stale/altered helper preparation/source-change/defs bindings. The source-before/null negative uses a transparently identified Git-metadata stub with real pinned source bytes; the final full source worktree replay below is separate actual Git evidence.

| Operation | Guarded wall seconds | Result |
|---|---:|---|
| First closure capture |2.503|Retained script-model failure: four existing and six absent source destinations had been miscounted|
| Second closure capture |1.753|Retained capture failure: already declared owned non-Nix inputs were initially excluded|
| Corrected closure capture |2.753|Pass; original packet unchanged|
| Read-only full input verification |2.503|Pass;1,796 regular-file pins and five exact trees|
| Intermediate fresh source checkout / preparation3 |40.258 /11.259|Pass; retained before the Git mode portability refinement|
| First focused suite |25.010|44 checks passed, then test-fixture setup hit a copied0444 header|
| Final focused suite |34.008|77/77 pass; fresh fixture/prefix and owner|
| Final fresh source checkout |45.262|Pass at exact source HEAD525176a|
| **Final preparation4** |**9.254**|**Pass with exact final recipe and all three module hashes recorded**|

The final source has483,357 tracked base files and exactly ten recorded source changes (nine Git-visible paths plus the ignored configuration). Independent review checked every source after-pin, all seven copied native sources, the recipe/module and output pins, executable wrappers, unchanged missing dependency scope, and no compiled objects in the fresh object directories. The final preparation sampled peak owned RSS215,433,216bytes and PSS94,410,752bytes. These are preparation measurements, not Firefox runtime memory or performance results.

All recorded owners kept the unchanged shared-cap/membership policy, recorded no quota violation, and ended with zero owned processes and no cleanup inventory errors. CPU/RSS/available RAM/quota cadence remains1s; PSS5s and its peak is a sampled lower bound. The three failed attempts and the successful intermediate preparation are retained. No compiler, guest, image publication or new speed acceptance is implied.

The manifest deliberately pins **libc++.a as absent**. After a legitimate stable-scope dependency build and verification supplies it—or changes dependency metadata/maps—the old closure must reject that changed state. Review the new complete dependency set and mappings, create a new closure identity, and prepare fresh source/build roots; do not simply edit one hash or rerun into old outputs. This is an intentional fail-closed boundary. The same full-review rule applies more broadly to any changed compiler/array packet.

Evidence: [validation summary](evidence/firefox-jit-integration-20261110/input-closure-validation.json), [77-case receipt](evidence/firefox-jit-integration-20261110/input-closure-tests.json), [final preparation](evidence/firefox-jit-integration-20261110/guarded-preparation-final.json), [final source changes](evidence/firefox-jit-integration-20261110/guarded-source-changes-final.json), [independent review](evidence/firefox-jit-integration-20261110/input-closure-final-review.txt), and [complete owner receipts](evidence/firefox-jit-integration-20261110/input-closure-owner-receipts.json).


## Integrated work and exact prepared inputs

Starting branch `gpt-6-astra-pro_linuxonweb-jit_20261110` was clean at `6cde3359135439b1bc582446e210749e6eb68d30`. The primary checkout and preservation tags remain unchanged.

| Original reviewed commit | Integration commit | Scope |
|---|---|---|
| `cbb2358fe2944b16759939ed587666293b40a930` | `3a4682a` | Owned disk-root native guest route, exact path/source/review gates retained |
| `5eeda38fe4fd9c9c4690df57d010725ea5f818b4` | `ad6aca0` | Reproducible owned Mesa EGL closure and evidence |

Canonical compiler SHA-256: `ecfbb9d379893a7f8eb997b191d6d8488ff64449c8e13d6af2a05c0f3171fbb4`.
Adapted native compiler SHA-256: `2f8c8d36f7a367f65f932050507317a960d3b41747c422ba278b8df63bdb957f`.
The adaptation retains the final159 Watchtower API replacement and wasm32 Value/pointer ABI assertions.

Paths below are relative to the integration worktree:

- Prepared source: `../linuxonweb-firefox-jit-20261110-native-source-2`, base Git HEAD `525176a870d4ec4329e7decdb2ef7fdd5b87fb22`, 483,357 tracked files.
- Prepared build: `../linuxonweb-firefox-jit-20261110-native-build-2`.
- Input packet: `../linuxonweb-firefox-jit-20261108-preflight-3a/preflight.json`, SHA-256 `1c28693371cc897123e31a02c010a4af27b397b0f5e30e604642061ebf18ea01`.
- Host packet manifest: `ecfdf31d835d06979884908250f643b77796ff070e0f5d56d69861dc7d2db3f0`.
- Dependencies: `../linuxonweb-firefox-jit-20261108-native-deps-build`.
- Owned Mesa EGL archive: `../linuxonweb-firefox-jit-20261108-mesa-build/artifacts/libEGL_mesa.a`, SHA-256 `b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8`.

`prepare-owned-build.py` refuses a dirty source or an existing output, verifies the pinned packet/candidate and existing dependency archives, and prevalidates all ten destination files. It copies the seven exact native-tier sources, creates the pinned ignored `.mozconfig`, and relocates the root and adapter `defs.mk`. It writes a literal owned-child environment, native compile commands, final-link arguments and phase commands. Temporary/cache paths stay in the owned disk root; HOME is preserved. Only the obsolete child `LD_LIBRARY_PATH` is removed. No Firefox configured header is synthesized.

The first preparation correctly exposed that a fresh Git worktree lacks the original ignored `.mozconfig`, but did so after copying the seven source overlays. That partial owned source/build and failed owner receipt remain intact. The recipe was corrected to prevalidate destinations and allow creation of that exact pinned configuration. A second fresh source/build passed. The failure is not a build or permission failure.

The output includes `preparation.json`, `source-changes.json`, `native-compile-commands.json`, `phase-commands.json`, `relocation-map.json`, `dependency-headers.json`, `link/link.args`, and `recipe/environment.sh`. The header inventory covers1,687 actual files. The original preparation's `missing-inputs.json` is an immutable before-reconstruction snapshot; `dependency-refresh.json` records the later closure below. A prepared graph still needs **2,634 configured Firefox objects and eight generated header/backend paths**.

## Exact helper archive reconstruction

The original six-archive dependency task had five validated archives and only `libc++.a` missing. Full source `defs.mk` additionally names an **unwrapped** mapping archive for helper targets. The available wrapped browser object could not simply be renamed as an archive: its two public function symbols differ.

The independently recorded `tools/nightly-musl/evidence/native-mapping-link.json` pins the same15,049-byte source (`cf9f7592186c95dbe9589d8e86bd86fd724b8f06f9c539826ca3a3707c621e97`) and the original unwrapped object/archive. The new `reconstruct-helper-mapping.py` parses the Wasm linking symbol table, removes `__wrap_` from only `shm_open` and `shm_unlink`, updates the two encoded section sizes, and demands the exact original full object hash. All nine other sections—including imports, code and relocations—remain byte-identical.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Existing wrapped object |5,849|`d9109125a1b3cd0c0d4e0c42dfd0ba6c68f3b4fc4e4d0a5ff079cc93c885ff3a`|
| Reconstructed historical helper object |5,835|`bae2a8cc8dd968036e4cecec8dfbdc218923e5a6a8594f89baceb0cdd874e755`|
| Reconstructed historical helper archive |6,106|`ce9bde472373b4d7d09555954006b94b3c0a8137d341d51d689371fb8e2c7561`|

Wasm validation, a real archive operation, exact single-member equality, required defined/undefined symbol inspection and full archive hash verification passed. The existing wrapped object/archive hashes are unchanged. Both prepared `defs.mk` files add the helper archive outside the browser-program guard, remove it for Firefox/plugin-container/xpcshell, and retain their wrapped browser archive. This is static linkage verification, not an executed helper or browser acceptance.

The new artifact is `../linuxonweb-firefox-jit-20261108-native-deps-build/native-mapping-link/libnightly-native-mapping.a`. Its `reconstruction.json` explicitly records `compiled:false`. No protected historical archive was accessed, no new C compilation occurred, and no renamed mismatched archive was accepted.

## Native compiler launch blocker

Current `AGENTS.md` requires: “Fail closed on unknown/unlimited/migrated groups.” The resource helper stores exact PID/start-time membership and rejects subsequent membership changes. This is an intentional project gate in addition to the common CPU cap.

The two retained dependency compile attempts contain genuine same-PID/start-time transitions from `cpulimit-70.slice` to `cpulimit-80.slice`; both kept a common three-CPU ancestor and both correctly failed the stricter continuity gate, cleaning all owned processes. Read-only inspection of the host quota watcher shows executable-name matching on each scan. Settling the Python owner before work does not stabilize later Ninja children. The80 mapping file was permission denied and was not retried or bypassed. No current compiler retry or monitor change was made.

The observed common ancestor is capped at3 CPUs, the inherited70 leaf at5.6, and the compiler80 leaf at1.8. The effective common cap remains3; this does not make leaf migration acceptable under the current rule. Independent read-only review found no documented webterm launch/readiness route that solves this.

**Concrete external unblock:** an administrator must provide a task-specific supported launch scope that all owned build descendants inherit, that the host quota watcher honors without later migration, and that remains under the shared<=3CPU ancestor while not exceeding the current compiler1.8CPU cap. Reuse the unchanged monitor and require exact membership continuity and normal owned cleanup. Do not rename commands, move cgroups, change global policy, use unrelated exemption scopes, or ignore transition samples.

## Scoped headless graphics result

The isolated host probe used Chromium150.0.7871.114 with explicit NVIDIA EGL and a private nonexistent D-Bus address. It observed ANGLE/OpenGL ES on **NVIDIA GeForce MX110, driver580.173.02**, a WebGL2 readback pixel `[64,127,191,255]`, and GL error0. Extensions were disabled to eliminate the packaged Hangouts background target. Seven resource samples retained the common three-CPU cap; the browser exited normally and no owned process remained.

The final route explicitly disables Vulkan and skips WebGPU. An earlier combined probe obtained a software SwiftShader WebGPU adapter (`isFallbackAdapter:true`) even though the compute result was42; its hardware acceptance remains false. The driver logged `vkCreateInstance` failure and reported no hardware Vulkan support. These are scoped host facts, not guest graphics conformance, Firefox readiness, JIT execution, or performance acceptance.

Exact arguments, environment, browser/driver identity, rejected software result, raw-evidence hashes and the observed probe source are in `evidence/firefox-jit-integration-20261110/headless-egl.json` and `headless-egl-probe.mjs`. Replay requires a fresh owned disk root/profile/cache, unchanged bounded ownership and the serialized heavy-work slot. The JIT guest runner deliberately isolates graphics.

## Verification and resource accounting

| Owned operation | Wall seconds | Result |
|---|---:|---|
| First full source checkout |52.771|Pass|
| First preparation |7.006|Retained preparation failure: ignored configuration absent|
| Fresh second full source checkout |50.766|Pass|
| Corrected preparation |7.004|Pass, preparation only|
| Exact helper reconstruction/validation |1.502|Pass, no compiler|
| Read-only preparation audit |6.014|Pass, 1,775 checks|
| Final host NVIDIA EGL probe |7.754|Pass, hardware WebGL only|

Every completed owner records zero survivors, no quota failure and no cleanup inventory errors. CPU/RSS/available RAM/quota cadence is1s; PSS cadence5s. PSS values are sampled lower bounds, especially for the1.502s helper step. The successful preparation sampled peak RSS142,569,472bytes and PSS84,714,496bytes. GPU owner RSS sum was1,036,316,672bytes and sampled PSS520,412,160bytes. The source checkout sizes and tool cadence are not Firefox runtime memory measurements.

The audit independently rechecks the exact source-change set, input and1,687 header hashes, native command/source binding, owned temp/cache paths, no compiled Firefox objects, exact helper reconstruction, rejection of an altered wrapped object, existing-output refusal, original primary tracked state, all owner receipts and scoped GPU limits. It does not count synthetic native execution or retest the earlier host emitter suites. Full raw outputs remain at the owned paths linked by the committed receipts.

## Reproduction and next steps

The preparation recipe is deliberately locked to the reviewed pre-array packet. Use a fresh source worktree at the exact source HEAD and fresh output/owner paths. Both source checkout and preparation must run through `tools/guest-packages/bounded.py`; source checkout is disk work and also needs the common cap. Preserve failed attempts instead of rerunning into their outputs.

After the supported launch scope exists, verify that `logs/runtime-build-attempt-4.log` and the chosen owner directory are unused, then resume the existing configured runtime tree with `replay-native-dependencies.py --phase build --targets cxx_static --jobs 1 --attempt 4` under a fresh bounded owner. Attempt3 already belongs to the successful cxxabi/unwind finalization and must not be overwritten. Then use fresh verification attempt4 and refresh source/dependency closure. Do not rerun prepare/configure in that existing dependency tree.

Only afterward configure/export/build the prepared Firefox tree from its literal environment and phase commands, generate every required header/backend path, compile the two recorded native source units, replace exactly their JS archive members, and link with every input verified. Complete O2, the original fpcast ABI pass and Wasm validation before a native-only package. Independent exact source/build binding, real Normal/Bail/Interrupt and GC/live-entry probes, original deadlines/checkers, normal exit/reaping and matched same-input Firefox comparisons remain mandatory. No runtime is promoted by this checkpoint.

[Curated preparation](evidence/firefox-jit-integration-20261110/preparation.json), [dependency refresh](evidence/firefox-jit-integration-20261110/dependency-refresh.json), [helper reconstruction](evidence/firefox-jit-integration-20261110/helper-reconstruction.json), [resource receipts](evidence/firefox-jit-integration-20261110/owner-receipts.json), [audit](evidence/firefox-jit-integration-20261110/audit.json), and [policy diagnosis](evidence/firefox-jit-integration-20261110/process-policy.json) retain the reviewable result.
