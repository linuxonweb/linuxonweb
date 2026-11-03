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
