





#  agent team

##   control
      95    /   100              is goal score do not stop util finish task goal in high quality. 100 is perfect quality  like 3A game, stable rich features and high performace for software and easy to use both on pc and touch mobile device
      15   %                  week usage for this goal  your can use ,stop when use up this also stop other subagent write doc in agents.md to give info  let other agent continue your goal and task , also stop when weekusage is below 80% too.
       git for manage version
       use <3 subagents at same time and < 2 cmd-agents for each agent , wait them finish if there are too many subagent
       same model as mainagent      for  normal subagent model for subtask.
       same model as main agent     for cmd-subagent model to running cmd.
       test task and coding task should give to subagent
       subagent should start a new agent for test  if it can
       cmd for read and edit files should run in current agent not cmd-agent.

## main agent's work
     think yourself as project manager cto, you need not write code or test by your self in most time, you should evaluate current project goal and quality, find best plan and tech solution.
     then give tasks to subagents, divide goal to sub tasks for subagents to implement, give subagent the  goal ,plan , its subtask and  other necessary  context, let them implment sub tasks and test debug and deploy, check results and summary includes  evaluate a score n/100, if result not good find why then improve plan and  give new task to new subagents again, tell subagent do not do anything outside its subtask, if something not wrong tell main agent to decide continue or not.
give meaningful name to each sub agent, add cmd- prefix for cmd subagnet

## improve context
   when run cmd like bash,python,node,do not run in main agent.  (the cmd for read or editing files still should and prefer to be run by none-cmd agent)
    run cmd in  a new  cmd subagent run cmd  and send back the summary of output so the cmd output will not pollute the main context . cmd subagent should send a summary what have done,result, including original cmd runned  and only important  raw output to main agent, for very long output like full file base64 str (only first 50 and last 50chars of base64 string if this really need).
    for serving cmd like dev server run in a serving agent, serving agent should manage running server acceptnew server or stop, restart current,there should only one serving agent.
    tell cmd agent stop after cmd finished or error occure, do not try to fix, report to main agent immediatly and let main agent fix and  start new new cmd agent

    when start new subagent , do not fork the thread, always fresh session with necessary context and goal, test, subagent should use same score rule to stop or not
the cmd  subagent  is for run cmd is not include in the 2 subagent limit, each normal agent can run 2  saperated subagent for cmd,none-cmd subagent can use cmd agent for run cmd too.
     do not run cmd that ouput large base64 string into output like stdout and other place that will output full base64 str, only do convert when output base64 str into a file or pipe, if you really need verify output base64 directly try only get first 50 char and last 50 char to output for verify is enough


























## Firefox wasm crash handoff (2026-09-23)

- Current artifact: `web/linux/initramfs-firefox.cpio.gz`, repacked with relative cpio paths from the rebuilt Binaryen `fpcast-emu` module (`firefox-fpcast.wasm`, 137,368,965 bytes before compression). Current initramfs SHA-256: `65da08b4ad50a5c70b6429f8600260e9e8d1afafb50b3d7cbc237781f489ee29`.
- The module imports three `linux.*` functions plus shared `env.memory` (initial 704 pages, maximum 65536), exports `_start` and `__indirect_function_table`, and has the three reserved null table entries filled by `web/linux/dist/firefox-callback-adapter.mjs`. Reproduce the Binaryen step with:

  ```sh
  wasm-opt --all-features firefox-shared-exported.wasm \
    --pass-arg=max-func-params@23 --fpcast-emu -o firefox-fpcast.wasm
  ```

- The source-side ABI fix is recorded in `web/linux/firefox-patches/0002-wasm-mozcontainer-callback-abi.patch`. Under the wasm conditional, `widget/gtk/MozContainer.cpp/.h` accepts GLib's `(gpointer, gpointer)` class callback and `(GTypeInstance *, gpointer)` instance callback, then uses the existing typed implementation body.
- Rebuild notes: the browser link needed `--import-memory`, the sysroot C++ ABI library, and temporary static-library symlinks under `.tmp-firefox-build/linklib`. Archived build sources/objects are under `.tmp-firefox-build/nix-local-store/nix/var/nix/builds/`; `/build/firefox-128.14.0` and `/nix` are temporary symlinks. The archived `tools/wasm/userspace/firefox/browser.nix` post-fixup is the authoritative `wasm-opt` recipe.
- Live verification must use `web/desktop/dev-server.mjs` for cross-origin isolation (`LINUX_WEB_PORT=4180 node web/desktop/dev-server.mjs`). A fresh Chromium CDP probe of `http://127.0.0.1:4180/linux/index.html?firefox=1` reaches AuroraWM, network checks, and `/bin/firefox`, but Firefox exits with status **139**. No Firefox window or Bing request appears. The worker still reports `RuntimeError: unreachable`; the adapter removed the earlier null-function trap but has not completed callback/X11 startup semantics.
- Next agent: inspect the guest wasm crash/runtime stack and callback/XPTCall path around `wasm-gtype: class_init MozContainer`. Filling table slots 0–2 with a no-op 23×`i64` callback is only a compatibility shim; trace or implement required callback dispatch and side effects before treating Firefox startup as complete. Reuse `.tmp-firefox-build/cdp_probe.py`.

