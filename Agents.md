# Agent status

## wasm_kernel_research (2026-09-19)

- Repository was empty when inspected (no commits or source files).
- Arch Linux toolchain is present: Clang 22, `wasm-ld`, Zig 0.16, and Emscripten 6.0.6. A no-libc smoke test with `clang --target=wasm32-unknown-wasi -nostdlib` successfully produced a WebAssembly module.
- The installed Emscripten wrapper is not usable in this host image: its bundled Clang requires `GLIBC_2.44`, while the host `libm.so.6` does not provide that version. Do not make Emscripten a prerequisite until the toolchain is repaired or replaced.
- Upstream remotes are reachable and snapshots are kept under `sources/`:
  Linux is pinned to `40288c920` and X server to `306071c0b` with materialized
  shallow trees; Firefox is pinned to `b16f852ba` in a partial clone whose
  large working tree did not finish materializing before the network fetch
  stalled. See `sources/README.md`; avoid patching upstream files.
- Main feasibility finding: upstream Linux has no WebAssembly architecture port. Compiling an x86_64 kernel object set to `wasm32` cannot work because the kernel requires architecture-specific boot, MMU, interrupt, atomic, and device code. A real kernel implementation would require a new `arch/wasm` port plus a browser host ABI for timers, memory, input, display, and networking.
- Xorg and Firefox depend on POSIX processes, shared memory, sockets, filesystem, graphics, and (Firefox) a JIT/runtime that are absent from browser WASI. They cannot be made runnable by compiler flags alone. Keep upstream sources unchanged and put browser-specific behavior behind a small host adapter (WASI imports or JavaScript glue).
- Suggested staged acceptance: (1) compile and run a tiny `arch/wasm` kernel/host ABI proof of life; (2) run a small WASI libc/userspace test with framebuffer/input/network adapters; (3) port an X server backend to the same framebuffer; (4) evaluate a browser engine separately. A browser tab cannot safely host an unmodified Firefox engine, so “Firefox opens bing.com” should be treated as a separate feasibility gate, not assumed after kernel boot.
- Source checkout status: `sources/linux` is present at commit `40288c9206c17eb66a603262e06a58d300d0f279` (torvalds/linux `master`), and `sources/xserver` is present at `306071c0b9683ef0dfadcfc2dbb78d369680542b` (xorg/xserver `master`). `sources/firefox` resolves to `b16f852ba66d190cacd42d0d43ac4d38bd07c4bd` (mozilla-firefox/firefox `main`), but its large working tree did not finish materializing in this environment. Record exact commits and complete that checkout before building Firefox.
- Added `docs/architecture.md`, which defines a small `linux_host` import ABI (clock, sleep, events, framebuffer, files, network, logging), a bounded browser event loop, and separate X/Firefox gates. Added `probes/wasm32-kernel-smoke.c` and `probes/Makefile`; `make -C probes` succeeds and `wasm-objdump -x` confirms the `linux_host.log` import plus exported `kernel_entry` and memory.
- Existing `web/wasm_smoke/run_smoke.sh` also passes in headless Chromium: the 1,194-byte module instantiates through `instantiateStreaming`, renders a framebuffer pixel, copies a synthetic DOM key event, reports `data-result="pass"`, and writes its adapter message to the page.

## browser_stack_probe (2026-09-19)

- Added `web/wasm_smoke`, a standalone native wasm32 browser-boundary probe. It
  compiles freestanding C with Clang and `wasm-ld` (no Emscripten, emulator,
  or JavaScript CPU interpreter), serves the module with the correct MIME type,
  and loads it with `WebAssembly.instantiateStreaming`. Its C adapter imports
  `linux_host.log`, `linux_host.clock_monotonic_ns`, `linux_host.frame_present`,
  and `linux_host.poll_events`; the HTML page exposes terminal and framebuffer
  surfaces.
- Chromium 150 headless verification passed via
  `web/wasm_smoke/run_smoke.sh`; the page reported
  `PASS: native wasm32 module instantiated (ABI LWEB v1, framebuffer + events)`.
  The exported handshake returned `0x4c574542` (`LWEB`), and the test checked
  a rendered RGBA pixel plus a synthetic keyboard event copied into wasm memory.
- Host checks: `/usr/bin/clang` 22 and `wasm-ld` 22 work for freestanding
  wasm32; installed Emscripten remains unusable because its bundled compiler
  requires GLIBC 2.44, and the Firefox wrapper is broken because
  `/usr/lib/firefox/firefox` is absent.

## api_test (2026-09-19)

