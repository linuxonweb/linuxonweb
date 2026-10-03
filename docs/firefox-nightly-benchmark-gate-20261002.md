# Nightly original benchmark gate — 2026-10-02

This packet migrates `tools/guest-rootfs/test-firefox-pbl-bench.mjs` to an
explicit full Nightly159 baseline/full PBL-JIT comparison. Host fixtures exercise
the acceptance predicates. No browser, guest, full build, promotion or deployment
was started. Complete Nightly binaries and their actual guest acceptance remain
pending; this packet cannot establish JIT coverage, GPU support or release readiness.

The runner defaults to `PBLBENCH_MODE=nightly`. Old128 and old candidate arms
require `PBLBENCH_MODE=historical`; that mode remains a diagnostic with the old
noise labels and never sets `nightlyBenchmarkAcceptance`. Historical input/results
remain unchanged. Nightly requires explicit arms and their caller-reviewed SHA256,
the exact original fixture SHA256
`b07d647a19177c276ea5c94df60d7557405d0a69a767d21d471d3071fa5e31d8`,
ABBAAB order, and `PBLBENCH_GUEST_READY=1`. Fixture overrides, smoke orders and
silently inherited old identities cannot pass the Nightly gate.

## Reviewed input contract

The arms JSON keeps the existing `name`, `dir`, `version` and `archiveSha256`
fields. Here `version` is the runtime manifest version; it is deliberately
distinct from Firefox's compiled version. Add the following object to each arm:

```json
{
  "nightly": {
    "fullPackageDir": "/mnt/p6/build/OWNED/full-package",
    "fullReportSHA256": "REVIEWED_PACKAGE_REPORT_SHA256",
    "overlayReportSHA256": "REVIEWED_GPU_OVERLAY_PACKAGE_JSON_SHA256",
    "buildEvidencePath": "/mnt/p6/build/OWNED/build-evidence.json",
    "buildReview": {
      "path": "/mnt/p6/build/REVIEW/coherent-build.json",
      "sha256": "REVIEWED_BUILD_REVIEW_SHA256"
    },
    "baselineAcceptance": {
      "path": "/mnt/p6/build/REVIEW/accepted-baseline.json",
      "sha256": "REVIEWED_BASELINE_ACCEPTANCE_SHA256"
    }
  }
}
```

`baselineAcceptance` is required on A only. `dir` points to the actual complete
Nightly archive after the default GPU-page overlay. `fullPackageDir` points to
the output of `package-firefox-nightly.py` before that overlay. These are
independently pinned arm inputs: no equality with the old public128 source archive
is invented. The runner verifies the package reports, both complete archives,
manifest chain, sizes, application/platform stamps, full-build/fpcast/validator
evidence and every retained command-log hash. The overlay must preserve init/home
and order/tail. A and B must use identical full managed defaults, homepage/default
overlay records and all non-Firefox asset descriptors, with distinct browser
binaries and separate source/object trees.

The pinned source is159.0a1, official reference BuildID20261002211853,
Hg `dfc77f7a6d716f1a20a2576597638d4fc21cd916`. Each arm supplies its own actual
14-digit local BuildID and compiled matching stamps; the official reference ID
is not substituted for a local build. Whole-tree Hg/Git equality is not inferred
from this gate.

The new reviewed full-build record has the following mandatory fields:

```json
{
  "schema": 1,
  "passReview": true,
  "scope": "nightly-coherent-full-build",
  "nativeWasm": true,
  "libc": "musl",
  "fullGraphBuild": true,
  "freshObjectTree": true,
  "incrementalArchiveReplacement": false,
  "portableBaselineInterp": true,
  "sourceRoot": "/mnt/p6/build/OWNED/source",
  "objectRoot": "/mnt/p6/build/OWNED/objects",
  "sourceIdentitySHA256": "MATCHING_FULL_PACKAGE_HASH",
  "buildEvidenceSHA256": "MATCHING_FULL_PACKAGE_HASH",
  "rawBinarySHA256": "MATCHING_FULL_PACKAGE_HASH",
  "finalBinarySHA256": "MATCHING_FULL_PACKAGE_HASH",
  "evidence": [
    {"path": "/mnt/p6/build/REVIEW/configuration-proof.json", "sha256": "SHA256"},
    {"path": "/mnt/p6/build/REVIEW/compiler-proof.json", "sha256": "SHA256"},
    {"path": "/mnt/p6/build/REVIEW/link-proof.json", "sha256": "SHA256"}
  ]
}
```

