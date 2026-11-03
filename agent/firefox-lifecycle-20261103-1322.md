# Firefox lifecycle and native spawn continuation — 2026-11-03 13:22 session

Owner: GPT-6 Astra Pro built-in `firefox_lifecycle` through rubywebterm.
Current overall acceptance remains **42/100** pending actual runtime gates.

## Cache generation candidate (off public)

`tools/firefox-lifecycle/build-cache-image.py` builds an isolated, single-gzip
image. Its original decoded rootfs prefix is retained exactly. The native
Firefox, `/init`, and original root-owned `/opt/firefox/browser/.purgecaches`
remain unchanged. The original launcher gains a supported `XUL_APP_FILE`
selection pointing to a content-addressed application resource directory.
The executable and GRE directory remain `/opt/firefox`, so native dedicated
profile install identity stays stable. Explicit custom XUL-app arguments/env
skip the injected selection and retain their original semantics.

The generation hashes the native/platform/app resource inventory, copied startup
font, kernel identity and explicit ABI-generation contract. Per-profile native
`LastAppDir` compatibility invalidates caches on generation change; native
profile locking, crash/safe-mode invalidation and failed-removal retry flags
remain authoritative. Direct native launches retain the original purge marker
and safely invalidate rather than accidentally using a stale profile cache.
No profile preferences, NSS/security databases, bookmarks or user files are
changed by the builder. No code-cache seeding, write buffering or packed resources
are enabled.

Candidate directory: `/mnt/p3/codex-build/f3l/cache-image-v1`.
Archive SHA256:
`4e7413a96baf81dcef4c79fcc7e3deaa1db33457ea0fd7cb70f0e138c7d394e5`.
Generation:
`aec6c42898cfd30839108799b35ebbd9586d6cc44d88ce1d354b3278b4f49c28`.
Measured build owner:13:37:45.443710 UTC,32.034s,exit0; internal builder30.296s.
Peak owned RSS43,089,920bytes; sampled PSS32,544,768bytes. CPU/RSS/RAM/quota1s;
PSS5s. Effective ancestor capacity3CPUs. No browser startup acceptance follows
from these build/static checks. Independent integration source review requested
conservative all-argument custom-app detection; applied before this build.

Required production gates: old-profile migration preserving selected profile;
same-generation warm cache reads; changed-generation invalidation; alternate
explicit profile/direct native fallback; corrupt disposable cache recovery;
actual decompression/extras/desktop/usable input and Stop. Ordinary Close/relaunch
is separate from native Restart normally, which remains unaccepted.

## Native restart and JIT route

The readable159 export's NSPR Wasm/Linux `_PR_CreateUnixProcess` returns
`PR_NOT_IMPLEMENTED_ERROR` before any host/kernel spawn operation. A host runtime
hook cannot implement a call which never crosses that boundary. Native shutdown
already restores XUL_APP_FILE and profile environment and unlocks the profile.
`prepare-native-restart.py` creates a pinned source-only change selecting the
existing Unix `LaunchChild(true,true)` exec path only for explicit target restart.
Failed exec is reported and sets nonzero exit; ordinary Quit remains unchanged.
No shipped binary is patched. No native rebuild/restart acceptance is claimed.

Historical exact relink requires2629 objects and63 archives. The readable export
has no configured matching object graph; required historical runtime/stack,
Mesa/EGL and C++/unwind inputs lie under a denied root-owned p6 ancestor. No sudo,
permission changes or alternate access path was used. Independent clean rebuild
from readable159 sources is legitimate but needs new dependency preparation and
native acceptance; old recipes reference historical guest receipts/private-header
pins as well as absolute paths, so path substitution alone is insufficient.

