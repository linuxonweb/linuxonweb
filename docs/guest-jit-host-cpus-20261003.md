# Native guest JIT runtime diagnostics at the host CPU count

The runtime code-install fixture passes62/0 and the uniform function-pointer
fixture passes24/0 against the current worker/runtime. Both runs record six
CPUs from fresh `nproc`, unmodified Chromium `hardwareConcurrency`, requested
Linux/Wasm configuration and actual kernel SMP output at startup. Preboot,
startup, final-phase and final host readings agree. This validates the native
runtime primitive; it does not accept Firefox159 Nightly JIT or a Sites release.
The fpcast fixture exercises its historical23-i64 ABI, not a measured Nightly
browser ABI. The full Nightly build is still incomplete.

## CPU and process ownership

Two failed admissions remain retained: the runner observed `nproc=6` while
Chromium reported8. Two controlled six-sample runs, one yielding and one
blocking, observe the runner entering `cpulimit-70.slice` after startup, with
`nproc` changing8 to6 while `nproc --all` and affinity stay at8. The failed
fpcast admission also captures runner and browser cgroups separately. These
observations identify allocation differences; they do not imply a hardware
change.

The runners wait two seconds before observing the launch allocation and use
`taskset` to assign that many actual allowed cores to the owned Chromium
process. The test runner retains its original affinity. Browser affinity is
read back from `/proc/PID/status`; a different mask or changed host allocation
fails admission. Browser values are not overridden, and the shared exact CPU
checks remain unchanged. Hosts above64 still fail. Failed runs are not waived.

Each runner uses a dynamic loopback HTTP port and fresh Chromium profile with
`--remote-debugging-port=0`. It validates the fresh regular DevTools port file,
browser and page endpoints, and live spawned PID/profile arguments before CDP
commands. Normal browser exit0, empty owned process group and closed HTTP
server are recorded for both passing diagnostics. Any forced termination fails
the run. Test-source, rebuilt archive and served runtime hashes are checked.
Historical Aurora mode refuses invocation pending its own migration.

## Retained evidence

| Evidence | Path below `/mnt/p6/build` |
|---|---|
| Code installation62/0 | `guest-jit-20260928/guest-hostcpu-affinity-run2` |
| Function pointers24/0 | `guest-jit-ffprep-20260928/fpcast-guest-hostcpu-affinity-run1` |
| Initial failed primitive admission | `guest-jit-20260928/guest-hostcpu-run1` |
| Initial failed fpcast admission | `guest-jit-ffprep-20260928/fpcast-guest-hostcpu-run1` |
| Controlled CPU samples and independent review | `firefox-nightly-musl-root-review-20261002/runtime-runner-review-run1` |

`tools/nightly-musl/evidence/guest-jit-runtime-host-cpus.json` pins the retained
results, console, commands, CPU phases, ownership and current source review.
All24 independent predicates pass. Its initial review incorrectly assumed a
separate fpcast result prefix; that failed audit is retained, and the corrected
review checks the actual `GUEST_JIT_RESULT pass=24 fail=0` line. Guest evidence
was unchanged. The fpcast source differs from its frozen runner only in
indentation; the code-install rerun uses the final runner. Syntax checks and
`git diff --check` pass. These are correctness diagnostics, with no Nightly
performance or full-browser acceptance claim. The running full build and
public Sites v10 remain unchanged by this packet.

## Full-browser runner preparation

The Nightly baseline and original-eight-case ABBAAB runners use the shared
`tools/guest-rootfs/firefox-browser-affinity.mjs` helper. It saves launch
allocation, uses actual `taskset` affinity, reads the spawned browser's mask
back at admission and completion, and rejects count or mask drift. ABBAAB
also requires identical assigned core IDs across every arm. Original CPU,
identity, checksum and performance gates remain intact.

The baseline runner now verifies the fresh DevTools regular file, exact
browser/page endpoint and spawned profile/PID before commands, then proves
its private process group empty on cleanup. No fixed or discovered external
browser is used. Package preflight still forbids execution during the owned
full build. The helper smoke starts only its own Chromium, without a Linux
guest or HTTP server.

The shared helper passes34 admission predicates; existing baseline43 and
benchmark118 predicates pass. Live owned Chromium admission/final evidence
records six actual cores, and a deliberately wrong launch plan is rejected
while preserving the unchanged real browser mask and count. Normal exit0 and
empty private group are retained. Root independently checks23 source/result/
ownership predicates in `nightly-browser-affinity-review-run2.json` under the
root-review task, also frozen in
`tools/nightly-musl/evidence/nightly-browser-affinity-preparation.json`.
Reproduce pure or live helper checks with
`node tools/guest-rootfs/test-firefox-browser-affinity.mjs --self-test|--live
/mnt/p6/build/firefox-nightly-browser-affinity-20261003/NEW`, using that task's
persistent `tmp` for all three temporary-directory environment variables.

This prepares the real Nightly gates. Neither the synthetic regressions nor
the live host-browser smoke establish full Nightly startup, TLS, JIT,
performance or release acceptance. Both earlier live helper smokes remain
retained; the second adds actual failed-admission evidence.
