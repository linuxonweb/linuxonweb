This packet prepares separate latest-Nightly integer safety fixtures. It has
not run Firefox, a guest, a browser build, or a deployment. Node semantics and
synthetic log regressions are preparation only. The accepted baseline/full PBL
build, native primitive/fpcast probes, exact build identity, startup SMP,
browser/TLS regressions, comparative timings and release gates remain required
by `firefox-nightly-full-jit-build-plan-20261002.md`.

The new scoped tools are in `tools/nightly-jit-safety`. `generate.mjs` writes
fresh files under `/mnt/p6/build` only. A run label identifies separate static
source filenames for each of nineteen cases in the main browser thread and an
actual Worker; both contexts execute sixteen repetitions. Each function starts
at line1. Required admitted functions have no arguments and use var locals with
4096 or4097 loop heads. The known results are independent constants.

| Claim | Cases | Required real evidence |
| --- | --- | --- |
| Integer compilation | sum, branch | Successful source-specific install followed by Normal run |
| Integer bailout/restore | overflow, negzero, modzero, modnegative, modoverflow, typechange, stackrestore | Successful install followed by Bail from that source, plus exact final semantics |
| Excluded correctness | typenonnumeric, argument, double, lexical, array, property, math, call | Source-specific rejection and no install/run/bail/NoEntry for that source |
| Policy exclusion | handler, throw | Correct semantics; positive policy rejection observer still pending |

The double type change is produced by Int32 addition overflow. Arbitrary string
type changes and a double literal inside a loop remain excluded. Division is
absent from the initial42-op whitelist and is not used to claim a compiled type
change. Stack restoration places a pending outer addition on the operand stack
when the inner addition overflows. Negative-zero and modulo cases use
`Object.is`-equivalent serialized `-0`/`NaN` values. Semantic success alone
does not establish SP/PC/IC correctness on every path or native TLS/stack ABI.

`check.py` consumes retained raw guest logs, not compilation claims supplied
in a result manifest. It binds observations to filename/line, case start/end,
installed function index, epoch, actual pthread identity and TLS cache address;
it requires main/Worker identities to be distinct. Reject observations require
valid TID/TLS/epoch fields, permit an uninstalled `fn=0`, and must belong to that
context's independently proven source-specific install/Normal-run identity.
Missing identity fields or a rejection from the other context cannot establish
exclusion. `--scope smoke` requires
compile/run proof for sum and branch and semantics for all cases, while reporting
the remaining proofs individually. The default integer scope requires every
case's proof and currently refuses full success because handler/throw policy
rejection occurs before OnLoopHead and has no positive observer. Every result
explicitly sets `fullJITAcceptance:false`. Neither mode validates build/CPU
identity or substitutes for the other full acceptance gates.

Current selected adapter compile lines prove successful private-syscall install,
but its run/bail stats are process-wide, emitted only at power-of-two compile
counts, without source/thread identity. They cannot satisfy this checker.
`prepare-observer.py` generates an **unapplied** proposed adapter/PBL overlay
and unified patches against the selected preparation. It records exact input
and output SHA-256 values and fails any changed anchor. No existing source or
preparation files are edited. Future integration must rerun against the newly
rebased full-build preparation and review changed hashes; it must not replace
current full-build source with old copied files.

The proposed observer uses a4096-record atomic budget, enabled only by
`PBLJIT_OBSERVE=1`, and fixed32-slot thread-local skip deduplication. An explicit
source filter requires `file:///home/admin/nightly-jit-safety/` before consuming
budget. Startup scripts cannot exhaust the fixture budget. Disabled observations
return before filename filtering, epoch reads or TLS skip bookkeeping. It records
actual install, Normal/Bail/NoEntry/Interrupt, major-epoch eviction, active
incremental-GC skip and real PBL debuggee/coverage skips. The record includes
source, loop offset, actual Linux `SYS_gettid`, `pthread_self`, TLS cache address, major epoch, installed
index, exit kind and real SP/PC/IC outputs. NoEntry output storage is unread.
There are no JS calls, observer callbacks, stack walks or new heap allocations;
stdio and the thread-ID syscall use the existing diagnostic/syscall pattern. The patch has not been compiled or
executed. Captured events stop at the budget, so missing evidence fails. Logging
adds overhead; comparative performance arms need the same setting, preferably
disabled. The observer is diagnostic preparation and does not widen admission.

