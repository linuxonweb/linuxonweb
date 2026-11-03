# LinuxOnWeb continuation acceptance — 2026-11-03

**44/100 confirmed; the complete requested goal remains unfinished.** Work began13:22:11UTC on a fresh named branch from frozen81103b2, with the five-hour deadline18:22:11UTC. This report supersedes the prior42/100 report for the changes described here. Exact final publication/capture times and final mobile/performance outcomes are appended after the last bounded gates.

## Acceptance against the original targets

| Target | Measured result | Decision |
|---|---|---|
| Usable Firefox within30s | Strict-cache candidate: visible exact-input/navigation completion105.438s from real Start Firefox;106.378s from page navigation. Earlier APK4 instrumented observation66.478s is historical and not a matched performance comparison. | FAIL; cold/warm startup target unfinished. |
| Genuine Firefox JIT | Existing native PBLIC/PBLBC/PBLJIT tiers are real but coverage is restricted; upstream general JIT remains disabled in this build. Native restart reaches unsupported detached-process operation. | Partial; protected native rebuild graph remains inaccessible. |
| At least50% matched host performance | Prior full-scene3.4783fps versus59.8483fps host, approximately5.8%, includes stalls. Final default-threshold matched sample is pending below. | Original target not achieved. |
| Broad OpenGL/Vulkan | Real native Vulkan fixture passed explicit WebGPU rendering with CPU/2D readback presentation.1443 passes/4329 draws/1443 presentations; first frame128x128 with151 colors. | Functional fixture only; fullAPI/conformance unfinished. |
| Real signed APK packages | GNU tar1.35-r1, wget1.25.0-r0, findutils4.10.0-r1 added;71 native behavior checks including TLS trust/rejection and spawn fatal statuses. Existing Python/curl/coreutils/gzip/grep/sed preserved. | Accepted exact signed public additions. Node.js still absent. |
| Durable package installation | Explicit native apk-persist saves signed immutable generations and exact world, verifies replay into clean rootfs.39 positive and54 negative checks passed. Real GUI recovery was typed and normal Stop destroyed owned workers. | Firefox candidate accepted for final publication; plain package resolution/replay remains pending. |
| Android/iOS | Android15 MI8, Brave148,1CPU512MiB: Python signed install30.596s/imports4.465s; native offline exact-world replay4.284s. Final full persistence gate pending after a prompt-detection fix. No iOS test surface. | Full mobile Firefox and iOS acceptance unfinished. |

Scoring retains the original rubric: desktop7/15, startup10/20, JIT4/20, graphics9/20, packages8/10, mobile2/10, preview/recovery4/5 =44/100. The two added points reflect the tested keyboard fix and signed common-port delivery. A fixture does not receive fullAPI credit, and package persistence is not counted twice.

## What changed and why

Firefox input now assigns repeat ownership to the host browser. The guest no longer invents extra repeats while a delayed keyup waits under load; explicit host-held repeat events still work. Native tests cover a650ms hold, three explicit repeats, rapid taps, modifiers, focus loss, and release.12 assertions passed after the measured readiness timestamp under the common enforced3CPU ancestor. Normal production Stop separately verified heldShift release, empty queue, reload to idle and actual worker destruction. An earlier immediate48-worker count was asynchronous teardown metadata: the subsequent owned-page event trace reached zero49 workers within1.327s after idle. No speculative worker-termination patch was added.

The safe Firefox cache candidate versions application resources and binds exact base image, init, kernel, resources and raw/gzip desktop extras. A final loader-issued proof enables the generation only after verified composition; absent/mismatched proof retains the original native purge path. Reserved proof aliases and unknown helper init layouts fail closed. The native executable, original installation path and original root-owned purge marker remain unchanged. This design remains off-default because same-generation clean-close reuse, generation migration, alternate profile/direct-native, corruption and interruption acceptance are incomplete. The final Quit attempt clicked before its confirmation dialog appeared; the final screenshot still shows the dialog. It is a harness race, not evidence of a90s native shutdown deadlock.

Signed package persistence uses a native C helper because the existing BusyBox shell lacks set-u and its EXIT trap status semantics did not support a safe transaction implementation. The helper stores immutable signed APK generations plus an exact world file under root-owned /home, binds compatibility/trust identity, and regenerates package files and their database together. Success is acknowledged only after durable activation. Restore failure stops desktop startup and exposes a focused native console; users can type apk-persist disable or previous. The production GUI command agent starts only after successful restore, so it cannot steal recovery-shell input. Package cache generations remain available for diagnosis after disabling them.

Use explicit commands on the final Firefox image:

