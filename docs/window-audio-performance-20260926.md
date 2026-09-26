# Guest window, popup and performance changes

Aurora advertised `_NET_WM_MOVERESIZE` but omitted the EWMH identity window
that GTK checks before trusting supported hints. `publish_ewmh_support` now
creates an unmapped child, publishes the root/child self-reference and UTF-8
WM name. Firefox can move the managed frame from its client titlebar.

Firefox popup CSS now supplies an opaque surface, explicit foreground/selection
colors and the bundled font. The TinyX guest has no compositing manager and
its system menu font setup is incomplete. This keeps context menus readable.

The packed init exported `LOWLAND_BLOB_TRACE=1` and per-packet Mozilla network
logging for every normal launch. The overlay disables these by default;
`?firefox=1&firefox_trace=1` forwards the opt-in flag to the guest kernel command line.
The logs remain available on demand. Controlled independent Chromium runs
used fresh profiles, 1280×720, 2 CPUs / 2 GiB, 100 seconds boot, 15 seconds idle,
toolbar operations, then 10 seconds idle. Baseline retained 1,278,655 bytes /
10,000 lines (the history cap was reached); the candidate retained 26,557 bytes
/ 269 lines. This is at least 97.9% fewer retained log bytes, not a CPU-speed
claim. Steady idle had zero long tasks and 16.67 ms rAF p95 in both runs.
Evidence is `.cache/reliability-performance-20260926/evidence/{baseline,final}`.


`tools/build-aurora-wm-guest.sh` builds a scratch tree with pinned Linux Wasm Rust
and Clang tools; no upstream source or live archive is replaced. It reuses the
Files NOMMU PTY implementation (`posix_spawnp`, `/bin/sh`) for the WM's embedded
terminal fallback. Fonts/wallpaper must be provided as documented by the build
script's environment variables. `package-window-chrome.py` requires an explicit
input hash and separate output and preserves every other member and metadata.

Final WM: `/mnt/p6/project/linux/.cache/aurora-wm-guest-20260926/aurora-wm-repaint-final`,
SHA-256 `bd0688f5f87124de9496894bde6a2eb2b32554f316842a8dce829e1ac0f6888a`.
The first overlay verified all 11,469 archive records: only `bin/aurora-wm`,
`init`, and `lowland-userChrome.css` changed and every member's metadata was
preserved. Reapplying the overlay is byte-identical. The packaging test checks
this and rejects an input hash mismatch or in-place output.

Chromium CDP on isolated port 4184 verified Firefox/Bing, titlebar movement
from guest `(42,66)` to `(102,92)` after a drag that left baseline unchanged,
an opaque readable context menu over the Bing landscape, and Files launch.
The combined candidate terminal returned `/home/admin` for `pwd` and
`wm-terminal-ok` for the corresponding echo command (`final-terminal-ok.png`).

Moving Firefox exposed a TinyX backing-store interaction in Aurora's
own Settings window. A bounded repaint of owned chrome at the end of a move
restores it; the dock is raised before painting so occlusion cannot discard
its pixels. `repaint-settings-uncovered.png` shows the repaired Settings panel.
`repaint-files-covered.png` / `repaint-files-uncovered.png` show the separate
Files client correctly repainting after Firefox covers it and moves away.
Evidence is in `/mnt/p6/project/linux/.cache/window-performance-20260926/`.
`xprop` is absent from the guest; the identity property was not queried at
runtime. The live GTK client drag verifies its practical protocol effect.


A framebuffer damage detector was prototyped and rejected. A same-browser
120-frame microbenchmark measured 22–23% lower idle CPU time but 15–25% higher
full-frame animation time. The existing synchronous snapshot/coalesced presenter
is retained, avoiding a video regression. The raw benchmark records remain
`bench3.json`; these are presenter-only microbenchmarks, not guest FPS.

Near-native web JavaScript is not currently possible: the preserved Firefox
build configuration defines `JS_CODEGEN_NONE=1` (no Gecko JavaScript JIT), and
the guest uses software X11 rendering. Disabling diagnostic traffic reduces
avoidable work but does not remove those architecture limits.

# Browser audio boundary

`dist/audio.js` provides a bounded PCM bridge for `linux.audio_write(pid, stream,
ptr, frames, rate, channels)`. The worker validates the full aligned memory
range, snapshots at most 2,048 interleaved float32 frames, and transfers ownership
of the copy. Worker pacing limits pending traffic to 250 ms and 64 packets per
stream per 250 ms. Main-thread scheduling accepts mono/stereo at 8–96 kHz,
uses a 40 ms initial lead and limits ahead-of-playback audio to 250 ms, clamps invalid samples, and drops
stale packets. Stop packets cancel queued sources and keep bounded stream-ID
tombstones to reject reordered packets. Stream IDs must be unique per start.

