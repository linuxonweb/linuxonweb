# Isolated Firefox readiness acceptance

This bounded local gate uses real `web/linux/main.js` and the accepted runtime.
Only `boot-manifest.json` and the Firefox archive may be served from the isolated
candidate. No production image or server source is overwritten. Read
`tools/guest-rootfs/package-aurora-ready.md` first; its `candidate/package.json`
must exist and pass review before the server starts.

This records the pre-promotion comparison procedure. The adapter's baseline
route reads the working `web/linux/` files, which now contain the accepted
candidate. Repeating the original comparison requires an isolated checkout
containing the preserved baseline image/manifest; do not treat the current
baseline selector as the old version or overwrite the accepted checkout to
repeat a test. Original baseline bytes are in the task's `baseline-images/`.

The sole serving agent owns port 4182, Chromium CDP 9396, their exact PIDs, and
cleanup. Keep that agent alive until testing and cleanup finish. Preserve user
server PID 1591443. All commands below run from the repository root. First verify
`findmnt -T /mnt/p6/build` and `df -h /mnt/p6/build`, then prepare disk scratch:

```sh
mkdir -p /mnt/p6/build/firefox-ready-20260926/tmp /mnt/p6/build/firefox-ready-20260926/server
export TMPDIR=/mnt/p6/build/firefox-ready-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
export READY_TASK=/mnt/p6/build/firefox-ready-20260926
export READY_NODE=/home/a/.config/nvm/versions/node/v22.22.2/bin/node
"$READY_NODE" --check probes/firefox-ready-server.mjs
"$READY_NODE" --check probes/firefox-live-acceptance.mjs
printf 'baseline\n' > "$READY_TASK/server/variant"
LINUX_WEB_PORT=4182 "$READY_NODE" probes/firefox-ready-server.mjs \
  "$READY_TASK" "$READY_TASK/candidate" > "$READY_TASK/server.log" 2>&1
```

The last command is long-running. The adapter reads the current dev-server source,
requires each replacement anchor exactly once, pins its repository root explicitly,
and writes the generated script and source hashes to `server/`. Original DNS/TCP,
headers, worker paths and static routing remain intact. A request-time selector
permits a same-origin baseline→candidate update without restarting the server.
An invalid selector fails closed for the two image routes. Do not change selector
during a download. After each switch, verify the response's
`X-Firefox-Ready-Variant` and served manifest version; after initial setup fetch
both archive variants to disk and verify their full SHA-256 against the manifests.
Keep accepted kernel/plain hashes unchanged. Preserve all raw evidence.

Launch a fresh visible task browser in another owned session, using the existing
graphical environment. Explicit disk cache and `--disable-dev-shm-usage` keep test
artifacts off tmpfs. Do not add flags to one arm only.

```sh
export TMPDIR=/mnt/p6/build/firefox-ready-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
/home/a/.local/archpkg/pacman/usr/bin/chromium \
  --user-data-dir=/mnt/p6/build/firefox-ready-20260926/baseline-profile \
  --disk-cache-dir=/mnt/p6/build/firefox-ready-20260926/baseline-browser-cache \
  --remote-debugging-port=9396 --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage about:blank \
  > /mnt/p6/build/firefox-ready-20260926/baseline-browser.log 2>&1
```

Capture executable/version, actual process command, profile/cache absence before
launch and active display in the run record. Baseline and candidate arms each use
fresh empty dedicated browser profiles on the same origin, the same flags and the
same fixture. These are **fresh-profile observations**, not machine-cold boots:
host OS, browser executable and Wasm caches may be warm. Never delete/reuse a
previous profile to retry; use a new suffix and retain the first attempt.

```sh
export TMPDIR=/mnt/p6/build/firefox-ready-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
export CDP_URL=http://127.0.0.1:9396 FIREFOX_READY_QA=1
export READY_NODE=/home/a/.config/nvm/versions/node/v22.22.2/bin/node
export READY_RUN=/mnt/p6/build/firefox-ready-20260926/baseline
"$READY_NODE" probes/firefox-live-acceptance.mjs boot http://127.0.0.1:4182 "$READY_RUN"
"$READY_NODE" probes/firefox-live-acceptance.mjs navigate "$READY_RUN"
```

Inspect `firefox-early-observation.png`, `firefox-launch.png` and
`firefox-fixture.png`. The early image is requested about two polling intervals
after the launch log, before fixture writes. An absent window in that image is
an observation, not a fabricated success. `navigate` uses the established guest
address-bar position at 1280×720; inspect before proceeding. If the real window is
not ready or has moved, stop and report instead of counting a successful command
as rendered content. The controlled `file:///home/admin/Downloads/runtime-qa-…`
fixture removes external search availability from the gate. Do not use Bing as
the render oracle.

