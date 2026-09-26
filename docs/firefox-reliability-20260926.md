# Firefox guest reliability work, 2026-09-26

Checkpoint: `5a39b34` on the original branch, followed by
`gpt-6-agent-firefox-window-media-filesystem-performance`.

## Causes and changes

- Firefox could not move because GTK did not recognize Aurora as an EWMH
  window manager. Aurora now publishes the supporting identity window and
  self-reference before advertising move/resize support. A bounded repaint
  after a completed move restores Aurora's exposed panels under TinyX.
- Firefox popups depended on transparency and missing system menu fonts.
  The guest chrome stylesheet now supplies an opaque background, explicit
  foreground/selection colors and its bundled font.
- Normal startup enabled verbose network and blob tracing. Tracing is now
  opt-in through `?firefox=1&firefox_trace=1`.
- The previous download bridge rejected the fourteen-argument transfer
  initialization callback containing a 64-bit timestamp. Typed XPT signatures
  now preserve transfer, stream, progress and seek values. The existing
  asynchronous Aurora Files picker remains the dialog implementation.
- Audio had three independent gaps: unavailable decoder subprocesses, FFVPX
  libraries omitted from the static executable, and no compiled cubeb output
  backend. The build now statically registers the preserved decoder objects,
  keeps decoding in the existing guest process, and sends bounded PCM from a
  cubeb backend to browser Web Audio after a user gesture.
- A separate Firefox Opus tail bug rejected valid padding against a shortened
  container duration. The final plaintext Opus packet now gets its decoded
  duration from libopus before the existing padding validation and trimming.
- Playback shutdown exposed a memory-mapping alignment bug. The guest reports
  64 KiB pages, but the mmap shim allocated on 4 KiB boundaries. Rust memmap2
  rounded the returned address down before unmapping it, causing an invalid
  free in audio IPC cleanup. The shim now validates and uses the page size
  reported by `sysconf(_SC_PAGESIZE)` for its allocations.

Build details are in
[`static-media.md`](../web/linux/firefox-shims/static-media.md),
[`aurora-file-picker.md`](../web/linux/firefox-shims/aurora-file-picker.md), and
[`window-audio-performance-20260926.md`](window-audio-performance-20260926.md).
Original shared Firefox source/object trees are not modified. Packaging checks
the input archive hash and preserves unrelated members and all metadata.

## Verified behavior

Live guest tests verified Firefox/Bing, dragging in both directions, opaque
context menus, and the embedded terminal (`pwd` and `echo wm-terminal-ok`).
Automatic downloads and explicit HTTP **Save Link As** both saved the complete
26-byte fixture. Reopening the selected filename through Aurora Files returned
an exact byte match, rather than merely an existing empty file.
The signed AMO uBlock Origin 1.75.0 package completed Firefox's normal install
flow and displayed its added confirmation; extension-signature checks remain
enabled. This verifies installation, not every extension API.

The final mmap-aligned Firefox, with audio IPC still enabled, played the
three-second VP8/Opus fixture twice to `ended` at 3.01 seconds. Both runs
reported all 30 video frames and zero drops. The earlier build decoded the
same data but trapped during cleanup and could not replay it.
The malformed 40 ms Opus-padding fixture still reports a demuxer error, and
subsequent valid playback works. The synthetic MediaSource test reaches `ended`
without an error but reports only 10 of 30 video frames; that remains a
limitation and is not counted as complete MSE decoding coverage.

On the final build, YouTube's 19-second “Me at the zoo” clip reached its end
card with decoded video and audio and no Wasm trap. YouTube then automatically
advanced to another video and produced additional audio: 5,782,640 cumulative
frames (about 120 seconds at 48 kHz), zero host drops. This verifies subsequent
stream playback; explicit same-clip replay was verified with the local fixture.
YouTube quality remained at its default and was not measured.

Evidence is retained under
`/mnt/p6/project/linux/.cache/reliability-performance-20260926/` and
`/mnt/p6/project/linux/.cache/window-performance-20260926/`.
Generated test media and acceptance instructions are in
[`web/linux/tests`](../web/linux/tests/README.md); deployment excludes these
fixtures and all source/build/cache directories.

## Performance and storage limits

At a fixed observation endpoint, retained serial history fell from 1,278,655
bytes (the 10,000-line cap) to 26,557 bytes / 269 lines. That is at least a
97.9% reduction in retained logging, not a measured equivalent CPU speedup.
Both runs had a steady-state host animation-frame p95 of 16.67 ms. A proposed
framebuffer damage optimization was rejected because full-frame animation
became 15–25% slower in the presenter microbenchmark.

The preserved Firefox configuration uses `-O2` and `JS_CODEGEN_NONE=1`.
Guest web JavaScript therefore runs without a JIT, and rendering uses software
X11. Near-native browsing performance is not achieved by these changes.
The filesystem remains a RAM initramfs: files, profiles and installed extensions
are session state and do not survive restarting the guest. H.264/AAC and
microphone capture are not added. No certificate or extension-signature checks
are disabled.
