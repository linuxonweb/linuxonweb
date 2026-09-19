# Out-of-tree Linux `arch/wasm` skeleton

This directory contains an experimental, source-preserving architecture
overlay. `linux-arch-wasm.patch` adds the smallest kbuild/Kconfig entry point
needed for `ARCH=wasm`; it does not implement boot, interrupts, virtual
memory, context switching, system calls, or browser devices. It must never be
applied to the tracked `sources/linux` checkout.

Run the probe from the repository root:

```sh
ports/linux-arch-wasm/build-probe.sh
```

The script creates a temporary detached worktree, applies the patch there, and
runs `make O=... ARCH=wasm olddefconfig`. A successful kconfig pass only means
that Linux recognized `arch/wasm`; the subsequent compile probe intentionally
stops at the first missing architecture dependency. With the temporary
`CLANG_TARGET_FLAGS_wasm := wasm32-unknown-unknown` overlay and the minimal
little-endian UAPI `byteorder.h`, placeholder `ptrace.h`, and placeholder
`sigcontext.h` mappings, UAPI generation completes. The overlay keeps the
`scripts/mod/empty.o` metadata sample native (matching `HOSTCC`) so the host
`mk_elfconfig` tool can consume ELF metadata while kernel objects remain
wasm32. The `asm/string.h` mapping lets device-table offsets and time constants
generate. `GENERIC_ATOMIC64` and the `asm/atomic.h` wrapper reuse Linux's
lock-based atomic64 ABI without requiring wasm compiler atomics. Bounds
generation now succeeds after the minimal `arch/wasm/kernel/asm-offsets.c`
emitter, scheduler-facing `asm/thread_info.h`, and a minimal `asm/processor.h`
CPU-state placeholder, and a generic cache geometry wrapper are added. The
next blocker is `fatal error: 'asm/page.h' file not found` while generating
scheduler offsets (`kernel/sched/rq-offsets.s`). Atomic64 runtime correctness is not proven:
interrupt hooks remain no-ops and no kernel has been linked or booted.

The native `empty.o` workaround is only a probe bypass: `mk_elfconfig` was
already native, and its original `Error: not ELF` referred to the wasm input.
The workaround yields host-sized ELF metadata, not valid wasm32 metadata;
modpost/object-format support remains a required port task.

The standalone C probe uses the same `wasm32-unknown-unknown` freestanding
target as the browser adapter and only validates that the compiler can emit a
host-importing wasm function. It is not a Linux kernel boot test.
