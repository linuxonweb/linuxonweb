# Mobile boot memory work — testing, not accepted

The connected Android Brave test `gpt6-android12/brave7` reached a guest
out-of-memory failure before Firefox appeared. Eight CPUs matched; the guest
had 1024 MiB. The kernel reserved 444416 KiB before unpacking the boot image.
The lowest sampled phone available RAM was 1115516928 bytes, only about
40 MiB above the conservative one-GiB guard. Increasing guest RAM is not an
appropriate first response.

Streaming inspection of the exact candidate archive found:

- Compressed archive: 115615257 bytes.
- Expanded archive: 391611696 bytes.
- 10377 regular files, with no declared hardlinks.
- Regular-file data rounded to the guest's 65536-byte pages: 1003880448 bytes
  (957.375 MiB), excluding metadata, overlays, kernel and application memory.

Two independent costs therefore need addressing: the expanded boot-image
reservation and the per-file memory overhead of flat Firefox resources.

## Compressed boot input

`loadDesktopInitramfs` accepts an opt-in `preserveGzip: true` alongside
`gzip: true`. It streams CPIO validation and retains only the init script,
keeps the original compressed bytes, then appends aligned desktop extras and
the existing init overlay. The default remains unchanged. The application
opts in only with `?compressed-initramfs=1` on Firefox boots without raw GPU
demo overlays. This requires kernel gzip/initramfs support;
source inspection and symbols are not a substitute for a live boot test.

Six new tests plus 22 inherited tests pass. A test using the actual archive
verifies the original compressed prefix hash and independently extracted init
overlay. Host assembly took 2.593 seconds with 320.5 MiB peak Node RSS. These
are host preparation measurements, not phone startup or speedup results.

## Firefox resource jars

`tools/guest-rootfs/package-firefox-omni.py` transforms a flat runtime directory
using that Firefox source tree's `SimplePackager` and `OmniJarFormatter`.
It uses the source-vendored `packaging` dependency. It requires fresh output,
both resource manifests, and regular-file inputs; it does not overwrite a
runtime, follow symlinks, strip native binaries, or deploy anything.

Six synthetic tests pass after correcting a missing vendored-dependency
path and a wildcard omission of root dotfiles. They verify toolkit/browser jar separation, resource bytes, unchanged
native files and source contents, and destination/symlink rejection. Upstream
ResourceWarnings are retained in the test log. Actual data conversion now
preserves all 8030 nonmanifest bodies exactly once, moving 8006 into jars.
The native binary is unchanged. All six canonical manifests match after
unpacking with Mozilla's parser. This is offline equivalence, not a browser
resource-loading test.

The resulting regular-file page estimate is 443.8125 MiB, a reduction of
513.5625 MiB. It still excludes kernel, metadata, overlays and runtime memory.
The actual `firefox-bin -> firefox` alias is not materialized in the directory
test; its original CPIO record must remain unchanged in the boot package.

`tools/guest-rootfs/rewrite-firefox-archive.py` streams explicitly reviewed
regular-file replacements into a fresh archive, preserving every unlisted
record's encoded bytes. Six tests cover native/init/home/alias preservation,
native identity, unsafe paths, duplicates, truncation and output protection.
A private full-archive build and independent record comparison now pass.
The 118878033-byte candidate preserves 4873 unlisted encoded records,
all 1436 symlinks, native executable identity, and the original trailer/tail.
All 26 transformed outputs match the independently reviewed resource tree;
gzip and ZIP CRC checks pass. Exactly two frozen routes change: the archive
and its boot manifest. All 1885 input pins remain unchanged.

This optimization reduces estimated guest filesystem allocation, not download
size: the compressed candidate is slightly larger than the original archive.
Build and independent verification took 23.33 and 24.75 seconds respectively.
Evidence: `/mnt/p3/codex-build/gpt6-android12/omni-package/release.json`.
No public deployment is implied.

## Remaining gates

The private phone owner now selects the verified candidate and explicitly
enables compressed input. Its 22 static/mock/local-server checks and syntax
check pass. The subsequent Brave8 run actually reached `/init`, mounted home,
started X and issued the Firefox launch command by 23.770 seconds after
navigation. The kernel reported 859456 KiB initially available, compared with
593088 KiB in Brave7, and freed 174656 KiB of initrd memory. This establishes
compressed-kernel boot, not Firefox resource loading or first-window timing.

