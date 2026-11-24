# Firefox JIT preflight integration — 2026-11-08, iteration 3

The current nested compiler is integrated into a complete, pinned host packet.
Both host suites pass. Native integration, a rebuilt Firefox package, guest
execution, and performance acceptance remain unproved. The broader project
acceptance remains 45/100; no deployed source or runtime was changed.

## Source and commit provenance

Working branch: `gpt-6-astra-pro_firefox-jit_20261108-iteration-0` in the owned
`../linuxonweb-firefox-jit-20261108-iteration-1` worktree; starting commit `be48594`.

- Nested compiler original: `fe43f006c8d90dba288789dad4e2527d2881122a`;
  integrated by cherry-pick as `d2a39b1`.
- Independent guest probe kit original: `a2400ca94231b06e153d360f3b03d719c905b650`;
  integrated with provenance as `93bcf19`. Its owner's 703 checks were not rerun:
  the probe files were unchanged, and there was no native candidate invocation.
- Canonical candidate: `tools/pbl-jit/PblJit.cpp`, SHA256
  `ecfbb9d379893a7f8eb997b191d6d8488ff64449c8e13d6af2a05c0f3171fbb4`.

## Exact inputs and implementation

`final159-rebuild-lock.json` pins 75 source/build/package files and source HEAD
`525176a870d4ec4329e7decdb2ef7fdd5b87fb22`. The fresh invocation used these arguments,
relative to the owned worktree:

```sh
python3 tools/nightly-jit-prep/rebuild-preflight.py \
  --source ../linuxonweb-org-push/firefox-src \
  --build-receipts ../astra-linuxweb-oct17/jit-typed-o2-build \
  --package ../astra-linuxweb-oct17/jit-o2-package/package \
  --jit-source tools/pbl-jit/PblJit.cpp \
  --output ../linuxonweb-firefox-jit-20261108-preflight-3a
```

Run this through `tools/guest-packages/bounded.py` with a fresh output and owner
receipt directory, disk-backed temporary files, and a finite time limit. The
preflight intentionally exits 2 when inventory is complete but native build
readiness is false. The bounded owner's `pass: false` for that exit is retained;
it is not presented as a successful native build.

The preflight validates historical receipts and exact JS archive membership,
relocates literal build inputs into the owned output, and keeps missing or denied
inputs explicit. It preserves the reviewed final159 PBI/PBLIC/PBLBC source
closure and binds the two compile commands to `OUTPUT/native-src/PblJit.cpp` and
`OUTPUT/native-src/PortableBaselineInterpret.cpp`. Both the native source and
source overlay receive the exact reviewed Watchtower API and wasm32 ABI adapter.
No historical configured objects are reused or fake configured headers created.

The host packet now copies and hash-pins `emit.cpp`, `run.mjs`,
`nested-fixtures.h`, and `run-nested.mjs`, and declares separate baseline and nested
runners. `run-host.py` requires the complete declared contract, verifies source
and packet hashes before compilation, copies the auxiliary header, and executes
both declared runners with finite bounds. Missing, altered, unpinned, or omitted
nested assets/runners fail closed. A zero exit without a passing nonempty result
is not accepted. Results appear separately under `test_results`; `test_result`
continues to expose the baseline result for existing consumers.

The adapter derives all 239 opcode numbers/lengths from the locked final159
header and preserves the committed TryNoteKind/trynotes scaffolding. The final
audit also checked every opcode already present in the fixture against that
header; no duplicate scaffolding or changed fixture opcode identities were found.

## Fresh verification

| Check | Result |
|---|---|
| Boundary tests | 15 tests passed, including six packet-integrity/result cases |
| Preflight | `passEvidence: true`, `hostPacketReady: true`; intentional exit 2 |
| ASan/UBSan compilation and emission | Both commands exited 0; sanitizer stderr empty |
| Existing suite | 42 modules; 1,969 execution checks, zero failures |
| Cache checks | 20 checks, zero failures |
| Nested suite | 9 modules; 2,702 checks across 184 scenarios, zero failures |
| Hostile nested input | 11 rejected fixtures; no Wasm module installed |
| Final source/packet audit | 107 checks passed |

