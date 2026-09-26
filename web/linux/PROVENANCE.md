# Native Linux browser payload provenance

## Firefox reliability release (2026-09-26)

The released reliability build is frozen under
`/mnt/p6/project/linux/.cache/reliability-performance-20260926/final-v5/`.
Its runtime payloads are:

| asset | bytes | SHA-256 |
| --- | ---: | --- |
| `initramfs.cpio` | 40,494,672 | `765a1a162d827ecc2ebcba605d830f8af4ace5019b4acf29df4cdb222e1a4e34` |
| `initramfs-firefox.cpio.gz` | 88,185,028 | `d48f8881d885814eb5614683bf4a6ed78313d1439ee4c3b6c87bb3fc4457d332` |
| guest Firefox executable | 157,420,348 | `68b86f1dea7312483c62284fce906287afcb7f8f11b1b07697c73e6dbd49ceae` |

The kernel is unchanged. Compared with the initial `b439fcac…` plain and
`f2a08c0b…` Firefox archives, the plain image changes only Aurora WM;
the Firefox image changes only WM, init, Firefox and its chrome stylesheet.
All 3,847 / 11,469 CPIO records and metadata were checked. Aurora Files remains
the previously verified `3fe947c2…` executable.

The reproducible overlays add EWMH identity, repaint exposed Aurora chrome,
opaque Firefox menus, opt-in network tracing, typed XPT transfer callbacks,
static FFVPX registration, correct 64 KiB mmap alignment, and an output-only
cubeb/Web Audio bridge. The media
profile keeps decoding in the existing single-process guest. The original
source/object trees are preserved. See
[`firefox-reliability-20260926.md`](../../docs/firefox-reliability-20260926.md)
and [`static-media.md`](firefox-shims/static-media.md) for build commands,
evidence and limits. Public deployment identity is recorded separately in
[`release.json`](../cloudflare/release.json). The release was published at
11:55:22 UTC from source commit `5e7eb6af46a24d1a2816497c4ce60d1ab27b8714`.
Full archive downloads from both the Worker and public ChatGPT Site matched
these hashes and lengths; isolation headers and live DNS/TCP/TLS checks passed.
The Site continues using its existing proxy deployment and serves the new
runtime without a proxy code change.

## Original staged payload

This directory stages the browser boot payload from the read-only sibling
checkout `/mnt/p6/project/linux/linuxwasm-wasm/tools/wasm`.

The runtime tree under `dist/` and `vmlinux.wasm` were copied byte-for-byte.
The Firefox initramfs was extracted and repacked as a valid `newc` archive after
adding minimal `firefox` uid/gid 1000 account records and changing `/init` to
create a writable profile and launch Firefox through BusyBox `su` at
`https://www.bing.com`; the sibling checkout was not modified. The browser
gunzips this payload before passing the raw CPIO to the wasm kernel.

| staged asset | bytes | SHA-256 |
| --- | ---: | --- |
| `vmlinux.wasm` | 6,281,750 | `21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75` |
| `initramfs.cpio` | 40,424,448 | `47e748df7eb2a6728fbdcd299245be5e1c5abc4c263abf05112b3d01baa239f2` |
| `initramfs-firefox.cpio.gz` (Bing/su uid-1000 patched) | 87,144,428 | `85dbee2c9e6b611c44e1bc08e32f97044b38c6f96cf6cb0d14b533ac3d91183a` |
| `dist/index.js` | 16,584 | `1a4a0310b55f9b33634afc5b24a3be985e490c0b24917e9e200adbf1297b43d4` |
| `dist/platform.js` | 4,046 | `a3b171470c5e7bee3d4aea9c54ed9af1d7ed73bc657dada36372b42d02870440` |
| `dist/worker.js` (user-memory growth adapter hooks) | 19,985 | `b8aa162801d8f5273356037fb834a3b337a945f67dc81fb7a305fbc10b03af91` |
| `dist/user-memory-growth-adapter.js` | 4,842 | `7500739662e7abed6a99732f4321e2ec0865a2bc9d8c8816c633217dd48adf83` |
| `dist/USER_MEMORY_GROWTH_ADAPTER.md` | 1,285 | `8c9b6ad067e883daf0b6a3e70685f2a10b7cc2a4e315f7d4b9a59ab733a5e0be` |
| `node_modules/@xterm/xterm/lib/xterm.js` | 289,441 | `1f991ac3b4b283ebf96e60ae23a00a52765dd3a2e46fa6fdda9f1aab032f7495` |
| `node_modules/@xterm/addon-fit/lib/addon-fit.js` | 1,497 | `bdaefa370b1bfc42ee88d46fe6072400902a4d4b2d45cd93438dda9b23c97089` |
| `node_modules/@xterm/xterm/css/xterm.css` | 5,559 | `ba8e6985669488981ccf40c0cefe3aba80722cb6c92de7ad628b0bd717faf2b6` |