- Added `web/api_test`, a localhost/HTTPS HTML5 capability test bench.
- It has user-triggered checks for camera, microphone, `MediaRecorder`, screen
  capture, clipboard, file picker, geolocation, notifications, vibration, Web
  Share, Canvas/WebGL/WebGPU, Web Audio, localStorage/IndexedDB, workers,
  WebSocket, timers, and WebAssembly.
- Permission-bearing APIs are never invoked during page load. The page reports
  unsupported APIs and denied permissions as explicit failures, and presents
  stream/recording output for inspection.

## Additional source check (wasm_kernel_research, 2026-09-19)

- Firefox `build/moz.configure/init.configure` gates its WASI/wasm32 triplet parsing behind `project == "js"`; this supports the SpiderMonkey/JS shell tooling path, not a full desktop Firefox target. The browser engine therefore still needs a substantial target port beyond the adapter smoke test.

## Native port gate runner (2026-09-19)

- Added `tools/check-port-gates.sh` and `docs/firefox-wasm-port.md`.
- The reproducible report currently records three real blockers: upstream
  Linux has no `arch/wasm`, X server has no wasm display/input backend, and
  Firefox exposes WASI target parsing only for `project=js`. The freestanding
  wasm32 adapter still passes its Chromium smoke test.
- The gate exits nonzero until those source-level requirements are implemented;
  this prevents the adapter smoke test from being mistaken for a full Firefox
  port.

## Host display/input adapter (2026-09-19)

- Extended `web/wasm_smoke` to call the documented `linux_host` clock, event,
  and framebuffer imports. The JS host queues DOM keyboard/pointer events and
  draws the wasm RGBA buffer to a canvas.
- Chromium verification passes with a 1,194-byte freestanding wasm32 module:
  `PASS: native wasm32 module instantiated (ABI LWEB v1, framebuffer + events)`.

## Desktop Firefox/X source gate (2026-09-19)

- Read-only inspection of pinned Firefox `b16f852ba66d190cacd42d0d43ac4d38bd07c4bd`
  confirms that `js/src/shell/moz.build` only adds a 1 MiB WASI stack, the
  `--stack-first` linker flag, and `wasi-emulated-process-clocks` /
  `wasi-emulated-getpid` libraries. This is a SpiderMonkey JS-shell path, not
  a desktop Firefox target or browser host port.
- Reproducible source gate:
  `test -f sources/firefox/mach` -> `no`,
  `test -f sources/firefox/browser/moz.build` -> `no`, while
  `git -C sources/firefox cat-file -e HEAD:browser/moz.build` -> `yes`.
  The pinned Firefox Git objects contain the browser sources, but the working
  tree is sparse and cannot run `mach configure` or a desktop build here.
- Read-only inspection of pinned X server
  `306071c0b9683ef0dfadcfc2dbb78d369680542b` finds zero paths matching
  `wasm|webgpu|webgl`; its available display backends remain native X11,
  Xwayland, Xnest, VFB, and kdrive. There is no out-of-tree desktop Firefox
  artifact to execute in Chromium. Remaining blockers are materializing the
  Firefox checkout, porting Gecko process/filesystem/network/JIT services, and
  implementing an X display/input backend for the browser host.

## Out-of-tree Xserver browser boundary (2026-09-21)

- Added `ports/xserver-wasm/build-probe.sh`, which runs a real Meson cross
  configure against pinned Xserver `306071c0b9683ef0dfadcfc2dbb78d369680542b`
  in a temporary directory. It never edits `sources/xserver`; the expected
  result is the first missing host dependency/backend blocker because the
  upstream tree has no wasm display or OS target.
- Added `ports/xserver-wasm/x11_client.c`, a freestanding wasm32 client that
  emits genuine core X11 `CreateWindow`, `MapWindow`, `CreateGC`,
  `PolyFillRectangle`, and `ImageText8` requests through `x11_host.send`.
  This is a browser host adapter for a real X server, not an X protocol or
  CPU emulator.
- Added `web/x11_proxy/server.mjs` and `web/x11_proxy/x11-client.js`. The
  relay uses a fixed loopback X TCP destination, requires a 16+ character
  token, checks an exact Origin, and forwards only binary WebSocket frames.
  The page's `GetImage` response is drawn to the canvas and browser keys emit
  further X11 `ImageText8` requests. It is an explicit local test path; it
  does not claim Firefox/Linux integration.
- The same loopback relay exposes a separate POST `/fetch` development bridge
  for arbitrary absolute HTTP(S) URLs without embedded credentials. It keeps
  an optional bearer token, an 8-second timeout, manual redirect handling, and
  a 1 MiB response cap. It is deliberately loopback-only and must not be
  exposed as a public/open proxy; the page button accepts a URL for testing.