Use the existing `actions` phase with guest pixel coordinates observed in the
fixture screenshot. First click “Run bounded comparison,” wait up to 35 seconds,
and save a screenshot. Then inspect and click “Download results JSON,” wait for
the save, and collect. Set `READY_ACTIONS_JSON` to each reviewed action list, for
example the supported structure is
`[{"guest":[X,Y]},{"wait":35000},{"shot":"fixture-complete"}]`:

```sh
"$READY_NODE" probes/firefox-live-acceptance.mjs actions "$READY_RUN" "$READY_ACTIONS_JSON"
"$READY_NODE" probes/firefox-live-acceptance.mjs collect "$READY_RUN"
"$READY_NODE" probes/firefox-live-acceptance.mjs warm "$READY_RUN"
```

`collect` requires actual downloaded JSON from guest Firefox, all five exact
checksums, 100 repetitions and successful completion. It records the file SHA-256.
`warm` reloads the real app into Firefox mode; it requires zero image requests in
both CDP Network events and page resource entries, exact home marker, fixture,
download, existing profile `http1-profile/user.js`, and an explicit marker inside
that profile. This does not claim bookmarks/history or SQLite integrity. Profile
paths match accepted packed init's explicit Firefox profile argument.

Switch the selector only after the baseline warm gate finishes, then invoke the
app's real update control on that same guest/profile:

```sh
printf 'candidate\n' > /mnt/p6/build/firefox-ready-20260926/server/variant
"$READY_NODE" probes/firefox-live-acceptance.mjs update "$READY_RUN"
"$READY_NODE" probes/firefox-live-acceptance.mjs warm "$READY_RUN"
```

The update gate requires automatic reload, a distinct active manifest version,
and identical bytes of every saved file above. Inspect its Firefox screenshot;
inspect candidate log lines for a successful `[wm-ready] Aurora handshake ready`
and the retained launch marker. A fallback/deadline is captured evidence but does
not establish that the readiness optimization fired. Reopen the preserved fixture
with `navigate` after update if the screenshot does not already show a usable
Firefox window. Do not overwrite the initial timing with a claim of first paint.

Gracefully close only this task Chromium, confirm its owned PID/CDP listener exited,
then repeat the initial `boot`, `navigate`, `actions`, `collect`, and `warm` with
new `candidate-profile`, `candidate-browser-cache`, `candidate-browser.log`, and
`READY_RUN=/mnt/p6/build/firefox-ready-20260926/candidate-run`. Leave the selector
on `candidate`. This gives one matched baseline/candidate pair without simultaneous
guest memory contention. Keep the candidate's successful helper log as a required
review gate. Record all screenshot reviews separately; raw JSON deliberately keeps
`visualAcceptance` pending because command completion cannot prove visible content.

For every boot, opt-in QA verifies actual host 4 GiB/2 CPU/1280×720 lines, kernel
4194240 KiB total memory (`0xffff0000` bytes), guest SMP two CPUs, foreground focus,
cross-origin isolation, actual Canvas2D renderer status and framebuffer dimensions.
Warm/update reload restores the actual-input focus precondition with
`Page.bringToFront` followed by a real CDP press/release at outer-page `(10,10)`.
That point was reviewed as blank margin outside guest canvas/buttons in the
probe's 1700px layout. The strict `document.hasFocus()` assertion remains; no
focus state is emulated. The first candidate update reached Firefox and the
helper's 508ms readiness handshake but failed this focus gate. Its preserved
`baseline/firefox-acceptance-update-failed.json` and
`baseline/update-failure-inspection.json` record visible, isolated Canvas2D with
focus false. `Page.bringToFront` alone was insufficient; the separate
`baseline/focus-input-control.json` records false→true after the real margin
click, with other host fields unchanged. Retain these failed attempts when
reporting the subsequent rollback/update verification.
One-second polling produces observation bounds, not exact event timestamps.
Timings start at the click/reload/update invocation, so update includes update work
and must not be directly compared with the initial boot. Screenshot and checksum
interaction times include deliberate waits, typed input and operator review.
Report launch-time differences only for matched initial arms, and report separate
render/functionality evidence. No distribution, first-paint, guest JIT or GPU
acceleration claim follows from this gate.

Finally stop only the owned browser/server, confirm their PIDs and listening
sockets on 9396/4182 are gone, and preserve the unrelated user's process identity.
Do not remove profiles, generated server, image downloads, logs or test outputs.
If also running `web/linux/tests/guest-persistence.mjs`, explicitly set `TEST_OUTPUT`
under this task directory, plus `ASSERT_WARM_CACHE=1 TEST_UPDATE=1`; its default
`/tmp` output is forbidden. That extra console test is not required by this scoped
Firefox gate because the opt-in phases directly cover warm/update file retention.