`vmlinux.wasm` embeds `.linux.sections` and `.linux.initramfs`; the external
CPIO is selected by `main.js` for the GUI/Firefox userspace. The page requires
COOP/COEP/CORP response headers because the runtime uses shared WebAssembly
memory and module workers. Firefox auto-boot raises the guest memory setting to
the supported 4 GiB maximum; the normal console/X modes retain the 1 GiB default.

Validation of the su/4 GiB progress state: a 75-second visible Chrome run at
`http://127.0.0.1:4173/linux/index.html?firefox=1` used 4096 MB and reached
Firefox GTK/Gecko initialization, then stopped with
`RuntimeError: memory access out of bounds`. No Bing request was observed.
Screenshot: `/tmp/linuxwasm-su-4gb-75.png`.

## User-memory growth adapter (2026-09-21)

`dist/user-memory-growth-adapter.js` is an out-of-tree bridge for user
`WebAssembly.Memory` ranges. `dist/worker.js` grows user destinations before
`write`, `write_zeroes`, and futex atomic access, and grows successful
`brk`/`mmap`/`mremap` ranges returned by the Linux syscall import. The kernel
destination used by `read` remains on bounded `memory_bytes()` access and is
never grown. Growth failures retain the existing copy/zero/futex failure
returns; syscall failures are logged with `console.debug` and leave the kernel
return unchanged. The generated sibling tree and `sources/` checkouts remain
untouched.

Validation evidence:

- `node --check web/linux/dist/worker.js` and
  `node --check web/linux/dist/user-memory-growth-adapter.js` both exited 0.
- A Node ESM edge test grew shared memory from 1 to 2 pages for a boundary
  write, grew it from 2 to 5 pages for an x86 `mmap` result, and rejected both
  a `Number.MAX_SAFE_INTEGER` address plus length 2 overflow and a range beyond
  an 8-page maximum;
  it printed `adapter edge tests: PASS`.
- A bounded visible Chrome run at
  `http://127.0.0.1:4173/linux/index.html?firefox=1` remained stable for 95 s
  after the adapter hooks, with no `RuntimeError: memory access out of bounds`
  and no observed Bing request. This validates runtime stability only; it is
  not a Firefox or Bing completion claim.

## Confirmed runtime settings restart (2026-09-26)

`main.js` and `index.html` now keep editable resolution/CPU/RAM drafts separate
from the active guest. Apply opens a Continue/Cancel dialog. Only Continue saves
preferences, closes the machine, and reloads the existing URL with its prior
launch mode. Cancel restores the active values without resizing the canvas,
changing storage, or stopping the guest. The dialog warns that unsaved work and
the temporary guest filesystem are lost on restart. Settings are locked only
during boot/restart. Failed boots release canvas listeners, pointer timers,
console streams, and network resources before a retry.

Preferences use `linuxonweb.machine-settings.v1` in localStorage, containing
`resolution`, `cpus`, and `ram` (MiB). The one-shot sessionStorage key
`linuxonweb.restart-mode.v1` preserves the launch mode without rewriting query
parameters or other preferences. Invalid stored values are ignored; the removed
256 MiB configuration is migrated in memory to 512 MiB. A real 256 MiB console
boot exhausted guest memory with the current image. Console/X modes therefore
start at 512 MiB; Firefox starts at 2 GiB and defaults to 4 GiB. CPU selection
is limited to the lesser of reported host concurrency and kernel `NR_CPUS=64`.
The 4 GiB choice advertises `0xffff0000` bytes to leave the final wasm32 page
unused.

