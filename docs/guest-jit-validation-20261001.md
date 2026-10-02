# Guest JIT validation and exception policy (2026-10-01)

Task root: `/mnt/p6/build/guest-jit-validation-20261001` (ext4; initially 68 GiB
free). TMPDIR/TMP/TEMP use its `tmp` directory. Browser gates run sequentially;
only their own browser/server processes are closed. Selected candidate
`ce0d881dec8cea07` is accepted and promoted locally as `ce0d881dec8c` after
independent final review and a passing dry-run/apply. Both failed unpublished
JIT7c array comparisons remain FAIL under the documented narrow engineering
tradeoff. The actual live-release comparison passes at 14/1,013 ms; all other
mandatory release gates pass. Sites v9 is still public pending authorized
redeployment and actual public update/cold-warm acceptance.

## Candidate validation commands

`test-firefox-session-startup.mjs` now accepts optional `SESSIONSTARTUP_TASK`.
Its default and assertions are unchanged. Both it and the benchmark runner
pass `node --check`.

The startup candidate directory holds a hard link to the verified archive,
a manifest with the local Firefox URL, and package metadata derived from the
candidate's successful `package-report.json` (`passPackage`, `candidateOnly`,
`sourceSha256`, `archiveSha256`, `version`, `bytes`).

```sh
export TMPDIR=/mnt/p6/build/guest-jit-validation-20261001/tmp
export TMP=$TMPDIR TEMP=$TMPDIR
export SESSIONSTARTUP_TASK=/mnt/p6/build/guest-jit-validation-20261001
node tools/guest-rootfs/test-firefox-session-startup.mjs \
  /mnt/p6/build/guest-jit-validation-20261001/jit7c-startup-run1 \
  /mnt/p6/build/guest-jit-validation-20261001/startup-candidate-7c-run1 '' web/linux
node tools/guest-rootfs/test-firefox-session-startup.mjs \
  /mnt/p6/build/guest-jit-validation-20261001/jit7c-update-run1 \
  /mnt/p6/build/guest-jit-validation-20261001/startup-candidate-7c-run1 update web/linux
export PBLBENCH_TASK=/mnt/p6/build/guest-jit-validation-20261001
export PBLBENCH_ARMS=$PBLBENCH_TASK/arms-7c-arrays-run1.json
export PBLBENCH_FIXTURE=$PWD/web/linux/tests/guest-jit-spec7b-bench.html
node tools/guest-rootfs/test-firefox-pbl-bench.mjs \
  /mnt/p6/build/guest-jit-validation-20261001/bench-7c-arrays-run1
```

Array arms: A is JIT 7b (`test-pbl-cc4937fc7c48c88d`); B is JIT 7c
(`test-pbl-1b53911f106c11e4`). Bench ports are HTTP 4201 / CDP 9411. A complete
measurement is ABBAAB, six fresh outer Chromium profiles, identical kernel,
rootfs, network refusal, machine settings, fixture and timing protocol.
The runner checks every checksum, all input hashes and process cleanup.
One-boot smoke runs never satisfy its benchmark gate.

## Flat-throw regression and bounded policy

Historical matched measurements show flat throws about 1.27–1.30x slower on
PBL. The source explains the differential:

- `PortableBaselineInterpret.cpp:5539` handles Throw by `ThrowOperation`, then
  goes to `error:` at line 6083.
- That pushes a fake exit frame and invokes the full `jit::HandleException`,
  then reconstructs interpreter/frame state at `unwind:` (6139).
- `JitFrames.cpp:578` resolves the Baseline frame through the JIT iterator,
  runs debugger/coverage checks, constructs an EnvironmentIter and processes
  try notes.
- `Interpreter.cpp:1207` processes try notes directly in the interpreter's
  existing activation and registers.

`tools/build-firefox-pbl-jit.py --interpret-handlers` adds an opt-in hook to
the copied PBL source, before `hasJitScript()` in
`CanEnterPortableBaselineInterpreter`:

```cpp
for (const auto& note : state.script()->trynotes()) {
  if (note.kind() == TryNoteKind::Catch ||
      note.kind() == TryNoteKind::Finally) {
    return MethodStatus::Method_CantCompile;
  }
}
```

This preserves existing exception semantics by selecting Firefox's C++
interpreter for handler-bearing scripts. Loop/iterator try notes remain
eligible. It does not implement a second unwinder. Numeric helper functions
called from interpreted handler functions still pass through
`Interpreter.cpp:3229` (`MaybeEnterJit`) and remain eligible for PBL/JIT.

On a fresh candidate process, rejected scripts never allocate a JitScript.
PBL's direct scripted-call fast path (`PortableBaselineInterpret.cpp:4897`)
and its CallScriptedFunction CacheIR path (1785) require an existing
JitScript, so they also fall through to ordinary invocation. The only three
`ensureHasJitScript` call sites are this PBL eligibility path and the disabled
BaselineCodeGen/BaselineJIT paths. GC eviction cannot introduce eligibility
for handler scripts, because their immutable try notes remain present.

Scope limitation: a numeric loop inside a function that also contains a
Catch/Finally handler stays interpreted; a separate numeric helper remains
eligible. The policy remains opt-in pending real-guest safety and measurement.

