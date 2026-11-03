# Current continuation — active 2026-11-03 task

Read agent/task.md for the full user request and AGENTS.md for current rules.
Root is CTO; built-in same-model agents own implementation, tests and deployment.
Task start 2026-11-03 07:06:26 UTC; five-hour budget ends about 12:06 UTC.

Shared branch: gpt-6-astra-pro_builtin-agents_linuxonweb-20261103.
Preserved source checkpoint 49fc26e. Retained metadata fix 80a52d1 passes 50
real browser checks plus independent review. No private profiles/caches added.
Overall acceptance 26/100 at last root update; the full goal remains unmet.

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

### Latest continuation addition

Current iteration adds diagnostic per-inode home I/O attribution and exact log
arrival timestamps. `warm1` cold run succeeded visually, but no restart occurred
because the manual handoff timed out. `inventory2` and `cache1` inspect/export
only that closed clean test profile. Experimental seed implementation:
web/linux/startup-cache-seed.mjs, startup-cache-catalog.mjs, startup-cache/60847fb85339.
11 real-browser safeguards passed in seed-tests1. Seed is not yet linked to
production main.js. Diagnostic proxy mode `seed` adds only the explicit
?startup-cache-seed=1 path; normal home/full modes do not seed. Next: after the
coordinated graphics/package lane, run one bounded fresh-home seed experiment
and verify cache reads/acceptance and actual launch improvement.

Graphics exact-cube guest run `cube1` uses fx-overlay4 (raw/gzip/manifest only)
with the same page as the host, no input, 3 CPUs, compressed initramfs. Do not
change served runtime while that owner is live. Its result also provides the
new per-inode attribution. Preserve all failed owners and timing caveats.

### Browser image release gate learned on 2026-11-03

Any image/compression/composition change must load the exact candidate through the production browser `DecompressionStream` plus desktop extras/init wrapper and reach a guest command or desktop before publication. Node gzip/DecompressionStream and direct kernel boot are component checks only. Chromium rejects concatenated gzip members (`Junk found after end of compressed data`) even when Node and Linux accept them. The failed4f6bf2d3a326 APK image was withdrawn and tested60847fb85339 restored pending a single-member repack and full browser gate. Preserve the failed cube2 evidence alongside the correction. Compressed boot itself remains validated for the reference608 image; code-cache and writeback experiments remain off.

### November3 experimental durability checkpoint (off public)

The canonical production persistent-home API remains strict and unmodified beyond the accepted create fast path. Standard-mount fixture passed46native+28host checks; without negotiated FUSE_WRITEBACK_CACHE it still makes265hostwrites (270→7fsync calls), so mountflags alone are not the major fix. Experimental negotiated writeback reduced256×4KiB operations to2hostwrites but current Stop lost an acknowledged open dirty page. The subsequent isolated native barrier passed16checks in27.374s, including genuine quiesce+syncfs acknowledgement, strictIDB quota error, exactnonce, healthyStop/reopen and timeoutresume. Exact payload/source/receipt live under tools/startup-benchmark/guest-home-mount and evidence/barrier1-20261103.json. productionAccepted:false: actualdesktop PID1respawns remain a quiescence blocker; no production supervisor or writeback flag is exposed. Prior failure receipts remain.

### Current acceptance follow-up

Cachev2 actualrun failed its cooperative15s deadline during concurrent work after first4.9MB strictlycommitted cache; no compatibility completion or reusedread proof. Seed remains off. Pending release uses repaired single-gzip d35dbfeb2a15, already actualFirefoxboot/cubePASS; actualdesktop signedAPK install and Pythonversionpass, modulecompletion exceeded4sobservation (not fatal), and packageagent is fixing standardlandmarkdirectory warnings in Pythonr1 before repeat. Quiet owner now excludes active browserprobes for requested150s and records screenshot request/completion times. Automated warmRestart mode uses previouslyobserved Restartnormally control at identical viewport; genuine newFirefoxPID +sameprofile +render/input evidence remains required before anylatencyclaim.

Future narrowIO lead: HomeFS.lookup reads an inode, then FUSELOOKUP repeats getattr in a second IDBtransaction. An optional transactionallycoupled lookup-with-attributes API may remove the redundant roundtrip without cross-request metadata caching. Notimplemented.
