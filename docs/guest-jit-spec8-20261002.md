# Guest JIT packet 8: own numeric properties and Math (2026-10-02)

Current selected candidate is `ce0d881dec8cea07`, with script-aware caching
and cached interpreter rejection for exception scripts. It passes 1,969 host
checks, startup/update, the complete original benchmark and six safety boots
with 8,408 assertions each. Spec6 semantics pass; its short and-or measurement
is supplemented by the predeclared precision check described below. Spec7
passes semantics but its longer compound-update confirmation measures a
14.516% slowdown against unpublished JIT7c and fails the declared coverage
bound. A separate predeclared six-boot comparison of the affected array case
against the actual promoted runtime passes at 14/1,013 ms, about 72.36× faster,
with all 198 raw batches retained. Root's frozen, narrowly scoped engineering
decision permits this intermediate-build tradeoff while preserving both old
FAIL results and all mandatory release gates. Final promotion review and local
apply pass: runtime `ce0d881dec8c` is promoted locally, with 117 evidence files
rechecked immediately before replacement and the old baseline backed up.
Sites v9 remains public until the authorized deployment and public checks.
The earlier
candidate sections below are retained as build and investigation history.

Builds on packet 7c, whose `ToPropertyKey` Int32 fast path and IC accounting
remain intact. Task root: `/mnt/p6/build/guest-jit-spec8-20261001`; TMPDIR, TMP
and TEMP point at its `tmp` directory. All changes are adapter source in
`tools/pbl-jit/PblJit.cpp` and the host emitter test. No upstream source edits.

## Implementation

- **Object variables.** A never-replaced head-live PlainObject becomes ObjTy,
  carrying its source variable index. Entry checks the object tag and the
  sampled shape before executing the loop. Objects may be nursery objects:
  their pointers are reloaded from the current frame at every entry, and the
  compiled loop never allocates a GC thing or invokes JS. Dictionary objects
  are excluded because shape identity alone is insufficient for mutable maps.
- **GetProp.** `NativeObject::lookupPure(AtomToId(script->getAtom(pc)))` accepts
  only an own normal data property with a slot. Fixed slots use
  `getFixedSlotOffset`; dynamic slots load the current `offsetOfSlots` pointer
  and add `dynamicSlotIndex * sizeof(Value)`. Numeric results are Double,
  accepting Int32 or Double at runtime. Other values bail before the operation,
  with the original object on the interpreter stack.
- **SetProp / StrictSetProp.** Only an existing writable own data property on
  a PlainObject is eligible. Objects watched by
  `Watchtower::watchesPropertyModification` are excluded. A runtime check
  requires the overwritten value to be a number, and the new value is a
  statically known number, so the raw slot store needs neither GC barrier.
  The operation leaves its assigned value on the operand stack. Read-only,
  accessor, inherited, custom-data, proxy and dictionary cases fall back.
- **GetGName.** Pure lookup checks the current global lexical environment
  first, then the global object's own slots. A lexical property that cannot
  use the ordinary data-slot path blocks global fallback. Non-syntactic
  scripts and inherited/accessor global bindings are excluded. Numeric values
  are embedded with an exact slot-value guard; object values become ConstTy.
- **Constants.** Up to sixteen ConstTy objects/functions and forty-eight
  holder guards. Embedded objects must be tenured; major-GC invalidation does
  not cover nursery moves. Every lexical/global/constant shape and every
  embedded binding/function slot identity is checked before the loop.
  Replacing `Math` or `Math.max` while preserving shape therefore misses the
  entry guard. Writable ObjTy pointers must differ from all constant-holder
  pointers before any mutation, preventing alias stores from invalidating a
  hoisted constant inside the loop.
- **Math calls.** Native identification requires `JSFunction::isNativeFun`,
  `hasJitInfo`, and `JSJitInfo::InlinableNative` before examining
  `jitInfo()->inlinableNative`. `Call` (122) and `CallIgnoresRv` (126) consume
  callee, this and arguments and push a Double result. Every argument must
  already be a number; no JS coercion or allocation occurs. Max/min fold wasm
  f64 max/min from their infinity identity, including zero arguments. Abs,
  floor, ceil, sqrt and trunc use the matching wasm numeric operation. Round
  uses floor plus a fractional comparison to 0.5, copies the input sign onto
  the result for negative zero, and preserves magnitudes at least 2^52.
  NaN results are canonicalized when boxed by the existing packet 7 path.
