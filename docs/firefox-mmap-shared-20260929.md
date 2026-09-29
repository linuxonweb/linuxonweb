# Firefox W0: MAP_SHARED aliasing in the mmap shim — 2026-09-29

Packet W0 of `docs/firefox-webgpu-design-20260929.md`. Task root
`/mnt/p6/build/firefox-mmap-w0-20260929` (ext4, disk-backed; TMPDIR/TMP/TEMP
under its `tmp`). Ports 4196/9406. Not promoted, not deployed; Sites v9 is
unchanged.

## Problem

The kernel is nommu, so the Firefox mmap shim copied file bytes into the heap
for every mapping. Two `MAP_SHARED` views of the same file were independent
copies: a write through one was invisible to the other until an explicit
write-back. Firefox's shared-memory users (IPC shmem, `SharedMap`, the
`cpmm.sharedData` snapshot) assume coherent views. That incoherence is the root
cause of the blank DevTools panel that `132e4fc` worked around in packed JS, and
WebGPU's shmem-backed buffer mapping (W3+) needs the same property.

## Design (adapter only: `web/linux/firefox-shims/mmap-shim.c`)

- One `shared_file` backing per `(st_dev, st_ino)` covering `[0, capacity)`.
  Each `MAP_SHARED` view returns `base + offset`, so all views alias byte for byte.
- Write-back happens on `msync` and on the last `munmap`, clipped to the file size.
- A mapping beyond capacity creates a new generation seeded from the old one.
  The old generation is marked `superseded` and freed after its last view is gone.
- Only regular files (`S_ISREG`) alias. Other shared maps keep a private copy.
  Private and anonymous mappings keep copy-on-map.
- Allocation and free never happen while the spinlock is held.
- `lowland_mmap_refresh()` re-reads the file after `write`/`pwrite`, keeping
  file writes coherent with live views.

No Firefox, kernel or musl source changed. The relink swaps only the shim object.

## Evidence

- Host unit test (`web/linux/tests/test-mmap-shim.sh`, `host-test-run1`) passes.
  It covers 64 KiB bases, shared aliases with both drop orders, backing
  sync/refresh, private/anonymous cleanup and allocation errors: 49 aliasing
  checks.
- Guest test (`web/linux/tests/guest-mmap-shared/`, `guest-run2`) passes 63/0 in
  the real guest at page size 65536, with 1 GiB and 2 CPUs verified.
  - This kernel has no `memfd_create` (ENOSYS), so the test uses the shim's
    `shm_open` path. That is the same fallback Firefox takes.
  - `guest-run1` failed by treating that ENOSYS as an error. It is preserved.
- Relink (`tools/build-firefox-mmap-shared.py`):
  - The control relink (`relink-control-run1`, old shim) reproduces the deployed
    binary apart from its build-id.
  - `relink-run1` (new shim): `firefox.wasm` is 157,423,177 bytes, SHA-256
    `4f7492e4c7666039f559c8cec55a438093fdf5093224dcd93c4ff95dede4305d`.
- Packaging (`tools/guest-rootfs/package-firefox-mmap-shared.py`) uses base
  `b21b2cac65a3` (the local DevTools promotion):
  - `candidate-run1`, version `93720d50222f`: only `opt/firefox/firefox` changes;
    11,469 records are unchanged. Archive is 88,379,774 bytes, SHA-256
    `d1a7a74f9aa0facdd8d7c11ebe86f564a5de60250683903b8e9ecc1ffeebb656`.
  - `candidate-noworkaround-run1`, version `9fe35012a2b7`: also restores the
    original `ContentProcessWatcherRegistry.sys.mjs`, removing the packed-JS
    DevTools workaround. 11,468 records are unchanged.
- DevTools:
  - `devtools-v9-control-run1` reproduces the original bug: eval has no guest
    effect.
  - `devtools-candidate-run1` passes console, eval, inspector, and warm boot with
    zero image requests.
  - `devtools-noworkaround-run1` passes the same steps. Its screenshots show the
    console panel and the inspector DOM tree. So the shim fixes the root cause:
    the packed-JS workaround is no longer needed.
- Startup and update regressions (on `candidate-run1`):
  - `session-startup-run1` passes cold and warm, with zero warm image requests.
    Launch-log times are 8.84 s and 7.87 s; this is not first paint.
  - `session-update-run1` passes baseline `b21b2cac65a3` → `93720d50222f`
    update/restart, preserving the prior download.
- Runner copies in `runners/` differ from the tracked runners only in repo/task
  paths and port 4196. All browsers exited 0 and all servers closed.

Compact evidence: `docs/evidence/firefox-mmap-20260929/shared-alias.json`.

## Next

- Promotion should use the no-workaround candidate (or its successor), after a
  session regression on those exact bytes. The JIT packet 2 candidate
  `a9438150f676` is also unpromoted; rebase both onto one image before promoting.
- W1 (relax the `RELEASE_OR_BETA` WebGPU gates under `__wasm__`, add prefs,
  `requestAdapter` returns null without crashing) builds on this relinked binary.
