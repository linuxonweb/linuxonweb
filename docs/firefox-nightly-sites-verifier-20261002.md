# Nightly Sites verifier preparation — 2026-10-02

This packet prepares a separate verifier for the two authorized releases in
`firefox-nightly-sites-release-plan-20261002.md`: accepted Nightly native Wasm
musl JIT first, then accepted GPU support. It changes no production runtime,
nested Sites checkout, historical verifier, source/build tree, public project,
audience or deployment. No browser, guest, server, build or network request is
started. Public v10 remains unchanged.

The host fixture suite passes 133 checks in
`/mnt/p6/build/firefox-nightly-sites-verifier-20261002/fixture-run8/result.json`.
Its `preparationPass=true`, `synthetic=true`, `releaseAcceptance=false` are
deliberate. Earlier fixture runs remain retained. Synthetic expectations are
explicitly marked, the contract cannot grant release acceptance for synthetic
inputs, and the production CLI rejects synthetic expectation packets.

## Scoped implementation and historical inputs

`tools/nightly-sites-verifier/contract.mjs` exports pure expectation, CPU and
release-contract checks plus a retained-evidence loader. `public-routes.mjs`
exports a read-only public-route verifier. `verify.mjs` supplies the CLI;
`test-contract.mjs` runs host-only fixtures with an injected transport, without
a listening server or live fetch. `public-html-policy.mjs` is a byte-for-byte
copy of the reviewed v10 policy, including its exact Cloudflare script template
SHA-256 `2740fe651481007b07bd176b8b9576b3efbdf506482cd41efe3101cc24a85297`.

Historical inputs remain unchanged:

- `/mnt/p6/build/guest-jit-sites-20261002/verify-public-runtime-v2.mjs` pins v10
  root `772bb8cb78fadbfaf850e1e34691d710bfcad146`, graph
  `43f61cac353536c8ee049d01b0b90aa903ccdd08f8176e26e380ebe41d0a1f30`, 90 routes,
  runtime `ce0d881dec8c` and the Firefox128 archive.
- `/mnt/p6/build/firefox-homepage-20260926/public-check.mjs` hardcodes two CPUs.
- `/mnt/p6/build/firefox-tls-20260926/test-firefox-tls-ready-release.mjs`
  hardcodes two CPUs and the old 119-root LOWLAND seed expectation.
- `web/sites/release-runtime.mjs` still has the old Firefox128 W3 decoder pin;
  this preparation does not change or bypass it.

## Reviewed inputs and trust boundary

An independent release review must freeze the expectation file and its SHA-256
before any verifier invocation. Expectations cannot be derived from live public
responses. Use the reviewed release's immutable dist, acquisition/build,
acceptance and promotion packet as inputs. The CLI checks the externally supplied
expectation-file SHA; every evidence input has an explicit relative path and
SHA-256. Realpath checks reject evidence escaping its packet, including symlinks.
Raw artifacts are streamed and hashed, with their first 512 bytes retained in
the in-memory descriptor; JSON records are hashed before parsing.

The caller independently reviews the underlying evidence and freezes its hashes.
The contract enforces required fields and cross-record identities, but cannot
authenticate a guest transcript, platform response or claimed source-graph audit.
A dishonest or mistaken reviewed record could still misrepresent observations.
Hashing a report establishes its retained identity, not its factual truth. The
verifier never calls connectors, authenticates credentials, pushes, saves,
promotes, deploys or automatically rolls back.

`synthetic-expectations.json` and `synthetic-contract-input.json` in fixture-run8
illustrate the normalized schemas only. They are not executable release inputs.
Do not remove their synthetic marker or reuse their fake identities. A real
packet must contain all report roles and all raw artifacts referenced by each
report. `evidence.binary`, `applicationINI`, `configureLog`, `linkLog` and
`compilerArgv` are mandatory build inputs. The binary must have the native Wasm
module header and the separately accepted binary hash; application.ini must
contain the exact Nightly version and actual local BuildID. Actual full-build
host/guest compiler captures must show guest WebAssembly C++ ABI and SjLj flags,
with no target flags in host commands. An isolated replay is rejected.

The expectation schema separately pins:

- Existing project `appgprj_6ab78cc88a948191a1abaabd04b81fe0` and unchanged
  `https://linuxonweb.exact-coot-7512.chatgpt.site` origin.
- Acquired reference 159.0a1 / `20261002211853` / Hg
  `dfc77f7a6d716f1a20a2576597638d4fc21cd916` / Git mirror
  `bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23`; actual local BuildID is separate.
- Accepted binary, runtime and three images with exact sizes/hashes/routes;
  root commit P, nested Sites commit N and immutable worker graph.
- Exact dist asset/graph/provenance/root hashes, complete route inventory,
  and deployment tar size/hash.
