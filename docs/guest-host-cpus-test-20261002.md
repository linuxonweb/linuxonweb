# Host CPU count in Firefox guest tests — 2026-10-02

`test-firefox-gpu-check.mjs` and `test-firefox-session-startup.mjs` now seed the
Linux/Wasm CPU setting from the outer browser's `navigator.hardwareConcurrency`,
using the UI's 1–64 clamp. Both compare that value with clamped host `nproc` and
reject missing, invalid or disagreeing counts. Each tested boot must retain the
selected count and print the matching actual kernel SMP CPU count. Results
record the host, browser, requested, selected and actual guest counts. Existing
readiness, profile, input, image, version, isolation and bookmark checks remain.

`test-firefox-pbl-bench.mjs` also selects and verifies the host count separately
for every boot in both benchmark arms. It saves the kernel SMP evidence before
benchmark output can evict startup logs, and verifies that the browser and UI
counts still agree at the end. Its updated runner passes syntax validation;
a fresh Nightly benchmark remains pending the browser build. Existing two-CPU
benchmark results stay historical. Older diagnostic runners must receive the
same host-count setup before any new invocation; do not reuse a frozen two-CPU
runner for a new comparison.

A fresh diagnostic cold smoke passed all eight checks at
`/mnt/p6/build/guest-host-cpus-test-20261002/cold-run1/result.json`:
host `nproc=8`, browser `hardwareConcurrency=8`, requested/selected guest CPUs
`8`, and kernel `smp: Brought up 1 node, 8 CPUs`. Firefox launched in 10.697 s;
the GPU-check page settled in 71.194 s. These observations are not benchmarks.

The diagnostic used the preserved isolated Firefox 128 v10 page overlay
`5e8d03307239`, archive SHA-256
`b29d7da9e39afa26128942d5702021c7c0e7580e59f1631a015c367d76c39eca`.
It opened `file:///opt/firefox/gpu-check/gpu-check.html` automatically and
reported Firefox 128.0, WebGL `none` (GL drivers exhausted) and WebGPU `fail`
(the Release/Beta gate rejected `requestAdapter`). This is CPU/default-page
validation, with no Nightly, successful GPU, warm/update or release acceptance.
No runtime was promoted or deployed.

Three runner syntax checks and ten targeted CPU contract checks passed; the
latter reject missing/zero/fractional/mismatched host counts and verify actual
SMP evidence without inventing a count when it is absent. The finite smoke
kept every profile/cache/scratch/output under the new disk-backed task path,
used about 161 MiB (below its 2 GiB allowance), and preserved the old two-CPU
smoke. Its owned browser exited normally, the HTTP server closed, and its
process group and HTTP/CDP ports were independently checked closed. Evidence
is retained in the task directory, including the adapted runner, guest logs,
screenshot and cleanup report.

The remaining homepage, DevTools, WebGPU W1 and WebGL F1a diagnostic runners
now use `firefox-host-cpus.mjs` for the same count contract. Every boot they
exercise (including update and warm boots) saves `<phase>-startup-guest-logs.txt`
and `<phase>-cpu.json` immediately on Firefox launch, before fixture, GPU or
DevTools output can evict the SMP line. Missing or mismatched SMP evidence fails
the boot after retaining the diagnostic files. Browser and UI counts are checked
at launch and again after readiness; DevTools also checks them after its requested
steps. The helper is included in each runner's input hashes and copied evidence.

Fixture-only checks pass 38 cases at
`/mnt/p6/build/firefox-nightly-guest-cpu-gates-20261002/contract-run1/result.json`.
They cover invalid/disagreeing host and browser counts, the 1–64 UI range,
missing/malformed/mismatched SMP records, independent cold/warm captures,
saved failure evidence, later ring eviction, and changed browser/UI counts.
The actual host `nproc` is eight; all kernel logs in this fixture packet are
synthetic. Six syntax checks pass for the four runners, helper and helper test.

