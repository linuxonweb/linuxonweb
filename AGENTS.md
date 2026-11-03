# LinuxOnWeb project instructions

## Current authorized task — 2026-11-03
The current user request in `agent/task.md` resumes development and supersedes
historical pause/attempt limits. Prioritize I/O and startup, responsive Firefox
within 30 seconds, genuine safe JIT performance, general Vulkan/OpenGL graphics,
>=50% host graphics throughput, then Android/iOS and apk packages including
Python/Node/basic tools. Do not claim unsupported features or infer acceptance
from compilation. Root is CTO; built-in same-model agents own engineering work.

Read `agent/continue.md` and `agent/devsummary.md` first. Historical AGENTS and
root continue are archived under `agent/archive/`; they are evidence, not active
pause instructions. Keep this file concise and put detailed work in agent logs.

## Git and ownership
- Branch: gpt-6-astra-pro_builtin-agents_linuxonweb-20261103.
- Checkpoint49fc26e preserves reviewed pre-existing source changes. Excluded
  private dirs/caches/big binaries remain untouched. No Git remote was configured.
- startup_io owns integration, startup/storage implementation and agent handoffs.
- graphics_jit owns guest GL/JIT and graphics benchmarks; coordinate main.js edits.
- packages_mobile owns package tooling, mobile UI and preview/metrics/deployment.
- Commit only reviewed task files, never blanket-add unrelated artifacts.
- Preserve failed evidence; checkpoint important progress and at most10 iterations.

## Resource and process discipline
- Builds/tests/profiles/caches/logs use disk-backed `/mnt/p6/build/` or verified
  `/mnt/p3/codex-build/`; never /tmp, /dev/shm, tmpfs or ramfs.
- Set task-specific TMPDIR,TMP,TEMP and child caches before jobs. Keep socket
  paths short. Bound finite jobs and track exact owned PID/start identities.
- Preserve unrelated processes, phone/browser data, displays and preview services.
- Measure effective CPU affinity/quota for every runtime owner; bind guest CPU
  setting to actual browser capacity. Do not spoof hardwareConcurrency.
- Sample CPU/RAM at1s during tests. Record build/test times and investigate tasks
  >5min if unexpectedly slow. Serialize all host guest runtime gates under the shared3CPU quota; overlapping
  guests have stalled at SMP bringup. Keep timed runs free of builds/uploads.
  PSS may be sampled every5s while CPU/RSS/available RAM/quota remain1s; record
  this cadence and label PSS peaks as sampled lower bounds.
- Avoid large/base64 terminal output; retain logs and screenshots in files.

## Validation and acceptance
- Measure cold/warm startup separately and compare same inputs/configuration.
  Guest log milestones do not prove visible/responsive Firefox; inspect and interact.
- Preserve original JIT workloads/checkers/deadlines; semantics alone do not prove
  GC safety/native execution. Never enable an unsafe candidate merely for speed.
- Preserve actual GPU backend identity. Explicit user backend selection; no silent
  WebGPU-to-WebGL fallback. Partial Vulkan or GLES is not full desktop GL/Vulkan.
- Package CA-only NSS seeds, never diagnostic/private-key profiles.
- Keep user home/clipboard/settings and in-page opt-in package update behavior.
- Preserve original dev port3000, old preview8001/proxies/cloudflared unless exact
  owned replacement is reviewed. Serve current work as testing until acceptance.
- Overall rubric: stability15, I/O+startup25, JIT15, graphics25, packages10,
  mobile5, preview/reproducibility5. Unknown remains unmeasured; no inflated95.

## Next-agent entry
Use `agent/continue.md` for exact current inputs, latest receipts, failures and
next steps. `agent/task.md` contains full user instructions; those take precedence.

### Browser image release gate learned on 2026-11-03

Every image/compression/composition change must boot the exact served artifact
through the production browser DecompressionStream plus extras/init wrapper and
reach a guest command or desktop before publication. Node gzip and direct kernel
boot are component checks. Chromium rejects concatenated gzip members although
Node/Linux accept them. Preserve the withdrawn4f6bf2d3a326 failure and repaired
single-member acceptance evidence; do not repeat that publication mistake.

### Current verified state for the next agent

Public APK4 d258203daee8 is accepted through the exact production browser path;
SHA2564675a8ceb318c539cd64eb1b69338a19185d0cadb7a5f51b2352048a0c09a771.
Compressed Firefox boot is default. Pythonr1 and genuine GNU coreutils are signed
packages; rootfs/APK database reset together, /home persists. Overall acceptance
40/100;30s Firefox, general GL/Vulkan,50% host, Node.js and full mobile Firefox
remain unmet. Read agent/continue.md for exact benchmarks and reproduction.

Canonical Omni is an isolated rejected candidate: file allocation fell538.5MB,
but measured whole-browser PSS regressed23.4% and FPS did not improve. Keep the
normal APK4 image public. Code-cache seeding and negotiated FUSE writeback remain
off. Root-owned .purgecaches repeatedly invalidates caches; never remove it
publicly without safe per-image/per-profile invalidation. Native Restart normally
currently exits without a replacement; do not mask it by relaunching all exit0.
