# Persistent browser home and reusable system images

## Architecture

The guest remains native wasm32 Linux with its existing prebuilt RAM initramfs.
`web/linux/persistent-home.mjs` implements the runtime's existing virtio-fs
contract over IndexedDB, mounted at `/home`. Regular-file contents use sparse
64 KiB chunks; inode metadata, directory entries, renames and affected chunks
commit in the same IndexedDB transaction. Symlinks, modes, ownership, truncate,
rename replacement and open-but-unlinked files are supported. Hard links and
special-file creation are not implemented by the existing filesystem bridge.
Home chunks contain uncompressed application bytes, allowing small random
writes without recompressing a whole home image. IndexedDB was chosen for
atomic metadata-plus-data transactions, including rename and interrupted-write
recovery; this is independent of any browser-internal storage compression.

One Web Lock prevents independent guest kernels from opening the same home at
the same origin concurrently. Mounts use `rw,sync,dirsync`; the kernel's
virtio-fs implementation already sets `default_permissions = 1`. Supplying
that option explicitly is rejected by this kernel, as the first live test
demonstrated. Mount failure stops desktop startup instead of quietly running
with a volatile home.

Every issued filesystem write resolves only after the IndexedDB transaction
commits, requesting strict durability where the browser supports it. Failed
multi-chunk writes roll back metadata and data together. Quota exhaustion is
reported to the guest as ENOSPC and to the page as a storage error. Linux's
synchronous mount limits delayed kernel writeback; applications must still save
their own buffers. Force-closing a tab during an incomplete application write
can lose that incomplete write. This is not an application-consistent snapshot
of an abruptly terminated Firefox process.

The home is tied to the browser profile and web origin. Private mode, browser
data deletion or eviction can remove it. The explicit Keep storage control
requests browser eviction protection and reports whether it was granted.
No durability guarantee is made against device loss or deliberate data clearing.

## System image cache and updates

`boot-manifest.json` describes kernel, desktop archive and Firefox archive with
independent SHA-256 identities and byte lengths. The recommended split is a
compressed immutable distribution image and separately chunked, uncompressed
mutable home. Firefox uses the existing gzip distribution; the smaller desktop
archive remains the existing raw CPIO in this release. CacheStorage stores
those verified distribution bytes in bounded 1 MiB parts separately from the
IndexedDB home. A complete index is committed only after all parts are stored;
reads validate every referenced part and reconstruct a streaming Response.
Missing/evicted parts trigger a fresh verified download. Existing monolithic
verified cache entries remain readable. The Firefox
archive is streamed through DecompressionStream only when booting; its expanded
rootfs remains guest RAM. No copy of the entire expanded rootfs is written to
the home database. Warm boots avoid repeated image download; they still unpack
the initramfs and compile/instantiate WebAssembly. Near-native Firefox speed is
not claimed.

Update & restart fetches the current manifest, stages and verifies all three
images, then changes a single atomic active-plus-rollback metadata record. It
refreshes the page only after staging succeeds. Network, checksum, quota or
metadata-write failure leaves the active record unchanged. The running kernel
stays pinned until refresh. After a successful durable-home mount, cache
cleanup keeps the active and one previous release; a failed boot does not
trigger cleanup. A shared system lock serializes updates, rollback and deletion.

Current production asset URLs are mutable across deployments. If a pinned
older image was evicted or explicitly deleted and is no longer served, boot
reports that the user must choose Update & restart. The home remains intact.
Offline full-page boot is not promised: the application frontend is not a
service-worker offline bundle.

The bottom storage panel distinguishes home file allocation, cached image bytes
and the browser's estimate for total origin usage/quota. File allocation does
not include IndexedDB metadata. Image deletion retains home files. Home
deletion requires a visible destructive confirmation, stops the guest, and
keeps the exclusive home lease until database deletion completes.

## Packaging and release

`tools/guest-rootfs/package-persistent-home.py` accepts an explicit baseline SHA
and transforms only the already-deployed `/init`, retaining all existing
Firefox/CA/font/picker/PTY/display adaptations. It seeds sample home files once
and avoids overwriting existing Firefox user.js, certificate databases or
userChrome.css. Console mode also runs `/init` to mount the same home before
entering its shell. The generic `init.sh` is documentation/build input, not a
replacement for the richer packed init.

Repackage from the retained **pre-persistence baseline**, not a previously
patched archive. After finalizing all guest/kernel changes, regenerate:

```sh
python3 tools/guest-rootfs/package-persistent-home.py --manifest web/linux
```

Cloudflare's explicit source allowlist includes the storage modules and
manifest. Staging rejects a manifest whose hashes or lengths differ from the
actual snapshot. The accepted release is served by Sites version 4 assets;
the existing Cloudflare worker remains the unchanged DNS/TCP network proxy.
Cloudflare deployment credentials were unavailable. Exact source commits,
bundle identities and deployment IDs are in
`docs/evidence/runtime-graphics-20260926/sites-release.json`; the older
Cloudflare release record retains its original deployment and source hashes.

## Verification status

Completed:

- Staged kernel SHA matches the archived build with CONFIG_FUSE_FS and
  CONFIG_VIRTIO_FS enabled.
- First overlay audit: all 3,847 desktop and 11,469 Firefox CPIO records retained;
  exactly `/init` changed, with other member bytes and metadata unchanged.
- Browser IndexedDB regression: 16 checks passed, including real transaction
  commit/reopen, sparse cross-chunk writes, shrink/extend zeroing, permissions,
  symlinks, rename replacement, open unlink, injected quota rollback/recovery,
  directory-cycle rejection and exclusive lease rejection.
- First real guest test discovered the unsupported explicit mount option;
  corrected to use the kernel's built-in permission behavior.
