# Two authorized Nightly Sites releases — 2026-10-02

This is a release plan, not acceptance or a deployment. The user authorizes
publication twice: latest Firefox Nightly with working native Wasm musl JIT
after guest acceptance, then working GPU support after guest acceptance. The
authorization persists; neither release requires another conversational approval.
Public v10 remains in place until the first concrete successor passes its gates.
The accepted Nightly JIT release becomes the rollback baseline for the GPU
release. Keep v9/v10 and both successor packets independently recoverable.

Only this document and small evidence files under
`/mnt/p6/build/firefox-nightly-sites-release-plan-20261002` were created. No
browser, build, promotion, pinning, source push, credential request, version save,
deployment or audience change occurred. Planning storage is ext4, capped at
2 GiB; TMPDIR/TMP/TEMP point to its `tmp` directory. Actual release packets use
fresh disk-backed task directories and their separately audited storage budget.

## Existing project and authoritative baseline

`web/sites/.openai/hosting.json` contains the existing project ID
`appgprj_6ab78cc88a948191a1abaabd04b81fe0`. Read-only `sites_get_site` at
2026-10-03T05:13:44Z (October 2 locally) returned active/public, latest version
10, and `https://linuxonweb.exact-coot-7512.chatgpt.site`. Its sanitized result is
`site-state-sanitized.json` in the planning packet. This observation confirms
the current audience and latest version number; the retained terminal deployment
record identifies which saved version was published. Re-read audience immediately
before each deployment and preserve it. Never create a replacement project.

| v10 identity | Exact value |
| --- | --- |
| Root runtime commit | `772bb8cb78fadbfaf850e1e34691d710bfcad146` |
| Nested Sites source commit | `b9656d4705aa4f6a073fa1b7122acf53a728a7c1` |
| Runtime version | `ce0d881dec8c` (Firefox 128.14.0 ESR musl) |
| Firefox archive | 88,910,833 bytes; SHA-256 `ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745` |
| Worker graph | `43f61cac353536c8ee049d01b0b90aa903ccdd08f8176e26e380ebe41d0a1f30` |
| Saved version | `appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_d95d358ac7f081918db3fa181f4387ba` |
| Successful deployment | `appgdep_6abf9e40b8248191ad11721dd367e7a2` |
| Deployment archive | `/mnt/p6/build/guest-jit-sites-20261002/linuxonweb-sites-jit-release.tar` |
| Local tar identity | 178,196,480 bytes; SHA-256 `d9a9e03eca222deb4c542b2f1fb02c9129d4d9f920f01e2e3e24de3b86eebe38` |

Authoritative retained packet: `/mnt/p6/build/guest-jit-sites-20261002`.
`release-result.json` binds the runtime, source, saved version, deployment and
rollback IDs. `artifact-review-packet.json`, `runtime-audit.json`,
`runtime-snapshot/generated/release-provenance.json`, the immutable snapshot,
`clean-source/web/sites/dist`, exact tar and listing, `push-result.json`,
`saved-version.json` and `deployment-start.json` preserve the release chain.
`public-runtime-verification-run2.json` passes all 90 routes, including the
entire Firefox archive; run1 remains FAIL. The original archive was not newly
downloaded or rehashed for this plan; its identity comes from these records.
Server archive content hash
`sha256:cc80971bb64047e21ce7c3199a7f6a2c9014a824e3b0ef5ad54f3eab61bd1637`
differs from the local tar hash; normalization semantics remain unestablished.
Record both independently; public full-route bytes are the runtime proof.

The 88 non-HTML routes had strict byte/hash/header checks. The two HTML runtime
routes and static root admitted only the exact reviewed 938-byte Cloudflare
script (template SHA-256
`2740fe651481007b07bd176b8b9576b3efbdf506482cd41efe3101cc24a85297`),
with constrained ray/timestamp fields and otherwise identical application bytes.
The root is a static meta-refresh with no COOP; `/linux/index.html` supplies
the required isolation. Do not claim root COOP or loosen HTML matching broadly.

v10 public cold/warm/update/TLS browser QA was deferred for the Nightly priority.
The cleanly closed v9 profile at
`/mnt/p6/build/guest-jit-validation-20261001/public-v9-baseline-run1` is retained
historical input, not evidence of a v10 or Nightly update. Before publication,
establish and close an owned current-v10 public profile using the new CPU policy;
preserve the original v9 profile and copy it before any compatibility experiment.

