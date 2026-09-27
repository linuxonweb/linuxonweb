# Honor Firefox startup preferences

The packed init previously supplied `https://www.bing.com` on every Firefox
launch, overriding the user's configured homepage. The accepted candidate
removes that one URL argument. The explicit profile path, environment, Aurora
readiness gate, certificates and existing profile preferences remain unchanged.
The generic init source also stops supplying the forced URL for future builds;
it was not used to reconstruct the accepted archive.

The candidate is version `89ec54c81936`, gzip SHA-256
`7ad492fe595d19e210da1a365640d5e10680d5ba4e41ae85c73e0949fc2761b0`,
88,300,032 bytes. Only the packed init changes; the other 11,469 CPIO records
are identical, with original ordering, metadata and archive tail preserved.
The previous four system inputs are saved under
`/mnt/p6/build/firefox-homepage-20260926/baseline-images/`.

`tools/guest-rootfs/package-firefox-homepage.py` reproduces the candidate from
those pinned baseline inputs. Give it `--source`, `--manifest`, and a fresh
`--output` below `/mnt/p6/build/firefox-homepage-20260926`. Export `TMPDIR`,
`TMP` and `TEMP` to that task's disk-backed `tmp` directory. It imports the
existing CPIO preservation helpers and requires two GiB of free disk space.
It never rewrites an existing candidate or the accepted source files.

`tools/guest-rootfs/test-firefox-homepage.mjs OUTPUT CANDIDATE [fresh-default]`
owns a finite HTTP/proxy server and Chromium process. With an isolated browser
profile, it seeds a home marker and user homepage preference, boots the accepted
baseline, navigates to a local guest page, types through the real guest input
path, and receives a Firefox-generated HTTP beacon. It then invokes the actual
Update & restart control and checks automatic homepage loading and input after
the update and a warm reload. The optional mode tests the candidate with no
pre-existing Firefox profile or user.js. All processes and test sockets close.

The baseline/update/warm run and independent fresh-default run passed. Exact
user.js content and the home marker survived update/reload. Warm boot requested
zero kernel/rootfs images. Fresh startup showed Firefox's New Tab, followed by
successful typed navigation and page input. Screenshots of default startup,
updated profile and warm profile were inspected. The initial harness attempt
failed before boot due to a string-escaping bug and remains preserved.

Observed launch-log times were 9.033 s baseline, 13.478 s update including image
download/restart, 10.815 s warm candidate, and 8.880 s fresh candidate. These are
single observations, not first paint. Baseline and fresh-default runs deliberately
waited 30 s before navigation; their page-ready times are not comparable with
the automatic candidate homepage. No speedup ratio is claimed. The verified
benefit is removing an unwanted launch target and honoring saved startup settings.

Compact evidence is `docs/evidence/runtime-graphics-20260926/firefox-homepage.json`.
Raw packages, browser profiles, exact harness copies, screenshots and reports
remain under the disk-backed task directory. Native JIT, general guest OpenGL,
Firefox GPU acceleration and hardware video decoding are unaffected.

## Public deployment and unresolved acceptance

Sites version 7 is deployed at https://linuxonweb.exact-coot-7512.chatgpt.site.
Its source commit is `6c68ffb494ae7381581891c9a33593a22e2faf93`, saved version
`appgprj_6ab78cc88a948191a1abaabd04b81fe0~appgver_38c6842a13d48191afadf08d8f3b9e94`,
deployment `appgdep_6ab8566b78b8819198870bd7939e570a` (succeeded). Only the
rootfs and boot-manifest routes differ from the preceding release. Local Sites
unit tests (10) and built-worker runtime checks (3) passed.

`public-assets-run3/result.json` verifies all 66 published routes, including the
complete Firefox archive hash, isolation headers, and cache policies. For the
two HTML documents, verification removes one exact hosting-injected Cloudflare
challenge template with a validated dynamic ray/timestamp, then compares the
entire original document. The first two checks failed on that injection and
remain preserved. The Sites-ingested tar wrapper differs from the local tar;
content was verified through published routes, not by claiming archive equality.

