# Nightly final optimization retry — 2026-10-03

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