# Agent status

## Firefox indirect-table adapter (2026-09-23)

- Added `web/linux/dist/firefox-callback-adapter.mjs`, a browser-side bridge
  for the staged Firefox wasm ABI. It identifies the module by its Linux
  imports and `_start`/`__indirect_function_table` exports, then fills the
  three reserved null table entries with a correctly typed 23×`i64` callback.
  Firefox and Linux payloads remain unchanged.
- Added `web/linux/firefox-callback-adapter.test.mjs`; Node tests verify the
  exact ABI fixture is patched once and unrelated modules are ignored.
- A live 4 GiB Chromium run now passes the earlier `RuntimeError: null
  function` at Firefox GTK startup and reaches `wasm-gtype: class_init
  MozContainer`. It still does not show a Firefox window or request Bing after
  extended observation. The remaining issue is the callback's missing
  side-effect/X11 startup semantics; the no-op bridge is a contained
  compatibility step, not a full Firefox completion claim.

## Arch/official Firefox Wasm artifact verification (2026-09-22)

- The current staged `web/linux/initramfs-firefox.cpio.gz` contains a genuine
  148 MiB `/opt/firefox/firefox` Wasm MVP module (SHA-256
  `b126f4e109b8bfc74aa6cd1414449b49c12777797f390dffa1fa1b740c666d68`), not a
  native ELF. Its imports are `linux.syscall`, `linux.get_thread_area`,
  `linux.copy_siginfo`, and shared `env.memory`; it exports `_start` and carries
  a `build_id` custom section. The MIME enumerator patch is present in the
  staged archive.
- Added `tools/build-firefox-wasm.sh`, a source-preserving Arch/official
  toolchain path. It runs a freestanding `/usr/bin/clang` + `wasm-ld` probe,
  extracts and validates the staged Firefox module with WABT
  (`wasm-validate --enable-all`), checks the guest ABI records, and materializes
  an output copy. It never binary-patches or relinks Firefox and labels the
  result as artifact verification.
- Arch packages are present (`clang`/`llvm`/`lld` 22.1.6, `wabt` 1.0.41,
  `wasi-sdk-git` r140 under `/opt/wasi-sdk`). A desktop source build remains
  unavailable: Firefox's pinned configure accepts `wasm32-wasi` only for
  `project == "js"` and rejects the browser target with `ERROR: Unknown OS:
  wasi`.
- Added `probes/firefox-wasm-musl-configure-gate.sh`, which archives the
  bounded configure dependency closure into a temporary tree and applies a
  local-only target-gate change for `wasm32-unknown-linux-musl`. Firefox's real
  parser reaches `checking for target system type... wasm32-unknown-linux-musl`,
  then stops at the expected closure boundary (`js/ffi.configure` is absent);
  no browser object is built and `sources/firefox` is unchanged.

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

## Firefox null-function callback blocker (2026-09-21)

- The captured profile run `/tmp/linuxonweb-profile-diag.FzhBDD/console.txt`
  reports at 31 seconds: `error running user module: RuntimeError: null
  function`, with the first frame `wasm-function[80832]:0x1983797`, followed
  by functions `380636`, `79042`, `197402`, `197401`, `454471`, `206297`,
  `205824`, `205352`, and `208100`. The run reached Firefox startup but made
  no Bing request.
- Extracting `opt/firefox/firefox` from the staged initramfs and inspecting it
  with `wasm-objdump` shows function 80832 (signature 2) ending in
  `call_indirect 0 (type 0)` at offset `0x1983797`; it loads the callback/table
  index from its argument structure. This is a null indirect-table entry, not
  an unresolved WebAssembly import (which would fail instantiation with a
  `LinkError`).
- The 154,316,950-byte Firefox Wasm artifact has no name or DWARF custom
  section, only `build_id` and `target_features`, so the frame cannot be
  mapped to a Firefox source symbol. No preference or small source adapter can
  be selected truthfully from this evidence; fixing it requires retaining
  symbols/source mapping and tracing the callback/table initialization in the
  Firefox Wasm build. No source, binary, or runtime workaround was applied.

## Firefox 128 patched rebuild probe (2026-09-21)

- The exact Firefox 128.14.0esr source archive at
  `/tmp/firefox-128.14.0esr-src.LTzEPs/firefox-128.14.0esr.source.tar.xz`
  was extracted to a temporary directory and all 41 sibling recipe patches
  (0001 through 0041) applied sequentially with `patch -p1 --forward`,
  including 0036 callback adapters, 0038 wasm32 XPTCall trampolines, and 0039
  static-runtime fixes. The archive and repository sources were not modified.
- The local environment has no `nix`, `nix-build`, or `/nix` store, so the
  sibling Nix derivation cannot run. A direct `mach configure` probe with the
  system Clang 22 fails because Clang canonicalizes the target as
  `wasm32-unknown-linux-musl`, which this non-Nix compiler does not support at
  link time. A temporary wrapper mapping to `wasm32-unknown-unknown` and
  adding `-D__linux__` plus `/usr/include/c++/v1` reaches the linker checks but
  fails because `/usr/lib/clang/22/lib/wasm32-unknown-unknown/libclang_rt.builtins.a`
  is absent and host `/lib/libc.a` members are not Wasm objects.