Observed native APK4 logs already show genuine custom PBLIC(threshold200),
PBLBC(threshold50) and loop PBLJIT(threshold1000) compile/install/entry activity.
Upstream native JIT is disabled and portable baseline enabled. Nested-loop
coverage lives in native `tools/pbl-jit/PblJit.cpp::scan`; host `guest-jit.js`
validates/installs already-emitted modules and cannot add that compiler coverage.
Original GC/live-entry/guard gates and desktop throughput remain unmet.

## Reachable native tool improvement

To use the accessible build route productively, this agent owns the pinned
findutils4.10.0 `posix_spawnp` source adapter and native test script. The package
agent owns actual compilation, signed packaging and runtime publication.
`prepare-findutils-spawn.py` changes only target `find/exec.c` and
`xargs/xargs.c`: child cwd/stdin use spawn file actions; GNU wait/status logic
and xargs scheduler remain in place; E2BIG splitting,126/127, parallel slots and
ordinary client failures are explicit. No fork result or child success is faked.
`findutils-spawn-check.sh` exercises genuine guest executables, preserving failed
owned evidence. Source2 native build and signed r1 runtime gates below now pass.

## Independent package-persistence review

First review found two exactness gaps: a base P/V-only identity could miss a
same-version rebuild, and a trusted signed same-version archive could replace the
installed payload silently. The package agent corrected both: canonical P/V/C
inventory, native `apk index` checksum binding before snapshot commit, and full
base installed-database identity. The second source review found no new blocker
in signature preflight, offline replay, atomic pointer/previous preservation,
ABI/trust mismatch refusal or explicit recovery. Actual multi-boot/failure gates
remain mandatory; source review is not durability acceptance.

## Final composition v2 and actual native observation

V1 is diagnostic-only: it omitted later desktop extras from the generation.
V2 pins the exact raw extras digest/size and optional gzip digest/size. The
loader verifies actual downloaded/decoded bytes, rejects prebundled proof paths
including CPIO aliases, and writes generation+extras proof only in its final
transient overlay. Legacy/unverified composition gets an empty proof and keeps
native purge-marker invalidation. No proof is persisted in home.

The first native v2 run selected the existing http1-profile, LastPlatformDir
/opt/firefox, and LastAppDir
/opt/firefox/app-5c0ea00a25f77f0e2b4fccb865d98266067d91790d90e8c1b999426fbc438722
with correct159 build identity and no InvalidateCaches field, per
/mnt/p3/codex-build/lwc/cache-compat1/compatibility.json. This proves the shell
proof/resource path, not warm reuse or30-second usability. That launch painted
52.307s, focused53.888s, then correctly failed exact input because the screenshot
shows readinessevidencce (extra c) instead of readinessevidence. Integration owns
native input-event diagnosis and graceful Close/Stop/warm acceptance.

## Native findutils source2 and signed r1 acceptance

First spawn candidate passed22/24 find/xargs checks but255/signal paths segfaulted.
Readable musl exit.c intentionally traps recursive exit; GNU xargs fatal-child
handling called exit during atexit. Source2 returns to wait_for_proc_all after
reaping every child, allowing its existing _exit path to return124/125. The main
scheduler still stops new work on fatal status. No child success is fabricated.

Fresh build started14:28:14.453131 UTC, ended14:29:31.720432,77.267s,exit0.
Source2 xargs SHA256:
cce65505a5002f586c7e88cc1fbc08e48727813228c6963fe3fc5497a1c2c7c3.
Signed findutils4.10.0-r1 APK SHA256:
4c485eb661b7ee584d50374f83d66fa7f86ccaed7d8c1a88babb2e57905b30ac.
Final runtime3 owner started14:33:57.399855 UTC, ended14:34:22.162904,24.763s;
real guest18.512s. All71 behavior checks passed (32find/xargs,39tar/wget), plus
signed APK installation/removal. Fatal255/signal pass serial+P2: existing siblings
finish, no new third job begins after fatal reaping, and child PIDs disappear.
Valid HTTPS,404 and real self-signed rejection pass. Default CA discovery passes
with SSL_CERT_FILE,SSL_CERT_DIR,CURL_CA_BUNDLE explicitly unset and asserted absent.
No insecure TLS option was supplied. Guest/browser exit0,errors empty,owned
remaining processes0. CPU/RSS/availableRAM1s,PSS5s;3CPU,512MiB guest. Runtime peak
RSS1,838,227,456 and sampledPSS1,180,037,120bytes; build peakRSS214,798,336 and
sampledPSS127,277,056bytes.

