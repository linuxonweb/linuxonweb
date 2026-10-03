# Isolated Nightly baseline guest gate — 2026-10-02

`tools/guest-rootfs/test-firefox-nightly-baseline.mjs` is a finite callable
baseline runner for the actual latest Nightly159.0a1 native Linux/Wasm candidate.
It does not build, package, promote, deploy, or modify public/local production
payloads. It uses a fresh private Chromium profile, persistent home and generated
QA server per invocation. Ports are allocated dynamically. The existing
Firefox128 diagnostic runners and historical evidence remain unchanged.

Current evidence is **preparation only**. Syntax verification and 36 synthetic
contract checks pass; no Nightly browser was started, no real archive was tested,
and no Nightly/JIT/GPU/TLS/release acceptance follows. Evidence:
`/mnt/p6/build/firefox-nightly-package-gate-review-20261002/contract-run2/result.json`.
The independent review copy redirects only its task root and uses the identical
shared CPU helper. Earlier 24-check run1, 27-check run2, 29-check run3 and
32-check run4 in the baseline task remain retained. The checks independently save
synthetic startup logs/SMP evidence and prove that missing SMP and historical
two-CPU startup evidence fail. They also refuse final host/UI CPU drift, missing
full-package input archive/manifest hashes, missing overlay source-manifest
hashes and added overlay system assets. These synthetic logs are labelled
`fixture-*`.

## Candidate inputs and required preconditions

Finish the full Nightly native Wasm build and fpcast validation before invoking
this runner. Do not start a guest while the owned full build is loaded. The
runner checks the process snapshot for owned compiler/Cargo/full-build commands
under `/mnt/p6/build/firefox-nightly-musl-recovery-20261002` and refuses them;
the operator must also coordinate other host load before real acceptance.

Use the complete Nightly runtime package from
`tools/guest-rootfs/package-firefox-nightly.py`, followed by the default-page
overlay from `tools/guest-rootfs/package-firefox-gpu-check.py`. Pin the reviewed
SHA-256 of **both reports** in the command. The runner binds the overlay's source
archive, source manifest and source version to the full package, then hashes
both actual archives and manifests. It also hashes the QA kernel/plain images
and requires their descriptors to remain identical. Every recorded input is
rehashed after the successful phases. Report hashes must be reviewed independently;
a caller-created report is not proof that a real full build occurred.

The full report must provide:

- `passPackage=true`, `candidateOnly=true`, `guestAcceptance=false`;
- `identity.version=159.0a1`, a fourteen-digit `identity.localBuildID`, the exact
  forty-hex `identity.hgRevision`, and matching `stamps` for `application.ini`
  and `platform.ini` (`version`, `buildID`, `sourceStamp`);
- `sourceSha256`, `sourceManifestSha256`, `sourceIdentitySHA256`,
  `buildEvidenceSHA256`, `runtimeInventorySHA256`,
  `rawBinarySHA256`, `finalBinarySHA256`, `archiveSha256`, `bytes`, and `version`;
- `allOutsideRuntimeRecordsIdentical=true` and `tailPreserved=true`.

The GPU overlay report must provide `passPackage=true`, `candidateOnly=true`,
`pageUrl=file:///opt/firefox/gpu-check/gpu-check.html`, the source archive/manifest
hashes and source version, final archive hash/bytes/runtime version, and true
home/profile, init, member-order and trailer preservation flags.
The candidate and full-package manifest asset sets must also match exactly.

The latest acquired official identity is 159.0a1, official reference BuildID
20261002211853 and Hg dfc77f7a6d716f1a20a2576597638d4fc21cd916. The current local
build identity is 20261003042618. The runner reads the actual hash-pinned full
package report instead of treating this prose or a hardcoded browser UA as proof.

For fresh NSS trust, the reviewed init-only trust adapter must be applied to the
known-good source archive **before** the full Nightly packaging stage. Its
`package-report.json` binds `sourceArchiveSHA256`/`sourceManifestSHA256` to v10,
`archiveSHA256` to the transformed input, and `sourceInitSHA256`/`outputInitSHA256`
to the exact launcher transformation. Require `passPackage=true`,
`runtimeAcceptance=false`, `browserRuntimeChanged=false`, and
`mustNotRunStandalone=true`. Bind that adapter's `archiveSHA256` to the full
Nightly report's `sourceArchiveSHA256` (also exposed as `sourceSha256`). This
runner records the full package input hashes; the separate init/trust audit
remains mandatory release evidence. The init-only archive must never be booted
as a Nightly candidate. See
`docs/firefox-nightly-nss-adapter-audit-20261002.md` for current static CKBI,
DER/trust fingerprints, fresh-profile and saved-profile requirements.

The task root is `/mnt/p6/build/firefox-nightly-baseline-gate-20261002`, with a
2 GiB allowance and 20 GiB free-space reserve. TMPDIR/TMP/TEMP must each resolve
to an existing disk-backed directory inside that root. The runner checks the
allowance/reserve before startup and every 30 seconds while waiting. Chromium
uses private disk caches and `--disable-dev-shm-usage`. Output directories must
be new; profiles and evidence are retained after graceful owned-browser/server
cleanup. Other browsers and services are untouched.