- Exact probe logs are `/tmp/firefox128-mach-configure-py312.log` and
  `/tmp/firefox128-mach-configure-wrapper3.log`. The next actionable fix is
  to run the sibling `browser.nix` derivation in an environment containing its
  wasm32-linux-musl cc-wrapper, musl/libc++ sysroot, compiler-rt builtins,
  Rust target specification/stdlib, and statically built GTK/X11 inputs. No
  rebuilt binary or Bing request can be claimed from this host-only probe.

## Guest admin account and desktop startup (2026-09-22)

- Added the source templates under `tools/guest-rootfs/` and the deterministic
  `tools/repack-guest-initramfs.sh` rebuild path. The script extracts either a
  raw or gzip `newc` archive, overlays the account/init templates, normalizes
  generated timestamps, preserves payload ownership through `fakeroot` when
  available, and emits a reproducible archive without modifying its input.
- Both staged images now define `admin` as UID/GID 1000 with `/home/admin`,
  `Desktop`, `Documents`, and `Downloads`; the historical `firefox` UID/GID
  1000 record remains as an alias. `/etc/sudoers` grants
  `admin ALL=(ALL) NOPASSWD: ALL`. The setuid `/usr/bin/sudo` is a static
  wasm32-musl helper built from `tools/guest-rootfs/sudo.c`; its validated
  SHA-256 is `ebe3c025e50c9543b7ac03387074e8abcab40bcac24fc44ec15a7af467feb90e`.
- `/init` starts Xfbdev, aurora-wm, xterm, and Firefox with `su admin` and
  `HOME=/home/admin`; existing network, certificate, and Firefox payload files
  remain in place. This change does not claim a Firefox or Bing success.
- `tools/repack-guest-initramfs.sh` installs the helper as root:root mode
  `04755` under fakeroot, preserving deterministic `newc` metadata. Archive
  checks: `web/linux/initramfs.cpio` is 40,459,264 bytes with SHA-256
  `411f644e0673c2b56cfc0fa1b85de7efce83f56bd472b66eee01e5105701d0f2`;
  `web/linux/initramfs-firefox.cpio.gz` is 87,160,126 bytes with SHA-256
  `c55b93b9d2eeb496ddb116a0f0e518f550c2de24897ddb52775f4ee8b20ce101`.
  Re-running the script against each staged image produced byte-identical
  output. CPIO listing checks confirm root-owned `/usr/bin/sudo` mode 04755,
  all account files, and all admin home directories in both images.

## Touch gestures on the Linux framebuffer surface (2026-09-22)

- Added `web/linux/touch-gesture.mjs`, a single-pointer adapter that moves the
  guest pointer to touch contact, turns a short touch into a left click, and
  turns a one-second hold plus movement into a left-button drag with a clean
  release. `touch-action: none` remains enabled and mouse, pen, wheel, and
  keyboard paths stay unchanged.
- `web/linux/main.js` routes `pointerType === "touch"` through the adapter;
  `web/linux/touch-gesture.test.mjs` covers tap, hold/drag, cancellation, and
  multi-touch ownership. The existing `inputDevice` virtio event API is the
  worker/guest protocol boundary; no Xvfb/Aurora worker message was changed.
- Validation: `node --test web/linux/touch-gesture.test.mjs` passed all 4 tests;
  `node --check web/linux/main.js` and `node --check web/linux/touch-gesture.mjs`
  both passed. No Firefox toolchain or initramfs files were changed.

## Native Firefox link resource and ABI hardening note (2026-09-22)

- The latest native Firefox 128 browser build reached the final `firefox` and
  `xpcshell` links, then failed with `clang++: error: unable to execute command:
  Killed`; no browser artifact was produced. The captured earlier Nix log also
  shows `mach build -j"$NIX_BUILD_CORES"` expanding to `make -f client.mk -j6`,
  so a serial retry must constrain both layers (`NIX_BUILD_CORES=1`, `mach build
  -j1`) and verify the generated make command. If the recursive build still
  overlaps final links, build the browser and xpcshell link targets in separate
  invocations.
- `wasm-ld` emitted repeated `function signature mismatch` diagnostics for
  libc++ constructors/destructors, NSS `sftk_FIPSEntryOK`, and Mozilla symbols.
  These are ABI inconsistencies between input objects/archives, not harmless
  noise and not evidence that a link succeeded. Keep the warnings visible;
  `--fatal-warnings` is useful for a short diagnostic pass, while suppressing
  them or forcing a mismatched indirect call would hide a runtime trap risk.
  The fix belongs in a single consistent wasm C++ ABI/libc++ build and source
  adapter set, followed by symbol-level revalidation.
