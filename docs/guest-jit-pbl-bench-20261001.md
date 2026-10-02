# JIT packet 3b: interleaved baseline vs PBL measurement (2026-10-01)

**Spec.** `docs/guest-jit-pbl-diagnosis-20260930.md` §Packet 3b.

**Task root.** `/mnt/p6/build/guest-jit-pbl-bench-20261001`. It is ext4, and
TMPDIR/TMP/TEMP point to `$T/tmp`.

**Code.** No rebuild was needed. Two new files:

- fixture `web/linux/tests/guest-jit-pbl-bench.html`
- runner `tools/guest-rootfs/test-firefox-pbl-bench.mjs`

## Setup

The two arms share everything except the Firefox archive. Kernel `21c15250…` and
plain rootfs `3abcabf2…` are the same in both, and match `web/linux`.

| Arm | Version | Firefox archive SHA-256 |
|---|---|---|
| A baseline | `fa0217b54d99` | `6c7fad946e53f977bc6d55a80323f7ec6a9fa84858d1a245fe0916e2f6d17e65` |
| B PBL | `test-pbl-6febc628d9f6f796` | `6febc628d9f6f7968bdb228d1590adcff83daabd8c6c4b63c8bb6a71c9afb486` |

**Boots.** Six cold boots in the order **A B B A A B**. Each boot:

- **Browser and server.** A fresh headless Chromium profile with an in-process
  server (HTTP 4201, CDP 9411).
- **VM settings.** 4096 MiB, 2 CPUs, 1280x720, canvas2d, `?firefox=1&gpu=0`.
- **Network.** DNS is refused and `/tcp` upgrades are destroyed, identically in
  both arms (280 DNS refusals in total, 0 TCP).
- **Seeding.** `user.js` and the fixture are seeded into the persistent home.
- **Navigation.** 20 s after `starting /bin/firefox as admin`, the runner
  navigates with real guest input (click the address bar, Ctrl+A, type the
  `file://` URL, Enter).
- **Results.** They come from guest stdout as `PBLBENCH {...}` lines.

**Fixture protocol.** The page settles for 15 s. Then, for each case, it runs 8
warmup batches and 11 timed batches of 100 reps, and repeats the case list 3
times. Every rep is checked against its expected value.

**Per-boot value.** For each case, it is the median of the 33 timed batches
divided by 100 reps (ms per rep).

## Result: harness PASS (`run1/result.json`)

- All 6 boots pass.
- Every checksum is identical across boots and arms.
- All 12 hashed inputs are unchanged, including the runner, the fixture, both
  manifests and archives, the kernel and the rootfs.
- There are no outer exceptions, fatal guest lines or bench error lines.
- Each browser exited 0 and the server closed.
- `navigator.hardwareConcurrency` is 2 in every boot.
- Navigation succeeded first time in 5 boots; boot 5 (A) needed 2 attempts.

**Verdict rules.**

- **Noise-bound.** The max/min spread of the boot medians in either arm is above
  1.10.
- **PBL slower.** The ratio is ≥ 1.10 **and** every B boot is slower than every
  A boot.
- **PBL faster.** The mirror-image condition (ratio ≤ 1/1.10 and every B boot
  faster).

| Case | baseline ms/rep (boots 1,4,5) | PBL ms/rep (boots 2,3,6) | spread A / B | ratio B/A | Verdict |
|---|---|---|---|---|---|
| int-loop (10k iters) | 2.59 2.63 2.54 | 2.57 2.58 2.52 | 1.035 / 1.024 | 0.992 | equal within noise |
| call-recursion fib(14) | 0.55 0.56 0.54 | 0.43 0.43 0.43 | 1.037 / 1.000 | **0.782** | **PBL faster** |
| throw-flat (500 throws) | 0.30 0.31 0.30 | 0.39 0.39 0.41 | 1.033 / 1.051 | **1.300** | **PBL slower** |
| throw-deep (100 x depth 5) | 0.34 0.35 0.34 | 0.38 0.38 0.38 | 1.029 / 1.000 | **1.118** | **PBL slower** |
| throw-error (orig. `f(5)`) | 0.34 0.35 0.33 | 0.37 0.39 0.38 | 1.061 / 1.054 | **1.118** | **PBL slower** |
| prop-mono (4000 x `o.x+1`) | 1.37 1.34 1.32 | 1.42 1.45 1.44 | 1.038 / 1.021 | 1.075 | equal within noise* |
| native-call (4000 x `Math.max`) | 1.78 1.72 1.73 | 2.00 2.04 2.07 | 1.035 / 1.035 | **1.179** | **PBL slower** |
| json (original) | 0.55 0.53 0.48 | 0.51 0.50 0.55 | 1.146 / 1.100 | 0.962 | noise-bound |

\* `prop-mono` is below the 10% threshold, but every PBL boot is slower than every
baseline boot. It is a consistent, roughly 7.5% cost.

**Hypotheses.**

- **H1 (noise): not confirmed as stated.** `int-loop` and `prop-mono` are equal,
  but `json` is noise-bound in both arms (the baseline spread is 1.146).
- **H2 (exceptions): confirmed.** All three throw cases are slower, by 1.12–1.30x,
  while `call-recursion` is not slower; it is faster.
- **H3 (dispatch): not supported.** `int-loop` ratio is 0.992.
- **H4 (non-hybrid props): not supported.** `prop-mono` is below the threshold
  (see the note above).
