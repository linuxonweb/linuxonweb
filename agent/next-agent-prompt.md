# Continuation checkpoint — 2026-11-03 15:32 UTC, 44/100

This leading status supersedes frozen-task statements below without changing their evidence. Active branch: `gpt-6-astra-pro_builtin-agents_linuxonweb-20261103-1322`. The original parent `81103b2ec04a8a4f8453617ca128448e831645bc` remains tagged. Normal deadline: **18:22:11 UTC**; final recovery reserve begins 17:40.

Host-owned keyboard repeat and release before Stop are production defaults (3c7709c). Explicit `input-repeat=guest` remains diagnostic. Two native keyboard/navigation runs and production Stop passed. Signed GNU tar 1.35-r1, wget 1.25.0-r0 and findutils 4.10.0-r1 are public after 71 native checks and exact signed-index readback. Accepted score: desktop 7, startup 10, JIT 4, graphics 9, packages 8, mobile 2, preview 4 = **44/100**. Node.js remains absent.

Native C package persistence is still a candidate: `out/pkp3/persistence-image1`, Firefox archive SHA256 `4b20a71713a8229f52f3ac2702d8d94dd5b4779a53ed28f0bb0d5830bf14b06c`. Actual production Firefox save followed by normal Stop 88.631 ms after acknowledgment passed. Fresh same-origin/profile restart restored exact world, signed generation, gzip/tar binary hashes and user data. Native replay took 1.114 s before X; the whole 127.627 s test includes 90 s Firefox observation, terminal typing and cleanup. Separate native five-boot and negative/interruption fixtures passed. **Interactive GUI failure recovery is pending**, so do not promote the helper image yet.

Two recovery preparation failures are retained. An early terminal command lost focus when Firefox opened later (133.136 s). Start desktop WM selected the unchanged plain image rather than the candidate Firefox image (26.700 s, failed before command). Reuse the known-good closed `pkgprod-verify1/profile`, never either failed profile, for the next attempt. The recovery watcher opens a real hvc0 terminal and the desktop command agent waits for X before claiming stdin. A later same-page Stop/Start must also close a recovery-only terminal before the normal desktop agent resumes stdin ownership. Package agent owns explicit small plain/console helper composition; do not alias images without validated base identities.

Strict cache lifecycle source binds immutable app generation, exact extras, native/platform and pre-generation base/init identities. A verified final proof enables the wrapper; missing proof retains original native invalidation. LastAppDir activation passed on a private candidate. Same-generation code-cache reads, changed-image and alternate-profile safety remain unaccepted. Native Quit exceeded 20 s while home I/O progressed; one bounded 60–90 s graceful-Quit diagnostic is approved. Native Restart remains unsupported, protected full-build inputs remain unreadable, and blanket exit-code respawn is forbidden. Cache seeding, write buffering and packed resources stay disabled.

Firefox agent owns the serialized matched 50→10→200→50 method-threshold/host matrix. Active web runtime is frozen during that lane. Its explicit WebGPU CPU-readback/2D diagnostic is unexecuted and is not full Vulkan acceptance. Package agent rechecked one authorized MI8; iOS hardware is absent. Keep CPU/RSS/available RAM sampling every second and PSS every five seconds. A brief connector outage at about 15:29–15:31 returned errors after one fixture had actually completed; resolve receipts before rerunning any uncertain command.

Next checkpoint uses the original encrypted 80a52d1 base, a new cumulative encrypted increment, the same public recipient, and separately pinned runtime artifacts. Midpoint encryption is queued for the first quiet slot after JIT. Never publish private keys, access grants, cookies or device identifiers.

---

# Continue LinuxOnWeb from the verified 2026-11-03 checkpoint

You are continuing an unfinished engineering task in
`/mnt/p3/project/linux/linuxonweb`, accessed through the rubywebterm MCP. The user
wants a real usable Linux desktop in a browser: first I/O and launch performance,
responsive Firefox within30s, genuine safe JIT performance, general OpenGL/Vulkan
and at least50% of host-browser graphics throughput, Android/iOS support, and
native apk packages including Python and Node.js. The exact full request and
rules are saved in `agent/task.md`; read it, `AGENTS.md`, `agent/continue.md`,
`agent/devsummary.md`, and the consolidated acceptance report before changing code.

The main agent is CTO/project manager. Delegate implementation, builds, tests,
deployment and source review to same-model built-in subagents. Inspect current
Git status and HEAD before a new branch; preserve existing work with a reviewed
checkpoint and never blanket-add unrelated profiles/builds/private directories.
Current branch is `gpt-6-astra-pro_builtin-agents_linuxonweb-20261103`; no Git
remote existed. User-authorized persistence is FileHarbor; recovery consists of
an encrypted original history, cumulative history increment, filtered public
source, and exact runtime archive. Follow the verified recovery report/receipts.