At 23.959 seconds, the phone's sampled available RAM fell to 600121344 bytes.
The one-GiB guard terminated the owned run; cleanup preserved recorded tabs,
Brave main identity, mappings, listeners, 19 protected processes and `:13`.
All 659 input pins stayed unchanged. The actual screenshot at 18.663 seconds
shows no Firefox window, and zero compiler lines or benchmark cases arrived.
No guest kernel OOM was logged. The exact launch allocation responsible for
the phone memory drop is not yet identified.

Evidence: `/mnt/p3/codex-build/gpt6-android12/brave8/terminal-review.json`.
Do not repeat this candidate unchanged on the phone or weaken the guard.
Next investigate executable compilation/instantiation memory and retained boot
buffers using the exact frozen runtime; source estimates cannot establish RSS.
Firefox resource loading and JIT remain pending.

An offline scan of the exact native executable finds 686672 functions,
174747594 bytes of code, 57240740 bytes of data and only 576 bytes of custom
sections. Removing debug metadata is therefore not a meaningful memory fix.
Imported memory starts at 1110 pages (69.375 MiB); its maximum is an address
limit, not evidence of physical allocation. The exact frozen worker stages
the full 233392657-byte executable in a JavaScript buffer before synchronous
`WebAssembly.Module` construction, then allocates user memory. Engine compiler
overhead and the actual stage causing the phone drop remain unmeasured.
Measure these stages on the desktop before another phone attempt.
Evidence: `/mnt/p3/codex-build/gpt6-android12/compile-memory-analysis/summary.json`.

## Desktop stage measurement and retained boot image

The subsequent headed desktop diagnostic used two matched host/browser/guest
CPUs and the same 1024-MiB guest. Native executable compilation took 1.367s,
initial user-memory allocation 0.070ms, and instantiation 101.940ms. Nearest
Module begin/end summed process RSS was 2958.363/3035.711 MiB; shared pages
may be counted more than once. These are desktop measurements, not proof of
the phone's failing allocation. Firefox first appeared in the capture completed
at 50.614s and rendered page content by 60.413s. The 30-second target is unmet.
The rendered page establishes that the resource jars can support the Firefox
UI on this desktop path, not full GPU or JIT acceptance.

All recorded cleanup/protected-process checks pass. The diagnostic has a
retained limitation: two transitive checker imports lacked prelaunch hashes.
See `/mnt/p3/codex-build/gpt6-android12/desktop-memory1/REPORT.md`.

Separately, forced-GC tests reproduced a boot-image lifetime defect: the live
framebuffer callback retained the entire spawn options object, including the
consumed image or its resolved promise. The runtime now builds that callback
through a helper which captures only framebuffer settings and the GPU host,
and avoids closing over all spawn options. Both direct and promised-image
regressions now pass; callback receiver and caller-owned options are preserved.
These tests execute the actual runtime source with mocked kernel/host services.
They prove collectability, not immediate garbage collection or runtime RSS savings.

An isolated package now applies only this refactor to the previously frozen
runtime. The original frozen source reproduces the retention failures; the
patched source passes all three lifetime/semantics tests. Independent verification
checks 634 files and 630 routes: only the index file/route changes, with no
worker-pool delta and the same archive/native identity. A first manifest check
caught stale inherited parent metadata before testing; corrected v2 metadata
passes the fresh verification.

The isolated browser comparison is now terminal. Firefox first appears by
80.495s and page content by 100.465s, slower than the earlier 50.614s/60.413s.
The same native constructor sequence has sampled summed RSS of 1950–2379MiB,
versus 2704–3036MiB, while compilation takes 3.214s versus 1.367s. These are
single observations with uncontrolled host/cache state, not a causal performance
result. Later samples represent different startup/render progress and cannot
establish steady-state savings. No browser GC was forced. The slowdown's cause
is unknown; do not promote this candidate as a proven speed or memory gain.
All 672 captured runtime pins, CPU equality and cleanup/protected-service checks
pass. The previously missing local checker dependencies are included this time.
See `/mnt/p3/codex-build/gpt6-android12/desktop-memory2/REPORT.md`.
Preserve the archive/native executable and measure again before another phone run.

No Firefox launch time, JIT speedup, full GPU support or production mobile
acceptance follows from these offline tests. The persistent preview and
Xephyr `:13` remain unchanged.

## Latest phone result: Brave13