## Firefox source/build gate (wasm_kernel_research, 2026-09-19)

- Added `probes/firefox-wasi-helper-gate.sh`; it reads pinned files with
  `git show` into a temporary directory and leaves `sources/firefox` untouched.
- At Firefox revision `b16f852ba66d190cacd42d0d43ac4d38bd07c4bd`, the gate
  confirms `allow_wasi=(project == "js")` and `if build_project == "js"`, then
  successfully runs `cargo check --target wasm32-unknown-unknown` for the
  small `build/rust/wasi` helper crate. This does not build Firefox or its JS
  shell.
- The same gate with `FIREFOX_WASM_TARGET=wasm32-wasip1` exits 101 because this
  host lacks Rust's target stdlib: `error[E0463]: can't find crate for core`.
  Installing that target would only test the helper crate and would not remove
  the full desktop Firefox port blockers.

## Linux arch/wasm skeleton gate (wasm_kernel_research, 2026-09-19)

- Added `ports/linux-arch-wasm/linux-arch-wasm.patch`, an out-of-tree patch
  that adds minimal `arch/wasm` Kconfig, Makefiles, a `setup_arch` stub, and
  generic asm Kbuild entries. The tracked `sources/linux` checkout is never
  modified.
- Added `ports/linux-arch-wasm/build-probe.sh`; it creates a detached temporary
  worktree, applies the patch, and runs `make O=... ARCH=wasm olddefconfig`.
  Kconfig succeeds (only existing EROFS range warnings), proving kbuild
  recognizes `ARCH=wasm`.
- The compile phase intentionally stops at the next missing architecture
  contract. The overlay now adds
  `CLANG_TARGET_FLAGS_wasm := wasm32-unknown-unknown`; the compile reaches UAPI
  generation. The standalone freestanding compiler probe still emits a wasm
  MVP module. This is a port boundary probe, not a bootable Linux kernel.
- The probe now checks for `scripts/Kbuild.include` and
  `scripts/pahole-version.sh` in partial checkouts and materializes missing
  copies only inside the temporary worktree via `git show`; the pinned
  `sources/linux` tree remains untouched. The probe also syncs Kconfig with
  `LLVM=1` before compiling, avoiding false partial-config failures.
- Added only to the overlay: `arch/wasm/include/uapi/asm/byteorder.h`, mapping
  wasm32's little-endian ABI to Linux's `linux/byteorder/little_endian.h`.
  Re-running `ports/linux-arch-wasm/build-probe.sh` now generates the
  byteorder UAPI header and reaches the next missing mandatory header:
  `No rule to make target 'arch/wasm/include/generated/uapi/asm/ptrace.h'`.
  Kconfig still succeeds (with the existing EROFS range warnings), and the
  standalone wasm compiler probe emits a wasm MVP module. The tracked
  `sources/linux` checkout remains unchanged.
- Atomic64 gate: selected `GENERIC_ATOMIC64` and added an overlay
  `asm/atomic.h` wrapper for Linux's existing generic atomic/atomic64 ABI.
  This uses lock-based operations, not unvalidated compiler atomics. Corrected
  the Kconfig patch hunk length so all configuration lines are materialized.
  `ports/linux-arch-wasm/build-probe.sh` now generates `bounds.h`, then stops at
  `arch/wasm/kernel/asm-offsets.s: No such file or directory` while generating
  `include/generated/asm-offsets.h`. No atomic runtime correctness is claimed
  while the IRQ hooks are no-ops. Upstream source files remain untouched.
- Correction to the earlier ELF diagnosis: `mk_elfconfig` was already a native
  host program; its `Error: not ELF` rejected wasm `empty.o` input. Compiling
  that input for the host is only a diagnostic bypass yielding host-sized ELF
  metadata, not a valid wasm32 modpost implementation.
- Added an overlay-only minimal `arch/wasm/kernel/asm-offsets.c` emitter. The
  top-level bounds and asm-offsets headers now generate; the probe reaches
  scheduler offsets and stops at `fatal error: 'asm/thread_info.h' file not
  found` from `kernel/sched/rq-offsets.s`. This remains a compile-boundary
  probe: no thread ABI or boot path is defined, and upstream `sources/linux`
  remains untouched.
- Added an overlay-only minimal `asm/thread_info.h` layout plus a compile-only
  `current_thread_info()` placeholder. Top-level and scheduler offset setup
  now proceeds through `kernel/sched/rq-offsets.s`; the exact next blocker is
  `fatal error: 'asm/processor.h' file not found` from `include/linux/sched.h`.
  This remains a compile-boundary probe with no task/thread ABI or boot path.
- Added an overlay-only minimal `asm/processor.h` defining scheduler-visible
  `thread_struct`, stack bounds, and a no-op `cpu_relax()`. Scheduler offset
  compilation now proceeds to the next cache ABI boundary:
  `fatal error: 'asm/cache.h' file not found` from `include/vdso/cache.h`.
  No context-switch, cache, or boot/runtime support is implied.
- Added an overlay-only placeholder `arch/wasm/include/uapi/asm/ptrace.h` so
  kbuild can continue without inventing a register ABI. The next probe run
  generates ptrace-related UAPI headers and stops at
  `No rule to make target 'arch/wasm/include/generated/uapi/asm/sigcontext.h'`.
  Kconfig and the standalone wasm MVP compiler probe still pass; this remains
  a source-level port boundary check, not a bootable kernel.
- Added an overlay-only guarded placeholder
  `arch/wasm/include/uapi/asm/sigcontext.h`; no signal-frame ABI is claimed.
-  The next probe generates all mandatory UAPI wrappers, then reaches the
  host-tool boundary: `scripts/mod/mk_elfconfig` is executed and reports
  `Error: not ELF`. The wasm target flag therefore needed a host/native
  metadata split before any kernel object could compile.
- Added an overlay-only `scripts/mod/Makefile` rule that compiles the
  `empty.o` ELF metadata sample with `$(HOSTCC -dumpmachine)` when `LLVM=1`;
  host utilities remain native while normal kernel objects use wasm32. The
  probe now passes `mk_elfconfig` and stops while generating device-table
  offsets because the next required architecture header is missing:
  `fatal error: 'asm/string.h' file not found`. Kconfig and the standalone wasm
  MVP probe still pass, and `sources/linux` remains unchanged.
- Added an overlay-only `arch/wasm/include/asm/string.h` wrapper around
  `asm-generic/string.h`; also sourced `kernel/Kconfig.hz` so the compile gate
  does not loop in `timeconst.bc` with an unset HZ. The probe now generates
  device-table offsets and time constants, then reaches the next architecture
  primitive while compiling `kernel/bounds.s`:
  `fatal error: 'asm/irqflags.h' file not found`. Kconfig, native host tools,
  and the standalone wasm MVP probe pass; `sources/linux` is unchanged.
- Added an overlay-only `arch/wasm/include/asm/irqflags.h` with explicit
  no-op interrupt hooks (the browser interrupt ABI is not defined). Bounds
  compilation now enters generic atomics and stops on the next missing
  architecture contract: `error: unknown type name 'atomic64_t'`, followed by
  missing `arch_atomic64_*` operations in `atomic-arch-fallback.h`. Kconfig,
  native host tools, and the standalone wasm MVP probe still pass; the tracked
  `sources/linux` checkout remains unchanged.
- Added an overlay-only `asm/cache.h` wrapper around `asm-generic/cache.h`.
  The page wrapper now supplies compile-only `pgtable_t`, `pgprot_t`, and
  `pgd_t`; extable/uaccess wrappers supply stubs. The next exact errors are
  missing `user_mode`, `__pa`, and `__va` primitives, followed by
  `fatal error: 'asm/elf.h' file not found` from `include/linux/elf.h`.
  This remains nonbootable; the tracked `sources/linux` checkout is unchanged.

## Firefox configure overlay probe (2026-09-19)

- To avoid changing `sources/firefox`, a temporary overlay was assembled from
  pinned Git objects (`mach`, `configure`, `configure.py`, `moz.configure`,
  `build/`, `python/`, `testing/mozbase/mozfile`,
  `third_party/python/{packaging,filelock}`, and project `moz.configure`
  files). The reproducible command was:

  `probe=$(mktemp -d /tmp/firefox-wasm-configure.XXXXXX); git -C sources/firefox archive HEAD mach configure configure.py moz.configure build python testing/mozbase/mozfile third_party/python/packaging third_party/python/filelock toolkit/moz.configure browser/moz.configure js/moz.configure js/src/configure > "$probe/firefox.tar"; tar -xf "$probe/firefox.tar" -C "$probe"; (cd "$probe" && ./mach configure --target=wasm32-wasi --disable-compile-environment --disable-tests)`

- The command exits 1 before configure starts with
  `FileNotFoundError: .../third_party/python/requirements.txt`. This is a
  Mach bootstrap dependency, not evidence of a successful desktop target
  configure. No Firefox browser wasm artifact was produced. Completing the
  overlay would require more Firefox Python/vendor files, after which desktop
  process, graphics, networking, and X backend blockers still remain.
- Adding the exact `third_party/python/requirements.txt` and rerunning exposed
  the next missing `mozshellutil` package. Adding pinned
  `testing/mozbase/mozshellutil` advanced one step further, then stopped with
  `ModuleNotFoundError: No module named 'blessed'` from
  `python/mach/mach/logging.py`. The next overlay input is therefore pinned
  `third_party/python/blessed`; no configure result or desktop Firefox wasm
  artifact exists.
- Added pinned `third_party/python/wcwidth` to the temporary overlay and reran
  the same target. Mach completed its site setup, then stopped while loading
  build commands with `ModuleNotFoundError: No module named 'looseversion'`
  from `mozbuild/configure/util.py`. The next exact overlay input is pinned
  `third_party/python/looseversion`; no configure result or desktop Firefox
  WASM artifact exists, and `sources/firefox` remains untouched.
- Added pinned `third_party/python/looseversion` and reran the target. Mach
  completed both virtualenv setup steps, then failed in its Sentry startup hook
  with `ModuleNotFoundError: No module named 'sentry_sdk'`. The next exact
  overlay input is the pinned `third_party/python/sentry-sdk` package; no
  configure result or desktop Firefox WASM artifact exists.
- Including pinned `third_party/python/sentry_sdk` allowed the overlay to load
  Sentry. Running with `MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none
  MACH_NO_UV=1` (to keep the probe offline and avoid rebuilding a virtualenv)
  then stops at `ModuleNotFoundError: No module named 'urllib3'` from
  `sentry_sdk/transport.py`. The next exact dependency is pinned
  `third_party/python/urllib3`; no configure result or desktop Firefox WASM
  artifact exists, and `sources/firefox` remains untouched.
- Including pinned `third_party/python/urllib3` and rerunning the offline
  overlay advances Sentry import to its next dependency:
  `ModuleNotFoundError: No module named 'certifi'` from
  `sentry_sdk/transport.py`. The next exact dependency is pinned
  `third_party/python/certifi`; no configure result or desktop Firefox WASM
  artifact exists.
- Including pinned `third_party/python/certifi` and rerunning the offline
  overlay produced no traceback: Mach remains at `Creating the 'build' site`
  for more than 70 seconds without reaching configure, so the probe was
  terminated. This is the next concrete bootstrap blocker (site creation or
  dependency resolution); no configure result or browser WASM artifact exists.
- Diagnostic rerun with the same certifi-inclusive overlay under
  `timeout 20s env PYTHONPROFILEIMPORTTIME=1
  MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none MACH_NO_UV=1` exits 124. The
  only stdout remains `Creating the 'build' site ...`; import tracing shows
  Sentry, urllib3, certifi, and `mozbuild.base` load, with no traceback or
  configure output before timeout. `strace` is unavailable on this host, so
  the next blocker is build-site activation/dependency resolution rather than
  a wasm compiler result. No browser artifact was produced.
- Source inspection confirms `MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none` is
  the documented way to avoid the Mach virtualenv, but the build command site
  is still activated by `mach configure`. The smallest direct probe uses an
  object directory: `(cd obj && ../configure --target=wasm32-wasi
  --disable-compile-environment --disable-tests)`. In a pinned temporary
  overlay this bypasses the Mach hang and reaches configure, then fails at
  `FileNotFoundError: .../config/milestone.txt`; stdout confirms Python setup
  and `checking for vcs source checkout... no`. No compiler result or Firefox
  WASM artifact is produced.
- Adding pinned `config/milestone.txt` to the direct object-directory overlay
  lets configure proceed through Python setup and VCS detection, then fails at
  the next required source input: `FileNotFoundError:
  .../browser/config/version.txt`. This is the next bounded overlay input;
  no compiler or target result is reached and no Firefox browser WASM artifact
  exists.
- Including pinned `browser/config/version.txt` lets direct configure continue
  to the next version input, then fails with
  `FileNotFoundError: .../browser/config/version_display.txt`. No compiler or
  target result is reached and no Firefox browser WASM artifact exists.
- Added pinned `third_party/python/blessed` to the temporary overlay and reran
  the same configure command. Mach now imports blessed but stops at
  `ModuleNotFoundError: No module named 'wcwidth'` from `blessed/sequences.py`.
  The next exact overlay input is pinned `third_party/python/wcwidth`; no
  configure result or browser WASM artifact exists, and `sources/firefox`
  remains untouched.
- Added only to the overlay: a compile-only `user_mode(regs)` false macro in
  `asm/processor.h`, identity `__pa`/`__va` conversions in `asm/page.h`, and a
  guarded empty `asm/elf.h` documenting that no wasm ELF ABI is defined.
  `git -C sources/linux apply --check ports/linux-arch-wasm/linux-arch-wasm.patch`
  passes. `ports/linux-arch-wasm/build-probe.sh` exits 0 after its expected
  compile failure: Kconfig, native host metadata, and the standalone wasm MVP
  probe pass, then `kernel/sched/rq-offsets.s` stops at
  `fatal error: 'asm/pgtable.h' file not found`. Page-table/runtime semantics
  remain deliberately undefined; no kernel boot or emulator is claimed, and
  `sources/linux` is untouched.
- Added only to the overlay a minimal `asm/pgtable.h` for the MMU-less shape:
  opaque pte/pmd/pud/p4d entries, folded levels, and one-entry geometry. These
  definitions provide only generic compile-time contracts and no translation
  or mapping semantics. The patch passes `git -C sources/linux apply --check`.
  `ports/linux-arch-wasm/build-probe.sh` exits 0 after its expected compile
  failure; Kconfig, native host metadata, and the standalone wasm MVP probe
  pass, then the scheduler-offset compile reaches generic atomic fallback and
  stops at `unknown type name 'atomic64_t'` plus missing `arch_atomic64_*`
  operations. This detached configuration does not emit `CONFIG_GENERIC_ATOMIC64`;
  no atomic/page-table runtime or boot behavior is claimed, and `sources/linux`
  remains untouched.

## Linux wasm overlay hunk validation (2026-09-21)

- Corrected the `arch/wasm/include/asm/pgtable.h` patch hunk count from 36 to
  43 added lines. The previous count caused `git apply` to truncate the
  generated header before `PTRS_PER_PTE`, the shift definitions, and the
  closing `#endif`; the corrected overlay passes `git apply --check` and
  materializes the complete 43-line header in a detached worktree.
