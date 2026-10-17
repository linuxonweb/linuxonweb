# Linux-on-Web performance and usability acceptance

Started October 12, 2026 on `gpt-6-codex-main-io-launch-20261012`.

October 15 continuation: user resumed and explicitly prioritized Firefox JIT
and daily usability, tested in desktop Chromium first. Mobile remains deferred
until desktop goals pass. The numbered gates below retain historical ordering;
current execution starts with JIT, then I/O/launch and graphics. Existing Xephyr
`:13` was absent at initial inspection; isolated CPU/JIT validation now uses
the already-running Xvfb `:11`, with exact identity checks. This display change
establishes no hardware graphics result.

Current desktop loop-JIT diagnostic pair `fse5`/`fsd9` passes the original independent
production checker on the same Firefox binary `649908c0` / archive `553a675f`.
Enabled: all 50 main/Worker cases and four privileged scopes in 123.836 seconds,
48 native installations, cold debugger/coverage skips and actual native
Interrupt/callback-abort/recovery. Disabled: 50 semantic cases, zero native
installations, 89.881 seconds. These durations cover different safety workloads
and are not a speed comparison. Both exited naturally, verified 68 seeds
read-only, matched three CPUs and released owned resources. Full JIT remains
pending native callback probes, ordinary UI/TLS and performance; the mutation
guards also pass on this binary as described below.
Evidence: `/mnt/p3/codex-build/gpt6-jit17-broad-independent/root-pair-review.json`.

Both original broad arms explicitly disable PBLIC/PBLBC, so they do not prove
correctness of the production-default IC and method compilers. Those need
separate native/semantic coverage and timing; preserve the original loop-only
checker and its policy exclusions.

The first candidate19 all-tier diagnostic (`fde1`, PBLIC/PBLBC/PBLJIT1)
completed all 50 main/Worker semantic cases in a 136.102-second owned run,
with natural Firefox exit, 68 read-only seeds and exact cleanup. The unchanged
original checker rejects throw-only source policy. Separate original raw GC/
debug/coverage and slice-GC checks pass; incremental and interrupt native-event
requirements fail. Incremental returned the expected value with GC still active
and no loop-native entries; method's early GC guard has no skip observation.
Interrupt installed/ran the infinite-loop native function, bailed twice, then
aborted and recovered, but no native kind3 Interrupt record occurred. Method's
own IRQ exit is a plausible path, not yet observed. All failures remain retained;
method/IC native execution and full JIT acceptance are unproven. Root replayed
72 actual artifacts at `gpt6-jit19-method/enabled/root-independent-review.json`.

The subsequent candidate19 all-tier timing pair completed the unchanged eight-case
fixture in 54.4349 seconds disabled and 26.1155 seconds enabled (52.024% less),
excluding its fixed 15-second settle. Both boots pass 67 acquisition/semantic
checks, natural exit, three matched CPUs, read-only seed verification and exact
cleanup. This is one exploratory pair, not repeated performance acceptance.
Recursion's per-repetition median fell 48.8%, JSON's 18.3%; three exception cases
remain 5.3–18.5% slower. Enabled integer-loop round 1 took 8.498 seconds and
contained eight 26–35 ms batches before returning to roughly 1–2 ms. Its cause
is Unknown; the 33-batch median masks this excursion. The log check covers its
enumerated PBLJIT/PBLIC/PBLBC prefixes, not all native output: PBLUNIMPL summaries
occur before/after the workload. Evidence is in
`gpt6-jit19-default-independent/default-pair-root-review.json` and
`gpt6-jit19-default-performance/integer-anomaly-review.md`. Native tier tracing,
repeatability, startup, daily usability and host-relative performance remain open.