`--jit-source` selects a preserved source. Every build copies that source into
its own output directory before compiling; reports record its exact hash and
input path. This prevents unrelated JIT 8 edits from changing the policy-only
comparison.

## Isolated policy candidate

`build-handlers-run1/report.json` passes in 86.85 s against real Firefox
headers and validates native wasm. It uses the exact JIT 7c source snapshot:
SHA-256 `329f01d8f0a96f05506712476b5908cd244b4a4ba9ff305be963a3e88ba513ac`.

Package: `web/linux/tests/runtime-candidates/pbl-jit-handlers-run1`, version
`test-pbl-2c8f1bbb67e7f670`, 88,908,452 bytes, archive SHA-256
`2c8f1bbb67e7f67023eb411937dafefc21938aef2bf2ea82f02be5ecfb941b1e`.
The audit passes 11,470 records: only `opt/firefox/firefox` changes and the
persistent `/init` remains byte-identical.

The `arms-handlers-7c-run1.json` and `arms-handlers-promoted-run1.json` files
prepare comparisons with JIT 7c and the promoted baseline respectively.
No real-browser benchmark result for this policy exists yet.

## Test-only JIT diagnostic environment

Optional `PBLBENCH_LOG_BUDGET=300` makes the benchmark server serve one
adapted main.js, appending `PBLJIT_LOG=300` to the guest kernel command line.
Linux passes this assignment to init, and non-login su preserves it. Both
arms serve the same adapter, whose SHA-256 is recorded in `result.json`.
The published main.js and the archive remain unchanged. This option is for
compile evidence. The JIT 8 original-fixture smoke verifies inheritance from
both the kernel command line and the guest startup diagnostic (budget 300).

`tools/guest-rootfs/check-pbl-safety-evidence.py RUN --packet 8` enforces the
six-boot safety transport pass, all required functions' actual guest
filename:source-line compilation logs in all three B boots, the configured
log-budget diagnostic, and the hash of the served main adapter in every boot.
It writes `safety-evidence-B-packet8.json`. Semantic checks cannot substitute
for compilation evidence. The fixture's timing rows memoize checks and do
not measure performance. Its allocation pressure is not proof of a major GC,
and it does not independently prove interrupt delivery.

## Gate results so far

- JIT 7c startup `jit7c-startup-run1`: PASS, cold 14,327 ms / 2 image
  requests, warm 11,349 ms / 0. Saved home/profile, real input and guest
  download pass; browser/server closed. Launch markers are observations,
  not an interleaved speed comparison.
- JIT 7c update `jit7c-update-run1`: PASS, promoted baseline 12,384 ms / 2
  image requests, updated candidate 16,968 ms / 0. Home/user.js and the prior
  guest download are preserved; browser/server closed.
- JIT 7c array ABBAAB `bench-7c-arrays-run1`: PASS, all six cold boots,
  144 case rows, identical checksums and unchanged input hashes. All browser
  processes exit 0 and the server closes. `arr-inc` median batches fall from
  621 ms / 100 repetitions to 13 ms / 100 repetitions (47.8x; rounded runner
  ratio 0.021). Its individual boot medians are 615/623/621 ms for 7b and
  13/16/13 ms for 7c. The runner labels this noise-bound because the fast arm
  spreads 23%; that generic label does not erase the large speedup.
  Other arrays and integer/double controls are near the timer floor. The
  native-call control has ratio 1.102 with overlapping 231/246/265 ms versus
  274/271/245 ms batches and no decisive regression verdict. One 7c boot
  requires two navigation attempts and launches in 17,342 ms, so this packet
  does not claim a launch speed improvement. Candidate remains unpromoted.
- Policy safety and baseline comparison: pending.

## JIT 8 coverage smoke

`smoke-8-original-run1/coverage-evidence.json` passes the one-boot semantics
and compilation check for default-policy JIT 8 `test-pbl-de48d07e6051b575`.
All 24 case rows pass, input hashes remain unchanged, the browser exits 0
and server closes. The runner's benchmark gate remains false by design for
a B-only smoke; its exit 1 is not a failed guest test.

Guest logs prove `PBLJIT_LOG=300` is inherited. Exact original fixture line 19
(int), line 24 (property write/read) and line 25 (`Math.max`) compile. The
Math/global dictionary concern does not prevent this fixture's compilation.
Actual GC epochs advance 3 to 4 to 5, with four recorded evictions and
recompilation. The adapter hash is
`79281daf2a95eae7da1d1c5a72c47c01f344beb4c360fafbc810002cb4427539`.
This is coverage evidence, not an interleaved performance result.

## Readiness and partial policy measurement

`bench-handlers-promoted-run1` is a failed gate: 5 of 6 boots pass, but policy
boot 2 never reaches the fixture after four fixed-coordinate input attempts.
Its screenshots show the desktop without a Firefox window. Two later policy
boots pass all original cases; compiled integer loops remain accelerated.
Successful-boot partial flat-throw ratio is 1.303, so this packet does not
prove that the policy fixes the exception regression. Partial measurements
and the failed boot remain in `partial-evidence.json`; they cannot support
promotion. Final combined candidate evidence is authoritative.

