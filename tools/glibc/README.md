This directory carries the owned GNU glibc 2.44 Wasm/Linux architecture patch and a reproducible, curated static implementation closure. The GNU allocator, tunables, errno, low-level locks, abort, diagnostics, signal functions and clock/futex helpers are compiled from 80 unchanged GNU source units. It is an incomplete architecture port; it does not install a usable GNU sysroot or produce accepted `libc.a`.

The combined packet passes 370 host assertions, 48,263 native guest assertions and 48,275 FPCAST23i64 guest assertions, all with zero failures. The two guest forms execute concurrent allocation using genuine GNU locks, separate GNU descriptors/DTV/compiler TLS and the retained Linux kernel. Each also exercises narrow real signal/time64 behavior and launches five separate actual GNU abort/fatal processes, each exiting 134. Evidence and the full build boundary are described in [the integration report](../../docs/glibc-port-integration-20261002.md).

Supply the exact GNU archive recorded in [source-provenance.json](source-provenance.json), a raw LLVM 22.1.8 toolchain and retained Linux/Wasm UAPI headers. The bootstrap independently checked the GNU release signature; replay verifies the exact signed archive's pinned SHA-256. No predecessor packet directories are needed at runtime. GNU source is extracted into a new owned directory, patched without fuzz, and all 80 implementation bytes are rechecked against [gnu-unit-provenance.json](gnu-unit-provenance.json). Empty `sysdeps/unix/sysv/linux/wasm32/Implies` is deliberately recreated. All source/build/scratch/cache/test paths are disk-backed; launch reserve is 8 GiB, hard stop 5 GiB, task budget 2 GiB. Compilation is sequential; the diagnostic GNU make uses at most two jobs.

```sh
export GLIBC_TASK=/mnt/p6/build/NEW-glibc-packet
export GLIBC_TOOLCHAIN=/path/to/raw/llvm-22.1.8
export GLIBC_KERNEL_HEADERS=/path/to/retained/linux-wasm/include
# Optional when invoking from a separate checkout:
export GLIBC_REPO=/path/to/linuxonweb
source tools/glibc/env.sh
bash tools/glibc/replay-source.sh /path/to/glibc-2.44.tar.xz
bash tools/glibc/probes/configure-port.sh
bash tools/glibc/probes/generate-metadata.sh
bash tools/glibc/build.sh host
node tools/glibc/probes/allocator-host.cjs
bash tools/glibc/build.sh guest
bash tools/glibc/probes/build-fpcast.sh
bash tools/glibc/prepare-guest.sh
python3 tools/glibc/package.py "$TASK/objects/allocator.wasm" native-package
export GLIBC_CHROMIUM=/path/to/chromium
# Optional free, task-owned ports (defaults 4202/9412):
export GLIBC_HTTP_PORT=4202 GLIBC_CDP_PORT=9412
node tools/glibc/run-guest.mjs jit "$TASK/native-run" "$TASK/native-package"
python3 tools/glibc/package.py "$TASK/objects/allocator-fpcast.wasm" fpcast-package
node tools/glibc/run-guest.mjs jit "$TASK/fpcast-run" "$TASK/fpcast-package"
# Expected nonzero: complete GNU library boundary, retained rather than bypassed.
bash tools/glibc/diagnose-make.sh
```

Use a new task for replay/build; sources, object directories and guest packages/results refuse replacement. Configure and metadata scripts are setup steps, not full-library acceptance. `build.sh` links `allocator.wasm` directly without archives, abort wrapping, cancellation substitutes or unresolved-symbol suppression. It deliberately exports the genuine cancellable futex helper in a separate negative link: that link must fail specifically on `__internal_syscall_cancel`. ThinLTO removes only the unused cancellation branch from the genuinely noncancellable GNU helper. `jit`/`GUEST_JIT` names in the inherited guest harness are parser labels and make no JIT claim.

The startup code is an owned fixture with fixed reservations for three descriptors/DTVs/TLS images and two child stacks. It is not general GNU CRT, ELF startup/loader, `pthread_create/join`, cancellation, robust-list/rseq, TSD destructors or NPTL lifecycle. The single-arena/tcache-disabled perturb policy comes from actual `GLIBC_TUNABLES` in the isolated init command and is an explicit test policy. Production must implement secondary-arena protection or adopt a separately reviewed single-arena policy. The nonrecursive memory provider performs shared Wasm growth and logical range reuse; it cannot supply hardware protection, negative sbrk or guard pages.

GNU public signal actions are converted to the actual kernel layout. Siginfo callbacks receive NULL context because the kernel has no native register/ucontext frame. Altstack and user-requested SA_RESTORER fail explicitly; nonlocal escape through live callbacks, async signal delivery during pure computation and broad timed synchronization remain unsupported. The time64 override asserts only the actual retained kernel's 403/422 capability. GNU `make lib` currently reaches the generic `__sigsetjmp` stub and fails on ELF assembly directives; that stub's ENOSYS body is also unacceptable. Genuine architecture jump/signal-mask/cancellation unwind is required next.

Guest packaging preserves the baseline plain rootfs records except isolated `/init` commands and the added probe. Existing launcher/rootfs utilities remain outside the new GNU payload closure. `prepare-guest.sh` applies a small test-only worker patch in the task, preserving the production worker; it excludes the old user_desc TLS adapter for the probe's explicit raw-TP marker and observes allocator futex outcomes without replacing kernel calls. This adapter selection is not production acceptance. Known-good releases remain untouched.

For a final audit of the reference directory layout (`guest-native-run1`, `guest-fpcast-run1`, `native-package-run1`, `fpcast-package-run1`), place the reviewed `acceptance.json` in the task and run `python3 tools/glibc/freeze-inputs.py` after documentation is final. It refuses an existing manifest. Invoke without redirecting stdout into its own snapshotted logs directory; the small returned manifest hash is audit metadata.