- Returned saved-version ID and deployment ID, after those real operations;
  the expectation packet for final acceptance is reviewed again to add these
  exact returned IDs. Do not predict them.
- Rollback identity: v10 for JIT release; previous accepted Nightly JIT release
  for GPU release, including its frozen final acceptance report hash.

P belongs to the root runtime/source commit. N belongs to the independently
prepared nested Sites source. Provenance refers to P, platform save source refers
to N, and the exact deployment refers to the returned saved-version ID. No file
must hash its own containing commit, and no expectation must exist at P or N.
Keep post-operation evidence in the disk-backed release packet. The local tar
and server archive hash remain separate; their differing normalization is not
assumed equivalent.

## Required release evidence

The complete contract cannot succeed without all of `build`, `package`,
`candidateQA`, `nss`, `jit`, `performance`, `dependency`, `promotion`, `source`,
`baseline`, `save`, `deployment`, `routes` and `publicQA`, plus their pinned raw
references. It does not accept a caller's top-level pass Boolean. It checks:

- Full native Wasm/Linux/musl configure/link completion, coherent PBL build,
  actual linked binary/application identity, complete dist resources, validation,
  fpcast and preservation of unrelated archive records.
- Actual candidate and public cold/warm/update boots, current version/BuildID,
  active manifest, isolation/SAB, automatic local homepage and animation/status,
  typed input, guest JS/download, DevTools, actual JIT, normal shutdown and cleanup.
  Warm boot and cached restart after `Update & restart` require zero image
  requests. The baseline is current public v10 for release1, accepted Nightly JIT
  for release2; the retained v9 profile is not accepted as a substitute.
- The automatic page path is exactly
  `file:///opt/firefox/gpu-check/gpu-check.html`, matching the full packager,
  GPU overlay and Nightly baseline runner. The old shortened path is rejected.
  Page `reportedUserAgent` and raw `reportedBuildID` are separate observations:
  Firefox159 major must agree, but navigator.buildID may be privacy-reduced or
  absent. Exact local BuildID is required from retained compiled application.ini
  and actual guest app/privileged identity records, not the page's raw display.
- Baseline readiness/keyboard/download and safely closed profile; before/after
  hashes for home, saved homepage/user.js, previous downloads, explicit distrust,
  trust choices and SDR key, plus normal stopped/reopened profile behavior.
- Source-derived current NSS DER inventory, fresh/no-seed and module-policy gates,
  valid HTTPS and self-signed/expired/hostname/distrust rejection on candidate
  and public runtime through unchanged `/dns` and `/tcp`; stopped-profile
  key/auth/trust preservation. No fixed 119-root or 173-root count is assumed.
- Actual guest JIT install/call/free, integer correctness/bailout, interrupt,
  active incremental GC, debugger/coverage, positive handler/throw policy,
  script/global/cache and Worker/TLS/stack isolation. Guest abort/unreachable,
  no post-trap continuation, safe quota fallback and current table/memory
  contracts are separate required fields.
- Frozen ABBAAB comparisons against v10 and same-Nightly non-JIT controls, all
  six arms, retained raw samples/checksums, zero exclusions and no regressed
  median case (`candidate/control <= frozen bound <= 1`). Each comparison has
  exactly one summary for each original case: `int-loop`, `call-recursion`,
  `throw-flat`, `throw-deep`, `throw-error`, `prop-mono`, `native-call` and `json`.
  Each arm has exactly three measured rounds of all eight cases,100reps,
  eleven positive finite raw batches per case and the actual expected checksum.
  Summaries are recomputed from all raw batches; duplicate, missing, unknown,
  nonfinite and zero cases/batches fail. Positive finite actual launch and guest
  readiness timings, readiness observation and their independent strict bounds
  are also mandatory. The reviewed declaration pins workload SHA-256
  `b07d647a19177c276ea5c94df60d7557405d0a69a767d21d471d3071fa5e31d8`,
  case checksums/counts, repetitions, order, candidate/control hashes, all bounds
  and a freeze timestamp before each arm. Both the declaration and fixture are
  retained evidence inputs; the final report must reference their frozen pins.
  Broader accepted
  JIT coverage/case declarations remain the independent review's responsibility;
  these fields cannot turn 42-op preparation into universal JIT acceptance.
- Root P/nested N/remote HEAD, reviewed clean paths, current unit/workerd results,
  exact tar/provenance, saved source N, exact returned save/deploy IDs, terminal
  success, unchanged public audience and no deployment overrides.

CPU checks require real `nproc`, browser hardwareConcurrency, selected/requested
CPUs and saved startup kernel SMP to agree. Observations include fresh preboot,
startup, post-phase and final reads; allocation drift is rejected. Comparative
arms and both controls use the same count. Fixtures cover six and eight CPUs;
neither is pinned. Counts above64 fail until a deliberate UI-limit change is
reviewed. The integration adapter must record every actual phase read, not copy
one observation into multiple phases.
The latest actual `smp: Brought up N node(s), C CPU(s)` line determines the count;
a correct earlier line cannot mask a later mismatch. This matches the shared
`firefox-host-cpus.mjs` helper rather than an invented startup-log format.

