# Firefox startup after Aurora readiness

The candidate replaces the packed Firefox startup's unconditional ten-second
sleep with the existing bounded Aurora readiness helper, invoked as `admin` on
display `:0`. A missing, nonexecutable or failed helper retains the ten-second
fallback. The helper's own deadline exits successfully, so an unavailable window
manager does not cause a second ten-second wait.

The deterministic packager is
`tools/guest-rootfs/package-aurora-ready.py`. Its archive audit preserves 11,468
original CPIO records, order, metadata and tail; only `/init` changes, and
`/bin/wait-for-aurora` is added. Kernel and plain-rootfs identities are unchanged.
The Firefox executable itself is unchanged.

| Image | Version | Compressed bytes | SHA-256 |
| --- | --- | ---: | --- |
| Baseline | `fa0217b54d99` | 88,186,382 | `6c7fad946e53f977bc6d55a80323f7ec6a9fa84858d1a245fe0916e2f6d17e65` |
| Candidate | `ff1ea9fc6f62` | 88,406,608 | `d929b7576238a733d62d41a7bb7d4d02e4dcaf58db20ee56130994e2971a3550` |

Raw package audit, shell-branch checks, browser profiles, screenshots and failure
evidence are retained under `/mnt/p6/build/firefox-ready-20260926/`. Every build
and artifact-producing test must export `TMPDIR`, `TMP` and `TEMP` to the task's
disk-backed scratch directory. The phased reproduction guide is
`probes/firefox-ready-acceptance.md`.

## Acceptance and observation limits

The real app runs Firefox with `0xffff0000` bytes of memory, two CPUs and a
1280×720 Canvas2D framebuffer. Tests verify host configuration plus kernel
4194240 KiB total-memory and SMP markers, visible focused foreground state and
cross-origin isolation. There are no worker hooks or profiling. One-second log
polling measures observations, not exact event timestamps or first paint.

The baseline fresh-profile launch marker was observed at 17,259 ms. Its early
screenshot showed the desktop before Firefox appeared; a later image showed the
actual Firefox window. The controlled local fixture rendered, and a JSON file
downloaded by guest Firefox passed all five workload checksums with 100
repetitions. The baseline warm boot fetched no system images and retained exact
home-marker, fixture, download and selected profile-file bytes. This file gate
does not claim bookmark/history or SQLite integrity coverage.

After the focus correction described below, baseline-to-candidate update passed
the real update control and automatic reload. Aurora reported readiness after
499 ms; the launch marker was observed at 7,825 ms, including update work. The
following candidate warm boot observed the launch marker at 7,626 ms with zero
image requests in both CDP and page resource entries. All saved file hashes
matched, and a later screenshot showed an actual Firefox window with a blank
New Tab. These update/warm observations are not the matched initial comparison.

The candidate fresh-profile launch marker was observed at 8,248 ms, 9,011 ms
earlier than the baseline in this single matched pair. Its successful Aurora
handshake reported 435 ms. Both initial early screenshots showed the desktop
before a Firefox window; this is not a first-paint measurement or a timing
distribution. Later screenshots showed the real window and rendered local
fixture. The actual guest download passed all five checksums with 100
repetitions. A final warm reload passed exact file preservation and zero image
requests, with a launch observation of 8,403 ms and a 525 ms handshake. Its later
screenshot showed Firefox and the Bing landing page; a pending ancillary TLS
request does not establish that all page resources completed.

The compact [acceptance evidence](evidence/runtime-graphics-20260926/firefox-aurora-startup.json)
retains the initial observations separately from update, recovery and warm runs.
Local functional acceptance passes. The Firefox image and manifest are promoted
locally, with all four original inputs preserved and verified in
`baseline-images/`. Isolated release staging verifies exactly two changed routes,
55 parts and 151,597,129 bytes; all other pinned runtime input bytes are retained.
Sites publication is a separate remaining gate and is not established by this
local evidence.

## Retained failures and recovery

The first candidate update reached Firefox and a 508 ms Aurora handshake but
failed the strict foreground-focus assertion after automatic reload. All other
configuration fields matched. `Page.bringToFront` alone did not restore focus;
a subsequent rollback similarly failed that gate. A separate diagnostic showed
that actual mouse press/release in the reviewed blank outer-page margin changed
`document.hasFocus()` from false to true without changing other host fields.
Warm/update setup now performs that real input before observation. No focus
state is emulated, and the assertion remains strict.

On continuation, the owned adapter process was absent and its session reported
exit 143. It was restarted only after confirming terminal state. The retained
guest had stopped with `machine worker failed`; its logs were preserved, and
the cause has not been established. An initial recovery command omitted the
opt-in environment and failed before browser attachment with `Unknown phase`.
The explicitly corrected normal reload passed the strict warm-cache and file
checks; its 16,675 ms launch observation is recovery evidence, not an initial
comparison. All failed runs and their profiles remain available.

This change removes avoidable startup waiting. It adds no native Firefox JIT,
guest Vulkan/OpenGL, hardware video decoding, or physical GPU acceleration.
