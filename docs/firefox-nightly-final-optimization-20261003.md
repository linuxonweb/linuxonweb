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
