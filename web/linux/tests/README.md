# Guest Firefox acceptance fixtures

Open these pages **inside guest Firefox**. On the local development server the
host gateway is `192.0.2.1` (not guest localhost), for example
`http://192.0.2.1:4184/linux/tests/file-picker.html`.

- `file-picker.html`: select single/multiple files and directories, cancel,
  download the generated text, then select that saved guest file with **Verify
  saved bytes**. Only `Saved bytes: PASS (exact match)` verifies the actual
  26-byte download, rather than just a dialog or empty destination. To exercise
  the save dialog, use Firefox's Save Link As action on the download link.
- `media.html`: codec/MSE capability queries, then actual decoding of silent
  VP8, VP8 + Opus muted, VP8 + Opus with sound, and MediaSource playback. Watch
  the `ended` event, advancing media time, decoded frame counts and errors.
  `canPlayType` alone does not establish successful decoding. Sound additionally
  requires an active host AudioContext and guest PCM reaching it. These fixtures
  do not establish YouTube network/player compatibility.
- The **Invalid Opus padding (must fail)** button plays the same encoded clip
  with its final DiscardPadding increased from 13,500,000 ns to 40,000,000 ns.
  The Opus packet contains only 20 ms of audio, so this case must report a media
  error and must not reach `ended`. It guards against accepting invalid padding
  while repairing valid end-of-stream duration handling.

The small videos are generated patterns and a sine tone, with no external media:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10:duration=2 -an \
  -c:v libvpx -b:v 80k -deadline realtime -y motion-vp8.webm
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10:duration=3 \
  -f lavfi -i sine=frequency=440:sample_rate=48000:duration=3 \
  -c:v libvpx -b:v 80k -deadline realtime -c:a libopus -b:a 32k \
  -shortest -y motion-opus-source.webm
ffmpeg -itsoffset 0.01 -i motion-opus-source.webm -i motion-opus-source.webm \
  -map 0:v -map 1:a -c copy -cluster_time_limit 1000 -y motion-opus.webm
rm motion-opus-source.webm
```

The second step offsets the synthetic video by 10 ms so the muxed raw WebM
block timecodes remain ordered after Opus codec delay. Without it, FFmpeg
produced audio blocks at 101 ms before video blocks at 100 ms; direct playback
succeeded but Chromium MediaSource rejected the file. The corrected fixture
passes host direct and MediaSource playback to `ended` with 30 frames and no
drops; guest decoding and guest audio still require separate acceptance.

The negative fixture changes only the four-byte final DiscardPadding payload at
byte offset 49823 of `motion-opus.webm` (49,849 bytes), to big-endian `02 62 5a 00`.
Its SHA-256 is `d994d0bc3fa4643647195c5e15a403f697ea3edb841fa4295b4caaa17bddabe2`.

The current guest root is an initramfs in RAM. These tests verify guest file
writes during the session; reload persistence requires a separate storage path.

`sh web/linux/tests/test-mmap-shim.sh` compiles the actual Firefox mmap shim
under renamed libc symbols with ASan/UBSan and leak detection. It emulates the
guest's 65,536-byte page size and checks Rust-style base rounding, shared aliases
and both reference-drop orders, backing-file synchronization, private and
anonymous allocation cleanup, and invalid page-size/allocation failures.
This checks the supported whole-mapping lifecycle; it does not establish full
POSIX `mmap`, partial-unmap, or `mremap` semantics.