For release1 the legacy Firefox128 GPU decoder is admissible only with complete
reviewed call traces showing zero legacy-decoder invocations from every enabled
Nightly caller. This packet does not provide that proof. Unsupported GPU status
on the local homepage is admissible for the JIT release.

For release2 the contract requires current Nightly FFI/goldens/decoder hashes,
malformed-test evidence and real guest Vulkan/OpenGL/Firefox WebGL/WebGPU cases
with animation, exact readback, backend/limits, recovery and normal shutdown.
It rejects the old decoder hash and host-only cube/adapter proof. The previous
Nightly JIT acceptance must be loaded with the exact rollback hash and matching
runtime/archive/saved-version/deployment IDs. GPU acceptance cannot reuse the
JIT release's inactive-dependency proof.

Compute is a reviewed feature policy, not a permanent GPU-release prohibition.
The JIT release conservatively requires `allowCompute=false`. A GPU release can
declare `allowCompute=true` only with a separately pinned retained shader fixture,
current Nightly FFI/decoder bindings and guest compute dispatch/readback, limits,
error/recovery proof in dependency, private and public QA. Host-only execution,
stale ABI, absent public compute proof or mismatching readback fails.

## Read-only full public-route verifier

`verifyPublicRoutes` verifies the reviewed local dist manifest/graph/provenance
and every local staged logical route before trusting its public counterpart. The
complete route inventory is independently pinned; counts can change from v10.
Every complete public route is streamed/hashed, including all three images and
immutable worker routes. It checks exact MIME, COOP/COEP/CORP, nosniff, ETag,
stable/immutable cache policy, HEAD and 304, and bounded ranges for all images.
Firefox must have multiple staged parts and receives a cross-part range check.
Parts are constrained to the existing20MiB ceiling and the reviewed client tree.

The static root must match the built Firefox meta-refresh and has no COOP;
`/linux/index.html` must provide isolation. Only the existing exact Cloudflare
insertion policy is accepted, with constrained ray/timestamp values and identical
remaining application bytes. New injections fail. Fixture/source/candidate and
wrong worker-graph URLs must return isolated404 responses. A successful route
report sets `complete=true` and always `releaseAcceptance=false`; actual private
and public browser QA is required by the separate final contract.

Prospective commands, after real reviewed inputs exist:

```bash
export VERIFY=/mnt/p6/project/linux/linuxonweb/tools/nightly-sites-verifier
export PACKET=/mnt/p6/build/firefox-nightly-sites-verifier-20261002
export TMPDIR="$PACKET/tmp" TMP="$PACKET/tmp" TEMP="$PACKET/tmp"
# EXPECTED_SHA is the independently reviewed expectation-file SHA-256.
# REVIEWED_DIST and EVIDENCE_DIR are the actual immutable release inputs.
node "$VERIFY/verify.mjs" routes "$EXPECTED_JSON" "$EXPECTED_SHA" \
  "$REVIEWED_DIST" "$PACKET/actual-public-routes-run1.json"
# Freeze/review that report and add it to the final evidence pins.
node "$VERIFY/verify.mjs" review "$EXPECTED_JSON" "$EXPECTED_SHA" \
  "$EVIDENCE_DIR" "$PACKET/actual-release-review-run1.json"
```

Reports use exclusive creation and stay inside the owned packet. Neither command
has run with real release inputs. The route command only reads the existing
public HTTPS origin; it must not be invoked before a concrete deployment.

## Pending integration and limits

The normalized QA/CPU/NSS/JIT/compiler record adapters are not yet connected to
real Nightly runners. Existing candidate tools can supply their underlying
evidence after full Nightly/JIT acceptance, but their reports cannot simply be
renamed to this schema. Public-origin orchestration remains unimplemented and
must be adapted/frozen/guest-validated before invocation. This packet never
launches the old two-CPU public/TLS scripts. The caller must obtain the exclusive
validation lane and serialize guest/performance runs.

Actual Nightly build/package/JIT/private acceptance, current-v10 baseline,
source/dependency closure review, returned platform IDs, real public bytes and
guest public update/TLS/JIT/GPU QA are still absent. A complete release contract
therefore cannot pass. The existing release plan governs isolated Sites checkout,
promotion, credentials/push/save/deploy, rollback verification and old-tab policy;
this verifier does not implement those mutations.

Task storage is disk-backed under
`/mnt/p6/build/firefox-nightly-sites-verifier-20261002`, with TMPDIR/TMP/TEMP there,
2GiB allowance and20GiB free reserve. A final frozen file/hash/size manifest and
host syntax/CLI review results are retained there. No commit is made by this
preparation task.