`privileged-driver.js` supplies concrete Browser Console operations against a
directly accessible **actual guest fixture content window**. It refuses missing
content access. It calls Cu.forceGC, reruns the previously installed sum helper,
attaches Debugger to both previously compiled and fresh helpers, sets actual
breakpoints, steps and reads numeric locals, and collects actual nonzero
getOffsetsCoverage results in a separate coverage session. Raw observer evidence
must independently show major-epoch eviction/recompile and skip exclusions;
the driver's own `ok` records cannot prove them.

The optional separate interrupt operation temporarily sets the current browser's
`dom.max_script_run_time=1` and `dom.always_stop_slow_scripts=true`, schedules the
integer infinite helper in an actual content timer without Debugger, then checks
a following calculation in the same content window, restoring preferences.
Nightly's current `nsGlobalWindowInner.cpp` uses that latter preference in the
actual slow-script interrupt path. An install followed by generated Interrupt,
actual browser termination and bounded same-process recovery must all be
observed. Window.stop, Worker.terminate and VM/process killing are not used as
interrupt proof. This driver is syntax checked but **unverified**; single-process
content access, guest Browser Console automation, CSP/injection, slow-script timer
delivery, remote-content actor transport and recovery behavior remain pending.
Verified incremental-GC driving, positive handler policy observation and native
pthread/TLS/errno/stack-canary callbacks remain unimplemented. The initial checker
does not yet accept privileged records as a complete gate.

Reproduce preparation into fresh destinations:

```bash
export TMPDIR=/mnt/p6/build/firefox-nightly-jit-guest-safety-prepare-20261002/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR" PYTHONDONTWRITEBYTECODE=1
node tools/nightly-jit-safety/generate.mjs \
  /mnt/p6/build/firefox-nightly-jit-guest-safety-prepare-20261002/fixture-run2 safety-run2
python3 -B tools/nightly-jit-safety/prepare-observer.py \
  --overlay /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/overlay-run4/overlay \
  --out /mnt/p6/build/firefox-nightly-jit-guest-safety-prepare-20261002/observer-run5
node tools/nightly-jit-safety/test-semantic.mjs
python3 -B tools/nightly-jit-safety/test-contract.py \
  /mnt/p6/build/firefox-nightly-jit-guest-safety-prepare-20261002/fixture-run2
node --check tools/nightly-jit-safety/privileged-driver.js
```

After complete-build/fpcast/package acceptance, verified observer integration
and native guest prerequisite gates, transfer all generated fixture files to
`/home/admin/nightly-jit-safety/safety-run2/` in the isolated candidate guest.
Open `file:///home/admin/nightly-jit-safety/safety-run2/safety-run2.html` in that
guest Firefox with `PBLJIT_OBSERVE=1` and an adequate existing `PBLJIT_LOG` budget.
The host harness must use the shared host CPU helper before every boot, retain
startup SMP immediately, reread nproc after every phase and at run end, and reject
drift or disagreement; no fixed count is allowed. It must bind the actual
Nightly application/platform/local BuildIDs and complete runtime/archive hashes.
The old128 safety runner's broad compilation requirements cannot be used here.
The transport/boot runner remains an explicit integration step; this packet
does not launch it or claim the generated files are installed.

Check the actual retained raw log after that transport completes:

```bash
python3 -B tools/nightly-jit-safety/check.py \
  --fixture /mnt/p6/build/firefox-nightly-jit-guest-safety-prepare-20261002/fixture-run2 \
  --logs /mnt/p6/build/firefox-nightly-jit-guest-safety-prepare-20261002/guest-run2/guest-logs.txt \
  --out /mnt/p6/build/firefox-nightly-jit-guest-safety-prepare-20261002/guest-run2/smoke-evidence.json \
  --scope smoke
```

Retained selected preparation is `fixture-run1` (label `prep-run1`) and
`observer-run4` under the task directory; earlier observer revisions remain
retained. `result-run2.json` records304 Node semantic assertions,40 synthetic
checker contracts, seven syntax checks and five observer structural checks.
None establishes source-specific Nightly execution or compiles the observer.
`manifest-run2.json` freezes the scoped tools, documentation and retained
preparation inputs/results. Earlier `result-run1.json` remains historical.

The preparation allowance is2GiB, with20GiB free-space reserve. All outputs and
temp storage remain disk-backed in the task directory. Existing baseline trees,
public Sites v10 and user services are preserved.