## Mandatory prerequisites for release 1: Nightly and JIT

1. Finish the full native wasm32/Linux/musl Nightly build, retaining actual
   configure, host/guest compiler argv, link, success and binary evidence.
   Current acquired identity is 159.0a1, official reference BuildID
   `20261002211853`, Hg `dfc77f7a6d716f1a20a2576597638d4fc21cd916`, Git mirror
   `bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23`. Pin acquisition proof and final
   local BuildID separately. Eight canonical Hg/Git pairs and the 198-file overlay
   do not prove whole-tree Hg/Git equivalence. Configure/export/MFBT/ABI and
   Cargo-scoped compiler fixes are bounded preparation, not full build success.
2. Package the complete newly built `dist/bin` runtime with
   `tools/guest-rootfs/package-firefox-nightly.py`, following
   `docs/firefox-nightly-package-20261002.md`. Record inventory/source identity,
   actual fpcast/validation and preservation audits. Never put a Nightly binary
   into a Firefox128 resource tree. Preserve profile/home and unrelated records;
   audit current NSS certdata/adapter rather than asserting the old 119 roots.
3. Configure/link current PBL and `tools/nightly-jit-prep` overlays against real
   configured headers. Reconstruct current table/import/memory/callback/stack
   contracts; do not reuse Firefox128 table minimum, ABI offsets or opcodes.
   Host 972 assertions and diagnostic objects do not establish executable JIT.
   Require actual guest install/call/free, integer correctness and bailout,
   interrupt cancellation, GC/debugger/coverage exclusions, script/global/cache
   guards, multithread syscall/TLS/stack isolation and safe interpreter fallback.
4. Integrate `tools/guest-rootfs/package-firefox-gpu-check.py` into the actual
   Nightly candidate, with explicit input archive/manifest SHA-256 values.
   Follow `docs/firefox-default-gpu-page-20261002.md`: default local version and
   WebGL/WebGPU page, early force-enabled GPU prefs, bookmarks and saved-homepage
   preservation. A page that honestly reports unsupported GPU may pass the
   first release's page gate; it cannot count as GPU acceptance.
5. Freeze comparative JIT fixture, cases, repetitions, arm hashes, order and
   acceptance bounds before launch. Use the same actual host CPU count for each
   arm, retain every raw sample and failure, and compare to actual v10 plus a
   same-Nightly non-JIT control where needed. Historical 128 acceptance and
   JIT7c tradeoff cannot authorize a new Nightly regression. Wider numeric,
   array/property/Math coverage must be implemented and accepted if required by
   the final JIT scope; the current 42-op integer preparation does not imply it.
6. Pass actual guest cold/warm, typed input/download/JS, default page, version,
   profile-preserving update, TLS positive/negative and DevTools regressions.
   Freeze exact accepted candidate hashes, promotion decision, evidence hashes
   and rollback pair; recheck freshness immediately before local promotion.
   The old 128-specific `promote-pbl-candidate.py` and pinned promotion packets
   need review or a Nightly-specific successor; never edit historical verifiers
   to make new evidence pass.

Every new guest run must record `nproc`, browser `hardwareConcurrency`, selected
and requested guest CPUs and actual kernel SMP CPUs; all must agree (currently
8). Capture kernel startup SMP lines before benchmark logs evict them. Existing
`test-firefox-pbl-bench.mjs`, `test-firefox-session-startup.mjs` and
`test-firefox-gpu-check.mjs` now do this; they remain candidate/local runners,
not public Sites acceptance runners. Their package assumptions and source
overlays must fit the final Nightly candidate. Historical diagnostic/public/TLS
runners require owned copies and adaptation before any new invocation.

## Mandatory additional prerequisites for release 2: GPU

Finish GPU after release 1 acceptance. Retest JIT and browser regressions on the
GPU candidate; use the accepted Nightly JIT release as its update/rollback baseline.
Require ordinary guest Vulkan applications, OpenGL through the selected route,
Firefox WebGL and any enabled Firefox WebGPU path to render successfully in the
real Linux/Wasm guest, including meaningful readback/pixel checks, animated
frames, supported resolution/feature limits, waits/lifetimes, recovery and
clean shutdown. The default page must report successful guest APIs and current
Nightly identity. Host cubes, force-enabled preferences, gears128 or a non-null
host adapter alone do not prove Firefox GPU acceptance. Hardware video decoding
is a separate unimplemented scope, not an implied GPU success.