## Real invocations after packaging

Run the default-page cold/warm gate first. The following is an invocation
template; replace the four candidate/report placeholders with reviewed real
paths and SHA-256 values. The template has not been executed:

```sh
TASK=/mnt/p6/build/firefox-nightly-baseline-gate-20261002
TMPDIR="$TASK/scratch" TMP="$TASK/scratch" TEMP="$TASK/scratch" \
node tools/guest-rootfs/test-firefox-nightly-baseline.mjs \
  --out "$TASK/cold-warm-real-run1" \
  --candidate GPU_HOMEPAGE_CANDIDATE_DIRECTORY \
  --overlay-report-sha256 REVIEWED_GPU_OVERLAY_REPORT_SHA256 \
  --nightly-package COMPLETE_NIGHTLY_PACKAGE_DIRECTORY \
  --nightly-report-sha256 REVIEWED_FULL_PACKAGE_REPORT_SHA256
```

The actual guest starts with the existing Firefox launcher and canvas2d host
transport. Neither a homepage preference nor explicit guest launch URL is seeded
in cold/warm mode. The runtime's default local GPU-check page must therefore
open automatically on **both** boots. The runner captures its browser identity,
settled WebGL/WebGPU diagnostics and screenshot, then navigates with real guest
keyboard events to an owned local input fixture. The fixture reports readiness,
accepts typed `wasmperf`, computes checksum 7998000 and downloads its JSON result.
The runner requires the actual persistent-home download to match that result.

A separate fresh invocation tests original-baseline to Nightly update and warm
restart. Append these options to the same command with a new output name such as
`update-warm-real-run1`:

```sh
  --baseline SAVED_VERIFIED_V10_DIRECTORY \
  --baseline-archive-sha256 REVIEWED_V10_ARCHIVE_SHA256 \
  --baseline-manifest-sha256 REVIEWED_V10_MANIFEST_SHA256
```

The explicit baseline is independent of the init-adapted packaging input; it
does not have to equal the full package's `sourceSha256`. This mode seeds a
saved local probe homepage in its private `user.js`, boots the verified baseline,
uses the actual `Update & restart` UI action, then boots Nightly and performs a
warm restart. It checks the saved homepage, user.js, home marker, fixture and
all prior guest-generated downloads for preservation. Consequently this update
mode does **not** establish default homepage behavior; that comes from the
separate cold/warm run above. This runner does not import or mutate the retained
real public-v9/v10 user profile; public profile-update acceptance remains a
separate release gate.

`--chromium PATH` may override the default known working host executable
`/home/a/.local/archpkg/pacman/usr/bin/chromium`. The browser must expose the
same host CPU allocation as `nproc`. The shared host-count helper selects the
UI-supported host count, currently 8, and every phase saves startup guest logs
and independently asserts actual kernel `smp: Brought up ... CPUs` evidence
before later browser logs can evict it. Missing startup evidence fails; no phase
inherits an earlier boot's count. Warm and post-update boot documents must
request zero kernel/rootfs system images. The update action may download and
verify its new candidate while staging **before** it restarts.

## Evidence and acceptance boundaries

The final `result.json` contains exact package/source/local build identity,
browser-reported UA/version/BuildID, host `nproc`, hardwareConcurrency,
requested/selected/kernel guest counts, screenshots, startup logs, phase logs,
typed fixture outputs, download preservation, network request records, pinned
inputs, storage size, and cleanup status. A nonzero owned browser exit, forced
termination, server cleanup failure, outer browser exception, changed input,
fatal guest trap/assertion, missing readiness, identity mismatch, persistence
failure or CPU mismatch fails the baseline.

Guest UA must identify Firefox 159 for candidate phases. Firefox usually reports
`Firefox/159.0` rather than the exact `159.0a1` source milestone, and
`navigator.buildID` can be privacy-reduced. The runner records those values
verbatim, reports whether the exposed buildID matches the local compiled value,
and uses independently pinned application/platform stamps for exact compiled
identity. It does not silently treat a reduced buildID as an exact-build proof.

WebGL or WebGPU absence/failure remains visible and can accompany a baseline
PASS; successful GPU rendering is a subsequent independent gate. The runner
always leaves `gpuAcceptance`, `jitAcceptance`, `tlsAcceptance` and
`releaseAcceptance` false. Its timings are fixed-deadline readiness observations,
not performance comparisons.

TLS cannot be inferred from browser startup, a historical seed count, current
certdata count, or packaging. Required follow-up evidence includes the actually
loaded static token's exact DER/trust inventory, no stale seed in a fresh
profile, saved custom trust/distrust/keys preserved through update, deterministic
valid/hostname-mismatch/expired/untrusted HTTPS fixtures with a rendered nonce
only on the valid route, and no certificate clickthrough exceptions. None of
those real TLS tests was run here. The current trust audit is read-only and
explicitly reports `runtimeAccepted=false`.

To repeat only preparation checks without launching any browser:

```sh
node --check tools/guest-rootfs/test-firefox-nightly-baseline.mjs
node tools/guest-rootfs/test-firefox-nightly-baseline.mjs \
  --self-test /mnt/p6/build/firefox-nightly-baseline-gate-20261002/contract-run5
```