- `ports/linux-arch-wasm/build-probe.sh` succeeds with its intentional
  compile-boundary exit: Kconfig, UAPI/header generation, native ELF metadata,
  bounds and asm-offset generation, and the standalone wasm MVP compiler probe
  all pass. The first compiler error is
  `include/linux/mm.h:1973:22: error: call to undeclared function
  'virt_to_page'`, followed by related `page_to_pfn`, `pfn_to_page`,
  `page_to_virt`, and `__pgprot` errors. The smallest ABI-justified next step
  is to specify the wasm linear-memory page metadata and protection contract
  (including `struct page`/PFN conversions and `pgprot_t`) before adding any
  implementation; arbitrary compile stubs would hide an undefined MM ABI.

## Bounded Firefox desktop configure gate (2026-09-21)

- Added `probes/firefox-desktop-configure-gate.sh`. It materializes one
  temporary, bounded configure overlay from pinned Firefox Git objects
  (`b16f852ba66d190cacd42d0d43ac4d38bd07c4bd`), including the complete
  `build/` and `config/` configure frontends plus the vendored Python modules
  they import. The sparse `sources/firefox` checkout is never modified.
- The probe seeds an isolated system-site-packages virtualenv with Firefox's
  finalized build-site metadata, preventing Mach package resolution from
  hanging or using the network. It runs the real top-level `configure.py` with
  `--enable-project=browser --target=wasm32-wasi --disable-compile-environment
  --disable-tests` under a 30-second timeout.
