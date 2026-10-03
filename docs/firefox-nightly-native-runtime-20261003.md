# Nightly static native runtime adapter — 2026-10-03

Nightly159's final native browser link lacked `__cxa_thread_atexit_impl`,
`_Unwind_Backtrace`, `_Unwind_GetCFA` and `_Unwind_FindEnclosingFunction`.
The new adapter supplies these interfaces without editing upstream musl or
LLVM runtime source. This packet establishes real guest runtime behavior;
it does not establish Nightly browser startup, JIT or GPU acceptance.

Each thread owns a LIFO list of destructor registrations. The destructor is
popped before invocation, allowing callbacks to register additional work in
the same drain. `pthread_once` creates a cleanup key, with allocation and key
errors returned to the caller. The browser is statically linked, so there is
no native shared-object unload requiring DSO pinning.

Browser-only `--wrap=__pthread_tsd_run_dtors` drains the list after pthread
cleanup handlers and before musl's ordinary key destructors. This covers thread
return and explicit `pthread_exit`; a pthread key also supplies fallback cleanup.
`--wrap=exit` runs main-thread TLS destructors before process `atexit` handlers.
The three actual expanded make/driver rows select these wrappers and the new
archive for Firefox, plugin-container and xpcshell. gfxtest retains its existing
link settings. No upstream runtime source or immutable sysroot is altered.

LLVM's real Wasm exception/personality/throw implementation remains linked.
Wasm owns its execution stack and this guest ABI has no native frame walker:
`_Unwind_Backtrace` returns `_URC_END_OF_STACK` without invoking callbacks;
CFA and enclosing-function queries return unavailable values. Consequently
native Rust backtraces remain empty. The adapter supplies no fabricated frames
and does not replace exception raising with a successful no-op.

The new fixture runs against the actual native libc++, libc++abi and libunwind
archives in a real Linux-Wasm guest. Four concurrent workers cover both exit
paths, cleanup-before-TLS, reverse registration order, registration during a
destructor, thread isolation and TLS-before-ordinary-key ordering. Main exit
checks TLS-before-process-atexit. It also checks the unavailable-backtrace
contract and retains every case in the prior 100-case typed-exception fixture.

Results under `firefox-nightly-musl-recovery-20261002/native-runtime-link`:

| Run | Runtime checks | Exception checks | Meaning |
| --- | --- | --- | --- |
| guest-run1 / guest-build-run2 | 20 pass, 0 fail | 100 pass, 0 fail | Correct adapter/wrappers |
| guest-run2-negative / guest-build-run3 | 16 pass, 4 fail | 100 pass, 0 fail | Only thread cleanup wrapper removed |

The negative control observes ordinary-key cleanup before TLS in all four
workers, demonstrating that the fixture detects the ordering bug. Both runs
record host/browser/guest CPU count6, kernel SMP6 and 1GiB guest memory. Fresh
owned Chromium processes and loopback servers exit cleanly with empty groups.
All 3,847 other archive records remain byte-identical to the prior isolated
test image. Only its test executable changes; no production image is promoted.
The accepted adapter object is byte-identical to the object executed in the
passing guest. Read-only review passes7,815 predicates, including complete
archive comparison and actual browser-only link scope.

Replay the fixture with fresh output names:

```sh
python3 -B tools/nightly-musl/probes/native-runtime/build.py guest-build-run4
TMPDIR=/mnt/p6/build/firefox-nightly-musl-recovery-20261002/tmp \
TMP=/mnt/p6/build/firefox-nightly-musl-recovery-20261002/tmp \
TEMP=/mnt/p6/build/firefox-nightly-musl-recovery-20261002/tmp \
node tools/nightly-musl/probes/native-runtime/run-guest.mjs runtime \
 /mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-runtime-link/guest-run3 \
 /mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-runtime-link/guest-build-run4
```

The first replay failed an archive-count assertion after compilation; actual
inventory has3,848 records including the trailer, and3,847 unchanged records.
Its outputs remain preserved. The accepted second build uses the measured
count. The negative runner intentionally returns exit1 with the four recorded
guest failures; its result is not positive acceptance.

Run45 stopped at the task guard while three raw browser links allocated about
7.3GiB of temporary output. Task caps20→22→32GiB were reported before each
increase; the20GiB free-space reserve remains enforced. Its historical stop
string still says20GiB even though the active cap was22GiB; subsequent runner
messages use `authorizedTaskLimit`. Run46 is the bounded j4 retry. Its compiler
wrapper runs Binaryen `-O2` after linking; this is not the mandatory later
23-slot fpcast transform. Inspect its live handle before further source edits.

Next: finish the full browser build, freeze/validate actual binaries, inspect
the ABI, apply fpcast exactly once, package the complete current runtime and
prove guest startup/TLS/home/default-page behavior. Then build the complete
coherent PBL/JIT browser per the existing full-build plan. Public Sitesv10
remains unchanged until actual Nightly JIT acceptance.
