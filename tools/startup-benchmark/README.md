# Bounded startup evidence

The user authorized continued testing with a host available-RAM floor of 1 GB
and persistent Xephyr display `:13`. The probe uses a conservative 1-GiB
`MemAvailable` floor sampled every 500 ms, rather than the former six-GiB
hard aggregate cap. This is a sampled guard, not hard memory containment.
Baseline1 showed that the system CPU watcher moves processes between cgroups;
the probe now tolerates migration while checking actual CPU affinity/quota
and reporting memory independently. Shared host policies remain unchanged.
Historical failed containment evidence remains under
`/mnt/p3/codex-build/gpt6-launch-runtime12/baseline1-audit/`.

`gpt6-codex-owner.test.mjs` checks CPU-quota ancestry, current-log guest CPU
identity and private-server route validation. Run these before the browser
owner. They are not Firefox acceptance tests.

`gpt6-codex-android-cpu.test.mjs` covers the Android cgroup-v1 root exception:
the initial cgroup namespace, complete CPU-controller mount, root membership
of every sampled thread, and matching online/browser/cpuset/affinity counts
are required. Linux 4.9's reserved initial namespace inode can establish the
namespace when Android denies reading PID1. Missing quota files or an absent
kernel-config symbol alone never establish unlimited CPU capacity.
The kernel definitions are in
[proc_ns.h](https://github.com/torvalds/linux/blob/v4.9/include/linux/proc_ns.h)
and [sched/core.c](https://github.com/torvalds/linux/blob/v4.9/kernel/sched/core.c).
This admission is not a performance measurement; guest CPU logs still need
to match, and phone/host available RAM must stay above the one-GiB floor.

`gpt6-codex-android-snapshot.mjs` collects thread affinity/cgroup records with
one filename-labelled `grep` batch rather than per-thread processes or
per-line shell reads. The earlier collector took 4.08 seconds for 54 threads on the
connected phone, exceeding the capture budget. The parser requires complete,
unique records and an explicit read error before retrying missing data for a
vanished thread; unknown command errors fail. It joins
the parent PID/start ticks and before/after thread sets. The owner retains each
raw attempt before parsing and validates every complete observed thread even
when the set changes. Only explicit thread disappearance or a changed set is
retryable: at most five attempts within a two-second observation budget, with
25 ms between attempts. This budget is checked around each bounded transport
call; it cannot interrupt a synchronous ADB call already in progress. Missing
live-thread data, malformed output, process identity changes, real CPU limits
and transport errors fail closed. No retry resets the benchmark deadline.
Thread-set formatting also accumulates strings before printing: Android's
shell resolves `printf` to `/system/bin/printf`, so calling it for every TID
spawns a process each time. In a read-only four-capture phone comparison,
two original captures took 2519.710/2574.914ms and two compact captures took
325.825/342.007ms with identical 53-thread transcripts. This is collector
timing, not Firefox startup or JIT performance. Output buffering alone was
tested and rejected because it did not remove those external calls.
These are sampled snapshots, not atomic or continuous CPU-state guarantees.

The October 12 probe uses a pinned snapshot receipt at
`/mnt/p3/codex-build/gpt6-launch12/freeze-receipt.json`. Its routes and SHA256
hashes, rather than the working tree, select all baseline inputs. Candidate
runs normally copy and hash `web/linux/main.js`, `web/linux/desktop-extras.mjs`
and `web/linux/firefox-jit-config.mjs`
into the unique run directory; the optional pool overlays are described below.
Every other input remains frozen. Do not edit
an owner or candidate while its run is in progress.

From the repository, as user `a`:

```sh
node --test tools/startup-benchmark/gpt6-codex-owner.test.mjs
export DISPLAY=:13 XAUTHORITY=/path/to/persistent-display-authority
bash tools/startup-benchmark/gpt6-codex-run.sh baseline baseline13
bash tools/startup-benchmark/gpt6-codex-run.sh candidate candidate13
```

Run names must be new. These are cold-profile probes, not warm distributions.
They require the existing X display, Chromium/prime-run, user systemd, sudo
mount permission and existing read-only WebSocket proxy on port 3000. The
private HTTP server does not replace or modify persistent previews. It serves
only the frozen allowlist with the dev server's isolation/no-store headers.

Set `STARTUP_RAM_MIB=2048` to test the requested 2-GiB configuration explicitly.
Host probes accept 1024, 2048 or 4096 MiB and retain their historical 4096-MiB
default when omitted; this does not change the web application's 2-GiB default.
The owner records and verifies the observed RAM selector. Native kernel memory
logs must also be reviewed before claiming that a guest ran with that capacity.
The constructor-only memory diagnostic retains its separate 1024-MiB setting
and rejects a conflicting explicit RAM value.

Each probe defaults to an explicit four-CPU quota/affinity lane. Set
`STARTUP_CPUS` to the freshly measured effective host allocation when it differs
(for example, `STARTUP_CPUS=2` for the current two-CPU ancestor quota).
The launcher selects only CPUs in its actual affinity and binds the same count
to its service quota and guest configuration. This selects a test lane; it does
not detect future cgroup migrations or override browser-reported CPU counts.
The owner still rejects any subsequent affinity/quota mismatch. Compare only
runs with equal actual allocations. Use short unique run names, such as `jcb1`,
to keep Chromium's temporary Unix socket paths within their length limit.
Each ordinary probe uses a 160-second
owner deadline, 170-second service lifetime, 90-second observation
window and 1536-MiB ext4 scratch volume on persistent p3. The shell checks a
20-GiB free reserve before mounting. Browser and guest CPU counts must match
the measured owner allocation; native browser counts are never overridden.
The disk bound includes browser profile/cache/temp files. Output logs are
bounded in the owner; screenshots are written as PNG files, never printed as
base64. The owner records its exact process identity; cleanup checks the
systemd invocation and mounted device before stopping/unmounting. The owner
tracks PID/start identities across migrations and cleans its browser children,
never the persistent Xephyr display. Reported RSS is a sampled sum which can
double-count shared pages; hard aggregate peak memory remains unknown.

Set `STARTUP_TRACE=1` for an opt-in diagnostic V8/Wasm compilation and sampled
CPU trace. It changes no guest or web application bytes. The owner requests a
64-MiB trace buffer and streams at most128MiB to `startup-trace.json`, including
explicit data-loss/flush errors in the receipt. Trace-enabled startup times
are diagnostic, not comparable acceptance timings. Tracing uses the official
[Chrome DevTools protocol](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json).

Inspect `report.json`, `source.json`, `guest.log` and timestamped screenshots.
HTTP starts/finishes show whether kernel and archive requests overlap. Guest
logs record milestones, not a usable Firefox window. Actual visual inspection
and interaction are required for readiness; a screenshot timestamp gives only
an observation bound. No JIT, GPU throughput, mobile or 30-second acceptance
follows from running this probe. Failed runs and scratch images are retained.

The first two trace runs failed to flush; their absence of saved data is not
evidence about compilation cost. `STARTUP_TIMING=1` selects a separate direct
constructor diagnostic instead (mutually exclusive with tracing). It overlays
the selected worker/platform scripts on the private server, retaining their
original and instrumented hashes. Production files and guest binaries are not
changed. Proxy constructors delegate to native Module/Instance constructors,
recording begin/end times, byte size when known, worker identity and success.
The worker sends records through a filtered diagnostic message; at most4096
events per worker and20000 total are retained in `startup-timings.json`.
These wall durations include scheduling delays, not CPU-only time. An unmatched
begin can mean incomplete observation, not necessarily a hung constructor.
This does not measure asynchronous compilation or native guest JIT acceptance.
Diagnostic timing runs are not unmodified startup acceptance or a speedup claim.

`STARTUP_POOL=1` adds the bounded worker-reuse candidate: current
`dist/index.js`, `dist/worker.js`, `dist/wasm.js` and `dist/worker-pool.mjs`
are copied and hashed along with the two existing application overlays.
Without this flag the earlier frozen runtime remains selected. Use `candidate`
for both sides of a pool comparison, switching only this flag; `baseline`
also omits the previously implemented archive/kernel overlap.
When direct timing is enabled its transformed files have separate `timed-`
snapshots, so both the actual candidate and diagnostic overlay bytes survive.
The pool prewarms eight workers once and retains at most eight idle workers.
Only a completed kernel halt or failed fork-copy returns a worker to the pool,
after task cleanup and stack unwinding. Kernel modules, task Instances and
user memory are not shared across unrelated tasks by this change.
Surplus idle workers close themselves; machine shutdown still owns all live
workers. Node kernel fixtures cover consecutive direct/forwarded tasks and
fork-copy allocation failure; browser performance and WebKit behavior require
separate runtime evidence.

## Native JIT-off identity probe

`gpt6-codex-jit-identity.mjs` prepares an opt-in private init overlay for the
three-switch off control. It polls for a parent `/opt/firefox/firefox` process,
joins PID/start ticks and executable device/inode before and after reading,
and emits only `PBLIC`, `PBLBC` and `PBLJIT` from a bounded NUL-delimited
environment read. It does not log other environment values or write guest
scratch files. Missing, duplicate, invalid or oversized input fails closed.
The guest reader transports bounded binary input through BusyBox `od -An -v
-t u1` before AWK parsing, so embedded NULs and newlines retain their original
record boundaries. Both environment and process-role checks use this path.
A known synthetic environment checks the guest reader before inspecting a candidate;
`PBLJIT_ENV_READER_V1` reports old NUL-reader and decimal-reader compatibility,
not native process identity. Failed environment reads emit nonce-bound byte,
record and selected-key counts only; no other names or values are printed.
The owner must bind a fresh nonce and verify the emitted identity; compiler
log silence is not evidence that the switches reached the native process.
Process enumeration requires globbing in the outer shell. The probe does not
use `set -f`, which the actual guest shell rejects. The stat reader splits
kernel-provided fields after removing the process-name field; generated-shell
tests run the actual enumeration and stat-reader prefixes against host `/proc`.
These checks do not replace execution of the full probe in guest BusyBox.

Host tests exercise the filter, parser and actual overlay construction with
mocked imports. They do not prove guest BusyBox compatibility or native Firefox
execution. Even a successful live probe establishes only that parent's initial
environment and executable identity, not compiler behavior, all child-process
environments, a live binary hash, JIT acceptance or performance. The private
init hook makes startup diagnostic rather than unchanged ordinary startup.

## Startup-memory diagnostic

For an isolated owner configuration, `memoryDiagnostic: true` requires
`candidate: true` and `timing: true`, and rejects JIT, trace and worker-pool
modes. Select the independently verified packed-resource receipt explicitly;
this setting does not change the launcher's default receipt. The diagnostic
uses the phone's 1024-MiB guest and 800x600 resolution, disables guest GPU and
opts into compressed initramfs input. It does not access the phone.

Constructor events include native `Memory` allocation results and link
`Instance` events to known module byte sizes within the same worker. Cloned
modules in another worker may have unknown sizes. Memory descriptors are not
read again by instrumentation; allocation failure behavior is preserved.
`memory-resources.jsonl` retains wall-clock timestamps and owned-process RSS
samples for correlation with constructor events. RSS sums can double-count
shared pages; allocation byte length is not resident memory. These diagnostic
measurements cannot establish JIT acceptance or unchanged startup performance.

## Current Firefox JIT diagnostic

`STARTUP_JIT_ARM=ic` or `STARTUP_JIT_ARM=method` selects the current binary's
existing kernel-command-line switches: both enable PBLIC, while PBLBC is zero
or one respectively. Both explicitly request PBLJIT=1. This compares method compilation, not all guest JIT tiers
disabled versus enabled. No guest binary is rebuilt. The owner verifies the
original eight-case fixture SHA256 against the existing Nightly benchmark
contract and seeds its exact bytes into a fresh private home before boot.
Both arms use identical profile preferences and workload filename; seeding
refuses existing profile/workload files and closes storage before guest boot.

JIT diagnostics reject startup tracing, constructor timing and implicit
worker-pool changes. Use `candidate` for both arms for identical archive/kernel
overlap. Default observation is120s, with160s owner/170s service bounds.
`STARTUP_JIT_FULL=1` selects540s from navigation (including startup),
with580s owner/590s service bounds to leave cleanup time within the user's
ten-minute limit. This shortens the previous900s observation without changing
the workload; incomplete results remain incomplete. The deadline never resets at workload start.
Capture stops early on a done/error packet; all24 original rows must still pass
the original checker. Start identity, label and CPU count must agree, and
duplicate sessions fail. Raw logs and compiler warnings/mismatches are retained.
Compiler summaries include PBLIC, PBLBC and PBLJIT, including loop GC evictions,
rejections and bailout diagnostics. The `ic` arm leaves PBLJIT enabled; it is
not a fully disabled-JIT control.

`STARTUP_JIT_ARM=off` requests all three custom compilers off on the candidate
boot path: `pblic=0`, `pblbc=0`, and `pbljit=0`. The last query option becomes
the kernel's init environment argument `PBLJIT=0`, matching the loop compiler's
native environment switch. Ordinary boots keep their existing defaults.
The owner rejects this arm with a frozen baseline boot path that cannot forward
the new switch; candidate overlays include `firefox-jit-config.mjs`.
All three arms retain identical benchmark bytes and profile preferences.
This is control preparation, not proof that the running native Firefox received
the environment or disabled its compilers. Verify native process/environment
identity before using this arm to claim an enabled/disabled speed comparison.
Incomplete workload results stay incomplete. Neither capture mode replaces
ABBAAB comparison, native writer
and tier verification, privileged safety scopes or full JIT acceptance.
Compiler console lines and checksums alone prove none of those. Review
`jit-plan.json`, `jit-results.json`, `guest.log` and actual screenshots.

For host runs, `STARTUP_JIT_IDENTITY=1` opts into the nonce-bound parent
environment probe described above. It requires a candidate JIT arm and rejects
startup instrumentation and implicit worker-pool changes. Only the private
`desktop-extras.mjs` overlay changes; its actual instrumented bytes are hashed.
The owner records expectations and observed identity in `jit-identity.json`
and fails if native identity is absent or mismatched. This changes diagnostic
init, not production startup. Verified switches alone do not prove JIT
execution, safety or speed. Omit the option for diagnostics-off timing.

An explicit private owner configuration can test the combined runtime with
`jitRuntime: "worker-pool"`, `candidate: true`, `workerPool: true` and
`jitIdentity: true`, plus an ordinary `jitArm`. All four selections are required;
the existing shell runner does not select this variant implicitly. The owner
labels it `worker-pool-lifetime` in `jit-plan.json` and `jit-results.json`.
This includes the current parent-context and framebuffer lifetime fixes as well
as worker reuse. Workload bytes, preferences, identity checks and capture bounds
stay unchanged. The label grants no acceptance and is not an unchanged-runtime
comparison. The 900-second diagnostic is still the 24-row benchmark, not the
separate original 150-second full-JIT safety session.

## Full safety preparation

`gpt6-codex-safety.mjs` prepares separate `reference-disabled`,
`reference-enabled` and `method-enabled` safety plans. The browser owner and
shell runner now support an explicit private safety bundle; runtime validation
of this integration is still pending.
Preparation requires an explicit candidate/worker-pool runtime, 2 GiB RAM,
measured CPU count and the original 150-second whole-session limit. The
50 main/Worker rows, four enabled privileged scopes, 30-second scope limits
and 2 MiB direct capture bound remain unchanged. Plans grant no acceptance.

Reference-enabled selects the original loop compiler with PBLIC/PBLBC off;
reference-disabled also disables the restart-only portable tier preference.
Method-enabled preserves the original checker and explicitly reports that
PBLIC's throw-only admission differs from its historical exclusion policy.
Do not count a reference pass as method-tier acceptance or change the checker
to conceal that difference. The capture/init helpers prepare private diagnostic
overlays only; they do not modify the installed package or ordinary startup.
A reviewed current build binding and actual direct native/Worker/privileged
results are still required before acceptance.

`instrumentFullSafetyInit` prepares a private desktop-extras module which
requires the exact reviewed packaged init bytes before replacing its Firefox
launch. Clipboard, run-agent and other overlay entries remain unchanged.
`gpt6-codex-safety-home.mjs` supplies the browser-side preboot seeder and
read-only artifact reader for that integration. Seeds reject existing files
before writing any file, restrict paths to the diagnostic tree and its private
profile preferences, and cap file count and bytes. Live reads always open
home with `readOnly:true`, reject nonregular/oversized files and short reads,
and close their handles. The caller must additionally check append-only
capture integrity, hashes, native writer identity and the session deadline;
these helpers alone do not establish those properties or runtime acceptance.

The launcher uses `STARTUP_SAFETY_ARM`, `STARTUP_SAFETY_LABEL`,
`STARTUP_SAFETY_BUNDLE` and `STARTUP_SAFETY_BUNDLE_SHA256`. Set
`STARTUP_POOL=1`, `STARTUP_RAM_MIB=2048`, the freshly measured `STARTUP_CPUS`,
and `STARTUP_RECEIPT` for the exact current frozen package. Do not combine a
safety arm with the 24-row benchmark, trace, timing or native-identity shortcut.
The bundle pins the current reviewed binding, native binary, archive, manifest,
kernel, build review, four observer sources, extracted init, original fixture
session and both diagnostic AutoConfig files. The loader verifies these files,
joins them to the frozen routes, preserves the original 50 case declarations
and regenerates only session binding/CPU/arm metadata. It copies the current
original driver sources without altering their checks or scope deadlines.
The Firefox 159 drivers use its built-in `Services` global and resolve actor
modules relative to the diagnostic resource alias. They do not import the
removed `Services.sys.mjs` module or register file-protocol actor modules.
`tools/nightly-jit-safety/test-driver-modules.mjs` covers this transport with
VM fixtures; those tests do not establish actual Firefox execution.

The 150-second safety clock starts at outer browser spawn, not navigation,
Firefox readiness or first native record. Capture remains append-only and
requires the original parent option, four enabled scopes, shell compatibility
and natural owned Firefox exit checks. Raw files and exact seeded sources are
retained for the unchanged independent session checker. A captured result is
explicitly `pass:false` pending that review; it is not full JIT acceptance.

## Connected Android diagnostics

`gpt6-codex-phone-server.mjs` verifies frozen route hashes and sizes before
opening an ephemeral loopback listener. It streams only allowlisted files with
cross-origin isolation headers; it does not replace persistent previews. A
phone test owner must forward its own unused port, check that the new origin
has no existing storage before seeding, and preserve preexisting Brave tabs.

`gpt6-codex-phone-lifecycle.mjs` keeps cleanup steps independent, retaining
errors while still attempting later owned-resource cleanup. Launch admission
allows at most 240 seconds of setup in a 1200-second owner, preserving the
original 900-second observation plus cleanup margin. These helper tests do not
establish phone Firefox performance, GPU support, or full JIT acceptance.
