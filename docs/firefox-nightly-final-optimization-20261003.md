# Nightly final optimization retry — 2026-10-03

The Run47/Run48 configuration below is historical. The latest retry is Run51,
described at the end, with the user's requested2GiB available-RAM floor.

The native-musl Firefox159 baseline is still incomplete. Run47's two concurrent
Binaryen `-O2` optimizers exhausted host memory: kernel evidence records the
death of optimizer2175585 and four Chrome processes. The plugin-container
driver reported `Killed`; the remaining build reached its1200-second bound,
terminated/reaped143, and owned PGID2173102 is empty. Build cleanup removed
the unfinished browser executables. This is neither a successful link nor a
browser/JIT acceptance result.

The user subsequently added swap; the host reported29GiB total, approximately
20GiB more than before, and explicitly requested another attempt. Run48 uses
`NIGHTLY_JOBS=1`, processing the three large browser programs serially. The
default phase duration remains1200seconds. The full-build-only
`NIGHTLY_BUILD_TIMEOUT_SECONDS` override accepts1200..7200 decimal seconds;
Run48 uses7200. Other phases reject the override. This preserves finite work
without repeatedly discarding optimization at20minutes. Optimization and
the required later23-slot fpcast transform remain separate operations.

The supervisor also applies these full-build bounds:

- inherited per-process virtual address-space limit24GiB;
- polled total owned-process-group RSS limit24GiB;
- stop when host available RAM reaches8GiB;
- at least24GiB host available RAM before launch;
- inherited `oom_score_adj=1000`, so a host OOM prefers owned build processes.

The latter two RAM observations do not count swap as available RAM. Additional
swap does not waive these limits. RSS polling is not a kernel aggregate-memory
limit. The configured CPU watcher moves compiler processes across cgroups, so
a transient scope alone would not retain an aggregate memory bound. No CPU
watcher setting, unrelated process, or swap configuration was changed here.
If actual optimization cannot fit the bounds, retain its failure evidence and
review a measured next step rather than restart unchanged indefinitely.

Disk-backed scratch remains in the recovery task. Its reported32GiB storage
allowance and20GiB free-space reserve remain unchanged. Prior runner/checker
bytes are retained under `status/build-run47-*.py`; the active recipe was
updated only after Run47 was terminal and its exact group was empty.

The retained terminal artifacts were directly reviewed:

- 4153 boundary checks pass: 3012/3012 native graph objects, unchanged reviewed
  generated graph, all 552 inttypes consumers naturally regenerated, pinned
  native Rust archive with 7101 Wasm object members. The two driver error
  records from the killed optimizer are explicitly retained.
- 1533 Pixman checks pass: 763/763 actual header consumers coherent.
- 18 supervisor preparation checks pass, including a real isolated child
  inheriting 24 GiB RLIMIT_AS and OOM priority, rejecting an oversized virtual
  mapping without allocating host RAM, actual `/proc` readers, and timeout
  defaults/range/invalid-input/scoping checks. This is supervisor preparation,
  not complete Firefox execution.

Evidence is bound in `tools/nightly-musl/evidence/final-optimization-retry.json`.
Run48 is live when this packet is recorded: owned PGID2237710, unified session
72143; first optimizer PID2240018. Its live `/proc/limits` and
`oom_score_adj` match the configured values. The status/log paths are:

```
/mnt/p6/build/firefox-nightly-musl-recovery-20261002/status/build-run48.json
/mnt/p6/build/firefox-nightly-musl-recovery-20261002/logs/build-run48.log
```

Poll that exact handle/group before further build or active-source/recipe
changes. A changing status file alone is not proof of a live process. Freeze
terminal build evidence after the group exits; review actual current binaries,
strip/fpcast separate copies, package the entire current runtime including
transformed helpers, and run the full baseline guest gates. Then follow the
separate fresh whole PBL/broad-JIT build and acceptance plan. No old128 object
substitution, reduced JIT admission scope, GPU acceptance or Sites release is
established here. Public v10 remains unchanged.

## Run49: original optimizer, more swap, requested memory limits

Run48 stopped at its former8GiB available-RAM floor after about14minutes,
exit143. The parent exited while optimizer2240018 remained live in the owned
group; a targeted SIGKILL cleared that group. Its terminal native artifacts
pass4152 boundary checks and1533 Pixman checks:3012/3012 native objects,
552/552 inttypes consumers,763/763 Pixman consumers, unchanged pinned native
Rust archive. These retained artifacts do not establish a finished browser.