Re-audit Firefox159 wgpu native FFI, IPC encoders, IDs/epochs, bincode descriptors,
callbacks/polling, shared mappings, async errors and resource lifecycle against
the new source. Current W3 goldens come from Firefox128 wgpu `c7458638`; current
`release-runtime.mjs` requires decoder SHA-256
`2f0c575b700a9220aea6365a60201f29600ff446c26eeeb78d703ccb11cd248e`,
377,315 bytes, with an external fallback under the old W3 build directory.
The new GPU protocol must have generated Nightly goldens, malformed/fuzz checks,
decoder/executor guest proofs and explicit newly accepted binary/hash pins.
Update reviewed helper/tests/dependency closure and commit the new decoder;
never bypass the mismatch or silently substitute the old fallback. For release
1, retaining a legacy decoder dependency is permissible only after demonstrating
that its unchanged path is inactive or compatible with every enabled Nightly
caller; no such demonstration is provided by this plan.

Review all static/lazy imports, computed imports, GPU owner Worker URLs,
translators/shaders/asset URLs, new runtime modules, force-enabled backend
behavior and WebGPU/WebGL fallback. Current helper pins WGSL/GLSL binaries and
requires production `allowCompute=false`; enabling compute or changing those
binary contracts requires new audited pins and closure. Explicitly allowlist
production modules even where paths contain `/tests/`; continue excluding
fixtures, runners, arbitrary test assets, profiles and candidate archives.

## Concrete release sequence, repeated independently

The following commands are prospective. `P` and `N` must be real full 40-digit
root and nested source commit IDs from that release; no successor identity is
known yet. Use fresh `nightly-jit` and later `nightly-gpu` packet directories;
never overwrite v10, earlier candidates or this planning packet. Record available
space and enforce the 20 GiB free-space reserve; report before enlarging the
parent task's 20 GiB source/object/cache allowance. This 2 GiB planning allowance
does not authorize a full build or new cache here.

1. Complete the acceptance gates above; prepare the concrete promotion audit and
   apply only the accepted runtime. Commit exact accepted root runtime files,
   adapters and manifests without staging unrelated files. Record root commit P,
   boot version, all three image hashes/sizes and precise acceptance packet.
2. Create a fresh isolated Sites preparation checkout preserving the existing
   nested history. Review/update helper and README claims there before audit,
   including changed Nightly ABI pins. Use its same reviewed helper for audit,
   stage and pin. The root source must remain HEAD=P and byte-clean on all
   selected paths throughout audit/stage. Freeze the snapshot and provenance.

```bash
export ROOT=/mnt/p6/project/linux/linuxonweb
export REL=/mnt/p6/build/firefox-nightly-sites-jit-20261002
# Second release: use a fresh firefox-nightly-sites-gpu-20261002 directory.
# P is the full root commit produced only after this candidate is accepted.
mkdir -p "$REL/tmp"
export TMPDIR="$REL/tmp" TMP="$REL/tmp" TEMP="$REL/tmp"
git clone --no-hardlinks "$ROOT/web/sites" "$REL/prep/web/sites"
node "$REL/prep/web/sites/release-runtime.mjs" audit "$ROOT" "$P" "$REL/runtime-audit.json"
node "$REL/prep/web/sites/release-runtime.mjs" stage "$REL/runtime-audit.json" "$REL/runtime-snapshot"
# Review runtime-audit.json and generated/release-provenance.json before pinning.
cd "$REL/prep/web/sites"
node pin-runtime.mjs "$REL/runtime-snapshot" "$P" "$REL/runtime-snapshot/generated/release-provenance.json"
npm test
# Commit only the reviewed Sites changes and generated runtime-assets.mjs/runtime-lock.json.
# Enumerate reviewed paths explicitly; never use git add -A.
# Record full nested commit N after that commit, then build its isolated checkout.
git clone --no-hardlinks "$REL/prep/web/sites" "$REL/clean-source/web/sites"
git -C "$REL/clean-source/web/sites" checkout --detach "$N"
ln -s "$ROOT/web/cloudflare" "$REL/clean-source/web/cloudflare"
cd "$REL/clean-source/web/sites"
export SITES_RUNTIME_INPUT="$REL/runtime-snapshot" SITES_RUNTIME_SOURCE="$ROOT"
npm test
npm run build
node --check dist/server/index.js
# Obtain the exclusive validation lane before workerd or guest checks.
npm run test:runtime
tar -cf "$REL/linuxonweb-sites-release.tar" .openai/hosting.json dist
sha256sum "$REL/linuxonweb-sites-release.tar"
tar -tf "$REL/linuxonweb-sites-release.tar" > "$REL/archive-listing.txt"
```