The older `preflight-1b-v2` packet establishes only the baseline 42 modules,
1,969 execution checks, and 20 cache checks. The new `preflight-3a` packet adds
nested evidence; the old baseline counts are not relabelled as nested coverage.

| Bounded job | Start UTC | Finish UTC | Wall time | Child exit |
|---|---|---|---|---|
| Boundary tests | 2026-11-08T20:26:02.537817+00:00 | 2026-11-08T20:26:04.542031+00:00 | 2.004 s | 0 |
| Preflight inventory | 2026-11-08T20:26:19.851249+00:00 | 2026-11-08T20:26:22.102849+00:00 | 2.252 s | 2 |
| ASan/UBSan host suites | 2026-11-08T20:26:52.223966+00:00 | 2026-11-08T20:27:03.227937+00:00 | 11.004 s | 0 |
| Final source/packet audit | 2026-11-08T20:28:46.941840+00:00 | 2026-11-08T20:28:48.444031+00:00 | 1.502 s | 0 |

Every recorded live owned process sample shared the capped `cpulimit.slice`
ancestor at at most three CPUs. CPU/RSS/available RAM/quota sampling was 1 s;
PSS sampling was 5 s, so the peak PSS is a sampled lower bound. Host-suite peak
RSS was 326,426,624 bytes and sampled peak PSS 252,958,720 bytes. All owners,
including the failed audit below, recorded zero remaining owned processes, no
quota failure, and no cleanup inventory errors.

The first final audit incorrectly counted companion `.bytecode.json` files as
rejection metadata and failed in 1.753 s. That script and receipt remain under
`preflight-3a-audit.py` / `preflight-3a-audit-owner`. Version 2 excludes the
companion files and passes. No compiler, runner, emitted fixture, or successful
host result was changed or rerun to resolve that audit-only selection error.

## Evidence and next native build step

All paths below are relative to the owned worktree:

- `../linuxonweb-firefox-jit-20261108-preflight-3a/`: `preflight.json`,
  `compile-commands.json`, `source-overlay/`, `native-src/`, `host-packet/`,
  `unavailable-inputs.json`, and the 107-check `integration-audit.json`.
- `../linuxonweb-firefox-jit-20261108-preflight-3a-tests/` and `-inventory/`:
  command logs, owner receipts, and resource samples.
- `../linuxonweb-firefox-jit-20261108-preflight-3a-host/`: real emitter executable,
  emitted modules/metadata, four command logs, and separate suite results.
- `../linuxonweb-firefox-jit-20261108-preflight-3a-host-owner/` and
  `-audit-v2-owner/`: successful bounded resource receipts.

Host packet manifest SHA256:
`ecfdf31d835d06979884908250f643b77796ff070e0f5d56d69861dc7d2db3f0`.

All three gates remain false: `nativeIntegrationReady`, `fullBuildReady`, and
`guestRuntimeAcceptance`. The inventory deliberately lists 2,634 absent
configured Firefox objects and eight absent configured headers/backend paths.
They must be regenerated in the owned build. The one denied historical Mesa EGL
archive is a separate source-closure task; this iteration does not try another
private path or bypass its access controls.

Next, finish the declared dependency source closure, create a complete owned
Firefox source checkout, apply the recorded source overlay and relocated adapter
recipe, then configure/build the exact native wasm32 Linux target in the owned
object directory. Compile both recorded `native-src` translation units, replace
exactly `PblJit.o` and `PortableBaselineInterpret.o` in the rebuilt JS archive,
and link only after every required input has verified identity and a completed
resource receipt. Full O2, Wasm validation, a native-only package, and real guest
normal-return/safety probes are subsequent gates. This iteration starts none of
those long native build or guest jobs and changes no deployment defaults.