Exact identities, check lines, and failure-before/fix-after receipt hashes are in
tools/guest-packages/evidence/findutils-native-spawn-20261103-1322.json.
Native-command acceptance is separate from full production desktop installation,
package persistence, mobile/iOS, native Firefox restart and broad JIT guard/GC
acceptance. P2 is covered; unbounded P0 is not claimed. The overall acceptance
score remains42/100 until the project manager integrates measured target gates.

The reused native shell lacks reliable set-u/EXIT-status behavior. Native tests
now emit explicit final status without relying on EXIT traps. Package persistence
is being moved to a checked native helper; do not enable the old shell helper
based on source review alone.

## Follow-up review and bounded experiment preparation

Recorded UTC: 2026-11-03T15:17:57.565143+00:00. Root score is now **44/100** after signed GNU ports and
native keyboard/Stop cleanup acceptance; Firefox startup, native restart, broad
JIT, full graphics conformance, 50% host performance and iOS remain unmet.

Future cache builds now use `linuxonweb-firefox-app-generation-v3` and bind the
verified **pre-generation base archive SHA256** and explicit **/init SHA256**,
plus the existing native/resource/kernel/font/ABI/extras identities. There is no
self-hash: the produced archive is not an input to its own generation. Existing
cache candidates remain byte-identical; clean persistence base images can be
inputs, but existing cacheLifecycle metadata, generation paths or cache proofs
are rejected. The final combined image needs a fresh two-boot native gate.

The v2 launcher was observed in actual Firefox compatibility metadata with
LastPlatformDir=/opt/firefox and generated LastAppDir, correct native BuildID,
and no InvalidateCaches. This establishes the app-directory/proof route, not
warm cache reuse or a 30-second usable launch. See integration receipt
`../../../codex-build/lwc/cache-compat1/compatibility.json`.

Independent input source review covered host-owned repeat (explicit browser
repeat only), native TinyX EV_KEY2 handling, and key/button release before
persistent-home settle and machine close. The exact deployed TinyX source was
read from commit feab72ca891bc04b18763763e15ee4e532369cdf; owned copy
`../../../codex-build/f3l/tinyx-kinput-pinned.c` has SHA256
fd4e8b1f350a6b390159875edd11284fcb50a98aaf1434af144ae0614e756e6b.
Integration's two native input runs passed 12 assertions, rapid nonce typing
and navigation. The promoted input change is integration commit 3c7709c.

Native Quit still missed its original 20-second exit gate in input-host2 even
after the actual Quit confirmation was clicked. Read-only I/O comparison shows
progress, not a proven deadlock: +6,535 calls and +16,885.390ms occupied time;
2,442 writes (10,324,884 bytes), 2,351 fsyncs and 122 renames, no recorded errors.
startupCache.4.little accounted for 5,497,688 bytes/861 writes; RemoteSettings
SQLite and WAL accounted for another 3,836,584 bytes/1,417 writes. Native startup
cache source writes the final header last and waits for the shutdown writer.
A root-approved later 60–90-second observation must preserve the failed 20s
result and inspect progress/owned processes before diagnosing a deadlock. No
write buffering, cache seeding or packed resources are enabled.

The production desktop Test-menu control agent is injected into normal GUI
boots. Independent review confirms moving its hvc0 open/read until after the
X socket exists avoids consuming pre-X package-recovery shell input. Console
and non-GUI modes already exit. Its bounded readiness wait remains; documented
recovery uses disable/previous then Stop/Start, and a real recovery echo plus
normal post-X Test-menu action should verify channel ownership.

