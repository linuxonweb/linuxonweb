# Disposable FUSE mount experiment

This fixture measures `MS_SYNCHRONOUS | MS_DIRSYNC` against an ordinary writable mount, using the real Linux guest and the unchanged strict IndexedDB HomeFS implementation. It is not a product durability change.

The current `web/linux/dist/virtio/fs.js` FUSE_INIT response does **not** negotiate `FUSE_WRITEBACK_CACHE`; OPEN flags are zero, not `FOPEN_DIRECT_IO`. In `sources/linux/fs/fuse/file.c`, `fuse_file_write_iter` therefore reaches `fuse_cache_write_iter`, whose non-writeback branch calls `fuse_perform_write`. That waits for `fuse_send_write_pages` and `fuse_simple_request` before returning. `generic_write_sync` then performs the mount-imposed additional sync. An ordinary mount in this configuration still writes through: it does not introduce delayed dirty-page coalescing.

`check.c` mounts two independent disposable HomeFS namespaces and checks actual guest `write`, `pwrite`, `fdatasync`, `fsync`, close, atomic rename, directory sync, quota and transaction-abort errors. The browser fixture injects real IndexedDB failures, independently reads acknowledged writes before the guest receives its write response, then uses the product Stop ordering and reopens all test files. The native benchmark uses 256 separate 4KiB writes; its timing is a narrow RPC diagnostic, not Firefox startup performance.

Build with the project's wasm32-linux-musl compiler and its static/shared-memory flags. `tools/guest-packages/make-smoke.py` creates the small image from the pinned clean BusyBox archive; use the bounded build helper and keep output on disk. Serve the generated `.cpio` and `.json` through `LINUXONWEB_MOUNT_FIXTURE` in the isolated timing proxy. Run the existing bounded owner in `mount-tests` mode. No real user profile is read or modified.


## Experimental writeback and acknowledged Stop barrier

`writeback.c` / `home-writeback.html` negotiate FUSE_WRITEBACK_CACHE only on the isolated tag `writeback`, using a test-only proxy transform. Production `dist/virtio/fs.js` stays unchanged. The first diagnostic reduced 256 separate 4KiB writes to two host writes, but proved that the current product Stop ordering loses an acknowledged open dirty page. That result rules out exposing writeback to users. The optional fadvise result and sticky syncfs error expectations were subsequently corrected in the source; the original failed receipt is retained and the revised writeback fixture must be rebuilt before its next run.

`barrier.c` / `barrier.html` provide a small native lifecycle diagnostic, with a fixed PREPARE/COMMIT/CANCEL protocol and a random 128-bit nonce. The helper records PID identity, uses pidfds to stop user writers, waits for their threads to stop, rescans for newly spawned processes, then calls actual guest syncfs. Only the exact successful acknowledgement permits Stop. Failed flush, cancellation or timeout resumes only processes stopped by that helper; pre-existing stopped processes are not resumed. The fixture PID1 itself is deliberately non-writing after setup, unlike the current real desktop init.

On 2026-11-03 the actual guest barrier fixture passed16 checks in27.374s: active writer and acknowledged still-open data were durable before PREPARED; wrong nonce could not commit; exact acknowledgement followed by Stop/reopen retained bytes. A real IndexedDB quota failure propagated as ENOSPC from native syncfs and left the guest running; a5s timeout restored the active writer without a false shutdown. Source and exact generated-payload hashes are recorded in `../evidence/barrier1-20261103.json`.

**Production remains unaccepted and disabled.** The current desktop PID1 may spawn/respawn writers, and namespace PID1 cannot be safely stopped by this helper. A production supervisor and complete desktop/APK/home/error/Stop/reopen acceptance are not implemented. This protocol experiment is not a product durability guarantee.