- **IC accounting.** GetGName (193), GetProp (74), SetProp (76), StrictSetProp
  (77), Call and CallIgnoresRv each advance their JOF_IC index once. Numeric
  property bails retain the original PC, IC index and complete operand stack.

## Cache and GC

Entry records now include the exact script pointer, current majorGCCount and
current global pointer. `OnLoopHead` returns immediately during incremental
GC. Before using a compiled entry, it evicts if the PC, script or major epoch
changed, including scripts with identical bytecode in reused addresses. The
existing bytecode comparison remains an additional check. Current-global
mismatches return without entering the generated function. Compilation and
execution allocate only ordinary C++ buffers / host wasm code, never GC
objects; interrupts still leave at the atomic backedge check.

Compile logs include `gcEpoch`, and compiled-entry eviction after a changed
major epoch logs the old and new epoch. The enabled line prints the configured
logBudget so a guest test can verify its diagnostic environment inheritance.

## Verification so far

`host-run5` passes **1963 checks, zero failures**, with the emitter built under
ASan/UBSan. It includes all 402 packet 7c checks, fixed/dynamic property reads
and writes, exact non-number bail frames, shape mismatch, read-only/accessor/
missing/Watchtower-like rejects, constant-holder alias rejection before writes,
distinct objects sharing a shape, and nursery head / embedded-constant safety.

Eight Math natives are compared with JavaScript Math across signed zeros,
NaNs, infinities, positive/negative halves and adjacent representable values,
subnormals, int32 boundaries and large magnitudes. Max/min also exercise pairs
and zero arguments. Same-shape global and function slot replacements and
lexical/holder/function shape changes reject before modifying frame variables.

Fourteen tests call the actual `OnLoopHead` gate with counting/rejected and expired compiled cache
entries: script identity reuse, major-epoch eviction and freeing, incremental
GC avoidance, and current-global mismatch. These are cache-gate tests, not a
forced browser GC or an installed wasm call across GC.

Real Firefox-header compilation passes in `header-check3`, with only the six
existing Unicode.h warnings. The previous two attempts are retained: they
caught the required AtomToId conversion, Handle::get, experimental JitInfo
include and complete EnvironmentObject type include.

## Candidate

`build-run1` completes in 122.33 seconds, with default PBL exception handling
(`interpretHandlers=false`). The Firefox wasm is 157,967,093 bytes,
SHA-256 `4c98cee4e1cd21fcf41461a137ba829ce8e564ce7ac107d556bb547b99a2c2f8`,
with a growable function table whose minimum is 177857. The compiled adapter
source hash is `147b65d192af045bae47380975fbe723cfd02186a59c097e351f45964efde690`;
`PblJit-8-run1.cpp`, `host-test-8-run1/` and `source-snapshot-run1.json` preserve
that input in the task root.

Package `web/linux/tests/runtime-candidates/pbl-jit-spec8-run1` passes its
isolated audit: archive 88,911,035 bytes, SHA-256
`de48d07e6051b575d8e2519f9eb2ebd62cb663b9ee1e53dd6174842ef6a93f75`.
Only `opt/firefox/firefox` differs; all 11,469 other records and the persistent
`/init` are identical.

The separate combined candidate in
`web/linux/tests/runtime-candidates/pbl-jit-spec8-handlers-run1` uses the same
frozen JIT source with the builder's `--interpret-handlers` adapter. This
rejects PBL preparation for scripts with Catch or Finally try notes before
JitScript allocation; loop and iterator try notes remain eligible. It targets
the exception-path regression independently of the loop emitter. The upstream
source tree remains untouched, and this policy still requires guest performance
acceptance.

`build-handlers-run1` passes in 91 seconds with `interpretHandlers=true`;
its copied adapter hash equals the frozen input hash above. Firefox is
157,967,320 bytes, SHA-256
`a46902432657621a9a2075599f8da4629bf81a0a3193f6d6462c0f3df909df2b`.
The package audit passes: archive 88,911,206 bytes, SHA-256
`962b207fbc7464345d7b8fae283a60f4a61a79980f04e68fb4d2398b0c80bd77`,
version `test-pbl-962b207fbc746434`. Only `opt/firefox/firefox` differs; the
other 11,469 records and persistent init remain identical. Build input hashes
are recorded in `source-snapshot-handlers-run1.json`. The default candidate
above remains available separately.

## Guest compilation smoke