`prepare-method-threshold.py` stages off-default PBLBC_HITS=50/10/200 overlays.
The native binary, admission flags, guard/GC policies, PBLIC/PBLJIT thresholds,
and original purge-marker cache policy remain unchanged. Exact matched scene:
`../../../codex-build/g3g/fx-overlay5/gpt6-astra-graphics-firefox-benchmark.html`,
36,031 bytes, SHA256
e610e6b07da7622ed0724308dd5867b93330ad2a740c515dea46bfa1b1a929c0;
raw extras 60,034,048 bytes, SHA256
e5a3450e6ed15cb81e480ca51dcf1d06a90b5f9c391091283fe4dfc878a5ca39.
The unchanged scene waits 10s from its first callback, then measures every
callback interval until the first callback after 20s, including long stalls.
A proposed 150s outer quiet-observation period is **not** the scene warmup.
The metric is native-page rAF callback rate, not physical displayed-frame rate.
There is no supported complete final tier-stat dump; sparse native compiler/
entry snapshots must not be extrapolated into final counts. Existing broad
GC/guard acceptance requires a reviewed full native build/observer binding that
is still unavailable; an improved threshold FPS alone cannot promote JIT.
No threshold benchmark or WebGPU readback presentation test has run yet.

## Threshold diagnostic stopped without an accepted native sample

Recorded 2026-11-03T15:49:55.563371+00:00. Overall score remains44/100.
The predeclared50→10→200→50 experiment is **incomplete**. Fixture composition
passed13.009s; the first host control passed37.258s and measured59.948831fps
(1,199 callbacks /20,000.390ms, full wall20,001ms) on the exact pinned scene.
The first native50 owner completed181.367s with no remaining processes, but
its150s observation showed only21 total scene frames and no finished20s sample.
The instantaneous2fps label is not an accepted FPS result. Automatic follow-up
arms stopped at the completion predicate; thresholds10/200, second50, and final
host control were not run. No threshold or native performance promotion occurred.

The native source/header/artifact identities passed. Absolute log timings from
pageTimeOrigin were WM36.575s, PBLBC60.938s, page script135.625s and WebGL142.224s.
Comparable earlier APK4 absolute WM/PBLBC times were18.041/33.826s; actual WM
handshake durations were536ms versus1025ms, a separate metric. Current log55,019
characters is smaller than the earlier successful readiness run's59,589; minimum
available RAM was25.788GB. Source hypotheses include the new pre-X agent waiter,
which repeatedly spawns BusyBox sleep, and observer/configuration differences.
Actual native wait-loop/spawn counts were not captured, so causality is unproven.
The outer bounded owner also sampled resources in addition to the existing
startup monitor; this difference is retained as a potential observer confound.

Root authorized only a targeted waiter rollback/event hook after all benchmark
owners ended. The existing native wait-for-aurora helper cannot directly govern
recovery input: both a real handshake and its10s timeout return0. Integration
owns a post-successful-restore event hook and its subsequent production tests.
No active test process remains owned by this agent. Curated receipts and retained
screenshot: `tools/firefox-lifecycle/evidence/method-threshold-incomplete-20261103-1322.json`
and `method50-incomplete-20261103-1322.png`. Required broad JIT guard/GC/build
binding gates remain unchanged and unmet.

## Quota audit and explicit WebGPU diagnostic (2026-11-03, around 16:20 UTC)

An isolated real NVIDIA/WebGPU clear/readback diagnostic observed 60 render passes and 48 full-target pixel checks, explicit CPU readback to 2D ImageData plus ImageBitmap/attached 2D presentation, and closed renderer resources. The unchanged direct WebGPU canvas export reproduction still lost its device on the first bitmap export (`VK_ERROR_OUT_OF_DEVICE_MEMORY`). These are functional observations only: no native Vulkan, shader-draw, conformance, throughput or default-backend claim. Historical bounded owner receipts did not record descendant cgroup ancestry, so constrained acceptance is withheld pending a representative recheck.