The repaired CPU observer now completes actual main/renderer captures in
304–498ms, with phone/browser/guest counts all eight. Its prior delay came
from invoking Android's external `printf` once per thread; a read-only
comparison retained byte-identical 53-thread transcripts while reducing
capture times from 2519–2575ms to 326–342ms. This improves test acquisition,
not Firefox performance.

The guest again reaches `/init` and issues the Firefox launch command.
The latest retained guest sample is 16.349s after boot; the only runtime
image, at 11.384s, shows a black guest canvas, not a Firefox window. Native
identity remains unverified and zero benchmark rows complete. Guest output
includes both `sh: vfork: Out of memory` and `sh: set: -f: invalid option`.
The latter requires a separate probe compatibility repair; neither message
identifies the complete Firefox failure or the memory allocation responsible.

Phone available RAM falls from 2777452544 bytes at admission to 764379136
bytes (729MiB), triggering the unchanged one-GiB guard. The owned run is
terminated and reaped; post-cleanup available RAM is 2889781248 bytes.
All 675 captured pins, 632 routes, recorded tabs/mappings, 19 protected
processes and persistent `:13` pass cleanup verification. Do not repeat this
candidate unchanged or relax the memory guard. Attribute the launch-time
allocation on a bounded diagnostic path before another phone run.

Evidence: `/mnt/p3/codex-build/gpt6-android12/brave13/terminal-review.json`.

## Inherited execution-context lifetime

Source review found another avoidable reference: `user_imports` captures its
original parent context in both `prepare` and `switch_entry`. Those closures
remain live after successful exec replaces the active context, keeping the
old module and linear-memory wrapper reachable. The selected function is
byte-identical in the current tree and the frozen phone worker (33054 bytes,
SHA256 `244dcd5229f2022ece635a157ac04fbe8db6c83d6fe6036e8f7d61765a3c758d`).

The regression executes that actual function with real small Wasm modules,
shared memories and instances; JIT, audio and the Firefox callback adapter
are stubbed. Forced-GC checks fail for both deferred and already-instantiated
parent contexts after exec. Three controls pass: pending/failed/aborted exec
preserves the active context, clone entry remains lazy and writes inherited
memory, and a worker without a parent rejects clone entry but supports exec.
Both current and frozen sources independently produce two expected failures
and three passes. Evidence is retained under
`/mnt/p3/codex-build/gpt6-android12/exec-context-red/`.

The repair stores only the boolean needed by those two closures; the active
`context` still owns its memory until replacement. An isolated copy applies
only this repair to the frozen worker, excluding the current tree's older,
unaccepted worker-pool changes. Fresh GREEN passes all five checks on both
current and isolated workers, plus all 13 checks in the combined lifetime,
worker-reuse/halt and framebuffer-lifetime suite. Three syntax checks pass.
Independent reconstruction and main diff review confirm exactly those three
substitutions in the isolated candidate; 62 input pins are unchanged. All
test processes are reaped and 19 protected processes, including `:13`, remain
unchanged. Evidence is under
`/mnt/p3/codex-build/gpt6-android12/exec-context-green/`.

These checks concern JavaScript reachability, not resident bytes, Firefox JIT,
or the cause of the phone's RAM drop. They do not simulate the entire live
kernel stack or prove that all other references disappear. No phone retry,
runtime package admission or deployment follows from this component repair.

## Phone memory-observer capability

A subsequent single read-only device check establishes that the existing
Brave main process exposes numeric `/proc/PID/status` memory fields. That
read takes 51.956ms and reports VmRSS 329224kB. `smaps_rollup` is permission
denied; a single `dumpsys meminfo --local PID` fallback takes 150ms and reports
TOTAL PSS 158502KB and TOTAL RSS 334352KB. These are different metrics and
separate samples, not contradictory readings or an allocation attribution.
The error label EACCES comes from diagnostic text, not an exposed native errno.

Phone available memory remains above the guard (2815524 to 2814600kB).
The 0.764-second check preserves the main process identity, exact ADB maps and
`:13`, with no foreground, navigation, guest or compilation action. Renderer
permissions remain to be checked. Sanitized evidence is at
`/mnt/p3/codex-build/gpt6-android12/memory-observer-capability/result.json`.
This enables a lower-risk, isolated native constructor diagnostic before
another complete Linux/Firefox phone boot; that diagnostic has not run yet.

## Constructor-only diagnostic admission