No browser or guest was started for this follow-up while the full Nightly build
was running. Historical two-CPU evidence and frozen promotion verifiers remain
unchanged. These runners retain their original candidate/version prerequisites
and task roots: W1 still diagnoses the old Release/Beta/Empty-HAL behavior, and
F1a still records its historical WebGL result without requiring a working context.
Their CPU setup is ready for later reuse; their historical acceptance predicates
still need deliberate Nightly migration before they can gate the new browser.

A subsequent bounded phase review found that the shared helper reused the
initial `nproc` result. An unchanged browser/UI/kernel count could therefore
pass after the available host count changed. The Nightly baseline and these
four migrated diagnostics now reread `nproc` before every boot, when saving
startup SMP evidence, at each phase's completion, and at the end of the run.
They retain `<phase>-preboot-cpu-phase.json`, `<phase>-cpu.json`,
`<phase>-final-cpu-phase.json`, and `end-cpu-phase.json`. Any observed allocation
drift fails with the changed host count saved. A run retains its initial CPU
request; it must restart under a stable allocation rather than silently changing
the CPU count between comparative phases. Pure fixture checks inject observed
counts explicitly and cannot inherit the live machine's count.

Evidence is under
`/mnt/p6/build/firefox-nightly-host-cpu-phase-review-20261002`: 66 CPU fixture
checks, 43 Nightly baseline self-test checks, 11 independent fresh-reader
regressions, five caller source audits, and seven syntax checks pass. The baseline
self-test uses a retained source snapshot with only its task-output literal
redirected into this new packet; both hashes and the substitution are saved.
`before-regression.json` retains FAIL for the previous helper accepting an
injected 8→6 host change. New failure files retain the observed host count and
the independent kernel count instead of replacing or discarding either.
Caller audit run1's FAIL is retained: its hash-path predicate recognized only
the URL form and missed the baseline's equivalent direct repository read.
Run2 includes both existing forms and passes without changing runner behavior.

The CPU fixture's live `nproc` observation was six; subsequent observations were
eight. Ten contemporaneous Node samples recorded `nproc=6`, `nproc --all=8`,
affinity `0-7`, `os.availableParallelism()=5`, and eight online CPU entries.
Ten Python samples recorded `nproc=8`, eight online/configured processors, and
the same affinity. Visible service/parent `cpu.max` values were `max 100000`;
root `cpu.max` was absent. A later Node sample also returned eight. GNU
coreutils 9.11 resolves to `/usr/bin/nproc`; no OpenMP count overrides were
present. These observations establish varying available-count reports, with
cause unresolved; they do not establish a physical hardware change. No fixed
six-CPU setup was introduced, and historical eight-CPU evidence remains intact.

This review started no browser, guest, compiler, package, promotion or deployment.
The existing 64-CPU UI clamp remains a separate limitation for hosts above that
range. Older runners outside this shared-helper migration still need the same
phase revalidation before future invocation. Nothing here
establishes Nightly, JIT, GPU, TLS or release acceptance.

The PBL benchmark runner subsequently adopts the same helper for each arm's
selection, preboot, startup and completion checks. It pins/copies the helper
alongside the runner, retains the original startup-log filename and saves
independent CPU JSON. All six ABBAAB boots must keep the first arm's observed
host count, and a fresh run-end nproc reading must agree. Syntax and whitespace
checks pass; no benchmark/browser/guest was launched. Exact Nightly identity,
fatal-path rejection and performance acceptance still need migration before
using this historical runner as a release gate.

The subsequent exact-count correction makes the shared helper reject hosts
above64 and mismatching raw host/browser counts before selection. It no longer
accepts a64-CPU guest for a128-CPU host, and two different counts above64 cannot
appear equal through clamping. Phase checks also reject forged clamped evidence.
The product UI remains unchanged. Root reruns68 CPU fixtures and43 Nightly
baseline fixtures; all pass. These are host contract checks, not new guest
acceptance. The historical available-count variation remains unexplained.