A separate integration browser was observed migrating automatically through the desktop D-Bus session to an unlimited systemd scope. Retrospective `method50a` internal monitoring contains 160 samples / 2,084 process observations, all under the same `/cpulimit.slice` three-CPU ancestor; its experiment remains incomplete and double-monitored. Host-before and both graphics receipts only recorded owner quota and therefore have an explicit unknown-descendant qualification. The new graphics launcher isolates its owned D-Bus address and requires the actual shared-ancestor preflight before navigation, with continuous checking delegated to the updated single bounded owner. No cgroup permissions or limits are modified.

## Explicit readback adapter source checkpoint (2026-11-03, around 16:35 UTC)

An off-default adapter now routes real WebGPU renderer readback through opaque CPU 2D ImageData presentation. Configuration must explicitly select `readback-2d` with effective WebGPU; WebGL fallback and external renderer factories are rejected. The normal direct mode is unchanged. Limits are 512x512, 16 surfaces / 16 MiB CPU canvas stores and one pending presentation. Close/forget cancel late frames; failed synchronous sinks close their owned ImageBitmap. Session selection is captured before asynchronous work. Integration independently reviewed the source with no diagnostic blocker; current sink ownership is explicitly synchronous.

Eleven focused ownership/backend rejection tests passed under the updated bounded owner in 1.255 seconds, one resource sample, no surviving owned descendants. These use a stub renderer and do not establish GPU acceptance. The separate real adapter fixture checks all pixels across 48 clear/readback presentations; the native WSI fixture records actual first-frame pixels and requires nonuniformity plus native draw/close/resource evidence. Both real fixtures await a shared-three-CPU guarded browser lane. The earlier historical raw readback/direct-loss observations remain qualified because descendant quota was not recorded.

The single-monitor startup watchdog was updated for the new all-thread inventory and cleanup-error API but has still not run a Firefox performance gate. A stalled owned Git inspection pager was identified by its exact argv and PID/start identity and terminated; no other sessions were touched.

## Guarded real WebGPU/native WSI result (2026-11-03 16:41:30.741–16:42:52.554 UTC)

The three serialized single-monitor owners passed with actual before-navigation and per-second common three-CPU ancestor checks: raw pixel diagnostic 5.512 s; actual adapter pixel diagnostic 5.760 s; native Vulkan WSI 14.755 s. Each cleaned all owned host processes. Raw/adapter each completed 60 real WebGPU passes and 48 full-image deterministic pixel checks; adapter split 24 ImageBitmap / 24 attached-2D frames and closed all resources/canvas stores. Native WSI retained exactly the old archive6c121d5e… and binarycc4a4c6c… identities, now using explicitly selected WebGPU plus CPU readback presentation. It completed 1,443 passes / 4,329 draws / 1,443 presentation calls, two shader translations, a real512x512 sampled-target pixel probe, and zero native WSI/GPU/CPUcanvas resources at close. Its first128x128 bitmap had151 distinctRGB colours; child and root visually reviewed the red/green/blue gears PNG. Native owner peak sampledPSS1,400,267,776B/RSSsum2,089,885,696B;14resource samples/3PSS. Short raw/adapter PSS peaks are sparse lower bounds (onlyinitial sample); no memory-size inference from them.

The native gear submission-loop rate is not physical refresh or matched Firefox performance. Root accepted this functional fixture evidence with no score increase and required the adapter remain off-default. Curated report+PNG: tools/graphics-benchmark/evidence/gpt6-astra-webgpu-readback-quota-20261103-1322.{json,png}. Original direct-export device-loss reproduction remains unfixed.