- The probe verifies that `sources/firefox` is exactly pinned to
  `b16f852ba66d190cacd42d0d43ac4d38bd07c4bd`, validates a positive timeout, and
  rejects unsupported configure projects. Before archiving, it checks every
  requested Git path with `git cat-file -e`; the archive pipeline, virtualenv
  creation, metadata seeding, and configure invocation are each bounded by the
  timeout. It prints the complete raw configure transcript, preserving the
  upstream diagnostic `ERROR: Unknown OS: wasi` verbatim before adding any gate
  summary.
- The authoritative result is reached in under a second: `checking for target
  system type...` followed by `ERROR: Unknown OS: wasi`. At
  `build/moz.configure/init.configure`, `real_target()` calls
  `split_triplet(config_sub(...), allow_wasi=(project == "js"))`; its
  `split_triplet()` accepts `wasi` and `wasm32` only when `allow_wasi` is true.
  Therefore desktop `project=browser` rejects the WASI triplet before any
  compiler/toolchain check. The smallest genuine upstream adapter is to make
  this target gate project-aware for a new desktop WASI host and then supply
  the corresponding Gecko process/filesystem/graphics/network/JIT ABI; merely
  changing the triplet or enabling the JS-shell path does not port Firefox.
- `FIREFOX_CONFIGURE_PROJECT=js` is a diagnostic comparison only: the gate
  recognizes the JS-only target parse (`wasm32-unknown-wasi`) and exits nonzero,
  explicitly refusing to call it a browser result. The browser gate also exits
  nonzero when the expected upstream rejection is observed and labels that
  outcome `NOT PASS`, so a caller cannot confuse the rejection with a Firefox
  browser success. It never claims an artifact or a runnable desktop browser.
