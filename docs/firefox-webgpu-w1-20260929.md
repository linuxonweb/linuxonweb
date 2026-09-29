# Firefox WebGPU W1: compile out the RELEASE_OR_BETA gates (2026-09-29)

Packet W1 of `docs/firefox-webgpu-design-20260929.md`. Gate: in the real
Linux-wasm guest, single-process Firefox 128.14 ESR exposes `navigator.gpu`,
and `await navigator.gpu.requestAdapter()` resolves to `null` without a
crash. It reaches WebGPUParent and the Empty wgpu HAL. **Result: pass.** The
candidate is not promoted into `web/linux` and not deployed.

Task root (ext4 on /mnt/p6): `/mnt/p6/build/firefox-webgpu-w1-20260929`
(`$T` below). All scratch went to `$T/tmp`: every command ran with
`TMPDIR=TMP=TEMP=$T/tmp`. Ports: 4198 (HTTP) and 9408 (CDP).

## The only upstream edit, and why it is unavoidable

Patch `$T/relink-run1/webgpu-gates.patch`, SHA-256
`b31bddf801ecdc6068e163c10f27c898da542326a003536704653b5ba4703a37`:

```diff
--- a/dom/webgpu/Instance.cpp
+++ b/dom/webgpu/Instance.cpp
@@ -66,7 +66,7 @@
-#ifdef RELEASE_OR_BETA
+#if defined(RELEASE_OR_BETA) && !defined(__wasm__)
     if (true) {
       return "WebGPU is not yet available in Release or Beta builds.";
--- a/gfx/thebes/gfxPlatform.cpp
+++ b/gfx/thebes/gfxPlatform.cpp
@@ -3175,7 +3175,7 @@
-#ifdef RELEASE_OR_BETA
+#if defined(RELEASE_OR_BETA) && !defined(__wasm__)
   feature.ForceDisable(FeatureStatus::Blocked,
                        "WebGPU cannot be enabled in release or beta",
                        "WEBGPU_DISABLE_RELEASE_OR_BETA"_ns);
```

Source hashes:

| File | Original | Patched |
| --- | --- | --- |
| Instance.cpp | `d0727d94...` | `63edadb39f48...` |
| gfxPlatform.cpp | `06c23a24...` | `e20ea9fc6649...` |

The preserved nix source tree was not modified. The tool writes both patched
copies inside the task directory.

Why an adapter cannot do this:

- **Instance.cpp.** The `RequestAdapter` errStr lambda is a compile-time
  preprocessor branch. On ESR it returns the Release/Beta message
  unconditionally, before any pref or `gfxVars` check. The request then
  rejects with `NotSupportedError`.
- **gfxPlatform.cpp.** `InitWebGPUConfig` calls `ForceDisable` at runtime,
  and no pref overrides it.
- **Neither gate calls an external symbol.** A `--wrap` link wrapper therefore
  has nothing to intercept. Rewriting whole functions in wrapper code would be
  a larger upstream divergence than these two lines.
- **The prefs-only control confirms it.** `webgpu-control-prefs-run1` sets
  `dom.webgpu.enabled=true` and `gfx.webgpu.ignore-blocklist=true` on the
  unmodified W0 binary. `navigator.gpu` appears, but all four `requestAdapter`
  calls reject with `NotSupportedError: WebGPU is not yet available in Release
  or Beta builds.`

Prefs are set through the adapter default-pref file
`opt/firefox/defaults/pref/wasm.js`, not omni.ja. The design note said
"packed user.js". The default-pref file was chosen instead because user
profiles and `user.js` cannot clobber it, and it already carries the other
wasm adapter prefs. Appended text:

```
// WebGPU (W1). ... (4 comment lines)
pref("dom.webgpu.enabled", true);
pref("gfx.webgpu.ignore-blocklist", true);
```

## Tools added

- **`tools/build-firefox-webgpu-gates.py OUT [--control]`** (new; the W0 tool
  is unchanged). Compiles each of the two translation units twice: original,
  then patched. It requires both originals to be byte-identical to the shipped
  objects. It then relinks the exact W0 `link-command.json` argv, pointing at a
  new `firefox-nss.list` where only the two object lines differ. After that it
  runs wasm-opt fpcast (`max-func-params@23`) and wasm-validate. It records a
  link-input diff and a masked build_id hash. `--control` relinks with the
  reproduced original objects, which must equal W0 modulo build_id. It pins
  every input hash (listed in `report.json`).
- **Compile reproduction.**
  - Compile line: the clangd `compile_commands.json` entry, with only the
    output path changed.
  - Include path: `-I/tmp/firefox-mmap-shim` is replaced by the task copy
    `$T/explore-control-run2/shimhdr` (header SHA-256 `47983e64...`).
  - Environment: the OS environment minus `NIX_*`, plus five variables from
    the pinned nix `env-vars` (`9060a69a...`): `NIX_CFLAGS_COMPILE`,
    `NIX_CXXSTDLIB_COMPILE`, `NIX_HARDENING_ENABLE`,
    `NIX_CC_WRAPPER_TARGET_HOST_wasm32_unknown_linux_musl` and
    `NIX_ENFORCE_NO_NATIVE`.
  - Source name: the relative unified name `Unified_cpp_dom_webgpu0.cpp`.