Candidate20 adds opt-in method/inline-cache execution tracing in an isolated
build. It covers generated IC entry and all return paths, preserves actual
function identity across nested method calls, and records method incremental-GC
and IRQ exits separately from loop-specializer events. The original checkers
remain unchanged. Twenty-five focused controls, 66 rounding and 58 admission
checks pass. Object/link/compatibility/package stages took 23.592/37.068/73.044/
30.926 seconds; the compatibility pass itself took 39.573 seconds. Native
`c6991aa7` has 224,488 validated uniform indirect-call signatures. Archive
`4a55b74b` changes only Firefox among 12,908 root-filesystem records. Root
independently reviewed source/output hashes and all 827 object archive members.
The completed desktop Chromium test fte20a1 retained the original 150-second
deadline, 30-second scope limits, 2-MiB capture and 2-GiB guest. Root independently
replayed 72 retained artifacts: all 50 semantic cases and all four original
GC/debug/interrupt scopes pass. Exact installation/entry/return joins establish
58 native method calls and 37 inline-cache calls across main and Worker threads.
All 1,092 input pins remained unchanged, six CPU measurements agree at three,
Firefox exited naturally, and owned processes were reaped. The original full
session still fails its two throw-source policy predicates. Original enabled
reference and all-tier mutation controls, general safety and full JIT acceptance
remain pending.
The supplemental trace parser was corrected offline against the same raw bytes;
30 controls and independent replay pass, with all 95 observed calls joined to
prior installations. Its initial failed report is retained. This observed subset
does not establish general GC safety. Canonical sources and persistent preview
are unchanged.

Candidate20's original disabled control fsd20a1 now passes the unchanged session
checker: 50 semantic cases, zero native events, natural Firefox exit, 68 read-only
seeds and three matched CPUs. Root independently rehashed 68 artifacts and replayed
the original checker. The 101.366-second owner duration is not a startup or speed
measurement. Same-build original enabled fse20a1 subsequently passed50 broad
cases and incremental/slice-GC/interrupt scopes, but failed gc-debug-coverage's
old-function eviction join. New native compilation and16 correct post-GC results
are observed; the missing old-function lifecycle cause remains Unknown. Full JIT
acceptance remains pending. All owned runs are terminal; see
`/mnt/p3/codex-build/gpt6-jit20-gc-diagnosis/diagnosis.md`.

All-tier mutation fme20a1 passes the unchanged original 75-case/8,408-assertion
checker, including all 18 native helper warmups and all six loop-native fallback
guard families. Root independently replayed the actual capture and verified that
checked fixture bytes match the guest seed. Firefox exited naturally; 14 seeds
were read-only, three CPUs matched, and owned resources were released. These
are semantic and observed loop-guard results with all tiers enabled; they do not
individually prove every method/IC guard or forced GC safety. The mutation
fixture's memoized timing fields are not performance evidence. Review:
`gpt6-jit20-mutation/enabled/root-independent-review.json`.

The two default-tier throw-policy failures are now traced to deliberate source
admission, not incorrect caught values: both original cases caught literal 19
on all 16 invocations, but their loops compiled while the reference checker
requires no native installation. PBLIC1 permits throw-only functions; Catch and
Finally remain excluded. Keep the original checker and its failures, and test
its PBLIC0/PBLBC0 reference mode separately from broader tier coverage. Rejecting
all throw-bearing functions to turn that report green would remove useful JIT
capability. Exact source/raw evidence is in
`gpt6-jit21-exception-review/review.md`. Exception benchmark slowdowns remain
unexplained; source inspection alone does not establish their cause.