The sibling Cloudflare symlink exposes only its existing locked Miniflare test
dependency; no Cloudflare service or checkout is edited. If missing, recover the
locked test dependency into owned disk-backed storage before tests. Node22+ is
required. Preserve command logs, test reports, actual source cleanliness and
P/N. Unit and workerd results must pass for this release, not reuse v10 logs.

Stage refuses an existing snapshot and reaudits source. Pin verifies full parts,
logical hashes, aliases, boot images, provenance and the <=20 MiB part ceiling.
Build verifies those locked inputs and derives the immutable kernel-worker graph.
Counts are release-specific: v10 had 72 source files, 80 pinned routes, 77 parts
and 177,996,346 staged bytes; build produced 90 routes. Do not hardcode them
as Nightly bounds. Preserve `dist/runtime-assets.json`, `worker-graph-build.json`,
`release-provenance.json`, snapshot metadata, tar hash/size/listing together.
Rebuild from N only; exact source equality and reproducible locked inputs matter
even though `SITES_RUNTIME_SOURCE` itself is not consumed by current build.mjs.

3. Freeze a new successor public verifier before deployment. Copy v10
   `verify-public-runtime-v2.mjs` and exact HTML policy to the release packet;
   adapt only reviewed expected P, graph, routes, version and image hashes to
   immutable accepted provenance, never to live responses. Add tests for changed
   expectations and hash the scripts/expectation packet. Keep historical scripts
   unchanged. Its CLI remains `HTTPS_ORIGIN REVIEWED_DIST NEW_REPORT_JSON`.
4. Establish and safely close the owned predeployment public baseline profile
   (v10 for release1; accepted Nightly JIT for release2), saving readiness/input,
   home/download, trust choices, SDR key and CPU evidence. Freeze a copy for the
   real same-origin update. Existing v9 profile remains untouched.
5. Only now request `sites_create_source_repository_write_credential` with the
   existing project ID and no private publish-on-push request. Consume its token
   only in process memory, suppress tracing/terminal echo, use the returned
   exact remote/branch/auth mode, push N and assert remote branch HEAD=N before
   save. Do not embed/persist the token in Git URLs/config, files or logs.
   The retained `secure-push.py` is an example, not directly reusable: it pins
   v10 SHA, repo/output paths, branch and remote. A new audited helper must bind
   the concrete successor N and server-returned source repository identity.
6. Call `sites_save_site_version` with project ID, `commit_sha=N` and absolute
   tar path. Retain the returned exact saved-version `id`, source SHA and server
   archive metadata. Assert source SHA=N. Do not derive IDs or predict version
   numbers. Confirm no conflicting publication is underway before retrying.
7. Re-read `sites_get_site`; preserve the current public audience and existing
   environment/network/tunnel configuration. Call `sites_deploy_site_version`
   with project ID and the exact returned saved-version ID, omitting access and
   tunnel overrides. Every deployment URL is production. Poll the exact returned
   deployment ID with `sites_get_deployment_status` until terminal; a saved
   archive or nonterminal status is not deployment success.
8. Verify public full bytes and guest behavior below. Record terminal IDs,
   audience, actual URL, hashes and result. On failed release acceptance, restore
   the previously saved known-good version through the same public deployment
   operation and verify its manifest/full bytes; retain failed successor evidence.
   Record the accepted release1 saved-version ID as release2's immediate rollback.

No write connector operation, credential helper or command block above was run
as part of this planning task. Platform approval/backend checks still apply at
execution; existing user authorization removes an extra conversational approval.