The user added swap again, requested the previous optimizer, lowered the RAM
floor to2GiB and allowed higher resident memory. The host now reports59GiB swap.
The source link adapter remains unchanged: no stripping or `--no-wasm-opt`
change was applied to the build. Run49 keeps the actual compiler-driver
`wasm-opt ../../dist/bin/firefox -O2 -o ../../dist/bin/firefox` operation.

Run49 usesj1,7200seconds,48GiB virtual address space and32GiB polled group
resident memory. The available-RAM stop floor is2GiB. Full-build-only
`NIGHTLY_ADDRESS_SPACE_GIB` accepts decimal24..48; default24.
`NIGHTLY_RESIDENT_MEMORY_GIB` accepts decimal24..32; default24. Preflight now
requires at least4GiB available RAM and available RAM plus free swap at least
the selected address-space bound plus2GiB. Swap can support virtual allocation;
resident memory and host available RAM remain separate live checks. Disk
allowance32GiB and free-space reserve20GiB remain unchanged.

The supervisor now waits for all live process-group members when stopping,
even if the parent exits first. It escalates remaining members toSIGKILL and
verifies no live survivors. Normal parent exit also checks for remaining
children.33 actual preparation checks pass, including a real parent which
exits onSIGTERM while its child ignoresSIGTERM, bounded escalation, real
isolated24/48GiB limits with oversized mappings rejected, a30GiB untouched
virtual mapping admitted under48GiB, RAM/swap readers, preflight boundaries,
and override validity/scoping. No physical30GiB allocation is performed.

Live observation verifies optimizer2300129, owned PGID2297842, inherited48GiB
RLIMIT_AS and OOM priority1000, original-O2 argv, and actual supervisor32GiB
resident/2GiB RAM settings. Unified session34812; status/log are the same task's
`status/build-run49.json` and`logs/build-run49.log`. Evidence and source hashes
are bound in`tools/nightly-musl/evidence/original-optimizer-swap-retry.json`.
Recheck exact live handles before further changes. Nightly full-build, guest,
JIT, GPU and deployment acceptance remain pending; public v10 is unchanged.

## Run49 terminal; Run51 with user-requested additional RAM

Run49 exited2 after20minutes. Original Binaryen-O2 aborted; the supervisor did
not stop it for RAM, disk or time. The exact group2297842 is empty and the
unified handle34812 was reaped. No final Firefox/plugin-container/xpcshell
remained. The last direct optimizer observation showed50,252,488KiB virtual
usage (about47.9GiB), close to its48GiB inherited limit. Allocation failure is
an inference; the log has only the driver's abort diagnostic and no definitive
allocator report or retained backtrace. Kernel evidence shows no new OOM kill.
The retained build boundary passes4152 checks and Pixman1533checks, including
all3012 native objects,552 inttypes and763 Pixman consumers. The Rust archive
remains pinned. The two driver errors are retained, not suppressed.

The supervisor now accepts24..64GiB virtual address space and24..48GiB resident
memory for full builds; defaults remain24GiB each. It records peak observed
per-process virtual usage to distinguish future limit pressure. Full-build
children inherit a zero core-file limit, avoiding huge system-managed dumps
outside the disk-backed build task. Actual guard tests pass39checks, covering
24/48/64GiB inherited address-space limits, zero core limits, oversized mappings
rejected, untouched30GiB virtual mappings admitted under48/64GiB, RAM/swap and
largest-live-process virtual usage readers, absent groups, override boundaries
and phase scoping, preflight boundaries and real descendant cleanup. These
checks cover supervisor behavior, not Firefox/JIT behavior.

Run50 initially started at64GiB AS/32GiB RSS. The user then requested more RAM;
the early retry was explicitly stopped to change the loaded supervisor.
It terminated/reaped143, group2360265 is empty, with4152 native and1533 Pixman
retained checks passing. This was a configuration change, not an optimizer
failure. Its previous supervisor source is preserved under
`status/build-run50-run-phase.py` before installing the current source.

Run51 is live: owned PGID2368654, unified session1600, j1,7200seconds,
64GiB inherited virtual allowance,48GiB polled group RSS threshold, and2GiB
available-RAM floor. The host has approximately39GiB physical RAM;48GiB is a
stop threshold, not a reservation or physical-memory allocation. The available
RAM floor protects that physical reserve. Additional swap supports virtual
allocation. Preflight still requires4GiB available RAM and available RAM plus
free swap >=selected AS+2GiB. Storage policy remains32GiB task/20GiB reserve.
The original-O2 operation, upstream Firefox source and link adapter remain
unchanged. Do not restart or change the active recipe on an observation timeout.
Reap Run51 and verify its exact group empty before freezing terminal evidence.