`dist/index.js` has a narrow local staged-runtime guard: requested guest RAM
must cover the materialized kernel/initramfs plus 64 MiB boot workspace and
must fit the allocator's actual maximum, including reservation fallback. It
fails clearly rather than advertising more physical RAM than can be allocated.
This is a local adapter change; the upstream/sibling TypeScript source tree was
not modified.

Chrome CDP evidence is retained in
`/mnt/p6/project/linux/.cache/runtime-settings-20260926/`. The apply/cancel test
confirmed that drafts and Cancel preserve the running guest and stored settings;
Continue preserved the URL/mode and produced guest-reported CPU online `0`,
`MemTotal: 521984 kB`, and framebuffer `1920,1080`. Browser exception/console
error count was zero after the restart-reader fix. Fault-injection tests verified
reservation-limit rejection, removal of all guest canvas listeners, a successful
512 MiB retry, and a visible storage-error dialog that leaves the guest running.
Screenshots: `restart-dialog.png` and `applied-console.png`.

Firefox was also verified with 2 GiB, 2 CPUs and 1280 × 720: AuroraWM stayed
running, Bing rendered in Firefox, and the guest reported `2 CPUs` and
`1817984K/2097152K` memory. Screenshot:
`firefox-2048mb-2cpu-1280x720.png`. A 1-CPU run stayed operational but reached a
Bing network timeout, so it is not evidence of a successful page load at that
configuration. Separate 4 GiB/2-CPU logs confirm real SMP and the physical-memory
limit. Larger-resolution testing exposed the guest TinyX request-limit mismatch;
that guest fix and its artifact provenance are documented separately.