The first original eight-case exploratory A/B runs on native `66dcc051`
completed in 64.490/38.565 seconds with matching checksums. They did not pass
acceptance: A matched the original fatal-log check on post-completion background
IndexedDB abort messages; B leaked disabled-compiler banners and had one zero-ms
batch from the reduced clock. This is one boot per arm, not the original six-boot
ABBAAB comparison or a host-relative claim. Exception/JSON cases regressed.
Native `2a0e6b3a` / archive `53f8c839` now includes verified logging-off gates
for all three compilers. The object/link/compatibility/package cycles all stayed
below 80 seconds; no runtime acceptance is inherited. Performance6 adds a separate
untimed target-clock probe and benchmark-only precision prefs, preserving the
original page/checker/deadlines, and retains final read-only seed evidence on
predicate failure. All six performance6 ABBAAB boots now completed: 144 rows,
63 per-boot predicates each, natural Firefox exits, 14 read-only seeds, three
matched CPUs and exact owned cleanup. Independent raw replay confirms median
fixture elapsed 54.9916 seconds disabled versus 29.203 enabled (46.9% less).
The fixture starts this timer after its fixed 15-second settle; it includes
case work and inter-batch yields. It is not browser startup or a host
performance comparison. Median per-case enabled/disabled ratios: integer
0.005142, recursion 0.953937, flat throw 1.056150, deep throw 1.064366,
error throw 1.126084, property 0.013817, native-call 0.007757, JSON 1.440078.
The original no-regression gate fails, and full benchmark acceptance remains
false: native attribution, TLS/build inventory and legacy lifecycle schema
requirements are not established by this diagnostic. Production-default IC/
method coverage is the next live test, preserving original checker failures.
Evidence: `/mnt/p3/codex-build/gpt6-jit19-independent/performance6-root-review.json`
and `/mnt/p3/codex-build/gpt6-jit17-performance6/comparison-output.json`.

The subsequent original mutation run `fme1` failed at `Math.trunc(-0.25)`:
integer boxing returned +0 instead of -0 after 17/75 rows. The disabled
control completed all 8,408 assertions, but Firefox reported an AsyncShutdown
failure in Places/Sanitizer cleanup before natural exit. Its raw semantic pass
is not lifecycle acceptance. The narrow interpreter guard repair now passes
66 extracted production-handler checks and the existing 58 entry checks;
the release object compiled in 20.11 seconds. The fixed native `649908c0`
passed the same original mutation workload in both enabled and disabled modes:
75 rows/8,408 assertions each, all 18 enabled warm helpers and six native guard
families. Both exited naturally, preserved 14 seeds and met 150 seconds
(107.698/87.250 seconds). No shutdown fatal recurred; its earlier cause remains
unknown. Current-binary broad/GC revalidation now also passes; the original
eight-case speed comparison is next. Evidence:
`/mnt/p3/codex-build/gpt6-jit17-independent/root-pair-review.json`.

The user approved the compatibility-only wasm-opt pass and routine choices
within ten-minute build/test cycles. `--fpcast-emu` plus validation finished in
79.63 seconds on the current candidate; no `-O2` pass was selected. The cold-loop admission repair passes
58 host checks. Earlier loop admission may increase allocation for short loops;
its performance cost is still unmeasured. Standalone full benchmark capture
is now bounded to 540 seconds with 580/590-second owner/service limits;
17 existing tests pass. The original eight-case workload is unchanged.

Desktop presentation `fsp4` shows Firefox at 30.172 seconds, a working local
page/counter and fullscreen rendering. This does not establish the 30-second
usable-page target. The window-manager repair restores topbar/dock after leaving
fullscreen, but a black region matching underlying Settings remains. A follow-up
Settings repaint build (WM16) is prepared, with no guest acceptance. Normal quit
confirmation appeared but its response was not consumed before the 150-second
bound. Keep these UI results separate from diagnostic JIT acceptance.

Host canvas resize recovery now passes 14 host tests and a headed Chromium
comparison with exact pixel readback: original blank, repaired restored. This
is separate from fsp2’s unresolved dock/exposure defect and proves no GPU result.
Evidence: `/mnt/p3/codex-build/gpt6-fb15/canvas-browser-result.json`.

## Execution rules

The latest October 12 priority is Firefox JIT first, then GPU performance,
with host validation before mobile. I/O, launch and packages remain goals.
Earlier stopped JIT/GPU
experiments are not automatically accepted or repeated. Before any new such
runtime cycle, record its scope and budget; keep earlier failed evidence.
Each delegated testing/build/deployment/GUI subtask has at most five iterations.
The main agent writes and debugs production code and regression tests. Fresh
test agents inherit the main model and reasoning settings. No unrequested image
generation or external art assets.

Preserve existing dirty work, user storage, preview servers and tunnels. Builds
remain release/musl with no debug information and the original optimizer;
The October 15 approval permits compatibility-only wasm-opt for the current
JIT candidate; expensive optimization stays optional and each finite cycle
must finish within ten minutes.
Do not publish an experimental image over the user's selected system without
the existing in-page update choice. Scores describe verified scope, not goals.

