# Local Firefox GPU homepage overlay — 2026-10-02

Firefox defaults to `file:///opt/firefox/gpu-check/gpu-check.html`. The installed page automatically animates WebGL and WebGPU cubes and displays the running document's `navigator.userAgent` Firefox version and, when exposed, `navigator.buildID`. Both fields are explicitly reported browser values: privacy settings can reduce them. No Firefox version is hardcoded into the installed page. Host Chromium rendering does not establish guest Nightly identity or GPU support.

`tools/guest-rootfs/package-firefox-gpu-check.py` now accepts a reviewed archive and manifest with explicit SHA-256 hashes rather than depending on the old W1 Firefox128 candidate. It creates a fresh isolated output. It sets the homepage and `browser.startup.page=1` plus these defaults in the installed `opt/firefox/defaults/pref/wasm.js`:

- `webgl.force-enabled=true`
- `webgl.disabled=false`
- `webgl.enable-webgl2=true`
- `webgl.disable-fail-if-major-performance-caveat=true`
- `dom.webgpu.enabled=true`
- `gfx.webgpu.ignore-blocklist=true`

These names were checked against the recovered latest Nightly `modules/libpref/init/StaticPrefList.yaml`. `gfx.webgpu.ignore-blocklist` has `mirror: once`; all five other GPU prefs have `mirror: always`. Setting early application defaults is required for the startup-only pref. The removed `dom.webgpu.workers.enabled` setting is not carried forward. Existing distribution definitions of managed GPU/startup prefs are removed so later customization cannot undo the early defaults. The distribution homepage and bookmarks point to the local page; unrelated existing INI content is retained. Saved user preferences continue to override defaults, including a saved homepage or a deliberately disabled API.

The adapter preserves `init`, Firefox code, user/profile files and every unrelated CPIO member byte for byte, along with original member order, metadata other than changed body sizes, and trailer padding. An input with a mandatory Firefox startup URL is rejected rather than altering its launcher. Input hashes and the manifest's Firefox byte count/hash must match. Kernel and plain-rootfs manifest entries remain unchanged. Reapplying the overlay produces an identical archive. It never promotes or deploys its output.

Run this after packaging a Nightly archive. Pin the two hashes from the reviewed build output, create a disk-backed scratch directory, and use a fresh output path:

```sh
TASK=/mnt/p6/build/firefox-nightly-musl-recovery-20261002
TMPDIR="$TASK/scratch" TMP="$TASK/scratch" TEMP="$TASK/scratch" \
python3 tools/guest-rootfs/package-firefox-gpu-check.py \
  --source "$NIGHTLY_ARCHIVE" \
  --manifest "$NIGHTLY_MANIFEST" \
  --source-sha256 "$PINNED_ARCHIVE_SHA256" \
  --manifest-sha256 "$PINNED_MANIFEST_SHA256" \
  --task-root "$TASK" \
  --output "$TASK/gpu-homepage-candidate-run1"
```

The dedicated task root must exist under `/mnt/p6/build`; output must not already exist. TMPDIR/TMP/TEMP must reference an existing disk-backed directory within that task. The packager requires the 20 GiB free-space reserve.

The page marks success only after non-background cube pixels are verified: WebGL reads a center pixel, and WebGPU validates a first submitted frame then reads an offscreen center pixel. WebGPU retries with offscreen readback presentation if the initial canvas device is lost. API absence, null adapters, request rejection, validation errors, asynchronous rendering errors, device loss and context loss remain visible. Rendering stops on fatal asynchronous errors; pending verification cannot overwrite a device-loss/error verdict. Browser identity is also logged as `GPUCHECK browser=...`, followed by the existing `GPUCHECK webgl=... webgpu=...` state lines.

Evidence is retained under `/mnt/p6/build/firefox-default-gpu-page-20261002`:

- `host-page-run2/report.json`: nine passing host checks, including actual Intel ANGLE WebGL and NVIDIA Maxwell WebGPU rendering. The first WebGPU canvas device was lost; the readback fallback rendered successfully. Cube-only screenshot pairs change over time; the 320 px viewport has no horizontal overflow. The remaining checks exercise API absence, null adapter, adapter/device rejection, invalid WGSL, device loss, context loss and a synthetic reported-Firefox identity. The synthetic identity check is only a formatting test.
- `validation/package-report.json`: five passing checks covering independent parsing of all 11,470 original v10 CPIO records, unchanged metadata/profiles/kernel/plain inputs, idempotence, conflicting distribution defaults while retaining user preferences, wrong-hash rejection without output, and mandatory-URL rejection.
- `validation/latest-pref-audit.json`: pinned source-file hash and the exact Nightly preference blocks.
- `v10-overlay-verification-run2`: isolated packaging diagnostic based on existing public v10. Archive SHA-256 `b29d7da9e39afa26128942d5702021c7c0e7580e59f1631a015c367d76c39eca`. Only `opt/firefox/defaults/pref/wasm.js` changes among existing members; four local page/distribution records are added. This Firefox128 archive must not be promoted as the requested Nightly upgrade.
- `validation/host-page.mjs` and `validation/package-check.py`: retained finite validation scripts. Browser profiles, caches and scratch remain disk-backed in this task.
- `guest-launch-run1/result.json`: actual Firefox128 guest cold-launch diagnostic passes all six checks in 102,727 ms. No homepage was seeded in the test profile; the local page opened by default and logged `Firefox/128.0` and the privacy-reduced reported build ID `20181001000000`. WebGL honestly reports unavailable contexts and `FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`; WebGPU honestly reports that it is not yet available in Release/Beta builds. These are recorded API failures, not GPU acceptance. The owned host browser exited normally with code 0 and the owned server closed. `cold-page.png` and `cold-guest-logs.txt` retain the visible page and guest identity/error evidence. `validation/guest-launch-smoke.mjs` retains the finite cold-only adaptation of the existing pinned runner; it does not test warm startup or profile updates.

Latest guest Nightly rendering, cold/warm startup and profile-preserving update acceptance remain pending the complete Nightly build and native Wasm JIT integration. Public v10 remains untouched.