- Remaining blocker: upstream desktop configure still rejects `wasm32-wasi`
  with the exact `ERROR: Unknown OS: wasi` diagnostic; implementing a genuine
  desktop target requires the Gecko process/filesystem/graphics/network/JIT
  host ABI and remains outside this bounded probe.
### wasm page ABI milestone

The out-of-tree `ports/linux-arch-wasm/linux-arch-wasm.patch` now defines a flat linear-memory page ABI: `ARCH_PFN_OFFSET == 0`, `mem_map`-backed PFN/page and virtual conversions, and explicit `pgprot_val`/`__pgprot` metadata with compile-time page-size invariants. `ports/linux-arch-wasm/build-probe.sh` applies the overlay and passes all prior page ABI checks; the first remaining compile boundary is `clear_page`, followed by `switch_mm`, `copy_user_page`, `copy_page`, `page_to_phys`, and missing `asm/seccomp.h`. The standalone wasm MVP compiler probe passes.

## Aurora/Xvfb browser integration (2026-09-21)

- Aurora provenance remains out-of-tree: `/home/a/project/aurorawm`, upstream `https://github.com/ecooxai/aurora-wm`, commit `86a97cd910b285e30fc4b2d12497c9288eede4de`, version 0.3.0.
- The browser entrypoint is `web/desktop/index.html?wm=1`; startup order is Xvfb display `:11`, then Aurora WM, then optional Firefox only after WM readiness (`?firefox=1`).
- `web/wasm_smoke/aurora_startup.js` reports heartbeat and `performance.measure("wm-startup")`; generated payloads stay out-of-tree and missing Firefox artifacts are surfaced as errors.
- Build reference: sibling `webos/scripts/build-aurora.mjs` and `build-xvfb.mjs`; run `tools/build-aurora-wasm.sh` only with an activated Emscripten SDK. Chrome and source-build validation remain pending when artifacts/toolchain are available.
- Headless Chromium validation of `web/desktop/index.html?wm=1&firefox=1` exited 0 and visibly reported `WM startup error: Xvfb artifacts missing` followed by `Firefox was not started because WM readiness failed`; this is the expected blocker until real Xvfb/Aurora payloads are built.

