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
owned evidence. Build and runtime results are pending.

## Independent package-persistence review

First review found two exactness gaps: a base P/V-only identity could miss a
same-version rebuild, and a trusted signed same-version archive could replace the
installed payload silently. The package agent corrected both: canonical P/V/C
inventory, native `apk index` checksum binding before snapshot commit, and full
base installed-database identity. The second source review found no new blocker
in signature preflight, offline replay, atomic pointer/previous preservation,
ABI/trust mismatch refusal or explicit recovery. Actual multi-boot/failure gates
remain mandatory; source review is not durability acceptance.