```sh
sudo apk update
sudo apk-persist add python3 tar wget findutils
sudo apk-persist status
```

Ordinary apk add remains ephemeral; apk-persist save explicitly snapshots an already-installed compatible world. /home remains durable browser storage and may still be evicted by browser policy. Package restoration can add startup time. Do not treat an APK progress line ending in '#' as a prompt. Bare command lookup in the unpromoted legacy plain image can prefer BusyBox aliases; no-force installation and ordinary nonroot PATH tests must pass before that mode is promoted.

## Measurement discipline and failures

Every new heavy owner is serialized and bounded. CPU/RSS/availableRAM and all-descendant shared-ancestor membership are sampled every1s; PSS every5s. A real issue was found where Chromium migrated via the user desktop D-Bus into an unlimited application cgroup. Affinity3 did not satisfy the required shared quota. Owned launchers now receive only a nonexistent private D-Bus socket, then validate every process shares the enforced /cpulimit.slice3CPU ancestor before workload and throughout execution. No cgroup was moved and no global/user bus was changed. The representative71+39+54 native gates were rerun with this corrected guard. Earlier functional evidence remains functional evidence, without retrospective quota claims.

The final strict-cache cold test ran17:20:44.305–17:24:21.492UTC,217.188s including the failed confirmation attempt and cleanup. Start Firefox was17:20:50.243. Paint was observed95.947s, exact rapid text100.660s, distinct completed navigation104.807s, and visible screenshot105.438s. These are demonstrated upper bounds, not invented earliest-ready times. Peak sampledPSS3.030GB, summedRSS3.813GB, minimum availableRAM25.944GB;209 resource/42PSS samples. No owned process survived. The fresh profile wrote4.144MB startupCache and14.247MB scriptCache; it read neither, so no warm reuse claim is justified.

The final cache build took94.055s:43.126s readiness image composition plus49.739s generation image composition, two full image compression passes. Peak treeRSS212.607MB/PSS194.087MB. A preceding1.119s owner stopped safely on an observed inherited-cgroup transition; the retry waited for the normal enforced membership before launching, without changing placement.

Other retained failures include the unimplemented native detached restart, an incomplete four-arm method-threshold benchmark, direct WebGPU canvas export device loss, failed Firefox focus-based corruption preparation, two plain harness predicate failures, and Android harness failures before full restored-state verification. All owned test processes/tabs/mappings were cleaned; unrelated user state was preserved. The accepted HTTPS mobile worker fix remains unchanged. Unsafe write buffering, cache seeding and packed-resource experiments remain disabled.

## Evidence and recovery scope

The source tree contains exact user instructions, preserved prior notes, per-iteration ledger, curated JSON receipts and screenshots. The final cloud entry separately exposes acceptance, continuation and selected small receipts because public source export intentionally filters raw evidence directories. Private browser profiles, device selectors, cookies/access grants and plaintext signing/recovery keys are excluded.

Recovery requires the original encrypted80a52d1 base, the final cumulative increment from that base, the exact manifest-pinned runtime/signed repository archives, and the original private recipient key held separately by the user. Only the public recipient certificate is available in this environment. Bundle prerequisites, fetch into the verified base and git fsck are checked before encryption. The final runtime restorer checks every part, full Firefox image, exact archive inventory, contained destinations and every final file hash, even with Python optimization enabled. Seven focused negative cases cover bad hash, traversal and collision errors. Full encrypted end-to-end decryption is explicitly not performed here. Protected historical native Firefox build inputs are not recreated by these archives.

## Precise next engineering work

1. Repair the native Quit observation fixture using actual visible dialog confirmation, then obtain native current-launch exit0 and a closed persistent profile. Run same-generation warm reuse and measure actual startupCache/scriptCache reads plus real input/navigation. Finish changed-generation, alternate-profile/direct-native, corrupt-cache and interrupted-publication cases before enabling the strict lifecycle.
2. Obtain legitimate access to the protected native Firefox object/dependency graph, implement detached native restart, rebuild through the permitted route and validate restart preserving profile/environment. Do not blanket-respawn exit codes. Continue genuine JIT coverage and full-scene profiling with matched host conditions.
3. Finish plain-mode no-force signed installation, normal nonroot bare-command resolution, coherent package replay and recovery. Complete Node.js target port.
4. Complete Android restored hashes/imports/world/generation and owned-worker cleanup after the prompt fix; test full Firefox and an actual iOS device.
5. Extend graphics coverage beyond the explicit native fixture, retain direct-export device-loss reproduction, and measure readback cost before any presentation default change.

Final publication, final benchmark/mobile outcomes and artifact verification are recorded below when completed.
