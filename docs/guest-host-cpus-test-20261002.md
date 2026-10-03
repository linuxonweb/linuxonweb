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