Acceptance is42/100, with substantial goals still unmet. Never call a successful
build or microbenchmark full acceptance, never manufacture a95score, and keep
failed evidence. The accepted public image is APK4 d258203daee8, single gzip,
116197223bytes, SHA256
4675a8ceb318c539cd64eb1b69338a19185d0cadb7a5f51b2352048a0c09a771.
Native Firefox SHA256 remains
26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998.
Compressed Firefox initramfs is default; raw diagnostic mode remains explicit.
The rejected Omni candidate must not replace APK4: it saved538.5MB in64KiB file
allocation but regressed measured browser PSS23.4% and did not improve FPS.

## Highest-value remaining work

1. Establish a legitimate reproducible native Firefox159 build from accessible
   sources/configuration; old exact p6 object dependencies were inaccessible.
   Do not bypass filesystem permissions. The readable p3 export is a lead,
   not proof of equivalence. Native Restart normally currently exits0 without a
   replacement: source points to unsupported detached spawn, while the exec
   path is only used under a different option. Fix correct restart semantics;
   a shell restarting every exit0 would break ordinary Close.
2. Implement and prove safe per-image/per-profile code-cache invalidation before
   removing the immutable root-owned browser/.purgecaches marker. A disposable
   same-image test read the original startup/script cache inodes (~19.55MB) with
   zero rewrites after marker removal, so the lead is real. Public marker remains.
   Do not touch preferences, security/NSS/user databases or overwrite established
   user profiles. Measure both full page-to-usable and explicit Firefox-launch
   request-to-responsive-window, with warm process restart a separate scenario.
3. Preserve strict durable HomeFS commits. Atomic create/lookup improvements are
   accepted. Experimental writeback has a real acknowledged-write-loss failure
   at current Stop. A16-check native barrier works in isolation, but actualPID1
   respawns/writes defeat complete quiescence. Solve lifecycle/error ownership
   before exposing any writeback option; never claim saved after failed flush.
4. Profile the full guest/browser stalls. Same320x240 cube measured3.4783fps in
   Firefox versus59.84828fps in host Chrome, far below50%. Narrow GL dispatch
   improvement and partial Vulkan WSI success do not imply full API conformance.
   Keep explicit backend choice and truthful capability reporting. Preserve real
   JIT/GC/guard tests; bounded cache retention does not prove native-speed JIT.
5. Native apk/Python/coreutils/gzip/grep/sed are accepted; repository has10entries
   including manager, certificates and demo. Rootfs/package DB reset together,
   /home persists. Node.js is not ported; host Node22 is tooling. Do not substitute
   a host proxy or applet and call it a genuine guest package. Other requested
   standalone GNU tools and broader Python modules remain unfinished.
6. The minimal512MiB Linux console now runs on the tested Android phone through
   authenticated HTTPS, using one hash-verified bundled worker Blob. Full Firefox
   remains too large/slow for mobile acceptance; iOS hardware was not tested.
   Use final mobile source/runtime evidence and preserve phone data/tab/forward
   ownership. Do not treat a desktop viewport screenshot as phone acceptance.

## Resource, test and publication rules

Use disk-backed p3 scratch with short TMPDIR paths. Never use/tmp or/dev/shm for
large builds/profiles; preserve existing services and unrelated processes. The
host has an effective shared3CPU ancestor quota. Serialize host guest runtimes,
including functional gates; concurrent guests stalled at SMP bringup. Avoid
compiler/upload contention during clean timing. Sample CPU/RSS/available RAM/
quota every1s in a separate worker; PSS every5s is a sampled lower-bound peak.
Do not spoof hardwareConcurrency or relax quota controls.

Use the existing bounded owner/tools and exact PID/start-time cleanup. Resource
sampling once blocked key-release scheduling and invalidated early input tests;
preserve the corrected independent sampler. Record exact test/build start/end
and durations. Keep task wall elapsed separate from nested and parallel sums;
model/planning time was not measured. All image/compression/composition changes
must boot the exact served artifact in real Chromium DecompressionStream through
the production extras/init wrapper before publication. Node gzip and direct
kernel tests alone missed a real multi-member-gzip regression.

Coordinate shared Git index and main.js/runtime ownership. Review narrow patches
independently and stop broad optional testing once the actual risk is resolved.
Do not commit/upload profiles, private preview tokens, upload credentials, device
identifiers or signing private keys. Public exports have an exact-value audit;
private recovery remains encrypted. Update readable handoffs and checkpoint
important progress, including failures and unmet acceptance targets.
