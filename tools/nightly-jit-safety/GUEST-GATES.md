These files prepare real Firefox Nightly159 gates. Host tests establish only
checker behavior and syntax. A prepared session without a reviewed final build
binding is `pending` and cannot pass an actual gate.

After the sole build owner completes the fresh full graph and package review:

1. Freeze a `caller-reviewed-full-nightly-jit-build-binding-v1` JSON record.
   `prepare-session.py --help` describes its input; the checker requires the
   actual final binary, source archive, runtime manifest, kernel, build review,
   four adopted observer hashes, application/platform/local BuildID, wasm32
   native-musl target, 23 environment slots and the restart-only portable tier
   preference. `broadCoverage` must reflect the reviewed build.
2. Prepare fresh disabled and enabled session directories with
   `python3 tools/nightly-jit-safety/prepare-session.py --out TASK/ARM --label LABEL --arm disabled|enabled --build-binding REVIEWED_BINDING`.
   TASK must be under the bounded guest-gates preparation root. Install each
   directory at `/home/admin/nightly-jit-safety/LABEL/` in its own fresh boot
   package. Merge its `user.js.fragment` before Firefox starts. Use the same
   final binary for both arms; the portable tier option is restart-only.
3. Use the reviewed bounded guest runner, rereading actual host CPUs at each
   boot. Host, outer browser, selected guest, raw kernel SMP and inner Firefox
   hardwareConcurrency must all agree. Enable `PBLJIT_OBSERVE=1` for safety;
   retain direct, unrotated stderr from Firefox and all inherited content
   processes at that session's `observer.stderr`, capped at 2MiB. Preserve a
   combined native-stderr/actual-fixture-console transcript in observed order.
   The owned runner must impose the session's 150-second outer deadline and
   retain real exit, cleanup and raw CPU/startup evidence.
4. In the actual Browser Console, execute the exact expression in the prepared
   `browser-console-expression.txt`. The driver registers actors only for its
   exact owned file URI. A child actor runs the privileged calls in the target
   process; a parent actor performs tightly scoped file I/O because this
   Nightly's IOUtils crashes outside the parent process. Local and remote tabs
   use the same bridge. Missing APIs or evidence report pending; measured
   identity/option/CPU mismatches and operation failures fail.
5. Retain `session-result.json`, each required `*-console.txt`, both raw logs,
   CPU/startup records, binding and every installed fixture/driver file.
   Independently review actual execution provenance and freeze an acquisition
   JSON of kind `caller-reviewed-actual-nightly-jit-session-acquisition-v1`.
   Its `artifacts` maps `contract`, `result`, `binding`, `cpu`, `startup`,
   `combined`, `observer`, the four scope names for enabled, and `file:NAME`
   for every installed source to absolute `{path, sha256}` records. Then run
   `python3 tools/nightly-jit-safety/check-session.py --acquisition RECORD --review-sha256 REVIEWED_SHA --out TASK/actual-session-check.json`.

Enabled requires all fourteen broad admissions, seven actual Bail exits, two
fallback and two policy cases in both main and Worker, distinct Worker thread
and actual inherited option evidence, then GC/debugger/coverage, incremental,
slice-GC and interruption scopes. Disabled requires all fifty exact semantic
results, false actual startup/Worker options and zero installations.

Native observation is bounded at 4096 owned-source events per process; option
observation is bounded at 64 events per site per process. Exhaustion markers,
boundary counts and unknown native result kinds fail the evidence gate.
The generated-module hot hook acquires no new JS, GC or runtime callbacks.

Cancellation requires a real native Interrupt, actual callback-abort and
subsequent calculation in the same window/process. The same-thread infinite
loop relies on Firefox's real slow-script machinery; JavaScript query timers
cannot preempt it. A query timeout or outer-watchdog termination cannot pass
cancellation. Actual recovery and cleanup remain unverified until guest runs.

A session pass is scoped evidence only. Array bounds/type and object shape/GC
mutation guards, native two-thread stack/TLS/syscall probes, baseline/update/
NSS/TLS/UI and all original eight same-binary ABBAAB comparisons plus the v10
comparison remain mandatory independent gates. Primary performance uses
diagnostics off. No session result accepts the full JIT, guest or Firefox GPU.