- **fpcast control: invalid.** `native-call` is 1.18x slower. It was investigated
  below, and the cause is engine behaviour, not the harness.
- **H5 (launch).** Baseline launch markers are 17973 / 18393 / 17909 ms and PBL
  17893 / 17388 / 17392 ms. No verdict, because not every PBL boot is slower.
  PBL is about 0.5 s *earlier* here.

### Why `native-call` is slower (investigated, not a harness fault)

The harness is sound:

- `int-loop` runs through the same fixture, page and timing path, and measures
  0.992 with spreads ≤ 1.035.
- Boots are interleaved, so drift cannot favour one arm.
- The `native-call` spreads are tight (1.035 in both arms).

The cause is in the PBL source (Firefox 128.14.0,
`js/src/vm/PortableBaselineInterpret.cpp`):

- **Fast path is skipped.** PBL's in-activation `CASE(Call)` fast path (line
  4832) handles only interpreted callees (`!func->isInterpreted()` → break).
- **Natives go through the IC instead.** A native such as `Math.max` goes
  through the Call IC:
  - an out-of-line `CacheIRReader` constructor;
  - an 8-argument `ICInterpretOps` call with its shadow-stack prologue;
  - CacheIR guard decoding;
  - then `CallNativeFunction` (line 1765). It pushes a BaselineStub IC frame,
    copies all arguments, builds a fake exit frame, calls `setJSExitFP`, calls
    the `JSNative`, and unwinds.
- **The baseline is shorter.** `js::Interpret` calls `CallJSNative` directly.

This is the same "two out-of-line calls per IC'd op" cost that 3a identified.
It is not fpcast: both arms reach `Math.max` through the same `call_indirect` to
the same `JSNative`.

## Go / no-go for JIT packet 4: GO, PBL is an acceptable substrate

The 09-26 "PBL is slower" rejection is **not reproduced as a general slowdown**:

- Pure dispatch is equal.
- Scripted calls are 22% *faster*.
- JSON is noise-bound in both arms.
- The launch marker is not slower.

The real costs are isolated:

| Cost | Size |
|---|---|
| Exceptions (`jit::HandleException`) | 1.12–1.30x |
| Calls to natives (Call IC) | 1.18x |
| Monomorphic property get/set | about 1.075x |

Packet 4 (the runtime PBL-to-wasm specializer) should remove those costs in
its generated code rather than inherit them:

1. **Native calls.** When the Call IC's attached stub is `CallNativeFunction`
   with a known callee, emit a guarded direct call to the `JSNative`. Build the
   exit frame inline, and skip `ICInterpretOps`.
2. **Property ICs.** Specialise monomorphic shape guards and slot loads/stores
   into straight-line wasm (this removes the `prop-mono` cost).
3. **Exceptions.** Keep the `jit::HandleException` path for now. It is a
   throw-only cost and does not affect steady-state throughput. Revisit it if
   exception-heavy chrome JS shows up in profiles.

## Deviations from the 3b spec (all identical in both arms)

**Task directory.** `-20261001` instead of `-20260930`.

**Fixture: yields after every batch** (`await setTimeout 0`).

- Without it, Firefox's modal slow-script dialog ("A script on this page may be
  busy") stalled the page in this single-process build (smoke4).
- `dom.max_script_run_time=0` was also added to `user.js`.

**Fixture: case sizes.** These were chosen so that every batch is ≥ 30 ms:

- `int-loop` uses 10,000 iterations instead of 40,000. 40,000 took about 1 s per
  batch.
- `call-recursion` uses fib(14) instead of fib(12).
- `throw-flat` uses 500 throws instead of 200.

**Fixture: path, label and deadline.**

- Path: `~admin/pblbench/pblbench-<arm>-<n>.html`, all lowercase, with the label
  derived from the file name. The guest typing helper loses shifted characters
  and early keystrokes (smoke1–3).
- Navigation is retried up to 4 times if no `start` line appears within 45 s.
- The deadline is 900 s per boot instead of 6 min.

**Prefs added to `user.js`.** Besides the spec's three: http2/http3 off, legacy userChrome stylesheets,
`browser.shell.checkDefaultBrowser=false` and the media prefs from the existing
runner.

**Smoke runs.** `PBLBENCH_ORDER` exists only for smoke runs. The harness passes
only with ABBAAB and 6 boots.

## Failed runs kept (`$T`)

| Run | What happened |
|---|---|
| `smoke1-failed-lowercase-path` | An uppercase path letter was typed unshifted, giving "File not found". |
| `smoke2-failed-uppercase-typing` | Shifted typing lost the URL prefix and Firefox ran a search instead. |
| `smoke3-failed-label-mismatch` | The page loaded on attempt 3, but the label was `pblbench-b-1` and the runner expected `b-1`. |
| `smoke4-failed-slow-script-dialog` | Only `int-loop` finished before the modal slow-script dialog. |
| `smoke5` | A single PBL boot passed with the previous fib(12)/200-throw sizes. It is not part of the measurement. |

## Host

- The host was idle apart from the user's own Chromium. Its load average was 2.3
  at the start and was not touched.
- The runner killed only the browser and server it started. Ports 4201 and 9411
  were free afterwards.
- Run size: `run1` is 1.2 GB (Chromium profiles and guest logs per boot).
