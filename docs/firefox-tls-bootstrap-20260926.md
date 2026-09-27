# Firefox trust bootstrap diagnosis and candidate

The deployed v8 Firefox can retain a partially initialized certificate store.
Its Wasm NSS fallback returns as soon as **any** SSL-trusted CA exists. A reload
during the first initialization therefore leaves missing roots unrepaired on
later boots. The observed failing profile has 119 certificates but only 11
guest-format trust records and shows `SEC_ERROR_UNKNOWN_ISSUER` for Bing.

The corrected key-free candidate is locally promoted after update acceptance,
**not yet a deployed fix or whole-goal completion**. Public version 8 and its
rollback versions remain unchanged until Sites deployment is verified.

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
presence: explicit zero-flag decisions must also be preserved. The subsequent
`distrust-update-run4` test creates both zero-flag and explicit-distrust choices
through guest NSS, then verifies their native rows survive a real update.

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
**Rejected seed: do not publish `prepared-seed-run1` or `fast-candidate-run1`.**
Further review identified its secret object as the default SDR/password-encryption
key: class `00000004`, type `00000015`, ID `F8000000000000000000000000000001`,
matching the build's `security/nss/lib/pk11wrap/pk11sdr.c`. It is not a client
certificate key, but it must still never be shared between user profiles.
Earlier runtime checks did not establish seed suitability for distribution.

`tools/guest-rootfs/prepare-firefox-nss-seed.py` prepares a replacement from the
owned stopped diagnostic profile. It rejects unexpected private objects, removes
the SDR object and its `sig_key_<object>_*` authentication metadata, then uses
SQLite secure deletion and vacuum to remove deleted payloads from free pages.
The 119 native trust rows and all remaining authentication/password metadata are
verified unchanged. `prepared-seed-run2` contains zero private objects. Existing
user databases are never passed to this preparation tool. Fresh-profile key
independence and runtime trust acceptance remain required before promotion.

The rejected fast candidate `fast-candidate-run1` changes exactly three CPIO members:
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

## Later release checks and replacement seed

The unpublished old seed passed several functional checks but remains rejected
for distribution. `partial-update-run1` used the actual update/reload control to
repair 108 missing trust records and preserve the 11 existing rows. It retained
the home marker, downloaded file, user preferences, existing private-key rows,
and existing key-database metadata. The key database is not byte-identical:
repair adds 756 authentication metadata records. `distrust-update-run4` preserves
all 119 native trust rows, including the two deliberately changed choices, and
rejects a self-signed certificate. Its positive navigation rendered Google after
a synthetic typing error; it is not evidence of Bing acceptance.

`media-regression-run5` completes three 3.01-second valid playbacks with 30 frames
and zero dropped frames each, rejects the malformed clip with decode error 3,
and plays correctly afterward. Host audio receives 473,016 frames without drops.
This verifies software decoding and Web Audio delivery, not hardware decoding.
`fresh-control-run1` supplies the missing clean v8 control: its driver/browser
exit zero, server closes, all 119 roots initialize, and Bing renders over HTTPS.
The original diagnostic's exit 143 remains a failed lifecycle observation.

Replacement `fast-candidate-run2`, version `29331a186e50`, uses the same native
module and the key-free `prepared-seed-run2`. Its archive is 88,378,783 bytes,
SHA-256 `7bd5e9041d568c6b5b325abba16754d943a51b009c368c39901c0fb0a751508a`.
Exactly the Firefox module and two seed databases change; 11,467 other CPIO
records remain unchanged. `safe-seed-warm-run2` passes actual guest input and
JavaScript, preserves home, initializes zero additional trust rows, and renders
Bing over HTTPS after warm reload with zero boot-image requests. Cold/warm
launch markers are 7,443/6,090 ms; these are not first-paint measurements.

Two independent guest profiles (`safe-seed-warm-run2` and `safe-seed-warm-run3`)
each generated their own default SDR key from the key-free seed. Host NSS 3.125
successfully encrypted/decrypted a fixed test string with each profile and
rejected cross-profile decryption in both directions. The guest-generated key
objects remained byte-identical during these checks. This establishes key
independence, not a test of the guest password-manager UI. The preparation helper
also rejects unexpected secret objects and refuses to overwrite an existing
output. See [firefox-nss-seed-isolation.json](evidence/runtime-graphics-20260926/firefox-nss-seed-isolation.json).

The replacement's first invalid-certificate screenshot is inconclusive: it
shows pending navigation over the previous Bing page. A subsequent update test,
`safe-seed-update-run1`, fails on the **v8 baseline before clicking update**:
the file homepage remains blank and cannot produce the input-result download.
It closes its browser/server cleanly. Retain its screenshot and guest logs;
do not count the old image's failure as replacement update acceptance or as
proof of a replacement regression. The cause remains unproven.

`safe-seed-media-run1` repeats the media gate on the exact replacement image:
three valid playbacks end at 3.01 seconds with 30 frames and no drops, malformed
padding produces decode error 3, and playback works afterward. Host audio
receives 473,528 frames without drops. Its browser/server close cleanly.

`ready-update-run2` completes those local gates against the exact replacement:
real Update & restart, repair of 108 missing trust records while preserving the
existing 11, home/old-download preservation, HTTPS Bing, and rejection of
self-signed.badssl.com without accepting an exception. Existing private objects
and key-database metadata remain identical; new trust authentication metadata is
added. Its browser exits zero and test server closes.

The test now waits for a JSON readiness download emitted by actual guest page
JavaScript before sending Escape or typing. In the diagnostic run the page was
ready 15.146 seconds after NSS initialization, later than the old 10-second
wait; an early Escape can cancel navigation. The first readiness run additionally
exposed automatic downloads-panel focus capture. Only fixture preferences now
disable that popup; production preferences are unchanged. Preserve both failed
runs, rather than treating this evidence as proof of every blank-tab cause.

Version `29331a186e50` is now promoted locally. The staged Sites snapshot changes
only the Firefox image and boot manifest: 58 routes, 55 parts, 151,569,304 bytes.
Build/test the pinned Sites archive, deploy, and repeat public acceptance next.
All fixture images and owned profiles remain excluded from deployment.

No owned service remains running. User PID 1591443 retains startTicks 148821663
and its original command. The wider JIT, general GL/Vulkan, and Firefox hardware
decoder requirements remain incomplete; the whole-goal estimate stays 75/100.