`/mnt/p6/build/guest-jit-validation-20261001/smoke-8-original-run1/coverage-evidence.json`
records a passing one-boot smoke for this default candidate: all 24 case rows,
original inputs unchanged, and guest `logBudget=300` verified. The original
fixture's property loop (line 24) compiles to 718 bytes of wasm, and its
Math.max loop (line 25) compiles to 743 bytes. Both run again after natural
major GC advances the epoch from 4 to 5: the log shows eviction and recompilation
of each loop, with exact fixture checksums retained. The int control also
evicts and recompiles across epochs 3, 4 and 5. This is natural guest GC
evidence, not a forced-GC or incremental-GC test.

The smoke has only arm B. Its runner's comparison `pass=false` is expected
because no arm A exists; the separate `passSmoke=true` covers compilation and
semantics. It establishes no interleaved performance result. Dictionary-global
rejection does not block this original fixture's Math binding.

**Pending:** combined-candidate guest safety, original prop/native ABBAAB benchmark,
and regression comparison against the promoted runtime. Dictionary globals or
non-own Math bindings may conservatively reject other browser contexts. The standalone
`web/linux/tests/guest-jit-safety.html` is owned by the fixture packet and will
exercise compiled paths and interpreter fallbacks with guest evidence.

No runtime has been promoted or deployed by this packet.

## Combined candidate startup and update

The combined JIT8 + `--interpret-handlers` candidate passes both real-guest
session gates in `/mnt/p6/build/guest-jit-validation-20261001`:

- `jit8-handlers-startup-run1`: cold launch 10,931 ms, page ready 72,368 ms,
  two image requests; warm launch 10,677 ms, page ready 39,774 ms, zero image
  requests. Guest JavaScript, input, download and saved home/profile checks pass.
- `jit8-handlers-update-run1`: baseline launch 11,448 ms, page ready 74,087 ms;
  updated launch 12,603 ms, page ready 41,520 ms, zero image requests. The prior
  download, home and user.js remain preserved. Both gates close their owned
  browser and server successfully.

The isolated handler-policy performance sequence is not an acceptance result:
one of its six boots never navigated to the fixture. Its successful partial
samples also do not establish that exception regressions are resolved. Launch
markers precede actual Firefox page readiness by tens of seconds; the final
benchmark uses an optional identical startup-homepage readiness marker in both
arms before sending address-bar input. Final combined-candidate safety and
performance gates remain pending. No local promotion has occurred.

## Safety acceptance and cache follow-up

`safety-8-handlers-run1` completes all six ABBAAB boots, 450 result rows,
identical semantic checksums and unchanged inputs. The compiled-path checker
confirms all 18 helper functions compiled before mutation in each candidate
boot, using identical logging/readiness adapters. Allocation pressure in this
fixture did not demonstrate a major-GC epoch change; the earlier original
fixture smoke remains the observed GC eviction evidence.

Pristine warmup nevertheless compiled 207/165/165 loops across the three
candidate boots. Different scripts can share immutable bytecode, while the
cache hashes only the bytecode pointer and evicts when script identity changes.
Repeated Math helper compilation is consistent with this mechanism. The exact
script guard is required for correctness. A script-aware cache lookup is being
implemented and tested before the final runtime build and acceptance sequence.
The existing 4,000-install lifetime bound remains: freed table slots are reused,
but module replay arena and log storage are not reclaimed. Cache exhaustion
falls back to the interpreter; removing that bound would not be a safe fix.

The revised source hashes script identity together with the bytecode pointer,
retaining exact script/global/bytecode/GC guards. Source SHA-256 is
`8ae0fa081ed4ce41111aee3bd62d798386a75dbd47ed9a2932349bf122e39912`.
The host suite passes 1,969 assertions with ASan/UBSan, including 20 cache
identity checks and alternating scripts sharing one bytecode pointer. Real
Firefox-header compilation passes with six existing Unicode warnings. The
cache candidate is `pbl-jit-cache-run1`, archive SHA-256
`37aeed1b7dcb8469b52a2d40e05b52f5e08eb349c9fe2a4d0b0d832f39102dff`.
Its safety smoke passes all 8,408 assertions and 75 rows. Each of the 18
helpers compiles exactly once during pristine warmup, confirming that the
script-aware lookup removes the observed recompilation churn.

The complete six-boot original benchmark for that candidate passes semantic,
input, navigation and cleanup checks. Candidate/control median ratios are
0.007 for integer loops, 0.770 for recursion, 0.014 for properties, 0.010 for
Math calls, 1.000 for flat throws and JSON, 1.103 for deep throws and 1.077
for error-object throws. The exception regressions prevent promotion.
Evidence is in `guest-jit-validation-20261001/bench-8-cache-promoted-run1`.

