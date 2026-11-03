# Linux/Wasm graphics measurements — GPT-6 Astra Pro / builtin agents / rubywebterm

This harness runs actual WebGL2 and a separately compiled GLES application in
real wasm32 Linux. It uses owned Chromium profiles and finite deadlines, verifies
rendered pixels, records input/runtime hashes, pins browser and guest to three
CPUs, samples owned CPU/RAM and live cgroup quotas every second, and reaps only
its own processes. Sum RSS can count shared pages more than once; it is not PSS.

## Accepted dispatch change, 2026-11-03

The host scalar-uniform path no longer allocates an array/callback on every
update. Five draw handlers avoid allocating a closure when no texture swizzle,
shadow texture or text diagnostic state requires the full restoration path.
The existing slow paths and native guest protocol are unchanged. Current
Firefox can consume this host change without relinking its static driver.

Independent source review passed. The candidate passed82 real-GPU scalar/draw
checks, the existing24 swizzle checks, and all four native correctness/performance
runs. A/B/B/A order used the same native Wasm and archive; the HTTP snapshot
receipt proves which host-module SHA was actually requested on every run.

| Workload | Baseline guest median (range), ms | Candidate guest median (range), ms | Candidate throughput / baseline | Pooled direct-host median, ms | Candidate / host throughput |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 draws,64×64,1-pixel readback |0.965 (0.919–1.129)|0.768 (0.598–1.079)|1.255|0.332|0.432|
|320×240 surface allocation,clear,full readback|2.444 (2.312–2.628)|2.336 (1.967–2.661)|1.046|1.686|0.722|

Each native arm has three1-second samples after0.5-second warmup. The direct
host uses the same shader, UBO, pixels, operations and sample durations. Both
host and guest report NVIDIA GeForce MX110 through ANGLE/OpenGL. Live cgroup
ancestry confirms a three-CPU quota; the browser and guest each use three CPUs.

The draw result supports about20% lower median frame time /25.5% higher
throughput in this sample. The small surface difference is noisy. The direct
surface comparator reuses two textures because the guest already pools texture
allocations; an earlier naive host allocation comparison was unfair for a
claim about transport efficiency and is not used above. These are throughput
microbenchmarks including readback, not display FPS, isolated GPU timestamps,
Firefox responsiveness, full API conformance or a general50% host-performance
result. The draw workload remains below that target.

Evidence: `evidence/gpt6-astra-dispatch-20261103.json`. Raw receipts, screenshots
and one-second resource samples are under `/mnt/p3/codex-build/g3g/dispatch-*`
and `perfhost-pooled1`. The current preview serves the reviewed module; existing
running guest workers load the new code on their next restart.

## Reproduce

Use a fresh disk-backed output directory with at least20GiB free. The build
recipe accepts a reviewed guest `glremote.o` and portable EGL/GLES headers.
The specific compiler/object/archive hashes are recorded in build and run
receipts. Do not silently substitute a native x86 driver or unrelated rootfs.

1. Build the guest driver with `web/linux/tests/guest-glremote/build.sh`, setting
   `MESA_INCLUDE` to accessible EGL/GLES/KHR headers. Its historical p6 default
   is currently inaccessible; do not bypass permissions.
2. Run `build-perf.py --driver-object OBJ --headers HEADERS --output NEW_DIR`.
3. Run `package-guest.py --binary NEW_DIR/gl-perf.wasm --output NEW_PACKAGE`.
   It verifies the plain rootfs and copies only its existing Wasm BusyBox into
   a new minimal test initramfs, with no persistent home or Firefox profile.
4. Point the ignored `web/linux/tests/guest-glremote/current-perf-candidate`
   symlink at that new package directory.
5. Run `browser-check.mjs SHORT_DISK_SCRATCH URL` through `monitor-run.py`.
   Use `GRAPHICS_ISOLATED=1 GRAPHICS_CPUS=3 GRAPHICS_ANGLE=gl`; the snapshot
   server records served hashes. `GRAPHICS_GL_OVERRIDE=FILE` selects an isolated
   candidate host module. The native page is `perf-guest.html`, direct host is
   `perf-host.html?pooled=1`, and scalar correctness is `scalar-check.html`.

The same-context fence experiment in `candidates/` was rejected after a real
native regression. It is not loaded by production and does not establish sync
correctness. Full desktop OpenGL/GLX, complete Vulkan/WSI, Firefox native JIT
GC/guard acceptance, hardware video and the overall host-performance target
remain separate outstanding work.

## Current native Vulkan presentation

`docs/gpt6-astra-rubywebterm-vulkan-wsi-20261103.md` describes the accepted bounded
WebGL2 WSI path and its failures/limits. `fetch-vulkan-sdk.py` verifies pinned
upstream inputs; `build-vulkan-wsi.py` produces a fresh native public-Vulkan
sample; `package-vulkan-wsi.py` appends it to a verified plain-rootfs fixture.
Use `vulkan-wsi.html` as the isolated page override and `vulkan-wsi-hook.mjs` to
capture a real frame before teardown. The acceptance gate requires successful
acquire/render/present, native CLOSE=0, and no guest resources left alive.
`presentation.html` separately tests asymmetric pixels, GPU-only copying,
resize, state preservation, and lifecycle/device-loss behavior.

`GRAPHICS_WEBGPU_DIAGNOSTIC=1` is allowed only with the isolated test server and
`GRAPHICS_ANGLE=vulkan`. It adds Chrome's experimental Linux WebGPU flag to that
fresh developer browser only. It does not alter product settings or switch
backends; the retained NVIDIA device-allocation failure is not a passed gate.

## Independent real-browser archive gate

`archive-browser-validation.html` validates the exact repaired system image in
Chromium, including its decoded byte count/hash, unchanged original init and
Firefox, and production extras/init-wrapper composition. It retains both a
tiny concatenated-gzip control and the original failed package image. Node
DecompressionStream acceptance is not substituted for browser acceptance.

Use the isolated browser harness with the page override, `archive-browser-hook.mjs`,
and `GRAPHICS_ARCHIVE_OVERRIDE`, `GRAPHICS_ARCHIVE_CONTROL`, and
`GRAPHICS_ARCHIVE_MANIFEST` pointing to pinned local test inputs. The independent
20-check report is `evidence/gpt6-astra-chromium-archive-20261103.json`.
The full production main/guest boot remains a separate startup owner gate.

Minimal WebGPU driver reproducers are in `diagnostics/`. Use them as isolated
page overrides at `/linux/tests/guest-glremote/` with explicit Vulkan ANGLE and
`GRAPHICS_WEBGPU_DIAGNOSTIC=1`. Their retained failures distinguish successful
offscreen rendering from device loss at canvas export; they are not accepted
WebGPU presentation tests.