Evidence is bound in`tools/nightly-musl/evidence/optimizer-virtual-memory-retry.json`.
No final optimized size, complete Nightly runtime, baseline guest, JIT, GPU or
Sites acceptance is established. Public v10 remains unchanged. The next stages
remain full current-source baseline/package/guest acceptance, then the separate
fresh whole broad-PBL/JIT build and acceptance, then GPU.


## Run51 interrupted by reboot; retained artifacts and Run52

The host boot changed from `1778b83986e6483a9183fcc2a02f4958` to
`80b2f373-8b98-45ed-9288-55ea9465c1c2`. Journal boot history ends the old
boot at11:47:50 PDT and starts the new boot at12:00:47 PDT. Exact old group
2368654 and optimizer2370793 are absent. The unified handle1600 no longer
exists. This is authoritative external interruption, not an observation timeout
or evidence of an optimizer allocation failure. Its exit code and precise
termination time cannot be recovered; no successful build is claimed.

The original stale running status is preserved byte for byte in
`status/build-run51-pre-reboot-status.json`. A separate reboot recovery record
captures boot history, group absence and the zero-byte incomplete executable.
The reconciled terminal status explicitly uses a null exit code, `reaped=false`
and an observation timestamp rather than an invented termination time.
Retained native artifacts pass4152 independent boundary checks and1533 Pixman
checks. All3012 graph objects,552 inttypes and763 Pixman consumers remain
coherent, with the unchanged7101-member Rust archive. The incomplete zero-byte
`dist/bin/firefox` was moved into owned status storage only after these checks;
otherwise a build might incorrectly reuse its fresh timestamp.

Run52 starts with the original automatic BinaryenO2 operation, j1 and7200s,
64GiB inherited address space,48GiB process-group resident threshold and2GiB
available-RAM floor. Current swap is60GiB, all free at launch; available RAM
was about36.7GiB. Storage32GiB/20GiB reserve and supervisor bytes remain
unchanged. Owned PID/PGID26369, unified session43377. Boot and launch metadata
are retained in `status/build-run52-launch-context.json`. The4GiB tmpfs limit
on `/tmp` survived the actual reboot. Current build scratch remains disk-backed.
No complete Nightly binary, optimized size, guest baseline, JIT, GPU or Sites
acceptance is established. Public v10 remains unchanged.

Actual optimizer27880 is live in group26369 with the unchanged original `-O2`
command, inherited64GiB address-space limit, zero core limit and OOM priority1000.
The live observation is retained in `build-run52-live-supervisor-run1.json`.
Reboot and new-run evidence pins are in
`tools/nightly-musl/evidence/optimizer-reboot-recovery.json`.

The actual Run52 compiler driver27489 response and Firefox object list were
captured while it waited for optimizer27880. All12 required native link flags
are present; the expanded argument list equals the captured Run49 list exactly.
This confirms the retry retained the link configuration; completed module
validation and real browser behavior still require the finished artifact.
The capture and two unchanged input snapshots are bound in the recovery packet.

## Run52 original-O2 main: measured size and static validation

The main Firefox original automatic Binaryen `-O2` operation completed in
Run52. The raw debug-bearing executable is 2,335,263,664 bytes, SHA256
`d418d84a6e68ad569264a74721587aee1f7ceaa16a901d032a4990617034bf2f`.
A separately written `llvm-objcopy --strip-debug` copy is 176,370,407 bytes,
SHA256 `8c236b2d18a627f272ec9931cc84625dcb02dcf0abc8fa28a88d40e58db90a64`.
This removes 2,158,893,257 bytes (92.4%), precisely the six `.debug_*` sections.
All 16 retained section payloads remain byte-identical, including code, data,
types, elements, imports, exports and the retained non-debug custom sections.
Actual before/after raw hashes match. The active build's raw main was preserved;
its 2.335 GB debug-bearing size is not a final download size. The strip operation
finished exit 0 in 0.51 seconds under 12 GiB AS/core 0 and 180 seconds; its peak polled
RSS was 26,378,240 bytes. It wrote a separate disk-backed status artifact.