An optional `--interpret-throws` adapter scans instruction boundaries before
first JitScript allocation and leaves explicit Throw/ThrowWithStack scripts
in the existing C++ interpreter. Candidate `pbl-jit-throws-run1`, archive
SHA-256 `256bb70bc59e7d9754c298959da5ac59b62e2828492c03ec468503bc972926fe`,
passes the original fixture smoke and preserves integer/property/Math
compilation. Its single-boot deep/error medians are 41/42 ms versus the prior
control medians 39/39 ms. This is not performance acceptance; repeated
eligibility checks remain under investigation. No candidate is promoted.

The opt-in `--cache-interpreter-rejections` adapter records static rejection
on the script's existing BaselineDisabled flag, before JitScript allocation.
A second minimal copied hook in `MaybeEnterJit` returns to the C++ interpreter
before repeated warmup/admission checks for those scripts. It is restricted
to the current JS_CODEGEN_NONE/PBL configuration. The copied unified unit
replaces exactly one existing archive member. Default generated sources remain
byte-identical with the option disabled; both changed units pass real Firefox
header checks. No original upstream files are edited.

Candidate `pbl-jit-throws-cached-run1` builds and packages successfully with
all three exception-policy flags. It retains the frozen `8ae0fa…` emitter;
builder SHA-256 is
`e7284bda1f792849b7a04d6bff3272cefe5524cd250ba34aafa26c33f09c36f6`.
Firefox is 157,967,665 bytes, SHA-256
`f1b32608c447fd86bf0d7a9891b1de623c3609f3317e4ff6c4882d9841007d15`;
the growable table minimum is 177857. Archive SHA-256 is
`ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745`,
88,910,833 bytes. All 11,469 other archive records and persistent init are
preserved. Full provenance is in
`/mnt/p6/build/guest-jit-throws-20261002/source-snapshot-cached-run1.json`.
The original-fixture pilot passes all 24 rows, unchanged inputs, one successful
navigation, exact diagnostic adapter and cleanup checks. Integer/property/Math
source lines 19/24/25 compile. Deep/error median timings are 39/39 ms per 100
repetitions, matching the earlier control medians; flat throws take 33 ms.
This one-boot result only authorizes the full interleaved comparison. The final
six-boot benchmark and startup/update/safety/coverage gates follow this pilot.

The complete original ABBAAB comparison subsequently passes all six boots,
144 rows, identical checksums, unchanged input hashes, single-navigation boots
and clean browser/server shutdown. Median ratios are 0.007 integer, 0.787
recursion, 0.943 flat throws, 1.000 deep throws, 1.000 error-object throws,
0.013 properties, 0.009 Math and 0.738 JSON. All cases meet the selected
median acceptance rule. Large variance in later control and candidate boots
limits throughput conclusions, especially exceptions and JSON; their results
do not establish a speedup. The property and Math differences remain orders of
magnitude despite short candidate timings. Candidate boot 6 observes major-GC
epoch 4→5, compiled-entry eviction and recompilation with correct results.
Raw rounds and distributions are retained under
`/mnt/p6/build/guest-jit-validation-20261001/bench-8-cached-fallback-promoted-run1`.
Cold/warm startup and the profile-preserving update also pass on this exact
candidate. Warm startup and the updated boot fetch zero system images; prior
downloads, home files and the Firefox profile are preserved. Reports are
`jit8-cached-fallback-startup-run1/result.json` and
`jit8-cached-fallback-update-run1/result.json` under the same validation task.
Full safety also passes on this exact artifact: six boots, 450 result rows,
8,408 assertions per boot, unchanged inputs, matching checksums and clean
browser/server shutdown. In each of the three candidate boots, all 18 required
helpers compile exactly once before mutation. All safety compilations are at
GC epoch 4; this safety fixture does not itself demonstrate a major GC.
`safety-8-cached-fallback-run1/result.json` and
`safety-evidence-B-packet8.json` retain the proof. Numeric coverage comparisons
against the audited JIT7c candidate follow; no promotion has occurred.

Spec6 completes six boots with matching checksums and clean shutdown. Its
and-or median is 5 versus 4 ms per 100 repetitions, a retained raw ratio of
1.25. A predeclared supplemental ABBAAB comparison increases only repetition
count to 2,500 and selects that same function, preserving its body and source
line, runtime arms and loader. All 198 batches are retained. Aggregate arm
medians are 107/113 ms, and the median of boot medians is 105/108 ms: ratio
1.028571, within the coverage-only bound of 1.05 declared before execution.
Both arms exceed the required 75 ms duration. This result establishes the
selected coverage bound, not a speedup. All other Spec6 ratios are <=1;
the original eight-case comparison keeps its strict <=1 bound.