The old runner waits 20 s after the launch log, which is not window readiness.
The 7c startup gate's cold guest-JavaScript readiness was 96,075 ms; combined
8 cold readiness was 72,368 ms. Optional `PBLBENCH_GUEST_READY=1` now seeds a
small identical startup homepage protocol in both arms, waits for its exact
per-boot label, file URL, Firefox user agent and timestamp from a double
requestAnimationFrame console event, and records readiness latency separately
from launch and timed execution. The existing 120 s readiness deadline remains
a failure; the timed fixture bytes and repetitions are unchanged. Defaults
retain the old protocol. Final combined runs use this option in both arms.

## Combined JIT 8 + handler policy gates

Candidate `test-pbl-962b207fbc746434` is built from frozen JIT 8 source
SHA-256 `147b65d192af045bae47380975fbe723cfd02186a59c097e351f45964efde690`
with only the optional Catch/Finally routing added. The package audit changes
only Firefox and preserves all other records and init.

- `jit8-handlers-startup-run1/result.json`: PASS cold/warm. Launch 10,931 /
  10,677 ms, actual guest readiness 72,368 / 39,774 ms, image requests 2 / 0.
  Saved home/profile, actual guest input and download pass; browser exits 0
  and server closes.
- `jit8-handlers-update-run1/result.json`: PASS baseline/update. Launch
  11,448 / 12,603 ms, readiness 74,087 / 41,520 ms, image requests 2 / 0.
  Home/user.js and prior guest download preserved; real input/download pass,
  browser exits 0 and server closes. These readiness observations are not
  interleaved launch performance measurements.
- Combined safety and interleaved throughput gates remain pending.

## Safety warm-up correction and preflight

The initial combined safety preflight `smoke-8-handlers-safety-run1` passes
75 semantic rows / 7,850 assertions but fails its compilation contract: seven
helpers never enter PBL. Their exact source lines have neither compile nor
reject diagnostics, and the 300-record budget is not exhausted. PBL defaults
to a ten-invocation warm-up threshold; calling each helper once does not
exercise specialization on its first C++ interpreter invocation.

The fixture now repeats pristine warm inputs 32 times, preserving function
definitions on lines 20–37 and yielding between helper groups. A warm-done
event separates compile evidence from subsequent mutations. The frozen hash
is `aba063ea1d0933c8a2de68a7f46743074a7af7be5cde5dc5655068a7945546ad`.
`safety-host-run5/report.json` passes 8,408 assertions, 75 rows and exact
18-function line metadata.

`smoke-8-handlers-safety-run2/coverage-evidence.json` passes all semantic rows
and proves every required line 20–37 compiles before warm-done; guest readiness
is 63,665 ms and navigation succeeds once. It remains a one-boot preflight,
not a final six-boot gate. Repeated same-epoch Math compilations during this
round-robin warm-up are retained for cache review. Full safety is pending.
The safety evidence checker now requires compilation before mutations.

## Completed safety evidence and cache-identity hold

`safety-8-handlers-run1/result.json` passes all six ABBAAB boots, 450 semantic
rows, identical checksums and unchanged input hashes. Every navigation succeeds
once, all browser processes exit 0 and the server closes.
`safety-evidence-B-packet8.json` passes: each B boot compiles every required
helper on lines 20–37 before mutation, verifies actual guest page readiness
and inherited log budget 300, and serves the identical adapter hash. No major
GC advancement is observed in these safety boots; allocation pressure remains
pressure evidence only. Timing rows remain memoized semantic transport.

Review traced repeated same-epoch Math compilation to immutable bytecode shared
by different JSScripts: hashing only the bytecode address aliases their cache
entries and can consume the monotonic installation limit. The current candidate
is therefore superseded for final acceptance. Original throughput and numeric
control runs are on hold until a script-identity-aware candidate is rebuilt.
Its startup/update/safety/performance gates must run on that new identity. The
completed evidence above is retained as bounded evidence for the older candidate;
there is no promotion or deployment.

The completed old safety boots recorded 207 / 165 / 165 pristine fixture
compilations for 18 helpers. The reviewed cache fix adds JSScript identity to
the cache hash; frozen source SHA-256 is
`8ae0fa081ed4ce41111aee3bd62d798386a75dbd47ed9a2932349bf122e39912`.
New acceptance begins with a single-B safety preflight, requiring all 8,408
assertions and all 18 compiled helper lines before mutations, while recording
compilation counts. The original eight-case ABBAAB performance comparison
follows before full startup/update/safety and numeric controls: exception and
JSON throughput remain unresolved, so a semantic pass alone cannot accept the
new candidate. No old result is reused as a final gate for the new identity.

## Cache-fixed combined preflight

Candidate `test-pbl-37aeed1b7dcb8469`, archive SHA-256
`37aeed1b7dcb8469b52a2d40e05b52f5e08eb349c9fe2a4d0b0d832f39102dff`,
is built from reviewed source `8ae0fa081ed4ce41111aee3bd62d798386a75dbd47ed9a2932349bf122e39912`
with Catch/Finally interpretation enabled. The package audit preserves init
and all 11,469 records other than Firefox.

`smoke-8-cache-safety-run1/coverage-evidence.json` passes 8,408 assertions,
75 rows and all 18 required compilation lines before mutation. Each helper
compiles exactly once: 18 pristine compilations, versus 165–207 on the old
candidate. Readiness is 70,182 ms and navigation succeeds once; inherited
log budget 300, adapter identity, unchanged inputs and cleanup all pass.
No major GC advances in this preflight, so pressure remains the only GC
exercise reported here. It is a B-only preflight, not a benchmark gate.

