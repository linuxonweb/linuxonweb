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