Public release acceptance is **incomplete**. `public-run3` passes cold startup,
guest JavaScript and typed input, but automatic warm restoration leaves a blank
tab and does not produce the guest-generated result file. `public-run2` also
failed that gate. A copy of the failed profile (`public-recovery-run2`) loads
the saved homepage and passes input/JavaScript after explicit Alt+Home, with
zero kernel/rootfs requests and exact user.js/home marker preservation. This
intervention does not prove automatic restoration. Its later HTTPS navigation
to example.com shows `PR_CONNECT_RESET_ERROR`; it is not a successful network
check. Owned browser and finite server processes exited cleanly.

`profile-inspect-run1` exports only an isolated copy's selected Firefox profile
files. Its recovery JSON decompresses successfully, records one recent crash,
and contains the expected file homepage URL. This rules out a missing session
file in that case; it does not prove all session data or restoration behavior is
correct. Keep version 6 available for rollback while investigating. Do not use
the recovery harness's narrow `pass` field as whole-release acceptance.

## Startup restoration investigation

The same file-homepage failure is reproducible locally. A diagnostic-only
image logs `_restoreHistory` using `remote=true`, followed by
`restoreDocShellState` rejecting with `NS_ERROR_FAILURE`. The preserved native
source already disables remote content processes for Wasm at compile time.
Adding `browser.tabs.remote.autostart=false` and `fission.autostart=false` to a
test profile does not fix restoration, and neither does disabling crash recovery.
Those experiments are not production changes.

The exact packed `tabbrowser.js` has an unchecked fallback: when its initial
URL is a promise waiting for session initialization, it selects the privileged
remote process. This bypasses the normal URI path's single-process check.
`package-firefox-session-startup.py` creates a pinned candidate which selects
`NOT_REMOTE` for that fallback when `gMultiProcessBrowser` is false. The remote
case remains the same. Only that CPIO member changes; init, user preferences,
11,469 other records, metadata except member size, ordering and tail are preserved.

Candidate `b354310fe03e` is 88,406,516 bytes, SHA-256
`9a651dee0be08e6a0ffe0b2ee5b49376310d57c9b66fe72fc58959034f4ef2a0`.
Its package is preserved under `session-startup-candidate-run1`; it is now
promoted locally, but not deployed. The preceding v7 inputs are preserved in
`session-baseline-images`, with `session-promotion-run1/result.json` recording
verified replacement of the local archive and manifest.
The first candidate test visually restored the real page but failed its input
gate: a notification banner moved the input below the test's fixed click point.
The subsequent test uses the fixture's autofocus instead. Preserve that failed
run and do not describe it as a passing input gate.

The second attempt restored a delayed first-run privacy tab rather than the
fixture. The reusable `test-firefox-session-startup.mjs` therefore disables
`datareporting.policy.firstRunURL` only in its owned test profile and retains
the normal notification banner. It does not disable crash recovery, alter
production privacy settings, or type a navigation/Home command during warm boot.
`session-startup-run3` passes cold and automatic warm page/input/JavaScript
checks with the exact candidate. The guest writes a new JSON result after each
phase through its normal download path, containing the Firefox UA, typed value,
timestamp and computed checksum. Exact user.js and home marker survive; warm
boot has zero kernel/rootfs requests. Screenshots were inspected, and both
owners closed normally. Observed launch logs are 7.385 s cold and 6.358 s warm;
the test intentionally waits 30 s before typing, so no speedup ratio is claimed.

The same test also offers `update` mode, which starts the pinned baseline,
clicks the actual Update & restart control, verifies candidate startup/input,
and reads back the exact earlier downloaded result. Both `session-update-run1`
and `session-update-run2` pass. The final runner takes an optional fifth argument
for the baseline package directory, so it can replay after promotion; its default
is the preserved v7 `candidate-run1` directory. The paired unmodified v7 control
(`session-control-run1`) passes cold startup but fails the warm input gate with
the blank tab. All these owners exited normally. Compact evidence is
`docs/evidence/runtime-graphics-20260926/firefox-session-startup.json`.

The Sites snapshot is frozen in `session-release-run1/release-src/web/cloudflare`:
exactly two changed routes, 58 logical routes, 55 parts, 151,597,037 staged bytes.
It is staged only; pinning, Sites tests, source push, publication and public
acceptance remain required. The public deployment is still version 7.