- Corrected real guest console test passed: `/proc/mounts` reports
  `home /home virtiofs rw,sync,dirsync,relatime`; shell wrote and synchronized a
  unique marker, then read its exact bytes after page reload and a fresh kernel.
  Mount reached in 2.54 s and 3.05 s in that already-warm QA browser; these are
  not cold-download or Firefox startup measurements.
- CacheStorage/UI regression: 18 checks passed, covering interrupted downloads,
  checksum mismatch and cache quota failure preserving the active release,
  successful activation/rollback, pinned running loader, offline cache reads,
  two-release cleanup, success-only automatic restart and confirmed/cancelled
  home deletion controls.
- A later live 88 MB Firefox update exposed Chromium's `Cache.put` "Unexpected
  internal error". The update correctly retained the running guest and active
  release. A transport matrix found smaller writes succeeded while larger and
  repeated writes failed despite ample browser-origin quota. Host filesystem
  inspection found only 1,654,784 bytes free in `/tmp`, while the workspace had
  about 194 GiB available and RAM was ample. This is an environment storage
  failure, not a claimed universal CacheStorage entry-size limit. QA browser
  profiles and TMPDIR must live on the disk-backed workspace. The implementation
  retains conservative 1 MiB parts and a last-written index for bounded memory
  transfers.
- After moving both task-owned QA browser profiles and TMPDIR to disk-backed
  storage, all 29 expanded cache checks passed, including mid-image partial
  failure, atomic metadata failure, exact streamed reconstruction, missing-part
  repair, allocation accounting, and repeated no-change updates retaining a
  distinct rollback image despite manifest property ordering. Identical images
  do not expose a misleading rollback action. Profile copies were hash-verified and the
  previously saved guest marker survived the browser restart.
- The real guest then passed write/reload with **zero system-image network
  fetches**, followed by actual Update & restart staging the full 88 MB Firefox
  image, automatic page refresh/resume and exact marker preservation. Final
  cached encoded bytes: 134,963,688; 88 entries including 85 data parts and
  retained monolithic images. The final warm loader reported two hits, zero
  downloads and no cache errors. Evidence is in
  `../.cache/runtime-graphics-20260926/storage-release-qa/`.
- Desktop and 430px mobile storage screenshots were visually reviewed. Labels,
  usage estimates and 44px controls fit without horizontal overflow. Console
  mode hides the unused blank framebuffer.
- Actual Firefox rendered pages using the persistent profile. A bookmark made
  in its UI retained the same URL, title, bookmark ID and GUID after page reload
  and a fresh guest. SQLite `integrity_check` returned `ok` before and after.
  The tested row's `visit_count` is zero, so this proves bookmark/profile
  preservation, not positive visit-history counts. Sanitized evidence is in
  `docs/evidence/runtime-graphics-20260926/storage-firefox-profile-reload.json`;
  browser profiles and SQLite databases are intentionally excluded.
- Small checked-in cache and guest-update reports are alongside that evidence:
  `storage-cache-fixture.json`, `storage-cache-final.json`, and
  `storage-guest-reload-update.json`.
- Actual storage controls passed: cancelling home deletion retained the exact
  guest marker and Firefox profile; deleting cached images reduced image bytes
  to zero while retaining both. Update refilled 134,963,688 encoded bytes.
  Confirmed home deletion removed every home entry and data chunk while leaving
  those cached images unchanged. The idle usage reader recreated only an empty
  root inode (one metadata node, zero data bytes), as expected. Evidence:
  `docs/evidence/runtime-graphics-20260926/storage-controls.json`.

- Public Sites version 4 passed full kernel/plain/Firefox hash and isolation
  checks, actual guest write/reload, zero-image warm reload, and Update & restart
  with exact marker preservation and no captured page errors. Sanitized live
  evidence is `docs/evidence/runtime-graphics-20260926/sites-live-storage.json`.
  Production desktop and 430px mobile screenshots were visually reviewed:
  separate storage counts and 44px controls fit without horizontal overflow.
  Observed mount times were 62.6 s initially, 53.4 s warm and 56.4 s after update;
  a visible 1 GiB/2 CPU repeat reached kernel startup at 1.0 s, unpack at 34.4 s,
  `/init` at 38.1 s, home mount at 61.0 s and shell at 71.3 s with zero image
  fetches. Slow warm boot reproduced in the foreground; its finer cause remains
  unresolved. Image reuse works, but fast overall boot is not established.
  A final visible local run with the same 1 GiB/2 CPU settings and zero image
  fetches reached kernel startup at 0.267 s, unpack at 1.099 s, `/init` at
  1.384 s, home mount at 1.979 s and shell at 2.655 s. The origin/runtime
  difference is real in these observations; this trace does not identify its
  cause. Both unpack-to-free-initrd intervals were about 0.28 s, so caching an
  expanded rootfs is not supported as a solution to the dominant observed delay.
  Local evidence is `docs/evidence/runtime-graphics-20260926/local-boot-timing.json`.
- Actual production guest DNS/TCP/HTTPS smoke checks passed: init logged
  successful `wget google.com` and certificate-validated
  `curl https://www.google.com`. Compact timing and network evidence is
  `docs/evidence/runtime-graphics-20260926/sites-live-timing-network.json`.

All local storage acceptance and live functional gates have passed. Storage-scope quality assessment:
95/100, based on transactional failure coverage, real guest and SQLite reload,
update/restart preservation, deletion isolation and responsive UI review.
This is a scope assessment, not a benchmark or overall project score. Further
boot performance diagnosis is unresolved. The verified persistence work
does not provide guest native JIT, GPU APIs, hardware decoding or near-native
execution speed.