- Safe link-pressure diagnostics are `--disable-lto` (already selected),
  `-Wl,-O0`, and the default `--gc-sections`; these can reduce peak linker
  memory but cannot repair signature mismatches. Keep any debug/symbol copy of
  a successful link before size reduction. For release processing, strip debug
  data before running Binaryen `wasm-opt --fpcast-emu` (optionally
  `--low-memory-unused`), write to a temporary output, validate it, and only
  then install the result. `wasm-opt` and `strip` cannot run after a killed link
  and must never be used to manufacture a missing artifact.
- This is a source/configuration diagnostic only. The active sibling Firefox
  recipe, staged initramfs, and server were not modified; no rebuilt Firefox or
  browser navigation is claimed.
## Keyboard input boundary handoff (2026-09-22)

- The browser keyboard bug was in the host mapping fallback: Linux evdev letter
  codes are not one contiguous `A + index` range (`A..L` is 30..38, punctuation
  occupies 39..43, and `Z` is 44). The old fallback therefore emitted invalid
  codes for most letters. `web/linux/keyboard.mjs` now uses the explicit evdev
  table and accepts standard `code`, `key`, and legacy `keyCode`/`which` fields;
  it also covers modifiers, navigation, keypad keys, and X Unicode composition.
  `main.js` routes composition events through Ctrl+Shift+U sequences while
  retaining physical key semantics and the existing touch/mouse path.
- Focused tests are in `web/linux/keyboard.test.mjs`; the bounded test command
  was run before the final explicit-letter correction and exposed the exact
  contiguous-code defect. Re-run `node --test web/linux/keyboard.test.mjs
  web/linux/touch-gesture.test.mjs` as the next local check.
- No Firefox build, initramfs, X server process, or worker transport was
  changed. The existing native Firefox build remains at the serial final-link
  failure with its incomplete artifact retained for diagnosis; do not treat it
  as a browser success. Existing server/watcher state and the admin/sudo,
  touch-gesture, and MIME commits remain as previously recorded.
- The command worker was given one bounded keyboard smoke test and must stop on
  its first result; no retry or self-fix is authorized. Remaining follow-up is
  to record that result, run the focused tests, and inspect the browser surface
  with the new adapter if the smoke test reports an error.

## Firefox callback adapter launch handoff (2026-09-23)

- Current goal remains a native Linux Firefox launch that reaches a visible
  browser page (Bing first, then x.com) through the existing Wasm/Xfbdev path.
  The browser adapter was installed in `web/linux/dist/worker.js` and
  `web/linux/dist/firefox-callback-adapter.mjs`; the staged payload is
  `web/linux/initramfs-firefox.cpio.gz`.
- Successful evidence: the adapter fills the three initially-null reserved
  indirect-table entries with a type-correct 23 x `i64` callback, removing the
  earlier null-function trap. The guest reaches Xfbdev/AuroraWM and starts
  `/bin/firefox`.
- Failure evidence: Firefox exits with status **139**, the worker reports
  `RuntimeError: unreachable`, and no Firefox window, Bing request, or X11
  surface appears. A no-op callback only proves table ABI compatibility; it
  does not perform the GLib/GType class or instance initialization side effects.
- Reproduce with `LINUX_WEB_PORT=4180 node web/desktop/dev-server.mjs`, then
  run `python /mnt/p6/project/linux/.tmp-firefox-build/cdp_probe.py` against
  Chromium CDP on port 9230. The probe navigates to
  `http://127.0.0.1:4180/linux/index.html?firefox=1` and reports console,
  exception, and status diagnostics.
- Highest-priority next investigation: trace the callback/table index and the
  post-callback trap in the Firefox Wasm/XPTCall/GType startup path, retaining
  symbols or source mapping from the archived build. Determine whether the
  required callback is a real MozContainer/GTK function (requiring a typed
  adapter with its side effects) or whether the trap is a later syscall/X11
  runtime failure. Do not treat filling slots 0--2 with a no-op as a Firefox
  startup fix.

## Firefox launch final handoff (2026-09-23)

- Goal remains incomplete. Default adapter mode fills reserved table slots
  0--2; the `firefox_no_adapter=1` A/B path produced the same Firefox
  `--version`/normal status **139**. The preflight produced no output, and no
  Bing request or X11 Firefox surface appeared.
- The worker reaches adapter installation and `_start`, then reports
  `RuntimeError: unreachable`. Temporary `MOZ_LOG`/preflight changes were
  removed; the clean repacked artifact is SHA-256
  `7c7f57cc525519cb5ffb395a40fbf287aeb43302427778e7d15d3026e623bf59`,
  86,130,286 bytes.
- Browser diagnostics remain opt-in in the adapter/platform/worker files.
  Syscall import wrappers were reverted after causing machine-worker failure.
  The retained recipe already includes patches 0036--0040; no omitted
  TLS/syscall patch is known. The original Nix launcher/rebuild environment is
  unavailable; a serial retry requires recovering the exact invocation and
  constraining both layers with `NIX_BUILD_CORES=1` and `mach build -j1`.
- Recommended next action: capture one diagnostics-enabled A/B run and then
  recover a symbol/relocation-preserving Firefox link (or its exact low-memory
  serial recipe) to map the failing callback/table index. Until that mapping or
  a retained syscall/TLS trace exists, no source or adapter semantics change is
  justified; this is the current blocker.

