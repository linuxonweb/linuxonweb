# Firefox media in the Linux Wasm guest

The preserved Firefox build contains FFVPX audio decoder objects, but its normal
runtime linker still tries to locate and `dlopen` native shared libraries. Those
libraries are absent from the static Wasm executable. Video-only VP8 played in
the baseline, while Opus was unavailable and YouTube rejected playback.

`build-static-media.py` links the preserved FFVPX objects into Firefox and
registers their real symbols with NSPR's static-library API. Gecko's existing
`FFmpegLibWrapper::Link()` still validates the version and required symbols.
The table includes the deprecated `av_init_packet`: this Firefox wrapper aliases
its version-60 and version-61 masks and still requires that symbol for FFVPX 61.
Omitting it causes registration to fail even though the Opus decoder is linked.
One `[WASM_MEDIA]` startup line reports registration, codec version and decoder
presence without enabling per-packet tracing.
The host does not decode or replace the guest video. H.264/AAC support is not
added by this change; the bundled open codecs remain responsible for decoding.

The same guest also had no compiled cubeb output backend. `cubeb_wasm.c` supplies
an output-only backend with a paced audio thread, float32/S16 conversion, volume,
position, pause/restart and drain handling. Each start gets a unique stream ID.
An explicit `linux.audio_write(pid, stream, pointer, frames, rate, channels)`
import sends interleaved float32 samples through the bounded browser adapter in
`../dist/audio.js`. Zero frames stops that stream. This requires the accompanying
worker import allowlist and host runtime changes. No microphone is exposed.
Browser audio resumes only from a trusted guest input gesture.

Audio IPC teardown also exposed an existing mmap shim bug: its hard-coded
4 KiB alignment disagreed with the guest's 64 KiB `getpagesize()` result.
Rust memmap2 rounds a mapping pointer down by that reported page size before
calling `munmap`, which then freed an invalid address. The captured Wasm stack
was `get_meta -> free -> munmap -> memmap2::MmapInner::drop` during stream
destruction. A symbol-preserving fpcast build had identical noncustom sections
to the failing module, confirming the symbol mapping. `build-static-media.py`
now rebuilds the mmap shim with allocation alignment from
`sysconf(_SC_PAGESIZE)`. This is a targeted mapping fix, not an implementation
of every POSIX mmap or partial-unmap behavior.

Patch `0009` addresses the final Opus packet duration/padding failure described
by [Mozilla bug 1884079](https://bugzilla.mozilla.org/show_bug.cgi?id=1884079).
The guest trace decoded the preceding audio successfully, then rejected 13.5 ms
of discard padding against a container duration of 7 ms. For a final plaintext
Opus packet with positive padding, the patch gets the decoded duration from
libopus at 48 kHz before applying the existing padding checks. Invalid packet
durations, excessive padding, negative padding and repeated padding remain
errors; encrypted packets keep the original path. The build snapshots and
recompiles the WebM unified unit without modifying the original source tree.

`package-picker.py --single-process-media` keeps RDD/utility decoding inside the
existing single-process guest, whose process-launch path otherwise fails with
`ENOSYS`. This does not change certificate, extension-signature, or site trust
checks. The XPT patch `0008` separately repairs download/stream callbacks that
carry full-width 64-bit values; an empty output file was a failed transfer
callback, not evidence that the Linux filesystem could not write data.

## Rebuild

The script requires the preserved object tree and the final Aurora picker link
response. It uses the final `firefox-aurora-prompts.list` when present, preserving
the MIME, picker and folder-confirmation repairs. It snapshots a supplied XPT
object and never edits the original sources, original objects, or live archives.

```sh
python3 web/linux/firefox-shims/build-static-media.py \
  --objects /mnt/p6/project/linux/.cache/firefox-fresh-obj-20260924-071600 \
  --picker-build /mnt/p6/project/linux/.cache/aurora-picker-20260926/firefox \
  --libcxx-include /mnt/p6/project/linux/.cache/libcxx-wasm-abi-20260925/include/c++/v1 \
  --xcb-include /nix/store/wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0/include \
  --xpt-object /path/to/picker-build-with-patch-0008/xptcall_wasm32.o \
  --audio-backend --output /path/to/new-output
```

The output retains the generated source patches, compile/link commands and logs,
static archives, and raw/fpcast Wasm modules. Initial memory rises from 64 to
80 MiB for codec tables; the existing 16 MiB stack and 4 GiB maximum remain.
Binaryen applies the same fpcast emulation as the working baseline, followed by
WABT validation. Kernel and TinyX binaries are unchanged.

## Verification boundaries

Run `web/linux/tests/test-cubeb-wasm.sh /path/to/firefox/media/libcubeb` for real
backend lifecycle tests with captured PCM, and `node --test web/linux/audio.test.mjs`
for browser-boundary bounds, ownership, timing, stop and cleanup tests. These do
not alone establish guest playback. The fixtures in `../tests/README.md` require
actual media time advancement, end events and sample delivery from guest Firefox.
`web/linux/tests/test-mmap-shim.sh` compiles the actual shim with isolated libc
names and a 64 KiB page-size fixture. Address/undefined-behavior sanitizers and
leak detection check shared aliases, both release orders, backing-file
sync/refresh, private/anonymous cleanup, and allocation failures.

The root filesystem remains an in-memory initramfs: verified downloads and
uploads last for that guest session. Reload persistence is not implemented here.
The Firefox build still defines `JS_CODEGEN_NONE`, so this change does not provide
a JavaScript JIT or establish near-native performance on complex sites.