The original eight-case comparison at `bench-8-cache-promoted-run1` passes
all six boots, 144 rows, unchanged input hashes, identical checksums and
cleanup. All boots navigate once; all candidate boots actually compile the
integer/property/Math fixture lines 19/24/25. Per-boot and per-round medians
are retained in `per-boot-evidence.json`. Both arms serve the same diagnostic
adapter and readiness protocol.

Performance acceptance fails despite the harness pass. Deep-throw medians are
A 39 / 40 / 39 ms per 100 repetitions and B 41 / 43 / 43 ms: ratio 1.103,
no overlap, A spread 1.026 and B spread 1.049. The raw verdict is PBL slower.
Error throws are A 39 / 41 / 39 and B 45 / 42 / 42, ratio 1.077 with no
overlap, though the raw threshold verdict is equal within noise. Flat throws
and JSON have median ratio 1.000; JSON's baseline spread 1.167 produces the
raw noise-bound verdict. Integer, recursion, property and Math ratios are
0.007 / 0.770 / 0.014 / 0.010. No major GC advancement is observed in the
candidate original-fixture boots.

The candidate remains unaccepted. Remaining full startup/update/safety and
numeric controls are held pending the exception policy decision; the failed
performance conclusion and all raw evidence remain preserved.

## Explicit-throw routing pilot

Candidate `test-pbl-256bb70bc59e7d97`, archive SHA-256
`256bb70bc59e7d9754c298959da5ac59b62e2828492c03ec468503bc972926fe`,
keeps the reviewed cache core unchanged and enables the additional optional
`--interpret-throws` eligibility scan. The package audit again preserves all
records other than Firefox and init.

`smoke-8-throws-original-run1/coverage-evidence.json` passes one-boot semantics
(24 case rows), exact integer/property/Math compilation lines 19/24/25,
unchanged inputs, identical diagnostic adapter and cleanup. Ready is 61,560 ms
and navigation succeeds once. All 33 raw batches and three round medians are
retained for every case.

Deep throws are 41 ms/100 repetitions (rounds 41/42/41), error throws 42
(rounds 42/40/43), flat throws 33 (37/33/33), JSON 59 (62/59/59). Compared
with the earlier completed baseline medians this is deep 1.051 and error
1.077; compared with the preceding candidate deep improves about 4.7% and
error is unchanged. This separate smoke is neither an interleaved comparison
nor acceptance proof. Numeric/property/Math medians remain 2 ms and recursion
47 ms. Full ABBAAB and gates await review of whether the pilot warrants them.

## Cached-rejection candidate preparation

The next candidate is pending a persistent rejection policy review. No new
browser or build has started for validation. Exact pilot/acceptance commands
and fresh output paths are prepared in
`/mnt/p6/build/guest-jit-validation-20261001/cached-fallback-validation-plan.md`.
The adjacent setup helper creates arm metadata and a hard-linked startup
package only after checking the audited candidate and frozen loader/fixtures.
`cached-fallback-frozen-inputs.json` retains current runner, server, loader,
manifest, kernel/plain rootfs and fixture hashes, promoted and JIT7c archive
identities, and the served budget300 adapter hash.

The next sequence is a B-only original pilot, then (if resolved) original
ABBAAB, cold/warm startup, profile update, full positive 18-helper safety and
separate spec6/spec7 ABBAAB controls using audited JIT7c as A. Expect 50–65
minutes on an idle host. Coverage is extracted from those same boots; merging
control fixture execution would change warm-up/cache ordering, so their timed
semantics remain unchanged. Root retains the strict promotion decision.

## Cached-fallback original pilot

Candidate `test-pbl-ce0d881dec8cea07`, archive SHA-256
`ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745`,
passes package and frozen-input checks. Frozen builder is
`e7284bda1f792849b7a04d6bff3272cefe5524cd250ba34aafa26c33f09c36f6`,
core remains `8ae0fa081ed4ce41111aee3bd62d798386a75dbd47ed9a2932349bf122e39912`.
Exact baseline/loader/fixture/package/build hashes are retained in
`cached-fallback-candidate-identity.json` under the task root.

`smoke-8-cached-fallback-original-run1/coverage-evidence.json` passes one
boot, 24 rows, exact compilation lines 19/24/25, readiness, diagnostic budget
and adapter identity, unchanged inputs and cleanup. Ready is 58,233 ms;
navigation succeeds once. Guest and browser logs contain no recorded fatal,
release-assert or crash markers; the browser exits 0 and server closes. This
is bounded one-boot observation, not proof against every admission failure.

Deep and error throws both measure 39 ms per 100 repetitions, matching the
prior promoted medians 39/39; flat throws measure 33 versus promoted 34.
Round medians are deep 40/39/39, error 40/39/40 and flat 33/34/33. All 33 raw
batches per case are preserved. Numeric/property/Math medians are 2/2/1 ms,
recursion 45 ms and JSON 62 ms (prior promoted median 61). These separate
smoke comparisons remain exploratory; full interleaved acceptance is pending
root's pilot assessment. No longer gate has started.

## Cached-fallback original ABBAAB

`bench-8-cached-fallback-promoted-run1/result.json` passes all six boots and
144 semantic rows, unchanged input hashes, identical checksums and cleanup.
Every navigation succeeds once. `per-boot-evidence.json` retains exact
rational median ratios, per-round medians and compiler/GC diagnostics.

