# Host presentation and native Wasm Firefox

The runtime is native wasm32 Linux/userspace, not v86 or an x86 emulator.
The browser compiles `vmlinux.wasm` and guest program Wasm modules. It does not
translate x86 code. Improvements to v86's CPU translator therefore do not apply.

Release decision: retain the accepted Firefox binary. The PBL candidate really
entered its portable interpreter and passed the five checksum workloads, but
the uninstrumented candidate was slower in four of five matched cases. It was
not promoted. The Aurora readiness helper is also unpromoted because its guest
deadline/handshake tests were not completed. Host presentation changes have
separate passing evidence; native guest JIT/GPU/hardware decoding are not added.

## Presentation implementation

`web/linux/dist/framebuffer.js` keeps the existing visible/input canvas and the
guest framebuffer ABI. `framebuffer-presenter.js` supplies private WebGPU and
WebGL surfaces. Their shaders convert guest B,G,R,X bytes to opaque RGB; the
visible Canvas2D context composites that surface with `drawImage`. Existing mouse,
touch, keyboard, focus, pan, and element references do not change. Binding a new
context type to a canvas already using Canvas2D is not supported by browsers;
the private surfaces allow safe fallback without replacing the input element.
WebGPU explicitly transfers the submitted offscreen frame to an ImageBitmap
before drawing, then closes that bitmap. Directly drawing the unpresented WebGPU
canvas returned transparent pixels on the tested Chromium; the transfer path
passed actual color readback.

Options accept `backend: "canvas2d" | "auto" | "webgpu" | "webgl"`.
The default remains Canvas2D. Auto/WebGPU try WebGPU, then WebGL, then Canvas2D.
WebGL starts at WebGL. Initialization failure, device/context loss, and draw
failure fall through to a working backend. Loss repaints the last retained
snapshot. Closing cancels paints, invalidates pending asynchronous initialization,
and destroys GPU resources. A changed backing-store size is restored to the
guest's fixed mode on the next paint; changing guest mode uses a new host.

Each accepted present snapshots shared guest bytes into a reusable ordinary
ArrayBuffer before returning. It strips row padding (including odd/unaligned
strides) and does not require padding after the final visible row. Subsequent
guest writes cannot mutate queued upload data. This is not an atomic transaction
across concurrent guest writes: guest drawing synchronization remains its own
responsibility. Multiple presents coalesce to one paint per animation frame.
No damage scanning was added: the earlier full-frame regression is avoided.

`host.ready` settles after initial backend selection. `host.diagnostics` returns
backend/requested policy, frame/present/coalesced counts, fallback reason and
WebGPU fallback-adapter status when exposed. The canvas also has
`data-framebuffer-backend` and emits `framebuffer-backend` with a diagnostic
snapshot when selection changes. A selected WebGL/WebGPU API does not establish
physical hardware acceleration.

## Verification and measurements

Run `node --test web/linux/framebuffer.test.mjs` and open
`http://127.0.0.1:4180/linux/tests/framebuffer.html` on the existing isolated
development server. The latter exposes `window.framebufferResults`; `done` marks
completion and `errors` must be empty. Tests compare actual rendered pixels,
including RGB channel order, top/bottom orientation, forced opaque alpha, odd
stride, shared-memory snapshot, resize, coalescing and unchanged input target.
The browser harness also exercises context loss and fallback repaint.

The first normal Chromium 150 run passed four Node tests and ten browser checks
(before adding the additional full-host loss-repaint check). Its WebGL renderer
was ANGLE Vulkan SwiftShader, a software backend; WebGPU returned no adapter and
fell back to WebGL. Measured median synchronous snapshot/render/readback cost:

| Frame size | Canvas2D | WebGL on SwiftShader |
|---|---:|---:|
| 1024 × 768 | 2.70 ms | 11.61 ms |
| 1280 × 720 | 3.07 ms | 12.65 ms |
| 430 × 932 | 1.22 ms | 6.16 ms |