## Real Xvfb/Aurora desktop staging (2026-09-21)

- Copied the existing source-built browser payloads from the read-only sibling
  `/mnt/p6/project/linux/webos/public/upstream` into
  `web/desktop/artifacts/{xvfb,aurora}`. These files are byte-identical to the
  sibling payloads; they were not rebuilt from the incomplete `vendor/aurorawm`
  snapshot. Sibling provenance is git revision
  `d9be82f47ea85a5a7dada8535d43010fe56095f6`.
- Artifact checksums: `Xvfb.js` 300,974 bytes,
  `6fa52cffc16d987249b35be4131b9b2586adbc81d2126d8c91da3f31b538ca51`;
  `Xvfb.wasm` 3,100,011 bytes,
  `fe86560c85c80847cb9d69fd675a72fe4fab66762fca56eb3013b1904ccb9319`;
  `Xvfb.data` 3,345,016 bytes,
  `ee1f4963cc56c99fbdebab6c269eb090f9edf47f90ce0a644218565330b9ac09`;
  `aurora-wm.js` 250,061 bytes,
  `9a3a84c3a06259dcfc1b9994ab719e97b9019332524150c3b4bb6aafc655c3fe`;
  `aurora-wm.wasm` 8,749,181 bytes,
  `f88aee88f9aec58c5b47370d3a3da372fa9a9708b245d6e56eed64f31ff15566`.
- `web/desktop/index.html` now starts a worker for real Xvfb and waits for its
  `onRuntimeInitialized` ready event before starting Aurora in a second worker.
  Firefox is checked only after an Aurora desktop-ready log line; no Firefox
  JavaScript/Wasm artifact exists in either tree, so `?firefox=1` reports
  `missing-artifact` and does not claim a browser launch.