## Ordered gates

1. **Persistent I/O:** failing tests first; real-browser IndexedDB correctness,
   transaction rollback, strict commit ordering, legacy-home compatibility,
   bounded request queue and measured before/after small and large writes.
   Preserve data semantics; do not trade durability for a benchmark score.
2. **Launch:** instrument cold download, warm cache, archive decode, kernel,
   window system, Firefox process and usable rendered page separately. Measure
   a cold and warm distribution, CPU quota, peak memory and image identity.
   Firefox target is a usable page within 30 seconds; process spawn alone does
   not pass. Historical warm 29.6-second evidence is not a current acceptance.
3. **JIT:** actual current-binary native compilation/execution evidence and
   unchanged original workload/deadline checks, compared with disabled JIT.
   Offline checks, partial sessions and interpreter speedups are not JIT passes.
4. **Graphics:** general application Vulkan/OpenGL feature tests before Firefox;
   report supported features and actual host adapter/backend. Compare identical
   scenes, dimensions, workload, hardware and browser against direct host runs.
   The user's target is at least 50% of host performance. Partial API support,
   translated command streams and software fallbacks are labelled explicitly.
5. **Mobile:** use the user-authorized connected Android device or a bounded
   three-core/four-GB emulator; document host/browser/guest CPU allocation.
   Verify touch, keyboard, storage/reload, launch and rendering. Desktop viewport
   emulation is not Android or iOS runtime acceptance. Test iOS on a real available
   Safari device; otherwise describe constraints and leave acceptance pending.
6. **Packages:** inspect guest ABI before promising Alpine compatibility. Provide
   signed repository/index/install/remove/dependency tests and reproducible musl
   builds. Candidate baseline tools: BusyBox, bash, coreutils, findutils, grep,
   sed, tar, gzip, curl and git, plus Python and Node.js. Package format alone does
   not establish that native Alpine binaries execute on this guest ABI.

## Initial resource and provenance record

- Current tracked HEAD: `3de18d3`; newer October 8 evidence supersedes the old
  October 6 GPU stop checkpoint. Existing dirty files remain owned by prior work.
- `/mnt/p6` has only about 4.6 GiB free, below the historical 20-GiB reserve.
  Do not put additional builds there. `/mnt/p3` is disk-backed btrfs with about
  662 GiB free. This round uses `/mnt/p3/codex-build/gpt6-io12` and its short
  `tmp` directory, including `TMPDIR`, `TMP`, `TEMP` and browser scratch.
- Initial host memory: approximately 28 GiB available. The current process's
  cgroup has no CPU quota in `cpu.max`; each runtime owner must still measure
  affinity and ancestor constraints rather than reuse a historical CPU count.
- First candidate: batch existing home block writes inside one strict atomic
  transaction, at most 32 block requests at once, retaining old partial blocks.
  Real-browser RED and GREEN evidence is required before calling this an
  improvement. This does not itself establish faster guest Firefox launch.

## Evidence and scores

The first storage iteration passes 47 real-browser checks, including old/new
RED/GREEN repetition. Matched 128-KiB and 1-MiB write medians improved 1.78x
and 2.72x respectively. This is Chromium IndexedDB evidence only; the limited
storage change scores 95/100, not the product. Archive/kernel overlap and
cancellation pass 54 unit checks. A failed boot cancels raw/gzip decoding,
releases readers and clears retained archive parts without waiting indefinitely
for source cancellation. Shared asset-cache downloads may still finish.
Measured candidate Firefox launch remains open. The user now authorizes a
sampled host available-RAM floor of1GB rather than the former assistant-chosen
six-GiB aggregate cap. The owner checks MemAvailable against1GiB, records sampled
owned-process RSS, and verifies CPU lanes after cgroup migration without
changing shared watcher policy. Hard aggregate peak memory remains unknown.
Use the persistent authenticated Xephyr display :13; never restart it or stop
it during finite browser-test cleanup.

Record measured results and honest iteration scores in `diary.md`; put the
latest handoff in `continue.md`. Do not claim 95/100 overall until the requested
end-to-end desktop/mobile gates actually pass.