- **`tools/guest-rootfs/package-firefox-webgpu-w1.py`.** Modeled on
  `package-firefox-mmap-shared.py`. It pins the W0 candidate archive, manifest,
  Firefox member and `wasm.js`. It replaces exactly those two members and
  verifies record order, metadata (except size) and the CPIO tail. It writes
  `package.json` and `boot-manifest.json`.
- **`tools/guest-rootfs/test-firefox-webgpu-w1.mjs OUT CANDIDATE BASELINE [candidate|control|control-prefs]`.**
  - Setup: owns one finite in-process server and one headless Chromium on
    4198/9408.
  - Probe: seeds a fixture `file:///home/admin/sites-probe.html`, a secure
    context. The page records `navigator.gpu`, the GPU globals, four
    `requestAdapter` calls (default, high-performance, low-power,
    forceFallbackAdapter) in try/catch, `getPreferredCanvasFormat` and
    `wgslLanguageFeatures`.
  - Reporting: it writes a Downloads JSON and sets the title. The runner also
    takes screenshots, checks for fatal or crash lines in the guest log,
    verifies that Firefox did not exit, and verifies real guest typing plus a
    JS checksum.
  - Modes: candidate runs cold and warm. The control modes run cold on the W0
    baseline.
  - Runner copies: each run copies the runner into `OUT/runner.mjs`.
    - Runner SHA-256 `44252dcf...`: `webgpu-gate-run1` and
      `webgpu-control-run1`.
    - Runner SHA-256 `bd177eb7...` (current file): `webgpu-control-prefs-run1`.
      This version only adds that mode.
- **`$T/runners/test-firefox-session-startup.mjs`.** A task copy of the W0
  session-startup runner (SHA-256 `97c6e453...`). It differs only in repo and
  task paths and fixed ports 4198/9408; see `$T/runners/session.diff`.

## Commands

```sh
T=/mnt/p6/build/firefox-webgpu-w1-20260929
mkdir -p $T/tmp; export TMPDIR=$T/tmp TMP=$T/tmp TEMP=$T/tmp
W0=/mnt/p6/build/firefox-mmap-w0-20260929/candidate-noworkaround-run1
python3 tools/build-firefox-webgpu-gates.py $T/relink-control-run1 --control
python3 tools/build-firefox-webgpu-gates.py $T/relink-run1
python3 tools/guest-rootfs/package-firefox-webgpu-w1.py --source $W0/initramfs-firefox.cpio.gz \
  --manifest $W0/boot-manifest.json --build $T/relink-run1 --output $T/candidate-run1
node tools/guest-rootfs/test-firefox-webgpu-w1.mjs $T/webgpu-gate-run1 $T/candidate-run1 $W0
node tools/guest-rootfs/test-firefox-webgpu-w1.mjs $T/webgpu-control-run1 $T/candidate-run1 $W0 control
node tools/guest-rootfs/test-firefox-webgpu-w1.mjs $T/webgpu-control-prefs-run1 $T/candidate-run1 $W0 control-prefs
node $T/runners/test-firefox-session-startup.mjs $T/session-startup-run1 $T/candidate-run1 '' $W0
```

`$T/verify-package-run1/result.json` is an independent CPIO comparison:
- 11,470 records in each archive, in the same order, with an equal tail.
- Only `opt/firefox/firefox` and `opt/firefox/defaults/pref/wasm.js` change.
- There are no header changes other than size.

## Results

### Reproduction and link

**`relink-control-run1` (pass):**
- Both originals reproduce byte-for-byte:
  - `Unified_cpp_dom_webgpu0.o`: `7521423c...`, 3,696,717 bytes.
  - `gfxPlatform.o`: `bc3a9f8d...`, 2,068,156 bytes.
- The control `firefox.wasm` (157,423,177 bytes) has masked build_id hash
  `fd1b9cdb...cab49a2`, equal to W0.
- Link diff:
  - argv 114/114 entries; only index 37 (the list path) and index 111 (the
    `-o` path) differ.
  - List 2378/2378 lines; only lines 1112 (`gfxPlatform.o`) and 1485
    (`Unified_cpp_dom_webgpu0.o`) differ.

**`relink-run1` (pass):** the same link-input diff, with the patched objects:
- webgpu0: `c2d44d77...`, 3,938,182 bytes.
- gfxPlatform: `06419735...`, 2,065,744 bytes.

Candidate `firefox.wasm`:
- 157,454,290 bytes, SHA-256
  `3a1af53de3306e5380c84fa900bcc505f09bae6ffb856be03972c9b9b2aa3db6`.
- Masked hash `c78ca578...`.
- wasm-validate passes.
- Timing: about 16 s per compile, 7.2 s link, 22.6 s fpcast, 10.6 s
  validate; 107.6 s total.