Each case discards ten warmups and samples thirty frames. The harness invokes
the normal queued paint callback without a vsync wait and includes a visible
canvas readback to avoid timing only asynchronous GPU command submission.
Readback adds synchronization and does not represent ordinary desktop frame
timing; these are comparative adapter costs, not guest Firefox benchmarks.
430 × 932 is a frame geometry test, not physical mobile GPU/keyboard validation.
The software-backend result justifies retaining the existing default, and says
nothing about relative performance on a physical GPU. Test-only browser flags
may enable a software WebGPU adapter for functional WGSL verification; they must
not be presented as physical GPU evidence or required production settings.

A subsequent Chromium run with test-only `--enable-unsafe-webgpu
--use-angle=swiftshader --enable-features=Vulkan` selected actual WebGPU and passed
all **eleven** browser checks, including full-host loss fallback/repaint, with no
exceptions. The adapter identified itself as Google SwiftShader and
`isFallbackAdapter=true`. At 1280 × 720, medians were 3.115 ms Canvas2D,
13.425 ms WebGL and 28.26 ms WebGPU. The explicit ImageBitmap transfer fixed the
initial WebGPU pixel failure. Reports are retained in
`docs/evidence/runtime-graphics-20260926/host-software-initial.json` and
`host-software-webgpu.json`. No physical-GPU performance claim is supported.

## Guest graphics and hardware video boundary

This change presents an already-rendered framebuffer. It does not add a guest
OpenGL/Vulkan driver, WebGPU implementation, or hardware video decoder. TinyX and
Firefox still render using their existing software stack. The current guest
imports include syscall/thread/signal and PCM-audio services, but no GPU-command
or compressed-video host bridge (`dist/wasm.js` import allowlist and `worker.js`).
The established media path decodes FFVPX in the guest; only PCM audio crosses to
Web Audio. See `web/linux/firefox-shims/static-media.md`.

`web/linux/tests/guest-graphics.html` must be opened **inside guest Firefox** at
`http://192.0.2.1:4180/linux/tests/guest-graphics.html`. The existing guest gateway
maps this to the development host. It reports the actual guest user agent,
secure-context status, WebGL context and red-pixel readback, renderer identity,
WebGPU adapter/device attempts, and real VP8/Opus sample playback counters.
An absent API on this HTTP page can reflect secure-context restrictions; it is
not proof of a missing GPU by itself. Successful playback or `powerEfficient`
also does not identify the decoder implementation. Check guest decoder logs and
driver identities before any hardware claim. To test a guest native GL X11 app,
first establish the presence of an actual guest GL library/driver and app; no
such application is supplied or fabricated by this presentation change.

The baseline fixture was subsequently run inside guest Firefox. WebGL context
creation returned false. `navigator.gpu` and `VideoDecoder` were absent, but the
page was insecure HTTP, so those absences alone do not establish the secure-
context capabilities. The VP8/Opus sample ended at 3.01 seconds with 30 total
frames and zero drops; replay ended with 60 cumulative frames and zero drops.
No hardware decoder identity was established. JSON evidence is retained as
`guest-graphics-baseline-first-play.json` and `guest-graphics-baseline-replay.json`
in the evidence directory. The compatibility user agent says Linux x86_64;
the inspected executable/runtime architecture remains native wasm32.

Real guest acceleration needs a separate driver/protocol implementation:

- Guest graphics API/driver → bounded command/resource transport → host
  WebGL/WebGPU renderer, including shader translation, format/capability limits,
  synchronization, mapping/readback, resource lifetime, and device loss.
- Guest decoder API → compressed packets + timestamps → host WebCodecs → frame
  transport/presentation and audio/video synchronization. WebCodecs hardware
  preference is a hint, not a guarantee or proof.