After the graphics lease, independent Stop source review found no proven Worker registry leak: worker exit posts then self.close(), and the web terminate wrapper requests asynchronous browser teardown. Integration actual recovery2 subsequently attributed all49 workers to the sole blank-created page and observed47→40→0 within1.327 s after idle; no product Worker patch was needed.

Final performance preparation is one default50 native run bracketed by host controls, exact persistence-image1 manifest9da17bf9… /Firefox archive4b20a717… /native26e380d… /cacheOFF. New scene builder adds only the frozen e610e6… HTML and result stdout preference to the unchanged current production extras prefix5b624dd8…, with native launcher/init unchanged. Integration approved source; no image build or benchmark has run at this checkpoint. Throughput-mode proxy omits HomeFS/input/worker rewrites; only sparse log-row timestamps remain. One required resource monitor, sole blank page and common shared cap apply. Native observation bound240s; all completed intervals/overruns count; no content-viewport or physical-refresh claim.


## Pre-release review and score qualification (2026-11-03, around 17:18 UTC)

The confirmed overall score is **43/100**. Earlier 44/100 entries remain historical and provisional: the additional desktop-input point still requires the representative twelve-assertion native gate under the verified shared three-CPU cap. Functional graphics fixture acceptance adds no points toward broad API conformance or matched Firefox throughput.

Independent recovery-source review found and closed three concrete issues in the generated runtime restorer: Python optimization could disable assert-based hash checks; restored image/part paths needed canonical containment; and later extra archives could collide with the reconstructed Firefox image. The corrected script uses explicit size/type/SHA exceptions, canonical paths and symlink rejection, exact regular-file archive inventories, cross-archive destination collision rejection, and final verification of every restored member including Firefox. Seven focused synthetic cases passed, including optimized Python and corrupt/traversing/colliding artifacts. This does not replace the final exact capture/restoration or public privacy-audit receipts.

The original 80a52d1 encrypted base plus the final cumulative increment and the separately pinned runtime remain the recovery contract. The increment includes an encrypted signing-key recovery copy under the original recipient certificate; no plaintext key belongs in source/runtime archives. Bundle prerequisite verification, fetch and fsck were performed before encryption; full cross-environment decryption remains unverified. Public filtered source excludes evidence directories, so the final delivery must separately include its consolidated acceptance report, iteration ledger, continuation and selected receipts/screenshots.

Source checks confirm FUSE does not negotiate WRITEBACK_CACHE, persistent-home writes await their IndexedDB transaction completion, host keyboard-repeat ownership defaults on with the explicit input-repeat=guest diagnostic opt-out, and the WebGPU readback adapter remains off-default. The currently published old manifest is d258203daee8 with Firefox4675a8ce and no cacheLifecycle; publication of the approved persistence candidate has not yet occurred. Final release review must inspect the actual new published route and hashes rather than infer them from candidate directories.

The one final matched-scene benchmark remains queued behind Android and strict cache acceptance. It uses the unchanged persistence-image1 Firefox bytes, default method threshold 50, cache lifecycle off, exact frozen scene, host controls before and after, one resource monitor and the actual shared three-CPU ancestor. Its native observation is bounded at 240 seconds and its total heavy lease at seven minutes. A missing complete elapsed sample means no FPS acceptance, and any complete current measurement is not an engineering before/after speedup claim against differently instrumented historical runs.


## Final matched sample and release review (2026-11-03, around 17:45 UTC)

The confirmed score is now **45/100**: the representative native keyboard gate passed under the shared CPU cap, and the final Android package install/save/Stop/offline restore/hash/import/home-data gate passed. Neither adds a Firefox throughput or full API conformance claim. Strict cache cold usable readiness was 105.438 seconds; the shutdown confirmation click raced rendering and left the dialog open, so that run does not prove a native shutdown hang, clean close or warm-cache acceptance. Cache lifecycle remains off by default.

