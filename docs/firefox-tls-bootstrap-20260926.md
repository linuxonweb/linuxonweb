# Firefox trust bootstrap diagnosis and candidate

The deployed v8 Firefox can retain a partially initialized certificate store.
Its Wasm NSS fallback returns as soon as **any** SSL-trusted CA exists. A reload
during the first initialization therefore leaves missing roots unrepaired on
later boots. The observed failing profile has 119 certificates but only 11
guest-format trust records and shows `SEC_ERROR_UNKNOWN_ISSUER` for Bing.

This is a locally verified candidate, **not a deployed fix or whole-release
acceptance**. Version 8 and its rollback versions remain unchanged.

## Evidence

Artifacts are under `/mnt/p6/build/firefox-tls-20260926`, on disk-backed storage.
The compact record is [firefox-tls-bootstrap.json](evidence/runtime-graphics-20260926/firefox-tls-bootstrap.json).

- `persisted-trace-run1`: copied owned v8 browser profile, public origin.
  NSS reports `certs=119 trust=119 sslCA=11`, skips repair, and Bing displays
  `SEC_ERROR_UNKNOWN_ISSUER`. Advanced details were expanded; no exception was
  accepted. The diagnostic harness exits zero and closes its browser/server.
- `fresh-trace-run1`: fresh owned v8 public profile. NSS reports zero trusted
  roots, then `eligible=119 updated=119 error=0`. Guest log timestamps bracket
  initialization at 57.908 seconds. Bing subsequently renders with an HTTPS lock.
  **The driver unexpectedly exited 143 before final reporting.** Its surviving
  browser was inspected, navigated away from the VM, and the stopped profile
  exported through `review-tls.mjs ... finish`, then closed. This is diagnostic
  evidence, not a clean harness pass; the signal's cause is unknown.
- `resume-partial-run1`: isolated local candidate seeded with the failing
  profile's exact `cert9.db`, `key4.db`, and `pkcs11.txt`. NSS reports
  `eligible=119 updated=108 preserved=11 error=0`; Bing renders with an HTTPS
  lock. SQLite inspection verifies all 11 pre-existing native trust rows remain
  byte-identical. The driver exits zero, browser exits zero, and server closes.
- `fast-fresh-run1`: fresh profile booted from the candidate image containing a
  prepared trust store. NSS starts with `sslCA=119`, then reports
  `eligible=119 updated=0 preserved=119 error=0`. Bing renders with an HTTPS lock.
  The measured trust phase is 2.123 seconds, versus 57.908 seconds in the v8
  diagnostic. These are separate observations, **not whole-boot or first-paint
  benchmarks**. The driver/browser exit zero and server closes.

All inspected databases pass SQLite integrity checks. The packaged host-generated
store has 119 certificate objects and 119 class `0000000B` trust objects; guest
NSS creates class `CE534353` trust objects. The failing profile has 11 of those;
the completed profile has 119. `CERT_GetCertTrust` itself only copies the cached
certificate trust structure; readable trust does not imply SSL trust.

## Candidate implementation

Patch `web/linux/firefox-patches/0004-wasm-nss-profile-roots.patch` now snapshots
the profile's existing native trust objects using NSS APIs. It uses their SHA-1
certificate lookup attributes to distinguish already stored trust decisions from
missing records. SHA-1 is only the NSS object lookup key here; certificate
signature and chain verification policies are unchanged. The fallback writes
trust only for missing `lowland-ca-*` CA records, and requires every eligible CA
to be either preserved or successfully initialized before reporting success.
In particular, it does not use nonzero trust flags as a substitute for record
presence: explicit zero-flag decisions must also be preserved. That case still
needs a runtime negative test before promotion.

The candidate was compiled from the preserved unified NSS source unit, linked,
processed by Binaryen fpcast emulation, validated by WABT, and executed by the
real guest Firefox. The original source/object trees were preserved.

The deployed module matches exactly:
`/mnt/p6/project/linux/.cache/reliability-performance-20260926/firefox-mmap-aligned/firefox-media.wasm`,
157,420,348 bytes, SHA-256
`68b86f1dea7312483c62284fce906287afcb7f8f11b1b07697c73e6dbd49ceae`.
Use that build's response and link command, preserving its media, picker, XPT,
64 KiB mmap alignment, 80 MiB initial memory, and 16 MiB stack. The older
`final-firefox` module does **not** match the deployed module.

`resume-build-run1` contains the source, patched unified unit, reviewable patch,
input hashes, compile/link argv JSON, logs, response file, raw/fpcast modules,
and a disk-backed snapshot of the legacy unwind object. No build command uses
`/tmp`. The shared legacy unwind object was copied, not removed from its old
location; historical consumers have not all been audited.

`prepared-seed-run1` was produced from the **owned fresh diagnostic profile**,
not a user's profile. `prepare-seed.py` verifies all 119 original root DER values
and matching native trust hashes, rejects unexpected object classes/client
private keys, removes 15 incidental website intermediate certificates, and
preserves the native authenticated trust objects and matching NSS key database.
It includes the NSS database secret key; this is not a client certificate key.
The subsequent fresh candidate run validates this database with guest NSS.

The fast candidate `fast-candidate-run1` changes exactly three CPIO members:
Firefox, `/nss-ca-profile/cert9.db`, and `/nss-ca-profile/key4.db`. All other
11,467 records, member metadata except lengths, and ordering are preserved.
Guest init only copies a profile file when it is absent; it does not replace an
existing user's certificate/key database. Existing profiles use the native
resumable repair instead.

- Candidate version: `952d3cb770e4`.
- Archive: 88,398,039 bytes, SHA-256
  `3b9eb48ad5bb0fbbbab518abc687485cb45db4c38c4a2574a6049d91187665b7`.
- Firefox module SHA-256:
  `644ab48f01a8a588706d1ec1c3a97006469964c705edc0f5d599286c890c610f`.

`prepare-resume.py`, `prepare-seed.py`, `package-resume.py`, and
`inspect-firefox-tls.mjs` retain the exact candidate preparation and diagnostics.
Each run freezes its runner and input hashes. The diagnostic's `pass` covers its
lifecycle; screenshots and NSS records supply the TLS evidence. It is not an
automated whole-release acceptance test. Do not reuse output directories.

## Required next checks

Before promotion, test explicit distrust/zero-flag record preservation through
guest NSS, warm HTTPS with zero image requests, and the real update/reload path
from an existing partial profile while preserving home and keys. Repeat clean
controls, reject an invalid certificate without accepting an exception, and run
startup/media regressions. Then promote only verified inputs, rebuild and check
the Sites archive, deploy, and repeat public acceptance. The v8 diagnostic's
unexpected signal requires a clean repeat; do not relabel it a pass.

No owned service remains running. User PID 1591443 retains startTicks 148821663
and its original command. The wider JIT, general GL/Vulkan, and Firefox hardware
decoder requirements remain incomplete; the whole-goal estimate stays 75/100.