All exact median ratios are at most 1: integer `2/285`, recursion `48/61`,
flat throws `33/35`, deep throws `1`, error throws `1`, property `2/149`,
Math `2/213`, JSON `31/42`. Deep boot medians are A 39/40/59 and B 38/40/45;
error medians A 38/40/57 and B 40/40/56. Later host variation is substantial
and retained. Raw verdicts are noise-bound except integer; no exception or
JSON speed improvement is claimed from these distributions. Property/Math
have large separated ranges despite the raw spread classifier.

Every candidate boot actually compiles exact lines 19/24/25. Boot 6 records
GC epoch 4 to 5, eviction and recompilation, proving an actual major-GC
transition in this candidate run. No fatal/guest error is recorded. Root's
authorized all-ratios-at-most-one condition is met, so cold/warm startup,
profile update, full safety and audited-JIT7c numeric controls are proceeding
on this same final identity. Promotion remains root-owned and pending.

## Cached-fallback startup and update

`jit8-cached-fallback-startup-run1/result.json` passes cold/warm: launch
10,960/9,873 ms, actual guest readiness 90,247/36,502 ms and image requests
2/0. Saved home/profile, real typed input, checksum and download pass.
`jit8-cached-fallback-update-run1/result.json` passes baseline/update: launch
10,629/16,129 ms, actual readiness 68,212/45,766 ms and image requests 2/0.
Home/user.js/profile, prior download and new real input/download checks pass.
Both runs check unchanged input hashes, report no outer errors and close the
server/browser cleanly (exit 0). These phase observations are functional gates,
not interleaved startup throughput measurements. Full safety is now running at
`safety-8-cached-fallback-run1` on the same final identity.

## Cached-fallback full safety

`safety-8-cached-fallback-run1/result.json` and
`safety-evidence-B-packet8.json` pass all six boots, 450 rows, 8,408 assertions
per boot, identical checksums, unchanged input hashes and clean browser/server
shutdown. Every navigation succeeds once. The checker proves all 18 helpers
compile before mutations, exactly once each in candidate boots 2/3/6 (18/18/18
compilations), and verifies readiness, inherited budget300 and adapter identity.
No major GC advancement occurs during safety: each candidate compile epoch is
4 and there are no GC evictions. The actual transition in original benchmark
boot6 is separate evidence; pressure is not relabelled as collection. Safety
timing rows remain semantic transport and carry no performance conclusion.

The spec6 numeric ABBAAB control is now running at
`bench-8-cached-fallback-spec6-run1`, audited JIT7c as A and unchanged final
`test-pbl-ce0d881dec8cea07` as B. Any exact median ratio above 1 holds further
gates for root review.

## Cached-fallback spec6 controls: functional pass, timing hold

`bench-8-cached-fallback-spec6-run1/result.json` passes six boots and 162
semantic rows, identical checksums, unchanged inputs and clean shutdown. All
navigations succeed once. Candidate boots compile exact required lines
19/21/22/24–29; boot6 records epochs 5 to 6 and nine evictions/recompilations.

`per-boot-evidence.json` retains exact ratios: int/let/args/if/mod/coalesce 1,
negation 3/4, Math 1/112, but and/or 5/4. Its boot medians are A [4,5,4] and
B [5,5,4] ms. `and-or-distributions.json` preserves all 33 batches per boot;
round medians are A1 [4,4,4], B2 [6,5,4], B3 [5,5,4], A4 [4,7,5],
A5 [4,4,4], B6 [4,4,4]. Samples overlap at integer millisecond resolution,
and the raw runner classifies this case noise-bound. That classification does
not satisfy root's exact median-ratio condition. Spec7 and public baseline
remain held pending root's assessment. The compile diagnostic reports the same
682-byte wasm module, 38 ops, two variables and depth two for this loop in
both arms; matching size is not a claim of identical emitted bytes.

A task-local public-origin two-stage wrapper has been prepared, with syntax
checked, without starting another browser or modifying benchmark inputs. It
will create a fresh public v9 origin profile before deployment, close it after
flushing home, then reopen the same profile against the new release to exercise
the actual storage Update control, preserved home/user.js/prior downloads and
zero-image warm restart. A separate fresh profile will test the new release's
cold/warm startup. Root and the Sites deployment owner must receive the clean
baseline-ready evidence before deployment.

## Predeclared and/or precision confirmation

Root authorized a single higher-resolution confirmation, without exclusions or
rerun-until-pass. Task-local fixture keeps all helper bodies/source lines and
changes only REPS 100 to 2500 and the same-line case iteration to and/or only.
Warmups 8, samples 11, rounds 3, settle 15 s and all value/checksum checks remain.
Base fixture SHA ec241f613d8fece7c805458ea7f49c3a827831c5beb5378769074a3520408a48;
derivative SHA a4d7275cbeb2a690a2ac41be48b8b7021f3f25f635bcfefd2248a85de1661e6d.
The task-local runner changes only repository anchoring and expected case rows
3 (the original declaration-based count would still expect all nine cases).
Runner base SHA b3530fc50a06fbc97348a6316ce8668a3b8e5b7234abac1f0a8d490fbd12ef11;
derivative SHA a98b9dadd748b5362ed5b04e6bc3d115334b0a84ed3a10b238889a38634e64ba.
Exact diffs, frozen image/loader identities and acceptance criteria are in
`and-or-precision-inputs-run1/predeclared-inputs.json` and adjacent `.diff` files.