The diagnostic separates download, synchronous Wasm compilation, input-reference
release, shared-memory allocation, instantiation and final-reference release.
It uses the same 233392657-byte native executable and actual runtime memory
allocator. It never invokes exported Firefox `_start` or boots Linux.

Inspection found an automatic Wasm start section, function 10, distinct from
application entry index 12. Main reviewed its exact 158-byte body in WAT: data
initialization, zero filling and atomic initialization coordination, without
function calls. The diagnostic permits only this explicitly pinned body; it
rejects unknown automatic starts and mismatched bodies. Its Linux import stubs
throw if called. This is not a replacement runtime or a Firefox benchmark.

Tests were written first. Initial six tests failed before implementation; the
later initializer-approval test reproduced blanket start rejection. Fresh GREEN2
passes 8/8 diagnostic tests, 35/35 combined integration tests and 5/5 syntax
checks. All 34 input pins and 21 protected process identities remain unchanged;
the test owner is reaped. These are host fixtures/static checks, not full-native
execution. Evidence: `native-memory-green2/terminal-review.json` under the same
Android evidence directory.

The next isolated phone run samples PID/start-bound main and renderer RSS and
system available RAM. It retains the one-GiB floor and two-GiB admission gate.
RSS is not PSS; shared resident pages must not be counted as unique memory by
summing processes. Dropping JavaScript references does not force collection.
Host samples and phone phase timestamps have no explicit clock-offset join;
use observed stage and held samples, not exact cross-clock allocation timing.

## Actual Android Brave constructor result

The single `native-memory1` run completes all six stages. Main independently
views the actual idle and completion screenshots and reviews the raw recorded
state, memory samples, CPU admission and cleanup receipt.

| Stage | Phone duration | Renderer held RSS |
| --- | ---: | ---: |
| Before download | — | 180.258 MiB |
| Download | 7583.760 ms | 404.867 MiB |
| Compile | 719.035 ms | 699.688 MiB |
| Drop input reference | 0.200 ms | 700.410 MiB |
| Allocate shared memory | 1.475 ms | 700.410 MiB |
| Instantiate and initialize | 128.445 ms | 553.012 MiB |
| Release references | 0.795 ms | 554.020 MiB |

Held samples follow the owner's one-second wait. Main-process RSS stays near
325 MiB. Lowest sampled phone available RAM is 2163.020 MiB; after cleanup it
is 2694.965 MiB. No guard trips. Dropping the input reference does not immediately
lower sampled RSS. The later reduction cannot establish which object was
collected. There is no post-close renderer RSS sample or continuous peak bound.

Phone main/worker concurrency is eight, with root cpuset/all-thread admission
passing before and after. All 34 pins and 21 protected processes are preserved.
The exact diagnostic target closes; the recorded prior target, maps, Brave main,
Xephyr `:13` and dev HTTP 200 remain. The owner exits zero and is reaped.

This establishes that this exact module can compile and instantiate on the
phone without running Firefox's exported entry point. It does not reproduce
the whole-guest failure or prove Firefox startup, JIT or GPU performance.
The next investigation is combined guest/kernel, boot image and application
residency, rather than another unchanged full phone boot or assuming native
constructor time is the main launch bottleneck. Evidence is retained in
`/mnt/p3/codex-build/gpt6-android12/native-memory1/` and `native-memory1-audit/`.

## Compressed desktop-extras tail

Compressed boot still appended 59997184 bytes of raw desktop extras. The loader
now supports `compressExtras: true` only together with `gzip` and `preserveGzip`.
It streams extras, alignment and the existing init overlay into another gzip
member, preserving the root gzip and all files. The application selects this
only through its existing explicit `?compressed-initramfs=1` Firefox path;
default/raw and raw-GPU-overlay paths are unchanged. No preview is deployed.

Six tests preceded implementation: five expected failures and one unchanged-mode
control. Fresh GREEN passes 27/27 combined tests and four syntax checks. Cases
cover byte equivalence, alignment, unchanged old modes, incompatible options,
compression errors and cancellation. An initial test-owner dependency scan
failed before any tests by traversing an unexecuted optional GPU path; the
corrected host-only scan passes without changing the tests.

Actual archive assembly reduces 178888780 bytes to 137303008 bytes, saving
41585772 bytes (39.66 MiB), or 634 rounded 64-KiB initrd pages. Independent
decompression compares the entire tail byte-for-byte with the previous result,
including all extras and the init overlay. The original root gzip hash and all
43 input/tool pins remain unchanged. Source identities and 21 protected process
identities pass; the measurement owner is reaped.

