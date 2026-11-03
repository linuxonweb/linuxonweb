# Current continuation — active 2026-11-03 task

Read agent/task.md for the full user request and AGENTS.md for current rules.
Root is CTO; built-in same-model agents own implementation, tests and deployment.
Task start 2026-11-03 07:06:26 UTC; five-hour budget ends about 12:06 UTC.

Shared branch: gpt-6-astra-pro_builtin-agents_linuxonweb-20261103.
Preserved source checkpoint 49fc26e. Retained metadata fix 80a52d1 passes 50
real browser checks plus independent review. No private profiles/caches added.
Overall acceptance 24/100 at last root update; the full goal remains unmet.

## Current runtime and evidence

Normal package 60847fb85339: 114,767,798-byte gzip, Firefox 159 original O2
plus fpcast ABI, 12,908 CPIO records. Home is browser-backed persistent; rootfs
is volatile. NSS key4.db seed has no private-key rows; home seeds are empty
directories. Package privacy receipts live under /mnt/p3/codex-build/s3n/.
Compression is still opt-in, not accepted as the default.

Latest matched raw3/compressed3 runs completed and reaped. Both used native
browser and guest 3 CPUs, fixed taskset 0-2, and all recorded ancestor quota
snapshots show effective 3 CPUs. Peak owned PSS 4.2732 vs 3.2287 GiB; about
24.4% lower, but no startup gain: Firefox window observed by ~71 s, rendered
startup page ~91 s. Earlier 8-core runs did not capture historical quota
values and must not be used as a clean CPU-controlled comparison.

The input harness originally delayed keyup while waiting for CDP, then still
blocked on synchronous /proc sampling. Monitoring now runs in a Worker with
one-second CPU/RAM/PSS/quota samples. Focused input1 test passed 176 actual
DOM keypresses: exact text and order, max dispatch 32.61 ms and DOM 38.39 ms
for intended 20 ms. This is harness validation, not guest latency acceptance.

Current owner: tools/startup-benchmark/gpt6-astra-current.mjs; monitor worker
gpt6-astra-monitor.mjs; isolated constructor proxy gpt6-astra-timing-proxy.mjs.
Run artifacts: /mnt/p3/codex-build/s3n/. Committed evidence copies are under
docs/evidence/gpt6-astra-builtin-rubywebterm-20261103/.
Direct1 showed a single large Firefox Module compile ~0.903 s, so speculative
large-module caching is not justified. Cloned Instance calls need role/call-site
classification; their 29.17 s sum spans workers and is not serial latency.

## Ownership and next actions

startup_io: integration, storage/startup, task docs. graphics_jit: GL/JIT,
benchmarks and explicit backend UI. packages_mobile: packages, mobile, preview,
backup. Python now has the contiguous build/checkpoint lane; startup_io should
only do static analysis and lightweight checks until that agent releases it.
Graphics dispatch candidate independently source-reviewed by startup_io and
approved; no full OpenGL/Vulkan/50%-host acceptance follows from that alone.

Next runtime: one compressed cold run with corrected input timing and a genuine
warm Firefox process restart retaining profile/cache. Measure cold request to
usable content/input separately from warm process launch. Use bounded content
conditions and retain failures; don't hide latency behind fixed waits or hidden
prelaunch. Prove stop and persistence separately. Keep compression opt-in until
these pass. Inspect accessible startup/profile/cache phases while native Firefox
relink remains blocked by inaccessible p6 build dependencies.

Preview port 3000 is a persistent owned systemd service. Authenticated HTTPS
wrapper, two-second metrics and messaging belong to packages_mobile. Preserve
user profiles, phone mappings and unrelated services. No Git remote on arrival.