Before any samples, root declared mandatory six clean boots/all semantics and
artifacts, each arm aggregate median batch at least 75 ms, and and/or macro
median candidate/control ratio at most 1.05. This additional coverage bound
compares against already-JIT7c and does not relax original promoted-runtime
comparisons (all ratios at most 1). Original low-resolution 5/4 remains on
record and is accepted only if this audited confirmation meets that bound.
The run is `bench-8-cached-fallback-and-or-precision-run1`. Original Spec7
coverage follows while root assesses the confirmation; public baseline remains
held until root's release.

## And/or precision confirmation result

`bench-8-cached-fallback-and-or-precision-run1/precision-confirmation.json`
passes every predeclared check: six clean ABBAAB boots, all correctness,
unchanged artifact hashes, identical checksums, cleanup and all 198 raw batches.
Boot medians are A [124,104,105] and B [132,106,108] ms; macro median
108/105 = 36/35 (1.028571), within the predeclared 1.05 bound. Aggregate batch
medians A107/B113 ms meet the at-least-75-ms resolution requirement.
`and-or-all198-batches.csv` includes every boot/round/sample and actual
normalization by 2500 repetitions. The inherited runner's per-rep display
fields divide by 100; they are preserved but not used for this confirmation.
Raw verdict remains noise-bound and does not itself supply acceptance.
Candidate boot3 records an actual GC epoch5→6, eviction and recompilation.

The original Spec7 fixture now runs in `bench-8-cached-fallback-spec7-run1`
against the same audited7c/finalcached pair, original production runner and
identical readiness/budget adapter. Public baseline stays held until root's
release. Public wrapper now also prepares an optional final real guest HTTPS
navigation check, with punctuated URL input, typed-address screenshots,
nonintercepting CDP gateway DNS/TCP observations and rendered-page screenshots.
Transport/NSS alone cannot establish HTTPS page acceptance: direct visual
review must verify intended URL, page/title and absence of error pages.

## Original Spec7 final coverage hold

`bench-8-cached-fallback-spec7-run1/result.json` passes six clean ABBAAB
boots and 144 semantic timing rows. Every boot navigates once; checksums,
frozen input hashes, browser exit and server cleanup pass. All candidate boots
positively compile source lines 22–29; controls compile 22–28. Candidate
compilation epochs are 4/5/3, with no eviction, fatal or error diagnostics.

Exact macro candidate/control ratios are int 1/2, arr-sum 1, arr-fill 1,
arr-inc 13/12 (1.083333), dbl-arr 1, arr-widen 1, float-acc 1 and Math 1/113.
Array increment therefore remains a coverage hold under the exact-at-most-one
condition. Boot batch medians are A [12,12,12], B [13,12,14] ms. All 198 raw
arr-inc batches and round medians are retained in `arr-inc-distributions.json`
and `arr-inc-all198-batches.csv`. The raw noise-bound label does not supply
acceptance. Browser lane is idle and public baseline awaits root release.

The unlaunched task-local public wrapper now retains both example.com and the
documented v9 positive www.bing.com HTTPS navigations in the same post-update
browser. Both use actual typed URLs, gateway DNS/TCP evidence and screenshots;
root's direct page/title/HTTPS/error visual review is still mandatory.

## Arr-inc precision preparation (not launched)

Root requested a single predeclared higher-resolution confirmation of the
original Spec7 arr-inc hold. `arr-inc-precision-inputs-run1` retains original
fixture/runner copies, exact diffs and `predeclared-inputs.json` (SHA
048e44df8c1657577927f551cadd88538ca436672cd25558f78e1611e5fff0ae).
Only fixture lines 18 and 39 change: REPS100→1000 and arr-inc-only iteration.
The helper body and original HTML source line25 remain byte-identical. Base
fixture SHA a9b154633d26f1c5018dcb33fd338fd013e004d46df757cbc3e879e275a8e1b6;
derivative SHA 7e3024d64d66edf4b85c85a95aac22f8365f60f17b3cf1cdd87554883fd42b91.
The copied runner changes only absolute repository anchoring and expected
three case rows; SHA a98b9dadd748b5362ed5b04e6bc3d115334b0a84ed3a10b238889a38634e64ba.

Declaration freezes the same audited7c/finalcached artifacts, loader and
budget300/readiness adapter. Before any samples, coverage-only acceptance is
six clean ABBAAB boots, all semantic/artifact/cleanup checks, all198 raw
batches, each arm aggregate median batch at least75ms and macro B/A at most
1.05; no exclusions or rerun-until-pass. The original promoted-eight-case
bound remains at most1. Prepared launch-command.sh targets
`bench-8-cached-fallback-arr-inc-precision-run1`; no browser has started and
root must release this launch after reviewing the declaration.

Root reviewed the frozen declaration and released the single arr-inc
confirmation. It now runs in `bench-8-cached-fallback-arr-inc-precision-run1`
with the prepared inputs and unchanged original evidence. Public baseline
remains held pending final numeric acceptance and independent review.

## Arr-inc precision final performance failure