## Required postdeployment acceptance

Run the newly frozen full-route verifier against the actual public origin and
this release's reviewed dist, writing a fresh report under its packet:

```bash
node "$REL/verify-public-runtime.mjs" \
  https://linuxonweb.exact-coot-7512.chatgpt.site \
  "$REL/clean-source/web/sites/dist" "$REL/public-runtime-verification-run1.json"
```

Stream/hash the entirety of every accepted and derived route, including Firefox,
kernel and plain images; compare exact sizes/manifest hashes. Verify MIME,
COOP/COEP/CORP, nosniff, stable revalidation, immutable graph caching, ETag/304,
HEAD, cross-part ranges and rejected fixture/source/candidate/wrong-graph URLs.
Review actual root routing separately from landing isolation. Only retain the
exact tested Cloudflare HTML insertion exception if still observed unchanged;
an unknown injection fails for review. Never normalize arbitrary scripts.

Use an owned public-origin runner adapted and frozen before invocation. The
local `test-firefox-session-startup.mjs OUT CANDIDATE [update BASELINE]` can
inform its logic but serves loopback assets; it cannot establish public delivery.
The historical `/mnt/p6/build/firefox-homepage-20260926/public-check.mjs` and
`/mnt/p6/build/firefox-tls-20260926/test-firefox-tls-ready-release.mjs` contain
hardcoded two-CPU and old NSS/package expectations and must not be run unchanged.
The old public HTTPS screenshot left review pending; screenshot capture alone
is not a successful TLS gate.

Require public guest version/BuildID and exact active manifest; host CPU counts
and actual SMP agreement; `crossOriginIsolated` and SharedArrayBuffer; fresh
default-page launch and animation/status; typed input, real guest JS/download;
cold and warm boot with zero image requests on warm boot; safely closed profile
reopen; actual Update & restart from the frozen previous public baseline with
zero replacement-image requests on the ensuing cached restart. Preserve home,
saved homepage/user.js, previous downloads, trust choices including explicit
distrust and existing profile keys. Compare current NSS source-derived expected
roots and test valid HTTPS through unchanged `/dns` and `/tcp`, with explicit
self-signed certificate rejection. Verify DevTools and actual native guest JIT
behavior. For release2 additionally assert real Firefox GPU rendering/readback,
backend identity, limits and recovery on the public runtime. Retain complete
logs/downloads, before/after profile records, input hashes, samples/screenshots
and normal browser/server cleanup; serialize guests and performance tests.

Keep the existing old-tab policy: the build does not retain prior worker graphs;
old cache-evicted tabs require close/reopen and explicit update/reload. Do not
promise uninterrupted old-tab worker creation unless that policy is separately
implemented and accepted. Home/cache are origin-scoped; testing must remain on
the unchanged public hostname.

## Outstanding blockers and stale assumptions

No complete accepted Nightly browser archive, guest JIT, comparative performance,
public baseline/update or guest GPU evidence is established by this packet.
The current full build and downstream runtime acceptance are the first blockers.
Successor P/N, exact archive, CPU-aware public/TLS runners and new frozen public
verifier remain unavailable until acceptance. Decoder/FFI/golden and dependency
closure migration is a further mandatory blocker for the GPU release.

`web/sites/README.md` mixes v9 58-route/55-part snapshot instructions, historical
2-CPU timing, v9 rollback language and pending successor wording with v10
release material. `/mnt/p6/build/guest-jit-sites-20261002/release-workflow.md`
is an early preparation snapshot, not the final deployment state. Correct only
the new isolated release documentation; preserve all historical evidence.
Old TLS seed119, Firefox128 decoder/goldens, pinned table/opcode/ABI assumptions,
old translator pins, fixed public verifier P/graph/90-route/version/archive
expectations, secure-push v10 SHA and local-runner package/root path assumptions
need explicit re-audit. Do not repin to conceal a mismatch or treat preparation,
host graphics or saved archive ingestion as browser/public acceptance.

Planning evidence: `inspection.json` hashes 28 inspected inputs;
`v10-authoritative-summary.json` captures sanitized retained release identities;
`site-state-sanitized.json` captures the read-only Sites observation. No tokens,
credential responses, visitor identities or browser profile contents are saved.