Mesa [VirGL](https://docs.mesa3d.org/drivers/virgl.html) describes the guest
kernel/Mesa and host-renderer layers. [Venus](https://docs.mesa3d.org/drivers/venus.html)
requires Vulkan and external-memory/virtio-gpu facilities not directly exposed
by browser WebGPU. Neither can be activated by a Firefox preference here.
[WebCodecs](https://www.w3.org/TR/webcodecs/#hardware-acceleration) explicitly
allows browsers to ignore hardware preferences.

## Firefox JIT and portable baseline: source evidence

Inspected archived Firefox **128.14.0** source under
`/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/var/nix/builds/nix-1-800818036/firefox-128.14.0`:

- `.mozconfig:21` contains `--disable-jit`; object `config.status` defines
  `JS_CODEGEN_NONE=1` and does not enable portable baseline.
- `js/moz.configure:210` exposes `--enable-portable-baseline-interp`, default
  false. Enabling portable baseline makes native JIT default false.
- `js/src/vm/PortableBaselineInterpret.h:11` explains the portable interpreter
  executes CacheIR inline caches without runtime native code generation, with
  wasm32-wasi explicitly motivating that design.
- `js/src/moz.build:461` conditionally compiles
  `vm/PortableBaselineInterpret.cpp` with that flag.
- `js/src/jit/wasm32/Trampoline-wasm32.cpp:15` implements `generateEnterJIT` as
  `MOZ_CRASH()`. The wasm32 CodeGenerator/MacroAssembler contain analogous
  stubs. Presence of a `JS_CODEGEN_WASM32` name does not mean a usable JIT exists.
- PBL changes conditional fields and frame layouts in `JSContext.h`,
  `Runtime.h`, `Stack.h`, `BaselineFrame.h`, and `BaselineIC.h`. Replacing only
  one object in the working binary would mix incompatible configurations.

Mozilla's [SpiderMonkey architecture](https://firefox-source-docs.mozilla.org/js/)
describes native machine-code JIT tiers. Its current
[configuration source](https://raw.githubusercontent.com/mozilla/gecko-dev/master/js/moz.configure)
also distinguishes PBL from native JIT. Runtime preference changes cannot add a
compiled-out backend. A real native-Wasm JIT would need Wasm module generation,
host compile/instantiate integration, function-table and call ABI management,
GC/deoptimization/exception integration and code lifetime handling. Writing code
bytes into guest linear memory cannot create callable Wasm functions.

## Bounded PBL compatibility gate and build path

The read-only-source gate compiles the actual PBL translation unit with the
archived compiler/include recipe, adding its build define, into a fresh output
directory. It caps compilation at 300 seconds and saves command, log and JSON:

```sh
python3 probes/firefox-portable-baseline-gate.py \
  --objects /mnt/p6/project/linux/.cache/firefox-fresh-obj-20260924-071600 \
  --libcxx-include /mnt/p6/project/linux/.cache/libcxx-wasm-abi-20260925/include/c++/v1 \
  --output /mnt/p6/project/linux/.cache/runtime-graphics-20260926/pbl-gate \
  --timeout 300
```

The gate passed on this host and produced a 9,353,775-byte object. A pass is one translation-unit compatibility result, not a runnable engine,
speedup, or browser build. A failure may be old generated configuration/header
state, not incompatibility of PBL with wasm32; inspect the saved error before
classifying it. Keep `JS_CODEGEN_NONE` for PBL; do not substitute the crashing
wasm32 native-codegen stubs.

The coherent candidate builder is `tools/build-firefox-portable-baseline.py`.
It makes an isolated object mirror and a copied generated JS configuration,
rebuilds every linked SpiderMonkey object plus PBL, and audits all PBL-conditional
headers against the complete archived dependency records. It refuses outside
consumers or missing engine dependency records. The initial inspection found
82 engine objects and 79 affected consumers, all inside the engine.
The source itself is read-only. This is a controlled object-overlay rebuild,
not a fresh configured Mozilla build directory.

The candidate sets the equivalents of `--disable-jit
--enable-portable-baseline-interp --enable-portable-baseline-interp-force`.
The FORCE option matters: the archived `JitOptions.cpp` otherwise defaults
`portableBaselineInterpreter` to false even when the code is compiled.
It reconstructs the engine archive and substitutes only that archive into the
exact accepted `firefox-mmap-aligned` link recipe; the baseline module must match
SHA-256 `68b86f1dea7312483c62284fce906287afcb7f8f11b1b07697c73e6dbd49ceae`.
The accepted picker/XPT/media/mmap replacement inputs remain in the link.

```sh
python3 tools/build-firefox-portable-baseline.py \
  --objects /mnt/p6/project/linux/.cache/firefox-fresh-obj-20260924-071600 \
  --link-build /mnt/p6/project/linux/.cache/reliability-performance-20260926/firefox-mmap-aligned \
  --libcxx-include /mnt/p6/project/linux/.cache/libcxx-wasm-abi-20260925/include/c++/v1 \
  --output /mnt/p6/project/linux/.cache/runtime-graphics-20260926/pbl-candidate \
  --jobs 4 --timeout 1800
# Review plan.json; re-run the same command with --execute to build a candidate.
```

The revised plan gate passed in 18.63 seconds: 2,712 dependency records,
82 engine objects, 79 affected consumers, and complete compile recipe mapping.
It includes `.cc` sources in unified regexp units and checks canonical aliases.
The first execution stopped after 68 completed units, before linking: a compile
database entry had a trailing per-file flag, which the initial recipe adapter
mistook for its source argument. The adapter now replaces the canonical source
token and preflights exactly one translation input for every unit. The fresh v3
rebuild then passed all 83 objects, archive/link/fpcast and WABT validation in
343.07 seconds. Its 157,905,187-byte module has SHA-256
`319c01c2836aea58a8e63bbf00e5475bcbf33e271fd8c73804651ccabe80f197`.
Actual tier entry and bounded guest correctness were then verified, as recorded
below; comparative timing rejected this candidate for promotion.
The script requires 4 GiB free space, caps preflight at 120 seconds and total
execution at thirty minutes with four
compiler jobs and individual compilation at five minutes, stops on failure,
and saves exact commands/logs and final report. It does not package or deploy.
The original engine objects occupy about 390 MiB and archive about 463 MiB.
Successful link/fpcast/WABT validation alone is not functional acceptance.
The existing `build-static-media.py` intentionally relinks a handful of objects
and is insufficient as a PBL engine rebuild. Start with a matching JS shell
correctness/IC/GC test and measure interpreter vs PBL on the same browser host,
then rebuild and verify Firefox UI, navigation, media and transfer regression.
Do not promote until these pass. The v3 wall time is measured; peak resource use
has not been measured. Configured limits bound attempts, not promise completion.

After a coherent candidate passes, `tools/build-firefox-pbl-diagnostic.py` can
build a separate diagnostic from its exact engine objects/configuration. It
copies the PBL source, adds a one-time atomic stderr marker at actual
`PortableBaselineTrampoline` entry, and repeats archive/link/fpcast/validation.
The marker is `[WASM_PBL] PortableBaselineTrampoline entered`. Observing it in
the guest proves this tier ran; build defines and faster benchmark timing alone
do not. Keep the uninstrumented binary for final timing and deployment. This
diagnostic does not modify the coherent candidate or original source.

### Isolated guest acceptance

`tools/guest-rootfs/package-pbl-candidate.py` checks the current accepted archive
against its manifest and the candidate against its successful build report.
It changes only `opt/firefox/firefox`, preserving all other newc headers, bodies,
names, padding and trailer, then independently inventories both archives. It
requires the current persistent-home init to remain byte-identical. Outputs go
under `web/linux/tests/runtime-candidates/`, outside the deployment allowlist.

```sh
python3 tools/guest-rootfs/package-pbl-candidate.py \
  --source web/linux/initramfs-firefox.cpio.gz \
  --source-manifest web/linux/boot-manifest.json \
  --candidate-report /mnt/p6/project/linux/.cache/runtime-graphics-20260926/pbl-candidate-v3/report.json \
  --output web/linux/tests/runtime-candidates/pbl-v3
```

In a fresh task-owned browser profile, open
`http://127.0.0.1:4180/linux/tests/runtime-candidates/pbl-v3/launch.html` and
choose **Boot this test archive**. It selects the test manifest only in that
profile's localStorage; the accepted manifest and archive are unchanged.
Repeat with the separate diagnostic build/report to prove trampoline entry.
Never use diagnostic timings as the final performance result.

Inside guest Firefox, open the gateway URL
`http://192.0.2.1:4180/linux/tests/guest-js-benchmark.html?label=baseline`
(or `label=pbl-v3`). Run the five checksum-checked workloads, then choose
**Download results JSON**. Read the saved result from persistent Downloads.
Both this page and `guest-graphics.html?label=baseline` export a schema, label,
run ID, timestamps and actual guest user agent; the benchmark adds warmup/sample
counts, checksums and timings. The graphics report includes actual WebGL pixel
readback and video state/frame counters. Wait for probes to finish and video to
end before exporting the graphics/video result.

Acceptance requires a normal Firefox window and navigation, actual PBL-entry
marker on the diagnostic binary, all benchmark checksums, comparable baseline
and uninstrumented candidate timings, profile/file retention across restart,
media playback/replay, and picker/download byte verification without traps.
Build validation alone does not satisfy these gates.

### Guest result and rejected promotion

Both isolated package audits passed: 11,469 records, with only
`opt/firefox/firefox` changed and the persistent-home init byte-identical.
The diagnostic binary rendered Firefox, mounted persistent home and emitted
`[WASM_PBL] PortableBaselineTrampoline entered` exactly once. Its captured serial
log contained no `RuntimeError`; all five checksums and the JSON download passed.
The sanitized `pbl-runtime-entry-proof.json` retains the log hash and counts,
module hash and checksums without copying browsing/profile data. Diagnostic
timings are excluded from the release comparison.

The uninstrumented comparison used the same 4 GiB guest memory, two CPUs,
1280 × 720 mode and Canvas2D presentation. Early single-call timings were
quantized to 0–1 ms and were discarded. The final protocol is
`fixed-batch-100-v1`: twelve warmups, five measured samples of exactly 100 calls,
checking every return. Every measured batch exceeded the ten-millisecond gate.
The table reports median milliseconds per call, not whole-batch duration.

| Workload | Accepted baseline | Uninstrumented PBL |
|---|---:|---:|
| Integer loop | 0.21 | 0.25 |
| Object properties | 0.69 | 0.79 |
| Array callbacks | 1.15 | 1.03 |
| JSON and strings | 0.37 | 0.46 |
| Exceptions and recursion | 0.19 | 0.30 |

All checksums passed. Four cases regressed; only array callbacks improved.
These bounded microbenchmarks do not establish a general browser speedup.
Promotion was rejected and the accepted baseline executable remains selected.
The candidate URL's label was truncated by guest UI input, but its active
`test-pbl-6febc628d9f6f796` manifest and candidate SHA were independently verified.
Evidence: `pbl-v3-comparison.json`, `guest-js-baseline-batched.json` and
`guest-js-pbl-v3-batched.json` under `docs/evidence/runtime-graphics-20260926/`.
Full candidate media/picker/profile acceptance was not completed after this
performance rejection and is not implied by the bounded correctness result.

## Capability status and remaining implementation

| Capability | Current evidence/status | Required next step |
|---|---|---|
| Host Canvas2D presentation | Verified pixels, input identity, coalescing, resize; fastest tested software path | Physical desktop/mobile timing before changing default |
| Host WebGL/WebGPU presentation | Both verified through actual software GPU pixel readback; no physical GPU proof | Physical adapter testing and sustained frame/device-loss measurements |
| Guest native JIT | Unsupported: compiled out; wasm32 native-codegen entry stubs crash | Wasm-generating compiler plus host module/table ABI, GC, exceptions and deoptimization integration |
| Guest portable baseline interpreter | Build, real tier entry, five checksum workloads and downloads passed; slower in four of five cases; not promoted | Profile the regressions before considering another candidate; full acceptance still required |
| Guest WebGL/WebGPU | WebGL context false; WebGPU API absent on insecure HTTP; GPU-command bridge absent | Secure-context retest for API availability, then guest graphics driver and bounded host command/resource bridge |
| Guest Vulkan and OpenGL through Vulkan | Not implemented by the presentation adapter; no supported guest driver path established | Guest API/driver, shader translation, synchronization/resource/memory transport and compatible host renderer |
| Guest hardware video decoder | No compressed-video bridge; existing FFVPX decode runs in guest software | Decoder integration with WebCodecs, timestamps/frame transport, AV synchronization and observed decoder identity |
| Native GL X11 applications | No actual GL application/driver test established | Supply a compatible guest library/driver and test application after the driver path exists |

Untested rows are not tested negatives. Host API success does not establish guest
API support, and guest playback success does not establish hardware decoding.
The full requested native JIT/GPU capability remains a separate porting effort;
this work should not be scored as completing those absent capabilities.

## Next startup investigation: compiled module reuse

Every new guest exec reaches `dist/worker.js`'s `compile_begin`/`compile_write`
byte copy and synchronous `compile_end`, which calls
`new WebAssembly.Module(bytes)` at line 532. There is no application module
cache. Thread/fork creation reuses `context.module`; it does not explicitly
compile Firefox again per thread. Browser internal reuse may reduce repeated
compilation, so complete recompilation cost on every boot is not established.
Page reload during restart discards a page-local module registry.

Do not implement the old IndexedDB compiled-module caching recipe:
the [WebAssembly serialization specification](https://webassembly.github.io/spec/web-api/#serialization)
rejects module serialization for storage with `DataCloneError`.
[V8's compilation documentation](https://v8.dev/docs/wasm-compilation-pipeline)
describes browser-managed code caching for streaming compilation. The kernel
uses `compileStreaming`, but its current asset loader reconstructs synthetic
Responses, so native disk-cache hits are not established there either.
`compile_end` is a synchronous kernel import; async compilation cannot be
substituted without a validated preload/worker handshake and exact-byte identity
check. First measure byte copying, decompression, compile and instantiate times
and actual engine cache traces across cold/warm/reload/browser-restart runs.
No compilation-cache change was implemented for this release.

## WM readiness candidate

`tools/guest-rootfs/wait-for-aurora.c` can replace the unconditional ten-second
Firefox startup sleep after runtime acceptance. It polls a real X11 handshake:
root `_NET_SUPPORTING_WM_CHECK` points at a window whose own property points to
itself, and that window's UTF8 `_NET_WM_NAME` is exactly `Aurora`. A process-local
SIGALRM timer bounds even blocking Xlib operations. Timer setup failure returns
2 so the caller keeps the original delay. Readiness or an elapsed ten-second
deadline returns 0; a timeout must not add a second ten-second delay.

```sh
python3 tools/build-wait-for-aurora.py \
  --output /mnt/p6/project/linux/.cache/runtime-graphics-20260926/wm-ready
```

This compiles against the archived wasm32-musl X11/xcb/Xau libraries, validates
the module, and saves ABI/command/log/hash evidence. It does not package it.
The first build and WABT validation passed: 823,503 bytes, SHA-256
`2c54b0b87a88366086672b3e199f886863082951a54c34ef01c2dcc6a015a2c3`.
The module imports shared `env.memory` and the three established
`linux.syscall/get_thread_area/copy_siginfo` functions, and exports `_start` and
the function table. This proves loader-shape compatibility, not guest execution.
Required guest acceptance before the init overlay is authorized for promotion:
`--self-test-timeout` actually exits after roughly one second; an absent display
waits roughly ten seconds; the current Aurora desktop returns readiness quickly.
The signal self-test must have an external test timeout so a broken guest signal
implementation cannot stall validation. Then compare actual Firefox launch times
across cold boots and preserve the existing delay when the helper is missing or
fails before arming its timer. No startup speedup has yet been measured.