The one reviewed confirmation completed six clean ABBAAB boots, all checksums,
unchanged artifacts/adapter, positive source-line25 compilations and orderly
browser/server cleanup. `precision-confirmation.json` verifies all198 batches
against retained guest PBLBENCH records, reps1000 and checksum189186112. Every
mandatory check passes except the predeclared performance ratio bound.

Boot medians are A [164,121,124], B [142,136,149] ms; macro142/124 =71/62
(1.1451612903), above1.05. Aggregate batch medians A128/B146ms meet the75ms
resolution requirement. Round medians are A1[167,144,195], B2[130,149,142],
B3[196,124,124], A4[121,121,124], A5[126,123,121], B6[178,141,146].
`arr-inc-all198-batches.csv` preserves every sample and actual /1000
normalization. Inherited runner /100 display fields remain untouched and are
not used. Original13/12 coverage hold remains; no samples/boots were excluded
and no retry occurred. Root continues diagnosis before public baseline.

Every boot logs the same three loop layouts at source-line25: offsets56/131/220,
wasm lengths928/1379/1085. This is matching diagnostic size, not proof of
binary identity. B3 and B6 each observe actual major-GC epoch3→4, evict all
three loops and recompile; B2 observes epoch5 without eviction. Raw compile/GC
records and guest-log hashes are in `compile-gc-raw-evidence.json`.

Read-only source review finds exact installed modules retained in existing
JitThread.sab replay arena: LOG_WORD3344, six-word install entries and
ARENA_BYTE409600. Freed module bytes remain in the monotonic arena. Closed
benchmark workers no longer retain accessible SABs; logs do not recover bytes.
A separate diagnostic boot can attach CDP to workers, pause after appendLog
(guest-jit.js source-line477), evaluate the task-local read-only extraction
expression, save bytes/metadata, then resume without changing source/archives.
The expression is prepared only; no diagnostic/public browser has started.
Debugger-paused timings cannot serve as benchmark acceptance.

## Plain caller matrix diagnostic (completed; not acceptance)

Root reviewed and released one bounded AB caller matrix, A audited7c and B
ce0d881 cached fallback. Declaration SHA
f3533228c99dbd11453cc95b2cd191a5c62311013edb149a5268e0b4268c91c7
and exact fixture/runner diffs are retained under
`/mnt/p6/build/guest-jit-validation-20261001/arr-inc-caller-diagnostic-inputs-run1`.
Fixture SHA2bf44b7b8454ed7815ab3b3e91f8b1ccd7e4a8230a8a596799bdae3b1da5d0a0,
runner SHA24ae25a24c7e33d34ec42c9dc2a0a2c55f185f022ff01c24e37d5d5cdf0ff1b7.
The exact callee body remains on HTML source line25. Each round uses fixed
protected argc0, protected argc1, no-handler helper argc0 and no-handler helper
argc1 cells, eight warmup batches and eleven measured batches of1000 calls.
Actual argument choice is source evidence only; no engine-frame argc or script
eligibility was observed. Helper result-object creation remains in its timing
scope, so this does not isolate a single trampoline instruction's cost.

The timing driver contains no debugger, worker attach, pause, module capture
or profiler calls. The instrumented draft was retained but not released/run.
`bench-8-cached-fallback-arr-inc-caller-diagnostic-run1/result.json` reports
`diagnosticFunctionalPass:true`, `timingAcceptance:false`; both boots pass,
navigation1, all264 batches/checksum189186112 match raw logs, input hashes and
the budget300/readiness adapter are unchanged, both browsers exit0 and the
server closes. Ports4201/9411 are free. No sample/boot exclusions or retries.

| Caller | A7c median ms/batch | Bfinal median ms/batch | B/A |
| --- | ---: | ---: | ---: |
| Protected argc0 |118|116|58/59|
| Protected argc1 |118|116|58/59|
| Helper argc0 |118|119|119/118|
| Helper argc1 |124|119|119/124|

A round medians in this order are [120,122,113], [113,121,116],
[118,112,118], [131,114,124]; B rounds are [116,119,113], [115,117,115],
[122,119,112], [117,141,115]. Both arms compile source25's three loops with
sizes928/1379/1085. B logs epoch4 without eviction. Helper loops at source35/36
reject specialization with head type in both arms; this does not establish
their engine eligibility state. Raw evidence, compilation records and all264
samples are retained in `caller-diagnostic-summary.json`,
`caller-matrix-all264-batches.csv` and each boot's `guest-logs.txt`.

The plain matrix did not reproduce a consistent caller/arity slowdown in these
two boots. It does not overturn the failed14.516% acceptance confirmation or
prove its cause. Browser lane is idle; no subsequent browser phase starts
automatically. The public baseline remains held for root assessment.

## Arr-inc promoted-baseline coverage declaration (prepared)

Root requested the missing release-baseline arr-inc comparison against live
promoted Firefox b21b2cac65a3, distinct from the failed7c precision gate.
`arr-inc-promoted-coverage-inputs-run1/predeclared-inputs.json` SHA
536a720e385819a90e7530a1241888a89ea6a7e49205b3185e862800a0b07a18
freezes six ABBAAB boots, all198 batches, correctness/input/cleanup checks and
strict macro median B/A at most1. No duration minimum, exclusions, retries or
noise-based acceptance. Both arm macro medians use three boot medians, each
computed from all33 batches. Checksum is -840074848 with original REPS100.