This trades preparation CPU for a smaller copied initrd: single host observations
were 1.947s before and 3.255s after, with maximum RSS 705964 KiB. These are not
controlled speed measurements or phone RSS savings. This reduction alone does
not explain or solve the previous full-phone boot deficit. Kernel extraction
and full startup must be tested separately; packaging-time precompression may
avoid repeated preparation work later. Evidence is under `compressed-extras-red`,
`compressed-extras-green2` and `compressed-extras-measure` in the Android evidence
directory.

The first checksum-only kernel gate never launches: its owner rejects CPU
admission before runtime. A separate postfailure audit sees eight affinity CPUs
but an ancestor quota of 2.4 CPUs; an earlier Node concurrency reading of eight
was from another context. The failed owner's exact operands were not retained,
so those separate readings cannot establish runtime CPU equality. One syntax
check passes, all 53 pins and 21 protected identities remain unchanged, and the
owner is reaped. Kernel extraction remains untested; do not equate offline byte
equivalence with actual boot acceptance. Retain CPU/resource guards when moving
this diagnostic to a matching execution context or the phone's Brave browser.

## Packaging-time extras compression

### Cold-download copy reduction

The integrated Brave14 run still reaches the phone's memory floor during
initramfs extraction: 937.07 MiB available, 12.373 seconds after navigation.
No Firefox window or native identity appears. This identifies the failing
phase, not a kernel OOM cause. All owned resources are cleaned up and the
user's browser, data, display and preview remain preserved.

Two additional source-level allocations are now addressed test-first:

- The verified immutable image Blob is shared by the cache and the returned
  Response, rather than creating the cache Blob and another byte-body copy.
- Downloads write each chunk directly into one correctly sized output buffer.
  Parallel ranges use disjoint views into that same buffer, avoiding retained
  chunk lists, separate assembled segments and the final concatenation copy.
  Truncation and excess data fail; reader locks are released and overflowing
  streams cancelled. Existing checksum and update-choice checks remain.

Actual RED results are two failures/one pass for Blob sharing and four failures
for the downloader. GREEN2 passes 46 tests and four syntax checks, including
all seven new regressions. The first combined run misses a dynamically imported
panel module in its test harness and is retained as a failed admission; the
corrected run pre-pins all actual imports. A supplementary TAP-count audit is
also corrected without rerunning tests.

These tests establish allocation/retention behavior, not mobile RSS savings.
Private staged assets and a fresh Brave15 owner are being verified. The next
phone test uses the user's requested 2 GiB guest setting while retaining the
1 GiB available-memory floor, 2 GiB admission minimum and original benchmark
deadlines. This differs from Brave14's 1 GiB guest setting and is not a
controlled same-configuration performance comparison. The live preview has
only received the default-RAM change, not these memory optimizations.

### Integrated Firefox candidate

The private `mobile-package/candidate` now combines the reviewed compressed
extras loader and isolated exec-context retention repair with the frozen
Brave13 runtime. Its existing isolated framebuffer lifetime repair remains
unchanged; the unaccepted worker-pool changes are excluded.

Five staging tests preceded implementation. The combined host gate passes
38 JavaScript tests and three syntax checks. Independent actual packaging
review verifies 633 routes: five changed and 628 unchanged. Main has exactly
two loader edits, worker exactly three retention edits, the root archive is
unchanged, and the extras gzip decodes to the byte-identical original CPIO.
All 646 input pins and 21 protected process identities remain unchanged.
The packaging job is terminal and released, without browser execution or
deployment. These checks do not establish Firefox startup or JIT acceptance.

A fresh Brave14 disabled-control owner is being admitted for the full Firefox
test on Android. It retains the original benchmark and deadlines, 1 GiB guest
RAM, 2 GiB phone admission and 1 GiB available-memory floor. Separate enabled
identity regression tests are preparation only; the running candidate's
identity helper remains frozen until release.

The extras packager now writes the original CPIO, a deterministic level-six
gzip companion, and a schema-one manifest binding both sizes and SHA-256 hashes.
Stage all three together before publication. The existing default raw API is
unchanged. Compressed Firefox boots explicitly select the companion when its
metadata exists; old manifests retain the runtime-compression fallback. Invalid
selected metadata, truncation or checksum mismatch fails instead of silently
using another payload. Raw/GPU-overlay paths do not select gzip descriptors.

