# GNU checkpoint and return to musl — 2026-10-02

User direction: save current GNU work, return to musl, and finish latest Firefox
Nightly followed by native Wasm JIT and Vulkan/OpenGL/WebGL GPU support.
This checkpoint preserves implementation sources, diagnostics and prior failed
attempts; it does not claim a working GNU libc runtime or GNU Nightly build.

## Last bounded GNU results

- Consumer13 plus producer31 compiler builds and passes ordinary-frame controls
  (5,361 assertions); genuine cancellation is unaccepted.
- Consumer13 SjLj controls fail at O0/O2/O3 with unconsumed admission metadata.
- Producer32 metadata repair compiles, compiler SHA256
  `53126ca50e5da00714fa51d7afab7547deed5d9cf39ba6773da7bd584660a03a`.
  No producer32 runtime controls were run after the user scope change.
- Startup-class and fatal-status proposals remain source/finite compile controls;
  genuine owner/cancellation, forced unwind and full GNU sysroot are incomplete.
- Owned process groups in all three GNU packets are empty. No production
  runtime, kernel, Sites payload or unrelated service was changed in this stop.

## Preserved handoffs

- `/mnt/p6/build/glibc-cancel-kernel-boundary-handoff-20261002/handoff.json`
- `/mnt/p6/build/glibc-cancel-kernel-boundary-handoff-20261002/repository-files.json`
- `/mnt/p6/build/glibc-native-frame-plan-continuation32-20261002/repo-scope-handoff.json`
- `/mnt/p6/build/glibc-native-frame-plan-continuation32-20261002/stop-handoff.json`
- `/mnt/p6/build/glibc-native-forced-unwind-consumer13-20261002/logs/user-stop-handoff-1.json`

Build outputs stay under `/mnt/p6/build`; only scoped source/docs are committed.
Unrelated untracked files, source clones, `web/sites`, runtime backups and the
unaccepted Firefox wgpu wrapper are excluded.

## Musl continuation

Start a separate musl branch at `1b4be96`, retaining this GNU branch unchanged.
Recover the existing Nightly159 musl configure/export/component/33 ABI checks;
these are prerequisites, not full-browser acceptance. The full Nightly build,
new SpiderMonkey JIT hooks and Firefox GPU integration still require work.
Existing source revision is `6ce79a0416258aa1bc3a29e9ccebccdacebf916a`,
version159.0a1, build20261002095017. Recheck official metadata before asserting
this remains the latest Nightly. Public Sites v10 remains Firefox128.14.0 ESR:
https://linuxonweb.exact-coot-7512.chatgpt.site . Preserve it until a replacement
passes startup/update, JIT correctness/performance and applicable GPU gates.