`$T/strings-check.txt` compares the two binaries:
- **Removed from the candidate:** "WebGPU is not yet available in Release or
  Beta builds.", "WebGPU cannot be enabled in release or beta" and
  `WEBGPU_DISABLE_RELEASE_OR_BETA`.
- **Now present:** the next checks, "WebGPU is disabled by blocklist." and
  "...dom.webgpu.enabled:false.", plus "Failed to create WebGPUChild".

### Candidate package

**`$T/candidate-run1`:**
- Version `c27a1a7c6e6a`.
- `initramfs-firefox.cpio.gz`: 88,387,268 bytes, SHA-256
  `dbd64c0dcf7228f6385f54f3409c806df53448387451b8fe8ec688594b3ab5c2`
  (uncompressed 280,054,560).
- Base: W0 `9fe35012a2b7` (archive `fe15ebdd...`, manifest `88c0e2ef...`).
- 11,468 of 11,470 records unchanged.
- `wasm.js`: 541 to 917 bytes, `5c4072e3...` to `544a8384...`.
- Manifest SHA-256 `9b6dcb44...`.

### Guest gates

**`webgpu-gate-run1` (candidate, pass).** Both phases:
- `navigator.gpu` is `[object GPU]` in a secure context.
- `GPU`, `GPUAdapter`, `GPUDevice` and `GPUBufferUsage` exist.
- All four `requestAdapter` calls **resolved `null`**.
- `getPreferredCanvasFormat()` returns `bgra8unorm`.
- The guest log shows "Uncaptured WebGPU error without device target: No
  suitable adapter found" four times. This is the wgpu server/parent path with
  the Empty HAL.
- No fatal or crash lines; Firefox stayed alive.
- Typed "wasmperf" produced checksum 7998000.

| Phase | Launch | Probe | Probe times (ms) | Image requests |
| --- | --- | --- | --- | --- |
| Cold | 7.9 s | 38.4 s after navigation | 280/130/49/195 | 2: kernel, initramfs `dbd64c0d` |
| Warm (automatic) | — | — | 82/36/194/10 | 0 |

Browser exit 0, server closed, 0 errors. Screenshots inspected:
`cold-probe.png`, `cold-functional.png` and `warm-functional.png` show the
title "WebGPU W1: requestAdapter resolved null x4", the JSON and the typed
text.

**`webgpu-control-run1` (W0 baseline, no prefs; pass).**
- `navigator.gpu` is absent.
- Input works.
- Browser exit 0. Screenshot inspected.

**`webgpu-control-prefs-run1` (W0 baseline plus both prefs in user.js; pass as
a control).**
- `navigator.gpu` is present.
- All four calls reject with the Release/Beta `NotSupportedError`.
- Input works; browser exit 0.
- Screenshot inspected: title "unexpected: rejected x4", as expected for this
  control.

### Session regression

**`session-startup-run1` (candidate vs baseline `9fe35012a2b7`, pass).**

| Phase | Guest ready | Launch | Image requests |
| --- | --- | --- | --- |
| Cold | 34.9 s | 7.9 s | 2 |
| Warm (automatic) | 25.7 s | 6.8 s | 0 |

- Fixture and input work in both phases.
- Browser exit 0, server closed, 0 errors.
- Screenshots inspected.

### Cleanup

- No owned process remains; ports 4198 and 9408 are free.
- User server PID 1591443 still has startTicks 148821663.
- The dev-server watcher and the user's Chromium were not touched.

## Limitations

- **No GPU work yet.** The in-guest wgpu HAL is Empty, so every adapter
  request is null. W1 proves only exposure and the path to WebGPUParent.
- **Patched objects are not bit-reproducible elsewhere.** They embed task
  paths. The `--control` relink proves the pipeline reproduces W0 exactly.
- **Firefox 128 differences.** `navigator.gpu.wgslLanguageFeatures` is
  undefined in Firefox 128; the fixture records this as a TypeError, not a
  failure.
- **Timings.** Launch-log times are not first paint; no speedup is claimed.
- **Release gates not yet run.** The candidate is not promoted or deployed.
  Pending: update/home preservation, DevTools console/eval/inspector,
  combination with the unpromoted JIT prep candidate `a9438150f676`, and
  public acceptance.

## W2 blockers

None from W1.
- **W2 is independent of the Firefox binary.** It is the runtime adapter: a
  host GPU-owner Worker plus a private `gpu_hostcall` syscall in `worker.js`.
- **Reusable tooling.** `tools/build-firefox-webgpu-gates.py` (exact object
  reproduction plus a single-list-line relink) is reusable for the W4
  `--wrap` forwarder relink.
- **To verify in W2:** whether host `GPUQueue.writeBuffer` accepts
  SharedArrayBuffer-backed views, or whether a copy is needed.
- **Candidate stacking:** future Firefox candidates must layer on
  `c27a1a7c6e6a`, or be rebased onto the W0/JIT-prep candidates.