The final fixed-setting benchmark occupied 17:25:28–17:32:01.304561 UTC. Fixture composition took 11.297 seconds. Host controls measured 59.550409 and 53.529418 fps with the same frozen scene, each including its complete elapsed sample and stalls. To preserve the hard seven-minute slot and host-after control, the outer native observation was shortened before launch to 151 seconds; the actual scene still used the unchanged 10-second warmup and 20-second sample. The native owner ended early after 83.253 seconds when its monitor could not verify one disappearing process. Every owner cleaned up with zero remaining processes. No native completed record, FPS ratio, threshold improvement or engineering speedup is accepted.

At monitor sample 77,475.004 ms, one exact PID/start identity had RSS zero and an empty cgroup. The same identity was under the common three-CPU ancestor in the preceding sample and absent in the following sample; no actual unlimited group or membership migration was observed. Source review found that a failed status/cgroup read remained in the group intersection without revalidating identity. Integration fixed this separately with explicit live/terminal/unknown identity states and twelve focused cases: only proven disappearance, PID reuse or Z/X/x states can be excluded; unknown live processes still fail closed. The original failed receipt remains unchanged in status. Curated JSON and screenshot are tools/firefox-lifecycle/evidence/matched-default-incomplete-20261103-1322.{json,png}; the image shows desktop/settings, not a completed Firefox benchmark.

A scoped production HTTPS authentication helper is ready for the final route smoke. It consumes a private grant file without printing its contents, follows normal browser authentication in a separate unlogged CDP connection, verifies the exact public manifest, returns to the sole blank page with no worker targets, discards private console cache and closes its connection before ordinary owner logging attaches. Six synthetic boundary cases passed in 1.756 seconds; this is not actual HTTPS browser acceptance. Integration owns the production owner integration and final runtime capture/publication. The actual production smoke and final recovery/public privacy receipts remain the next release-review evidence.


## Final public-route and recovery closure review (2026-11-03, around 18:00 UTC)

The actual public HTTPS smoke authenticated through normal grant navigation and verified manifest 9da17bf9, runtime 1a3951f0c48d and matching loaded/served footer revision. Its 150-second asset window did not finish the cold rootfs downloads, so the native VM never started. Owner duration was 160.516 seconds with cleanup zero. This is a measured cold-network limitation, not native navigation, normal Stop, package-PATH or 30-second startup acceptance. No longer retry was authorized. The historical 3.48/59.85 fps comparison remains the latest accepted full scene; this session's current comparison is incomplete and has no accepted ratio.

The original score weights were independently recovered from frozen81103b2 AGENTS.md and handoffs: desktop/stability15, I/O+startup25, JIT15, graphics25, packages10, mobile5, preview/reproducibility5. The current45/100 is7+10+4+9+8+3+4 on those unchanged denominators.

Recovery source audit found the three xterm runtime files are Git-tracked and recoverable from the full encrypted Git chain, but filtered out of the public source tar and omitted from the runtime archive. A219830-byte exact supplement now supplies those three unchanged files, the unchanged377315-byte optional WebGPU decoder, the complete existing embedded MIT notice and precise provenance. No npm version is invented, and decoder inclusion does not enable/accept that optional route. The supplement binds immutable runtime-manifest SHA fed503455594836a87b131d2e62a62a12bdd0c220c4e9768b0d5c6dd65d1b081. Seven actual optimized-Python restore/idempotence/conflict/integrity checks passed; all62 unique public HTTPS response paths are covered by tracked public source, exact runtime or supplement. Response-header coverage does not imply the large downloads completed.

The tracked local server is web/desktop/serve.mjs and uses eight Node built-ins, without npm runtime dependencies. Run LINUX_WEB_PORT=4173 node web/desktop/serve.mjs from the restored checkout, then open /linux/index.html or the package console with ?cpus=1. The server supplies isolation headers and the DNS/TCP bridge and serves latest-build overrides. Existing live-preview grants remain private and are not part of recovery. Cloudflare/Sites deployment tooling is separate.