## Firefox resumed trap handoff (2026-09-23)

- The latest bounded probe identifies the exact Wasm failure as
  `wasm-function[7]:0xcef60` in `_start`. Adapter and `firefox_no_adapter=1`
  runs are identical, so the reserved-slot shim is not the distinguishing
  factor.
- One retry experiment was run and failed, then reverted. Built-in terminal
  keyboard input is verified; X11/Firefox input remains unverified.
- Recommended next action is either to add a source-map guard for function 7
  at offset `0xcef60` or recover the exact serial Firefox build to produce
  symbol/relocation mapping. Current status: **blocked**, score remains
  incomplete; no Firefox/Bing/X11 success claim is justified.
- Address correction: the exact immediate guard address is decimal 37277824,
  hexadecimal `0x0238d080`.

## Final Firefox baseline handoff (2026-09-23)

- The dev server at `127.0.0.1:4180` remains running. Current Firefox baseline
  and `firefox_no_adapter=1` both trap at `wasm-function[7]:0xcef60` in
  `_start`, with guard immediate 37277824 (`0x0238d080`), status **139**, and
  no Bing request or X11 Firefox surface.
- The retry experiment was tested in Chrome and reverted. Built-in hvc0
  keyboard `echo hi` works. The X canvas receives key events, but the captured
  screenshot showed AuroraWM Settings with no focused terminal, so X11 keyboard
  delivery remains unverified. Source audit found no obvious JS mapping defect.
- Current score: **12/100**. Next agent should source-map the guard or recover
  the exact serial Firefox rebuild, then run one Chrome verification cycle.

- Final name-section audit did not map `0x0238d080` or nearby function indices;
  no safe patch is justified. Preserve the existing dev-server PID/session and
  continue with source mapping or the exact serial rebuild before another
  Chrome verification.

## Firefox guard/build handoff (2026-09-24)

- Guard tracing observed the exact `0 -> 1` transition before the trap.
  Opt-in worker diagnostics remain in place; no callback semantics changed.
- Serial reuse builds remain diagnostic only: the first attempt used a stale
  host probe; a fixed `TMPDIR` still used the Wasm wrapper for host tools; and
  explicit `HOST_CC`/`HOST_CXX` compiler probes reached but failed at the host
  linker. No artifact changed; current artifact SHA is
  `1484f318...2e365`.
- Next action is to recover the host linker from the saved `buildPhase`/Nix
  environment before any rebuild. Do not claim Firefox is fixed.

## Firefox build environment handoff (2026-09-24)

- Purity is fixed and a fresh canonical objdir configure now succeeds. The
  exact mmap/unwind shims are fixed; disk cleanup recovered approximately
  6.2 GiB.
- An incremental build progressed through C++ DOM/WebIDL after multiple 600 s
  windows, but has not reached a successful link or produced a new artifact.
  The deployed Firefox payload remains unchanged.
- Next agent should resume the same objdir with the same environment and shims;
  do not clean or reconfigure. Continue through link inspection, preserve any
  symbol-bearing output, and only then test a newly produced payload.

## Firefox incremental build handoff (2026-09-24)

- The repaired fresh objdir/environment/shims were resumed. Multiple serial and
  `-j2` incremental windows progressed deep through C++ DOM, WebIDL, and media,
  but no linker run or Firefox artifact has completed.
- Last bounded log: `/tmp/firefox-fresh-build-shim-j2-final-20260924.log`;
  it ended with RC124 at `dom/media/mediacontrol`. Approximately 5.7 GiB
  remains free in `/tmp`.
- Next agent must resume the same objdir/environment/shims; do not clean,
  reconfigure, or deploy. Preserve any link/symbol output when it appears.

## Firefox incremental build progress (2026-09-24)

- Subsequent incremental `-j2`/`-j4` windows advanced C++ from DOM media
  through gfx, harfbuzz, GL, layers, Skia, Thebes, VR, WebRender bindings,
  image, and intl. No linker or Firefox artifact exists yet.
- Last bounded log: `/tmp/firefox-fresh-build-shim-j4-final-20260924.log`,
  ending RC124. Approximately 4.9 GiB remains free in `/tmp`.
- Next agent resumes the same objdir/environment/shims; do not clean,
  reconfigure, or deploy.

## cmd-kernel-tls-patch handoff (2026-09-24)
- Investigated deployed `web/linux/vmlinux.wasm` `func[210] <sys_set_thread_area>` at file offsets `0x27b60..0x27b7b` (body-size byte `0x27b5f = 0x1c`); original sequence loads `arg0+4` before storing to `current_task+24`.
- Created opt-in candidate only at `/mnt/p6/project/linux/.cache/vmlinux-sys-set-thread-area-arg-candidate-20260924.wasm`; deployed kernel file was not modified.
- Candidate replaces exactly offsets `0x27b63..0x27b68` (`41 04 6a 28 02 00`) with six NOP bytes (`01 01 01 01 01 01`), preserving `local.get 0` / `local.set 0`, body length and all other bytes. Candidate SHA256 `5475073d4e0bc3cd91d0f98527173f42e86befce3cba24a4df01516ba45385b3`; original SHA256 `21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`.
- `wasm-validate --enable-all` passes; byte diff confirms six bytes only. Candidate should be packed into a separate archive for browser A/B before making any default deployment decision.