Actual `wasm-validate --enable-all` on this separate stripped original-O2 main
passes exit 0 in 15.03 seconds with unchanged input hashes. The actual running
child inherited 16 GiB address space and zero core limits. The bounded runner
uses 180 seconds,12 GiB available-memory admission and 4 GiB available-RAM stop
floor, with disk-backed scratch. Peak polled group RSS is 6,852,685,824 bytes
(6.38 GiB), minimum available RAM 12,347,465,728 bytes (11.50 GiB). Exact owned
validator PGID69632 is empty after reaping; its log is empty. Earlier validation
of the raw debug file under 8 GiB AS aborted with `std::bad_alloc`; its report
and diagnostic log are retained. That allocation diagnostic does not establish
module invalidity. The successful stripped validation and byte-identical
retained sections establish static validity of this measured main, while
browser behavior still requires guest acceptance.

Raw-main ABI inspection measures 238253 functions,238250 defined functions/code
bodies and 207620 element entries. Maximum element parameters is 23; maximum
parameters over all functions is 32. The raw table still contains mixed
signatures (`everyElementUses23I64ToI64=false`); passing the inspection without
`requireFpcast` does not accept the guest's 23-i64 indirect-call contract.
The actual imported shared memory has maximum 65536 pages (4 GiB), the exported
growable table starts at 207623 entries, and exported stack pointer initializes
to 8388608. Main and every required helper still need the actual fpcast
transform, transformed static/ABI validation and package/guest gates.

At the pinned read-only observation, Run52 remains running in owned PGID26369,
unified 43377. Plugin-container's original-O2 operation has finished and the
build log advances to xpcshell at 32:26.28, with its actual link running; later original-O2 optimizer 75550 is directly
observed. The full build retains j1/7200 seconds,64 GiB inherited AS,48 GiB polled process-group
RSS threshold and 2 GiB available-RAM floor; its main handle belongs to the
parent owner. These observations are progress, not terminal/reaped full-build
evidence. Recheck the exact group and mutable status/log before changes.

The size comparison's retained runtime is Firefox 128.14.0: the uncompressed
executable member is 157,967,665 bytes, SHA256
`f1b32608c447fd86bf0d7a9891b1de623c3609f3317e4ff6c4882d9841007d15`.
The gzip Firefox+Linux initramfs is 88,910,833 bytes, SHA256
`ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745`.
The actual local archive matches the boot manifest, baseline member inventory
and retained v10 deployment record. The new stripped main is 18,402,742 bytes
larger than the old executable member (about 11.6%); this compares executable
bytes, not gzip package sizes. No final new package/download size is measured.
Parent tool observation confirms current Sites v10 and source commit
`b9656d4705aa4f6a073fa1b7122acf53a728a7c1`. Public manifest retrieval returned 403;
no current public artifact bytes were fetched. The retained 178,196,480-byte
whole-Site source tar is a different artifact from either executable or gzip
runtime archive; its local SHA and server content hash have distinct recorded
semantics. Public v10 remains unchanged.

The compact provenance packet is
`tools/nightly-musl/evidence/nightly-size-and-validation-run52.json`. It pins
actual comparison sources, reports, logs, ABI inspector/source snapshot,
validator/tool identities, retained manifest/inventory/deployment record and
launch metadata. Large module hashes come from pinned actual measurement
reports; this documentation pass verifies their bindings and file sizes
without repeating the multi-gigabyte raw hash. The current Sites observation
and 403 are parent-reported tool observations, not fresh downloaded-file pins.

The user subsequently requested stopping this still-incomplete Run52 and
rebuilding without debug symbols now. The owned group received SIGTERM;
actual child status records exit -15 and the parent reaped unified43377 with
wrapper exit143. Exact PGID26369 is fully empty, confirmed by the retained stop
record and a fresh read-only group check. Completed main/plugin remain; build
cleanup removed interrupted xpcshell. This stop is a requested configuration
change, not optimizer failure or full-build success. The next owner freezes
retained artifacts, reconfigures without debug, verifies actual compiler flags
and dependency coherence, and checks scoped linker debug stripping before
original-O2. No optimizer-RAM benefit is measured or promised.
After the actual no-debug rebuild, record its final Firefox binary size and
absolute path in repository `diary.md`, with important lessons/mistakes learned;
this mandatory user-requested followup remains pending. The prior configuration
had `--disable-debug` but omitted `--disable-debug-symbols`, and debug-section
composition was overlooked before repeated O2 retries. Inspect actual section
sizes and compiler/link flags before repeating massive optimizers. The measured
92.4% metadata-removal size benefit does not measure optimizer code-work or RAM
benefit; keep those claims distinct.
Current stripping preserves the completed main. Full-build,
all-main/helper strip/fpcast/package validation, baseline guest, fresh whole
broad-JIT browser acceptance, GPU and both authorized Sites releases remain
pending. This packet accepts only the measured static main validation.