The promotion helper independently audits exact source transformations,
frozen artifacts and all raw guest-log samples. Its 57 rejection tests pass.
The original held result remains in the audit alongside the supplemental
evidence; no samples are discarded. Evidence paths are
`bench-8-cached-fallback-spec6-run1`,
`bench-8-cached-fallback-and-or-precision-run1` and
`and-or-precision-inputs-run1` under the validation task.

Spec7 completes all six boots and 144 rows with matching checksums, unchanged
inputs, one navigation per boot and clean browser/server shutdown. All cases
match or beat the audited JIT7c median except arr-inc: A boot medians are
12/12/12 ms and B medians 13/12/14 ms, giving 13/12 = 1.083333. Aggregate
raw medians are also 12/13 ms. This remains a performance hold despite the
runner's noise-bound classification. Diagnosis and a separately predeclared
higher-duration measurement precede any release; the original 198 batches
are retained in `bench-8-cached-fallback-spec7-run1`.

Read-only comparison finds byte-identical 7c/final host array modules and
metadata, including arr-inc's 1,378-byte module (SHA-256
`d31ebce86c6cae1ee83771ba1d842e561a08d816fbca1aa67863b3204f0981a5`).
Guest reset/update/sum modules also have equal A/B sizes. This does not rule
out entry/cache/runtime overhead. The predeclared supplemental comparison
completed with 1,000 repetitions, the same arr-inc body at line 25, six ABBAAB
boots and all 198 timed batches. Its coverage-only bound is <=1.05 with both
aggregate batch medians >=75 ms; no exclusions or retry-until-pass are allowed.
Declaration SHA-256 is
`048e44df8c1657577927f551cadd88538ca436672cd25558f78e1611e5fff0ae`
in `arr-inc-precision-inputs-run1`. A boot medians are 164/121/124 ms and B
medians 142/136/149 ms. The median-of-boot ratio is 142/124 = 1.145161,
failing the 1.05 bound; aggregate arm medians 128/146 ms meet the duration
bound. All 198 raw batches, checksums, inputs and cleanup records are retained
in `bench-8-cached-fallback-arr-inc-precision-run1`. The independent audit is
`/mnt/p6/build/guest-jit-promotion-20261002/arr-inc-real-audit-run1.json`.
Promotion remains held. The narrow promotion-helper supplement passes 59 rejection tests;
the existing and-or audit tests also pass 57/0 after that addition.

Read-only call-path inspection identifies a concrete hypothesis: the async
timed caller contains Catch/Throw, so final exception policy selects the C++
interpreter while JIT7c allows PBL. The array helper has one formal default
argument and receives zero actual arguments. Its loops still specialize in
both arms. The existing C++ entry path already pads missing arguments with
Undefined while preserving actual argc, so no argument or GC guard deletion
is justified. A fixed protected/ordinary caller by zero/one actual argument
matrix completed as a plain two-boot diagnostic, with no instrumentation.
All 264 samples and checksums pass; A/B aggregate medians are 118/116,
118/116, 118/119 and 124/119 ms. The result does not attribute the prior
slowdown to caller policy and cannot replace the failed acceptance run.
Actual engine-frame argc and installed-module byte identity remain unproved.
Evidence is `bench-8-cached-fallback-arr-inc-caller-diagnostic-run1` under
the validation task. Adaptive future-entry fallback remains an unapplied,
unbuilt proposal. A six-boot protected array comparison against the live
promoted runtime establishes release-baseline coverage: A boot medians
989/1,049/1,013 ms and B 16/14/12 ms produce the strict unrounded ratio
14/1,013 = 0.013820335636722606. All 198 raw batches pass correctness and
match guest logs; all three candidate loops compile on each candidate boot.
Before launch, root froze a conditional decision allowing a narrowly audited
engineering tradeoff only after that strict <=1 comparison and all existing
release gates pass. Decision SHA-256 is
`c8e5fe57a2727850c375f6bfd50121ffb9ea0a10629e34c0da9ca5a67273ec98`
at `/mnt/p6/build/guest-jit-promotion-20261002/root-conditional-tradeoff-decision-run1.json`.
It binds all prior reports/raw logs plus the new declaration/fixture/runner.
The failed intermediate comparisons must retain FAIL, original thresholds
and unresolved cause in the promotion output; there is no generic override.