## Current host checkpoint

- The web app defaults to 2 GiB while preserving saved choices. Host probes can
  explicitly choose it with `STARTUP_RAM_MIB=2048`; the historical probe default
  remains 4 GiB. The configuration change passes 35 tests and three syntax checks.
- One compatible-binary 2-GiB guest run passes all 24 diagnostic benchmark rows
  and checksums. RAM selection and kernel memory agree; all five CPU observations
  agree at three. Native parent identity verifies enabled JIT settings, and logs
  show eight loop compiles and 11,760 reported runs. This is not full JIT acceptance.
- The 30-second screenshot shows no Firefox window. Around 61 seconds it shows
  a blank Firefox window. The usable-page-within-30-seconds gate does not pass.
- The fixture takes 90.084 seconds in that run. An earlier 4-GiB diagnostic took
  33.914 seconds; a separate host Chromium reference took 4.2045 seconds. Host load
  was high during the 2-GiB run. These are not controlled comparisons and do not
  establish a RAM regression, an accepted speedup or the 50%-of-host target.
- New string, typed-array, primitive dense-store and native-call paths pass 21
  emitted-Wasm and inherited test groups, four syntax checks and release object
  compilation. Native calls preserve IC error handling and resume the interpreter
  after debugger/coverage activation; malformed terminal calls reject before
  emission. These changes have not been accepted in Firefox runtime. Compatibility-only
  function-pointer conversion remains awaiting clarification; no optimizer pass
  is authorized by these results. Mobile testing and GPU acceptance remain pending.
- The previous compatible run starts the machine at 5.3 seconds but shows a blank
  Firefox window around 61 seconds. A fresh constructor-timing diagnostic on
  October 13 uses that compatible binary, explicit 2 GiB and the existing
  90-second observation window. Its 17 controls pass; three CPUs match.
  Firefox module construction takes 973.1 ms, ending at page time 20.668 seconds.
  Actual screenshots show no Firefox at 30 or 40 seconds, then a rendered
  default check page at 60 seconds. Compilation alone cannot explain the gap;
  the 30-second target still fails. No new binary, compatibility pass, changed
  deadline, full JIT or graphics acceptance follows from this diagnostic.

- A subsequent combined worker-reuse/context-lifetime candidate passes 36
  preflight tests and completes one host startup with three matched CPUs and
  2 GiB. Instrumentation records 137 worker contexts and 2,651 constructor pairs
  versus the previous 302 and 3,122. No capture cap is reached. Actual screenshots
  show desktop only at 30 seconds, blank Firefox at 40, and a rendered page at
  50 seconds. The 30-second goal still fails. Earlier boot stages also differ,
  so this is not an isolated worker-pool speedup or controlled comparison.
  Full JIT validation with reused workers remains pending.
- The explicit worker-pool/lifetime JIT variant now passes all 24 original
  benchmark rows and checksums in 29.276 seconds, with three matched CPUs,
  2 GiB and nonce-bound native parent evidence for all three enabled switches.
  Its 65 preflight tests and three syntax checks pass. The earlier 90.084-second
  result is not a controlled comparison. Actual 30/40-second screenshots still
  show no Firefox; the 110-second screenshot shows rendered benchmark rows.
  This does not establish native tier/writer identity, the separate original
  150-second full-JIT safety gate, 50%-of-host performance or release acceptance.

- Full-JIT preparation exposed a shared post-IC coverage-check gap. A new
  production-emitter regression fails before the fix; after moving the existing
  native-call count guard into the shared IC guard, 23 tests and four syntax
  checks pass. One musl release object compiles in 23.993 seconds with no debug
  sections. It is not linked or runtime-validated. The original safety suite's
  throw-exclusion policy also differs from current expanded-tier admission;
  do not weaken that historical checker or treat its result as interchangeable.

Completion remains unproven; the historical score was not an acceptance measure.
Current evidence and next runtime gates are recorded in `continue.md` and
`diary.md`. Preserve the existing preview services and display `:11`; historical
display `:13` was absent at the October 15 inspection.