New sessions default to 1280 × 720 (restored at the user's request); 1600 × 900
remains available, and saved explicit resolutions remain unchanged.
The canvas uses its selected resolution for both backing size and CSS pixel size.
The surrounding stage scrolls when the viewport is smaller. Chrome geometry
checks with 1600 × 900 selected at 1920 × 1200, 900 × 650, and 390 × 844 all reported a 1600 × 900 backing
canvas and a 1600 × 900 CSS rectangle, with overflow in the narrower viewports.
Reloading a saved 1280 × 720 choice preserved it. Evidence: `test-geometry.log`
and `geometry-1920.png`, `geometry-900.png`, `geometry-390.png` in the same
runtime-settings evidence directory.

Final integration used the frozen Firefox candidate
`e726ede312e1164a2081f4294374774e02ac4574126ea1602889f442c477ca25`
on port 4182 (the guest request-limit fix is owned by the rootfs work). At
1600 × 900, 2 GiB and 2 CPUs, AuroraWM stayed healthy and Firefox rendered Bing.
The actual Apply → Cancel → Apply → Continue flow then restarted into
1920 × 1080, 4 GiB and 2 CPUs, preserving the Firefox query and other URL
parameters. AuroraWM and Bing remained visible after the restart, with zero
browser exceptions. Evidence: `firefox-2048mb-2cpu-1600x900.png`,
`test-firefox-restart.log`, and `firefox-restart-1080p.png`.

An explicit **Pan display** toggle appears only when the stage overflows. It
enables native touch/trackpad scrolling and temporarily bypasses guest pointer
and wheel input; turning it off restores guest input. Keyboard handling stays
with the guest. Chrome input tests observed trackpad scroll `(120, 80)` and touch
scroll `(327, 212)` while both the backing canvas and CSS rectangle stayed
1920 × 1080. They also verified guest wheel capture before/after pan mode.
The settings panel scrolls on short screens: at 900 × 400, its bottom was
376 px and the Apply button remained visible at 355 px. Evidence:
`test-pan.log`, `pan-display-touch.png`, `settings-short-landscape.png`.

## On-demand guest logs (2026-09-26)

GUI boots no longer create a terminal or log-viewer element. `Show logs`
creates the viewer; `Hide logs` removes it and cancels its pending update.
`log-viewer.mjs` retains at most 10,000 lines / 2 Mi characters, with an
8,192-character limit per line. It decodes each console stream independently
and strips terminal control sequences, including sequences split across chunks.
No rendering timer or log DOM updates run while the viewer is absent.

The viewer renders at most 100 lines, initially the latest. Scrolling to its
upper/lower edge pages through older/newer history in overlapping 50-line
steps, preserving the reading position. `Latest` resumes following output.
Visible updates are batched at 100 ms. An explicit `Start console` still creates
an interactive xterm for shell input; ordinary GUI boots do not instantiate it.

Validation: four `node --test web/linux/log-viewer.test.mjs` tests pass.
Chrome checked absence at startup, 350 injected lines producing only rows
250–349, older-page loading, removal, hidden writes, and reopening at the latest
line, with zero JavaScript exceptions. A separate 512 MiB / 1 CPU console boot
accepted `echo console-qa-ok; pwd`, returned the marker and `/`, and kept logs
hidden. Evidence: `/mnt/p6/project/linux/.cache/aurora-picker-20260926/`
`log-viewer-qa.{log,png,mjs}` and `console-qa.{log,png,mjs}`.

## Aurora Files and Firefox picker (2026-09-26)

Aurora Files now supplies open, multiple-file, directory and save dialogs through
its CLI and a resident X11 service. Firefox patch `0005` connects Gecko's picker
to that service, returning real guest paths through normal `nsIFile` objects.
Patch `0006` defensively checks MIME extension enumeration during HTML accept
filter setup. This is a Firefox integration and documented X11 protocol, not a
general desktop portal implementation. See
`firefox-shims/aurora-file-picker.md` and
`../../vendor/aurorawm/PICKER_PROTOCOL.md` for rebuild and protocol details.

Normal Files adds new-folder and rename prompts, recursive copy, cut/paste,
location entry, refresh/hidden-file shortcuts, and confirmed recoverable Trash.
Copy preserves symlinks and chooses a unique destination; cross-filesystem
moves report an error while retaining their source. Trash recovery uses
cut/paste from its sidebar folder. The terminal uses the guest-compatible
openpty/posix_spawnp path; hiding it suspends shell-to-folder synchronization,
and reopening it sends the current folder to the shell.

Build only Files with `tools/build-aurora-files-guest.sh`; the packed WM remains
unchanged. `tools/guest-rootfs/package-picker.py` requires an explicit baseline
SHA-256, replaces Files and optionally Firefox, and inserts picker service
startup into the existing init. It preserves unrelated archive members and
metadata, including the previous TinyX keyboard, request-limit, certificates,
fonts and devpts repairs. Do not replace packed init with the generic source
script, which would discard those accumulated image adaptations.

The final Files Wasm binary has SHA-256
`3fe947c295b993d50b6709f3814b8b2261a1d7adc821f04826eede727afb5666`.
Its 11 native tests cover picker protocol/globs and response bounds, terminal
behavior, recursive copy/symlinks/no-overwrite, and recoverable Trash metadata.
An isolated 512 MiB / 1 CPU Start X guest verified terminal echo/pwd, new folder,
rename, collision-safe copy, cut/paste to Downloads, cancelling Trash, confirming
Trash, and preserved data plus `.trashinfo`. Screenshots and the exact smoke
record are under `/mnt/p6/project/linux/.cache/aurora-picker-20260926/`
(`files-guest-qa.md`, `files-guest-*.png`).

Folder-upload QA exposed an independent Firefox Wasm limitation:
`PromptCollection.sys.mjs` failed with `NS_ERROR_NOT_IMPLEMENTED` when invoking
`nsIPromptService.confirmExBC`. That method needs 11 i32/pointer parameters,
while the incoming XPT stub tables stopped at eight. Patch
`0007-wasm-xptcall-prompt-arity.patch` extends those typed tables and the parameter
buffer to 12, matching the existing outgoing call limit. It preserves the
existing type/context restrictions and restores the normal confirmation path;
it does not bypass folder-upload confirmation. The rebuild script compiles
this third object alongside the GTK picker and MIME-filter objects.

A fresh final raw-image boot also verified hidden-terminal navigation remains
in Documents, then reopening the shell returns `/home/admin/Documents` from
`pwd` and `final-files-ok` from echo. Evidence: `files-final-hidden-navigation.png`,
`files-final-show-pwd.png`, and `files-final-cwd.log`; no trap/panic/Files error
markers were captured. That isolated test VM was closed after verification.

The picker-enabled Firefox with patches `0005`–`0007` is 154,631,172 bytes,
SHA-256 `a86dfbd80aa8df82d82f9d3446b2a47e1ef64312c7a095f9870b43bf67796afe`.
WABT and Node validate its Linux guest imports, shared memory and entrypoint.
The build reuses the preserved working Firefox object tree and exact CA-aware
link response, replacing only the three patched objects, then applies Binaryen
fpcast emulation. Original source and shared object files are not modified.

On the final combined candidate, Firefox loaded Bing over HTTPS and the local
guest fixture, then returned a single text file and a true two-file selection
with both names, sizes and actual text contents. Evidence:
`final-prompts-boot.png` and `final-two-contents.png` in the same scratch directory.
The normal folder-upload confirmation now appears (`final-folder-confirmation.png`);
this screenshot alone does not establish successful folder enumeration.

Final directory acceptance is verified by `final-folder-actual-result.png`:
after activating the correct Firefox tab and allowing its confirmation delay,
Upload returned two files with `Documents/` relative paths, expected sizes and
actual text contents. Earlier attempts accidentally activated the second privacy
tab; no further picker focus defect was established. `final-cancel-retains.png`
records cancellation retaining the previous two-file selection.

### Deployed images

Both live images were replaced only after checking the preserved baseline and
candidate hashes, using temporary files and atomic rename. Port 4180 serves
both with HTTP 200 and matching fetched SHA-256:

| Image | Bytes | SHA-256 |
| --- | ---: | --- |
| `initramfs.cpio` | 40,492,844 | `b439fcac4686703ba82859eec071463daeed3441fcd90fe79e084cabc2c97138` |
| `initramfs-firefox.cpio.gz` | 87,862,922 | `f2a08c0b8d44cb1df73a087a2187abe0a25b91cd72f3fb2e1c98873cb166dfc4` |

Compared with baseline raw `beea582d106e6454397611b8efaba1b89417269129303a981bae69978e8e5bb1`,
only `init` and `bin/aurora-files` contents changed among 3,847 CPIO records.
Compared with baseline gzip `e726ede312e1164a2081f4294374774e02ac4574126ea1602889f442c477ca25`,
only those two and `opt/firefox/firefox` changed among 11,469 records. Counts
include the trailer. Other contents and all metadata except replacement sizes
are identical. Preserved baselines and candidates are in the scratch directory's
`baseline/` and `candidate/` folders. The default remains 1280×720.

Eleven frontend tests (including the four log-history tests), eleven Files tests,
Python/shell syntax checks and `git diff --check` passed. Save As dialog opening,
filename/filter presentation and dismissal were exercised; saved bytes were not
independently verified. No extended soak or cross-filesystem move support is
claimed. Existing nonfatal Firefox CustomizableUI/getFloatPref diagnostics remain
outside this change; the final picker tests did not reproduce the earlier
confirmExBC error.

- Fresh live `http://127.0.0.1:4180/linux/index.html?firefox=1` boot verified `readme.txt` (29 bytes) and its actual contents through the Aurora picker, with no log viewer or xterm DOM; evidence: `/mnt/p6/project/linux/.cache/aurora-picker-20260926/live-final-single-contents.png`. Both served archive hashes matched the deployed hashes above.

- Staged whitespace checks passed with `core.whitespace=-blank-at-eol`; the default checker only flags the required single-space blank context lines in the three unified Firefox patch files. Source-code whitespace checks passed unchanged.
