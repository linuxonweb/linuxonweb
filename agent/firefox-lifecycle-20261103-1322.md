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
