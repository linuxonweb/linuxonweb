# Firefox JIT native preparation — 2026-11-10

## Result and acceptance

The two reviewed preparation branches are integrated, a complete isolated Firefox159 source tree is prepared with the reviewed nested-loop candidate, and the missing helper mapping archive is reconstructed **byte-for-byte** from an existing owned object. The original six-archive dependency set still lacks `libc++.a`. No compiler, native Firefox link, package, guest, or new performance benchmark ran in this iteration. The project acceptance remains **45/100**.

`preparationComplete: true` means paths and source inputs were prepared. `compiled`, `nativeIntegrationReady`, `fullBuildReady`, and `guestRuntimeAcceptance` remain false. The custom PBLIC/PBLBC/PBLJIT tiers are not upstream SpiderMonkey native JIT: the preserved target configuration contains `--disable-jit` and `--enable-portable-baseline-interp`.

This work explicitly binds the **pre-array nested-loop candidate**. An independent array extension is being developed separately. It is absent from this prepared source and packet. The preparation recipe intentionally pins packet3a and its exact candidate; integrating a changed compiler requires a new complete host packet, including every new fixture/header/runner, fresh native-source adaptation and independent review. Do not relabel this receipt as covering a later candidate.

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