`portableBaselineInterp` must be false for A and true for B. This record must be
produced by actual full-graph configure/compiler/link review under
`docs/firefox-nightly-full-jit-build-plan-20261002.md`: coherent headers/layouts,
target SjLj/WebAssembly C++ ABI, actual PblJit/PBL/Jit/XPC translation units,
fresh objects and final archive/link membership. A review's booleans are an
explicit caller-reviewed trust boundary; hashing them does not independently
prove their claims. Three preparatory objects cannot qualify. Every listed
evidence path is rehashed before and after the run. The runner also rejects
observed compiler/build processes in the owned source/object roots before
starting its QA server.

A's acceptance record must have `schema:1`, `passReview:true`,
`scope:"accepted-nightly-baseline"`, matching `archiveSHA256`, `runtimeVersion`
and `finalBinarySHA256`. Its `gates` must affirm `fullBuild`, `nativeWasm`,
`startup`, `defaultHomepage`, `savedHome` and `currentNssTls`, with at least two
hash-pinned `evidence` records. This is a review of actual completed baseline
and guest evidence, including current fresh/existing-profile TLS; a synthetic
fixture report or old119-root seed cannot supply it. Neither required reviewed
record has been produced by this preparatory packet.

## Live guest and comparative acceptance

The QA HTTP server listens on loopback port0 and records its allocated port.
Each Chromium boot uses `--remote-debugging-port=0` and an exclusively created
profile. It reads only that profile's fresh regular `DevToolsActivePort` file,
then requires the `/json/version` WebSocket port and browser UUID to match that
file before connecting. The spawned child must still be alive with both the
owned profile argument and dynamic debugging-port argument in its actual
`/proc/PID/cmdline`. The runner rechecks the file, version/browser ID and child
before connecting, and checks the page WebSocket against the owned loopback
port and target ID. Every CDP command, including cleanup navigation and
`Browser.close`, requires verified ownership and the live owned child. There is
no fallback to the historical fixed HTTP4201/CDP9411 endpoints in either mode.

Each boot retains `endpoint-ownership-attempt.json` as soon as a port file is
observed, and `endpoint-ownership.json` before the verified connection. The
result includes actual port/browser ID, spawned PID, file freshness, profile,
target and HTTP origin. Missing/stale/symlink files, dead children, wrong process
arguments and mismatched browser/page IDs fail before browser commands. This
ownership migration addresses root review's concrete fixed-port hazard: a
user's existing Chrome on9411 must never receive this runner's navigation or
close commands. Endpoint fixtures are pure and do not start a server/browser.

Every boot retains immediate startup kernel SMP evidence and fresh nproc readings
at preboot, startup and benchmark end; the new identity phase also rereads nproc.
The final run reading must match all six arms. Browser hardwareConcurrency,
requested/selected CPUs, actual kernel CPUs and fixture navigator CPUs must equal
the dynamically observed count. Counts above64 fail because the present UI clamps
there. Historical observations of six/eight do not select a future count.

The ready fixture measures real guest page readiness. Before fixture timing, a
bounded real keyboard Browser Console probe logs `Services.appinfo.version`,
`platformVersion`, `appBuildID`, `platformBuildID`, `OS` and `XPCOMABI` under a
unique per-boot label. It requires exact compiled version/local IDs and the
measured native target's `Linux`/`wasm32-gcc3`. Current recovery `config.status`
and `mozilla-config.h` both report `TARGET_XPCOM_ABI=wasm32-gcc3`. Compiled
application/platform source stamps are separately pinned by the package chain.
The ready and benchmark UA must be Firefox159. `navigator.buildID`, which is
often privacy-reduced, is not used as exact build proof.