## 2026-09-24 cmd-kernel-tls-test handoff
- Tested candidate `/mnt/p6/project/linux/.cache/vmlinux-sys-set-thread-area-arg-candidate-20260924.wasm` (SHA256 `5475073d4e0bc3cd91d0f98527173f42e86befce3cba24a4df01516ba45385b3`) in `web/linux/vmlinux.wasm` with backup `web/linux/vmlinux.wasm.backup-kernel-tls-test-20260924` (original SHA256 `21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`).
- Chrome Canary CDP probes on ports 9286/9287: archive/vmlinux HTTP 200; candidate progressed past TLS setup (syscalls nr245,244,96,167,174,172,173,17,160,56,25,135,134,63), then Firefox failed `RuntimeError: memory access out of bounds` (wasm fn 466), guest ended in kernel panic `Attempted to kill init! exitcode=0x0000000b`; no Firefox UI/Bing/X.
- Restored original vmlinux and validated with `wasm-validate --enable-all`; dev server left running. Candidate is rejected pending a fuller TLS ABI fix.

### 2026-09-24 TLS adapter handoff

- The opt-in `firefox_tls_adapter=1` path now caches syscall 244's pthread pointer from arg0 before the kernel syscall and returns it through the one-argument `get_thread_area` import, preserving number/BigInt types.
- `platform.js` propagates Firefox diagnostic flags and falls back to `globalThis.location.href` when no execution URL is supplied; the explicit TLS gate accepts Firefox-shaped modules exporting `_start` and `__indirect_function_table`.
- A one-time opt-in `get_thread_area` readback marker reports the original result, returned cached pointer, and type. Chrome confirmed the adapter activates, but the Firefox startup trap remains unchanged.

### 2026-09-24 TLS descriptor ABI correction

- The opt-in TLS adapter no longer returns raw syscall-244 arg0. After the kernel call, it reads the little-endian i32 at guest memory `arg0 + 4` with bounds/type checks and caches that value for `get_thread_area`; on failure it delegates the original result.
- The marker now records descriptor and decoded pointer values. Default behavior remains untouched.

### 2026-09-24 guard address correction

- Disassembly confirms the two abort-guard constants at decimal `45757056` and `45757072` (`i32.const` at the trap site and the next guard). Opt-in `firefox_guard_bypass_all` and `firefox_guard_memory_diag` now use those addresses under the strict Firefox module gate.

### 2026-09-24 initramfs root-agent gate

- `tools/guest-rootfs/init.sh` now starts `linux-guest-agent` only when a
  `/dev/vd[a-z]` disk exists or the embedding explicitly passes
  `lowland.root.agent=1`. Firefox boots this archive as an initramfs without a
  LOWLAND_ROOT disk, so the previous unconditional launch produced the
  misleading `preparing system root: No such device` message.
- `bash -n`, BusyBox `sh -n` (when available), and `git diff --check` pass.
  Repack the staged archive before browser verification; no worker.js or
  Firefox payload was changed by this fix.

### 2026-09-25 root-agent gate deployment

- Repacked and deployed `web/linux/initramfs-firefox.cpio.gz` with the gate;
  deployed SHA-256 is `b8ece6ebb061f93447858a49405cb7b999ed2ccf03783ee59876852a5d37f9ef`
  (86,455,381 bytes). The pre-change backup is
  `web/linux/initramfs-firefox.cpio.gz.backup-before-root-agent-gate-20260925`
  with SHA-256 `5b79ba33fc9767edf85f64b14a378af7e206802ba0e50c067975c44611f9b02f`.
- `gzip -t` passed; CPIO listing retains `/bin/linux-guest-agent`, and the
  archived `/init` contains the `/dev/vd[a-z]`/`lowland.root.agent=1` gate.
  Firefox initramfs has no LOWLAND_ROOT disk, so the agent is skipped and its
  `No such device` diagnostic should disappear. `worker.js` line 505 remains
  intentional guest-Wasm trap reporting, not a JavaScript syntax failure.

### 2026-09-25 Firefox Bing/X working deployment (supersedes older crash handoffs)

- Live archive `web/linux/initramfs-firefox.cpio.gz` is now the validated
  Firefox/CA candidate, SHA-256
  `e274c8073fa1522356013dc25e540cfba956b7fbf39c7afede193fd53330b1c2`
  (87,733,610 bytes). Port 4180 serves it with HTTP 200, matching
  `Content-Length`, `Cache-Control: no-store`, COOP/COEP. Open
  `http://127.0.0.1:4180/linux/index.html?firefox=1` in Chrome. The preceding
  root-agent-gated baseline is preserved at
  `/mnt/p6/project/linux/.cache/gtk-icon-bypass-20260925/x11-detect/baseline-b8ece6-preserved.cpio.gz`
  (SHA-256 `b8ece6ebb061f93447858a49405cb7b999ed2ccf03783ee59876852a5d37f9ef`).