Assembly preserves the exact root gzip and packaged extras gzip, aligns each,
and appends the existing raw init overlay. It does not recompress the extras.
Six new JavaScript tests and three packaging tests preceded implementation.
Fresh GREEN passes 33 JavaScript tests, three Python tests and four syntax
checks; all 44 pins and 21 protected identities remain unchanged.

Private packaging of the actual extras preserves all 189 members and reduces
the downloadable body from 59,997,184 to 18,342,831 bytes: 41,654,353 fewer bytes
(39.72 MiB). The assembled candidate is 137,234,428 bytes, with independently
verified root, extras and overlay equivalence. Its SHA-256 is
`0f1347b8c764a0c103a60029c6c2424fad0a25e1f9e2239b881b58b134e2d505`.

One sequential host file-stream observation took 3.294 seconds with runtime
compression and 1.713 seconds with packaged gzip; Node maximum RSS was
612,192 KiB across both runs. This is not a controlled benchmark, measured
HTTP throughput, phone-memory saving or Firefox startup result. No production
assets or persistent preview were replaced. Evidence is under
`/mnt/p3/codex-build/gpt6-android12/precompressed-extras-measure/`.

A separate checksum-only Brave kernel test is prepared to verify real extraction
of these bytes before attempting another complete Firefox boot. Its diagnostic
rdinit verifies every manifest member and powers off without mounting user home
or launching Firefox/GPU. Three test-first host controls cover archive/alignment
preservation, unsafe inputs, nonce/CPU markers and complete checksum results.
Those controls are not actual kernel acceptance; runtime evidence is separate.

The first actual Brave kernel run starts eight CPUs and reaches the console
handoff, but the diagnostic recorder fails because browser `TextDecoder` rejects
shared-memory views. It captures zero of 189 checksum results. This is not proof
of an extraction failure. The main application already uses `nonSharedBytes`;
the repaired diagnostic now reuses that helper, with a new shared-subview and
split-UTF-8 regression written first. The failed run and old helper are retained.

The early kernel reports 900,096 KiB available and 137,408 KiB reserved, versus
859,456 KiB available and 178,048 KiB reserved in Brave13's one-GiB guest: initial
reservation falls by 40,640 KiB (39.69 MiB). This is an observed guest boot-memory
improvement, not an end-to-end phone RSS or startup result. Minimum sampled phone
available RAM is 1,961.53 MiB; no resource guard trips. Owner duration is 37.728s,
not a successful launch time. Before-work phone/browser/guest CPU counts match
eight; post-work thread admission is unavailable after the capture failure.

Main reviews the actual idle image and failed raw log. All 652 pins and 22
protected processes remain unchanged, with the exact target closed, prior tabs,
Brave main, mappings, previews and `:13` preserved. No completion image exists.
Evidence: `precompressed-kernel-phone1/` and `precompressed-kernel-phone1-audit/`
under the Android evidence directory. A new owner, not a rerun of the terminal
directory, is prepared for testing the recorder repair.

The second Brave run passes the real kernel extraction gate: all 189 member
checksums, exact nonce markers, and eight phone/browser/guest CPUs before and
after execution. Main views both actual idle and completion images. Its
13.207-second page duration includes download, hashing, boot, checksums and
shutdown; it is not Firefox startup. Minimum sampled phone available RAM is
1,367.94 MiB, above the unchanged one-GiB floor. Initial guest reservation is
137,408 KiB, and the kernel subsequently frees 134,016 KiB of initrd memory.

All 653 pins and 39 served route identities match. The owner exits zero, its
session and endpoints disappear, and the exact target closes while prior tabs,
Brave main, mappings, `:13`, dev HTTP and 21 owner-baseline protected processes
remain. One additional preflight Node process disappears before owner startup;
its origin and exit cause are unknown. Do not claim every preflight process
survives. An initial offline audit also uses text-mode newline normalization
incorrectly; a separate comparison establishes exact equality of the 13,445 raw
log bytes. The failed audit is retained and the runtime is not repeated.

Evidence: `precompressed-kernel-phone2/` and its `-audit/` sibling. Main's review
is `gpt6-codex-main-review.json` in that audit directory. This accepts kernel
extraction only. Full Firefox startup/JIT/GPU, integration through the actual
application loader, performance targets and deployment remain unaccepted.