The Browser Console keyboard/evaluation path is unverified against actual
Nightly. The runner records the exact expression and raw identity guest logs;
missing output, unavailable chrome console, focus/input errors or wrong appinfo
fail with no UA-only fallback. This prerequisite must be exercised in a bounded
guest smoke before scheduling a costly six-boot acceptance run. It is an
observer, not a browser/source/runtime patch. Matching console preferences are
seeded in both arms and the console closes before timed navigation.

Each boot must retain exactly24 case rows: all eight original names once in each
of three rounds, each with100 repetitions, eleven positive finite batches and
the correct median. Each checksum is independently checked as the fixture's
known result multiplied by1100 with int32 wraparound. All144 rows across six
boots remain mandatory. Duplicate/missing rows, incorrect checksums, error
events, fatal logs/traps, wrong build identity or incomplete cleanup fail.
Fatal observations from startup through the final guest poll are accumulated so
later log eviction cannot clear an observed crash. Startup SMP is saved
independently before the benchmark history can evict it.

The primary verdict is the unrounded ratio of B's median of its three per-boot
case medians to A's equivalent median. Every original case requires B/A<=1.
The same strict bound applies independently to launcher observation and actual
guest readiness. Noise labels cannot waive a regression. All33 timed batches
per case/boot are included; there is no trimming or sample exclusion. These are
the original broad correctness/fallback cases, not proof that the let-based
integer fixture or excluded arguments/arrays/properties/Math compile in the
current42-op specializer. Coverage/safety/debugger/GC/cancellation/thread/TLS and
public-v10 compatibility remain separate mandatory gates.

## Host validation and future invocation

All scratch, logs and fixture output stay under
`/mnt/p6/build/firefox-nightly-benchmark-gate-20261002`; the task has a2GiB cap
and20GiB free reserve. No `/tmp` output is permitted. The runner checks this
policy before startup, during deadline polling and before final result write.

```bash
export TMPDIR=/mnt/p6/build/firefox-nightly-benchmark-gate-20261002/scratch
export TMP="$TMPDIR" TEMP="$TMPDIR"
node tools/guest-rootfs/check-firefox-nightly-benchmark.mjs --self-test \
  /mnt/p6/build/firefox-nightly-benchmark-gate-20261002/fixture-run5
node --check tools/guest-rootfs/test-firefox-pbl-bench.mjs
node --check tools/guest-rootfs/check-firefox-nightly-benchmark.mjs
```

The selected host regression evidence is `fixture-run5/result.json` (118 checks). Earlier
fixture-run1/run2/run3/run4 are retained. The regression set includes wrong/missing source,
local BuildID and stamp fields, incomplete/failed build/ABI evidence, unaccepted
baseline/TLS, incorrect PBL configuration, shared objects and changed resources,
lost/duplicate rows/batches, NaN/zero timings, wrong checksums/repetitions, each
of eight strict slower cases, launch/readiness regressions, fatal/cleanup errors,
live app/platform identity mismatches and CPU phase/cross-arm drift.
Ownership regressions additionally reject stale/malformed port files, exited or
signaled children, missing process/profile evidence, foreign hosts/ports/browser
UUIDs, mismatched page targets and missing ownership evidence in accepted reports.

After all actual prerequisites and the identity-driver smoke exist, a new
complete acceptance invocation is:

```bash
PBLBENCH_MODE=nightly PBLBENCH_GUEST_READY=1 \
PBLBENCH_ARMS=/mnt/p6/build/REVIEW/nightly-arms.json \
PBLBENCH_ARMS_SHA256=ACTUAL_REVIEWED_SHA256 \
node tools/guest-rootfs/test-firefox-pbl-bench.mjs \
  /mnt/p6/build/firefox-nightly-benchmark-gate-20261002/acceptance-run1
```

`pass` and `nightlyBenchmarkAcceptance` mean only this frozen benchmark passed.
`jitAcceptance`, `gpuAcceptance` and `releaseAcceptance` remain false because
this runner does not establish the other mandatory acceptance gates. No actual
guest acceptance invocation occurred in this packet.