- Chrome screenshots `screenshot-ca-fallback-bing.png` and
  `screenshot-ca-x.png` under
  `/mnt/p6/project/linux/.cache/gtk-icon-bypass-20260925/x11-detect/`
  show Firefox drawing the Bing home page and the X.com landing page.
  Corresponding CDP logs report successful HTTPS responses and no
  `SEC_ERROR`, `SSL_ERROR`, or guest Wasm trap. The Firefox toolbar and
  some page text still show tofu/hex boxes; X's webfont body text is readable.
  Keyboard usability and long-run stability remain to be checked.
- Do not replace the live working archive for font experiments. Use an
  isolated server port/candidate path, or restore this exact SHA after any
  reversible test. Two DejaVu TTFs and one OpenSans TTF with minimal
  Fontconfig XML each stalled Firefox before window/NSS initialization,
  just after `Fontconfig warning: using without calling FcInit()`; neither
  produced a Wasm trap. The single-font log/screenshot are
  `cdp-ca-onefont.log` / `screenshot-ca-onefont.png` in the scratch directory.
  A separate dev-server root on port 4181 confirmed the one-font stall without
  changing the live 4180 archive. `FC_DEBUG=4` proves OpenSans is parsed and
  reaches `FcConfigSubstitute donePattern`; removing all family aliases from
  the Fontconfig XML still stalls before NSS/window/Bing after 80 seconds.
  Neither isolated run trapped. See `cdp-onefont-isolated-debug2.log` and
  `cdp-onefont-minimal.log`; next diagnosis should add bounded markers around
  Gecko's Fontconfig font-list initialization/matching, rather than adding
  more fonts or changing TLS.
- A fresh, read-only Chrome profile against the deployed port 4180 produced
  `screenshot-persistent-live-bing.png` and `cdp-persistent-live.log`: 54
  Bing URL references, three successful NSS certificate completion markers,
  zero `[user-module] WebAssembly runtime trap` and zero `RuntimeError:
  unreachable`. This checks the actual live artifact after deployment.
- The reviewable source changes are `web/linux/firefox-shims/mmap-shim.c`,
  `sys/mman.h`, `unwind-stubs.c`, and
  `web/linux/firefox-patches/0002` through `0004`. Patch `0003` plus the
  shim restores coherence for Firefox's shared-memory WebRender blob;
  patch `0004` loads trusted profile CAs when static Wasm lacks dynamic CKBI.
  It requires actual `lowland-ca-*` CA certificates in the SQL profile,
  checks CA status, and retains normal chain/hostname verification.
- To regenerate `/nss-ca-profile`, extract `etc/ssl/cert.pem` from the
  initramfs and run `python3 web/linux/firefox-shims/build-nss-ca-profile.py
  GUEST_CERT_PEM EMPTY_OUTPUT_DIR`. This imports the 119 PEM CAs using NSS
  `certutil` and rewrites `pkcs11.txt` for guest path
  `/home/admin/.mozilla/firefox/http1-profile`. Package `cert9.db`,
  `key4.db`, and `pkcs11.txt` as `/nss-ca-profile/*`; the guest `/init`
  copies them into the admin profile and uses HTTP/1.1 preferences.
- Build scratch and exact command captures are at
  `/mnt/p6/project/linux/.cache/gtk-icon-bypass-20260925/x11-detect/`:
  `compile-ca-command.txt`, `link-ca-command.txt`, `firefox-ca.list`,
  `firefox-ca-fpcast-named.wasm`, `package-bing-ca.py`, and
  `package-ca-fallback.py`. Link with Wasm ABI-matched libc++/libc++abi,
  16 MiB stack, 64 MiB initial memory; apply Binaryen
  `--all-features --disable-compact-imports --pass-arg=max-func-params@23
  --fpcast-emu` and validate with WABT and Node `WebAssembly.Module`.
  The candidate also contains scratch-only Wasm direct-X11 detection,
  optional icon-load skip, and GTK SVG-support fallback. Promote those
  source changes into reviewable patches before expecting a clean rebuild
  from tracked files alone. Rust trace hooks are diagnostic and should be
  removed or gated in a release build.

### 2026-09-25 TinyX evdev keyboard deployment (current live artifact)

- Live `web/linux/initramfs-firefox.cpio.gz` SHA-256 is now
  `e3b194e6c4c6aa144c4b57d3d06f3b9ee3d8c351bfba6284d9f9aa3423f363cc`
  (87,735,764 bytes). The previous working Firefox/Bing/X archive is preserved
  at `web/linux/initramfs-firefox.cpio.gz.backup-pre-evdev-keyboard-20260925`
  (SHA-256 `e274c8073fa1522356013dc25e540cfba956b7fbf39c7afede193fd53330b1c2`).
  The new archive replaces only CPIO member `bin/Xfbdev`, retaining the same
  Firefox, CA profile, init, fonts, and shared-memory repair. Port 4180 serves
  it with HTTP 200, matching `Content-Length`, `Cache-Control: no-store`, and
  COOP/COEP. URL: `http://127.0.0.1:4180/linux/index.html?firefox=1`.
