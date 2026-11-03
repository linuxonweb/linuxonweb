# Package persistence and GNU ports — continuation

Session start: 2026-11-03T13:22:11Z. Base deadline: 2026-11-03T18:22:11Z.
Owner: built-in packages_persistence, GPT-6 Astra Pro, rubywebterm.
Baseline acceptance: 42/100; no new production gate accepted yet.

## Iteration P0 — audit and preparation

Mandatory project files read before mutation. Existing signed APK4/package artifacts
and unrelated untracked work are preserved. New work runs under the new named
1322 branch prepared by integration.

The bounded command monitor now observes inherited cgroup migration before launching
CPU work, samples CPU/RSS/available RAM/ancestor quotas each second, and PSS each
five seconds. The first monitor fixture caught an initial 8-CPU service context
followed by the enforced 3-CPU ancestor; it is retained as a failed observation.
The corrected run passed with seven samples, two PSS samples, and a 0.752-second
wait for the policy. No controller or host quota is changed.

Explicit `apk-persist` is an isolated candidate, not enabled in production. It
stores exact signed optional packages and world in immutable, hash-pinned
generations in root-owned persistent home storage. Replay recreates files and
the database together. Signature/manifest/base-ABI/trust failures stop before
desktop. Standard `apk` remains session-only. Manual edits outside `/home` are
outside the persistence scope. Explicit disable/base recovery retains evidence.
Required real guest, interrupted operation, corruption, ABI-upgrade, and production
path gates remain unperformed.

Node feasibility is bounded and evidence-based: the fetched upstream configure and
V8 architecture headers do not contain a wasm32 target. The maintained Edge.js
WASIX/QuickJS route has a different ABI; its host N-API mode is not substituted
as genuine guest Node.js. No compatible maintained wasm32-linux-musl Node/V8
port was found; this is not a universal impossibility claim. Exact URLs and
source hashes are in `tools/guest-packages/evidence/node-feasibility-20261103-continuation.json`.

GNU wget1.25.0, tar1.35 and findutils4.10.0 pinned archives and the working
LLVM22/musl toolchain are present. Builds await the shared heavy-work lease.

## 2026-11-03 15:03 UTC checkpoint

The task began13:22:11 UTC; the five-hour budget still ends18:22:11 unless root
approves the important-bug-only extension. Root accepted a score increase42→43
at15:02: the genuine GNU package delivery adds one point; persistence remains a
candidate pending production Stop and negative gates. No95/100 claim.

Published the exact native-tested signed tar1.35-r1, Wget1.25.0-r0, and
findutils4.10.0-r1 archives to the existing public repository. All previous public
versions are retained and newly rejected tar-r0/find-r0 candidates are excluded.
The live signed index contains13 versions,1729bytes, SHA256
75cf2cd6089cb767fa842012750ac6d928de3913e5db138affbc6c6c0d6b9a46.
Native signature checks plus local and public HTTPS readback match. Source and
runtime evidence are checkpointed; `gnu-publication-20261103-1322.json` records the
new selection and preserved previous index. Native71 behavior checks passed,
including real tar/gzip archive work, find/xargs subprocess statuses and cleanup,
and Wget valid/default-CA HTTPS plus self-signed certificate rejection. Node.js
remains blocked on an authentic compatible Node/V8 target; no alternative runtime
is mislabeled as Node.

The shell persistence draft is rejected, retained with an unconditional early exit,
and never installed. The real guest rejected set-u and exposed unreliable EXIT-trap
status, so all transaction checks moved into a native158791-byte C helper. Its source
is `tools/guest-packages/apk-persist.c`; current build is
`out/pkp3/persistence-build2/apk-persist`, SHA256
be3214abafca8d28d7d5c46f18f17af887cda82c4651940a099bea689b06a3b8.
Independent Firefox-agent source review addressed exact checksum identity,
protected native/trust checks on status/previous, process-group cancellation and
checked acknowledgements. Compiler-Werror and2MiB stack analysis passed.

Actual prerequisite34checks and five-boot39checks passed. The first helper attempt
failed closed because native apk2 default fetch treats `name=version` as a name;
fetch-by-name now requires the exact installed filename and nativeP/V/C afterwards.
Fixture cleanup now calls idempotent HomeFS destroy rather than settling an already
closed backend. All failed receipts are retained. Five-boot owner52.008s, peak tree
RSS1596936192bytes/PSS913393664bytes sampled1s/5s; remainingownedprocesses0.

Isolated production candidate `out/pkp3/persistence-image1` is built from pinned
APK4, version1a3951f0c48d, archiveSHA256
4b20a71713a8229f52f3ac2702d8d94dd5b4779a53ed28f0bb0d5830bf14b06c.
Composition31.256s. It has not been promoted. Integration owns actual production
terminal install/save, immediate Stop at nativeACK, same-origin reload and coherent
binary/database/world/user-marker acceptance. This image currently has no new
Firefox cache candidate mixed into it. Ordinary APK remains session-only; explicit
apk-persist snapshots signed releases/world, not arbitrary root filesystem edits.

Next: production Stop durability, signature/PVC/ABI/trust and activation interruption
negatives, then recheck Android availability and run the owned1CPU512MiB package
console path with bounded180s Python installation/import/persistence where safe.
No iOS or full mobile Firefox acceptance is claimed. Heavy lanes remain serialized;
resource sampling and exact cleanup identities are mandatory. Do not publish private
signing keys, disposable test keys, credentials, cookies, or device identifiers.