AudioContext creation/resume occurs synchronously on trusted guest canvas or
mobile-keyboard pointer/keyboard gestures. Machine shutdown cancels nodes,
closes the context and aborts gesture listeners. `guestAudioStats()` exported
from `main.js` exposes counts/state/peak (no PCM) for diagnostics.

`node --test web/linux/audio.test.mjs` covers snapshots, invalid format/ranges,
queue bounds, synchronous resume, stereo channel separation, clipping, stale
packets, reordered stop packets, cleanup and worker pacing. The scheduling API
follows [MDN AudioBufferSourceNode.start](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start).
End-to-end guest media playback requires the accompanying cubeb backend and
Firefox media decoder build; host PCM tests alone do not prove media decoding.

A real Chromium AudioContext/AnalyserNode probe played 30 synthetic sine packets
(15,360 frames) through the same host: peak 0.25, maximum measured RMS
0.177509, zero drops, clean context closure (`audio-real-graph.log`). This
verifies browser graph output, not physical speaker audibility or guest decode.

# Accepted combined build and live YouTube validation

The accepted `final-v5` build retains the WM above and the bounded host audio
bridge, and includes the accompanying Firefox codec, Opus tail-duration and
64 KiB mmap-alignment fixes. Normal audio IPC remains enabled. Final archive
hashes are recorded in `web/linux/PROVENANCE.md`.

The public 19-second YouTube clip `jNQXAC9IVRw` played changing decoded footage
and captions through its end card. The first pass, including an intentional
pause/resume while inspecting settings, delivered 1,788 PCM packets / 915,056
frames with zero host drops. PCM peak was 0.871884; an AnalyserNode inserted
into the actual guest audio output graph measured maximum RMS 0.230707.
`youtube-v5-paused-quality.png` shows player time 0:02 / 0:19;
`youtube-v5-progress.png` and `youtube-v5-ended.png` show later footage and
completion. The selected YouTube quality was left at its default and was not
established; this is not a quality or frame-rate benchmark.

YouTube then automatically advanced to `BHQ0oOVsdTQ` (a Hogwarts ambience
video) and produced further audio. Cumulative counters reached 11,295 packets /
5,782,640 frames, zero host drops, and five stop events after the subsequent
stream was paused. This verifies clean completion and subsequent-stream
playback, not an explicit replay of the same YouTube clip. Explicit replay of
the local three-second fixture was separately verified inside guest Firefox on
the same fixed build: two completions, each 30 video frames and no dropped
frames, with host counters increasing from 282 to 564 packets. Attached worker
console capture found no runtime traps in `final-v5`.

The earlier completion/replay failure was in the guest audio IPC teardown:
the Firefox mmap shim allocated at 4 KiB alignment while the guest reported
64 KiB pages. The IPC Rust mapping cleanup rounded down to the wrong allocation
base. Full stack evidence (`audio-trace-stack.txt`) and completed cubeb
drain/join/STOPPED markers (`audio-trace-play12.log`) excluded the host queue and
backend thread join. Disabling audio IPC made playback/replay complete, and the
final mmap alignment correction fixed it with IPC enabled.

Remaining limits: YouTube still shows a codec advisory banner despite the
working WebM stream; unsupported codecs and sites remain outside this check.
The guest has no Gecko JavaScript JIT and uses software rendering. MSE fixture
playback reached its end but displayed only 10 of 30 frames, so full-frame MSE
playback is not claimed. An actively repainting Firefox window can still leave
black dock icon shapes after overlapping it; the bounded end-drag repaint fixes
the large Settings backing-store artifact but is not a general compositor.
The accepted WM's `final-v3-dock-confirm.png` and `final-v3-menu-confirm.png`
verify the same final WM's drag/chrome repaint and opaque context menus.

Evidence is under `/mnt/p6/project/linux/.cache/window-performance-20260926/`.
`youtube-v5-first-ui.log`, `youtube-v5-replay-ui.log`, and
`youtube-v5-console.jsonl` retain the counters and console record. Despite its
filename, `youtube-v5-replay-ended.png` shows the subsequent autoplay video.
The real graph measurement proves emitted audio, not physical speaker audibility.

# Final public Site UI verification

The deployed Site at `https://linuxonweb.exact-coot-7512.chatgpt.site/`
rendered HTTPS Bing in a fresh 1280×720 session with 4 GiB guest memory and
two guest CPUs. Firefox moved from screen origin (95, 198) to (159, 227).
A subsequent right-click produced an opaque, readable Firefox page context
menu, visually reviewed after capture. Durable screenshots are
`web/cloudflare/evidence/firefox-public-drag-20260926.png` and
`web/cloudflare/evidence/firefox-public-context-menu-20260926.png`.
Earlier automated click attempts did not display the popup; those captures
are not menu evidence. Only the cache test driver was adjusted to hold the
click for 150 ms; no production input code changed during this final check.
Cold boot remains slow, and no near-native performance claim is made.