Fixture SHA276868983545ca62c2ba5e55d42d2e0b163327e14b4762ece19c4a1977273463
changes only source line39 to filter arr-inc. Original callee/source25,
REPS100/WARMUPS8/SAMPLES11/ROUNDS3/settle15000 remain exact. The copied runner
is byte-identical to frozen a98b9dadd748b5362ed5b04e6bc3d115334b0a84ed3a10b238889a38634e64ba,
with existing absolute repository anchoring and expectedCases3. Live baseline
manifest and actual kernel/plain/Firefox bytes and SHA are verified; A archive
d3d9afca272947ba1b6bb743585a6f0cf33de90c54adff1cd85b5c5bf9d8002b,
B ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745.
Same budget300/readiness loader adapter, no instrumentation or public browser.
Outputs will be `bench-8-cached-fallback-arr-inc-promoted-run1`. Prepared only;
root release required. The failed7c confirmation remains explicitly FAIL.

## Arr-inc promoted-baseline coverage completed

Root released exactly the declared six ABBAAB boots after freezing the
conditional engineering decision at
`/mnt/p6/build/guest-jit-promotion-20261002/root-conditional-tradeoff-decision-run1.json`
(SHA c8e5fe57a2727850c375f6bfd50121ffb9ea0a10629e34c0da9ca5a67273ec98).
The run completed with all mandatory checks passing and no instrumentation,
exclusions or retries. This distinct release-baseline comparison does not
change the failed unpublished-7c precision result or establish its cause.

`bench-8-cached-fallback-arr-inc-promoted-run1/promoted-coverage.json` reports
PASS: A boot medians [989,1049,1013] ms; B [16,14,12] ms; macro B/A 14/1013
= 0.0138203356367, meeting the strict bound of 1. Aggregate medians are
A 999/B 14 ms. Round medians are A1 [991,987,982], B2 [15,15,17],
B3 [14,16,12], A4 [1027,1049,1057], A5 [999,1139,1000], B6 [12,12,11].
Every one of the 198 raw batches is retained and matches guest PBLBENCH logs,
REPS 100 and checksum -840074848. Every boot navigates once, exits zero without
forced termination/fatal/outer errors, and uses unchanged input hashes and
identical budget/readiness adapter. Server closure and free ports 4201/9411
are verified. The conditional decision and all of its prior frozen failure
artifacts remain hash-identical.

B boots 2/3/6 each compile all three exact source-line25 loops once, sizes
928/1379/1085. Observed epochs are 5/5/4 respectively, with no logged GC
eviction; no major-GC claim is made from stable epochs. Promoted A has no JIT
compilation records. `compile-gc-raw-evidence.json` preserves the exact lines
and guest-log hashes. The inherited runner's raw noise-bound label is retained;
the predeclared strict unrounded macro comparison supplies the acceptance
criterion. All samples appear in `arr-inc-all198-batches.csv`.

Result SHA 6d1e05c876a71e804bdc8e0a7e09bd8284885c15b8b912b3e35d210dd0dfc469;
coverage SHA 452c8d8a9a4ed020b81f8688e6d191cd16d6c44b313929bd25b81d76e858b974;
raw CSV SHA 6008e885c94458e43b423977c762f23536ea6a249c59ed2dbe353b2c93b9ce94.
Session 43055 exited zero and the browser lane is idle. Root assesses promotion;
no public baseline or subsequent browser phase has started automatically.

## Fresh actual public-v9 baseline (completed, profile preserved)

Root released baseline only using frozen public-firefox-two-stage.mjs SHA
ff6366ab78cf3d29fc0c81faaae05cbb6bf4b2d39b7446fa6189df300511b9a0.
`public-v9-baseline-run1/result.json` reports PASS, profileSafelyClosed true,
home flushed, guest page closed, browser exit zero and no outer errors. The
fresh owned profile root is
`/mnt/p6/build/guest-jit-validation-20261001/public-v9-baseline-run1`; profile/
and cache/ are preserved unchanged until post-deployment update release. No
historical seed, interception, local server, TLS/update/coldwarm phase or public
runtime mutation was used. Session 46854 exited zero.

Actual public manifest runtime 29331a186e50 and archive
7bd5e9041d568c6b5b325abba16754d943a51b009c368c39901c0fb0a751508a
(88,378,783 bytes) match the expected v9 identity. Manifest/archive return200,
archive content-length/ETag match, COOP same-origin and COEP require-corp are
observed. Guest systemUsage reports the same runtime, fresh boot requests two
system images. Guest launch marker appears at36,393 ms, actual Firefox
readiness download at108,850 ms; these are functional observations, not
performance/first-paint claims. Real typed wasmperf input produces a guest
JSON download with checksum7,998,000 and exact fixture URL/Firefox UA. NSS
reports119 eligible, updated0, preserved119, error0; exact home marker/user.js
checks pass. Full logs, readiness JSON, functional screenshots and exported
trust/profile snapshots remain in the output. Result SHA
ce61a20239bb294991d4dce3a0a592cc07362b99743930cec269babafc495d9a.

Root and Sites deployment owner were notified that the profile is closed and
ready. Browser lane is idle. No update or fresh new-version cold/warm begins
until exact deployed runtime/deployment identities and root release arrive.