- `web/desktop/dev-server.mjs` serves the desktop with COOP/COEP headers and
  an EventSource reload endpoint. Its watcher is limited to `web/desktop` and
  `vendor/aurorawm`; query flags therefore survive source-triggered reloads
  without watching the large `sources/` trees.

## Native Linux browser boot payload (91af974, 2026-09-21)

- Commit `91af9741ecb2b849c4f01f33d4e15c50d38c4837` stages the native wasm32
  Linux runtime under `web/linux/`: `vmlinux.wasm`, console/framebuffer/network
  adapters, and the GUI/Firefox initramfs payloads. The Firefox initramfs is
  locally recompressed with minimal `firefox` uid/gid 1000 records and its
  `/init` launching `https://www.bing.com` through BusyBox `su`; this is a
  staged boot payload, not proof that desktop Firefox is runnable.
- The browser entrypoint is `/linux/index.html?firefox=1`. It auto-starts the
  guest in Firefox mode, waits for the Linux/X userspace to initialize, and
  requests the browser payload from the guest. The server must serve the page
  with COOP/COEP/CORP headers for shared WebAssembly memory.
- Boot caveat: this is a native wasm32 Linux boot/runtime integration and does
  not establish a full Firefox desktop port. If the guest or its userspace
  fails, the page remains a diagnostic framebuffer/console surface and must
  report the failure rather than claim that Bing opened.
- Firefox-mode caveat: the initramfs supplies only minimal `firefox` passwd/group
  records; `/init` uses BusyBox `su` and a writable `/home/firefox` profile, and
  Firefox mode reserves the supported 4 GiB guest-memory maximum. Whether the
  wasm userspace transition and browser remain stable is still a runtime gate.
- Progress validation: the 75-second visible run reached Firefox GTK/Gecko
  initialization at 4096 MB, then failed with `RuntimeError: memory access out
  of bounds`; no Bing request occurred. Screenshot:
  `/tmp/linuxwasm-su-4gb-75.png`. This is not a Firefox/Bing pass.

## User-memory growth adapter (2026-09-21)

- Added the out-of-tree `web/linux/dist/user-memory-growth-adapter.js` and
  imported it from the staged `web/linux/dist/worker.js`. It grows only user
  `WebAssembly.Memory` destinations for `write`, `write_zeroes`, and futex
  atomic words, and grows successful `brk`, `mmap`/`mmap2`, and `mremap` ranges
  returned by the Linux syscall import. The kernel destination used by `read`
  remains bounded by `memory_bytes()` and is never grown.
- Failed user growth preserves the existing copy/zero/futex failure return;
  syscall growth failures emit a `console.debug` diagnostic and preserve the
  syscall return. `web/linux/dist/USER_MEMORY_GROWTH_ADAPTER.md` documents the
  boundary and provenance. No sibling checkout or `sources/` tree was changed.
- Validation: `node --check` exited 0 for both adapter and worker. A Node ESM
  edge test grew shared memory 1→2 pages for a boundary write and 2→5 pages
  for an x86 `mmap` result, then rejected safe-integer overflow and an
  8-page-maximum violation (`adapter edge tests: PASS`). A 95-second visible
  Chrome run at `http://127.0.0.1:4173/linux/index.html?firefox=1` stayed
  stable with no out-of-bounds runtime error and no Bing request; this is
  runtime-stability evidence only, not a Firefox/Bing completion.

## Firefox MIME handler startup adapter (2026-09-21)

- The native guest does not implement the `nsIJSEnumerator` bridge used by
  `nsIMIMEInfo.getFileExtensions()`. The external patch in
  `web/linux/firefox-patches/0001-ignore-unsupported-mime-extension-enumerator.patch`
  catches only `NS_ERROR_NOT_IMPLEMENTED`, preserves existing extensions, and
  rethrows all other failures. A dry-run applies cleanly to the unpatched
  Firefox module at `opt/firefox/modules/ExtHandlerService.sys.mjs`.
- The staged `web/linux/initramfs-firefox.cpio.gz` contains the patched module;
  its SHA-256 is
  `ddf243b260093fb2214dc29527843ee0accdbe81939c831cff398b8d3d82a3f8`.
  The older 15:17 headless log used an unpatched image and its line-469
  `NS_ERROR_NOT_IMPLEMENTED` is stale. The later `RuntimeError: null function`
  remains unresolved; no Firefox rebuild or fake browser workaround was used.