- Cause: packed TinyX's `LinuxKeyboardRead` read K_MEDIUMRAW bytes from the VT
  fd, while the browser's virtio-input delivers EV_KEY records on
  `/dev/input/event0`. Host canvas keydowns and all virtio descriptors were
  already reaching the guest, but X/Firefox did not receive the keys. The
  deployed Xfbdev opens event0 nonblocking, converts its 16-byte records to
  the original KDrive keyboard path, and preserves the VT fallback.
- Fresh isolated Chrome QA on port 4181 loaded Bing, typed `x.com` in Firefox,
  and showed the X.com sign-in page with zero WebAssembly traps. Fresh live
  Chrome QA on port 4180 repeated the navigation by clicking the actual
  Firefox address field at `(570,211)`, Ctrl+A, typing `x.com`, and Enter;
  `screenshot-evdev-live-address-after.png` shows X.com. The live CDP log
  reports Firefox still running and zero Wasm traps/JS exceptions. QA logs
  and screenshots are in
  `/mnt/p6/project/linux/.cache/gtk-icon-bypass-20260925/x11-detect/`.
  The guest hvc0 console is log-heavy under current `MOZ_LOG`; prior hvc0
  typing was verified separately. This deployment fixes X/Firefox input.
- Canonical source patch:
  `tools/wasm/userspace/tinyx/0001-wasm-evdev-keyboard.patch`. Build provenance,
  exact WABT fallback commands, and the hash-guarded transform script are in
  `tools/wasm/userspace/tinyx/README.md` and
  `patch-packed-xfbdev-keyboard.py`. The full source rebuild could not run in
  this workspace because the Nix executable and target `libXfont.a` /
  `libfontenc.a` are absent; the deployed binary-specific transform was
  validated with `wasm-validate` and Node `WebAssembly.Module`. Do not apply
  it to any other Xfbdev build. The Firefox toolbar and some page text still
  render as tofu/hex boxes; font diagnosis remains separate.

### 2026-09-25 Firefox chrome-font deployment (current live artifact)

- Live `web/linux/initramfs-firefox.cpio.gz` SHA-256 is now
  `d117b9f45b51373558ef020f9d53455772455800cda0f03dd02455d397347e7e`
  (87,821,011 bytes). The keyboard-fixed no-font archive is preserved at
  `web/linux/initramfs-firefox.cpio.gz.backup-pre-userchrome-font-20260925`
  (SHA-256 `e3b194e6c4c6aa144c4b57d3d06f3b9ee3d8c351bfba6284d9f9aa3423f363cc`).
  Port 4180 serves the new archive with HTTP 200, matching `Content-Length`,
  `Cache-Control: no-store`, and COOP/COEP. The earlier pre-keyboard backup
  remains available as recorded above.
- Relative to the keyboard-fixed archive, CPIO changes exactly `/init` and
  adds `/lowland-OpenSans-Regular.ttf` and `/lowland-userChrome.css`. `/init`
  copies the TTF to `/opt/firefox/fonts/OpenSans-Regular.ttf`, installs the CSS
  in the admin Firefox profile `chrome/userChrome.css`, and enables
  `toolkit.legacyUserProfileCustomizations.stylesheets`. The font is outside
  Fontconfig's standard scan paths, so the earlier Fontconfig startup stall
  is avoided. CSS narrowly targets Firefox tabs, address bar, and toolbar
  text; a broad `:root` override was rejected in isolated testing because
  Bing/X timed out. The deployed CSS has no diagnostic green border.
- Fresh isolated and live Chrome profiles both showed readable tab/address
  text, Bing home, and typed navigation to the X.com sign-in page with zero
  `[user-module]` WebAssembly traps or JS exceptions. Live evidence is
  `screenshot-userchrome-live-before.png`,
  `screenshot-userchrome-live-confirm-after.png`,
  `cdp-userchrome-live.log`, and `cdp-userchrome-live-confirm.log` under
  `/mnt/p6/project/linux/.cache/gtk-icon-bypass-20260925/x11-detect/`.
  Click the actual Firefox address field around canvas coordinate `(570,211)`
  before Ctrl+A/type/Enter in CDP automation; `(350,205)` hits toolbar reload.
- Reviewable sources are `web/linux/firefox-shims/userChrome.css` and
  `web/linux/firefox-shims/package-userchrome-font.py`. Rebuild from the
  preserved keyboard archive with host
  `/usr/share/fonts/TTF/OpenSans-Regular.ttf` (font SHA-256
  `c53aceea2dcf5b4098099c0c4d0a061d17e178a049317b42a422b1a9f7f8eb59`):
  `python3 web/linux/firefox-shims/package-userchrome-font.py BASE_FONTLESS_ARCHIVE OPEN_SANS_TTF OUTPUT_ARCHIVE`.
  The script reproduces the deployed uncompressed CPIO byte-for-byte; gzip
  headers vary with output filename. This fixes Firefox chrome text only;
  website font coverage and long-run stability still need separate checks.
