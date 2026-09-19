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
`sigcontext.h` mappings, UAPI generation completes. The current expected
compile result is `Error: not ELF` while the host-side `scripts/mod/mk_elfconfig`
tool is executed; applying the wasm target globally has not yet separated host
tools from wasm kernel objects. The architecture compiler/ABI contract remains
undefined, which is evidence that the skeleton is not a kernel port.

The standalone C probe uses the same `wasm32-unknown-unknown` freestanding
target as the browser adapter and only validates that the compiler can emit a
host-importing wasm function. It is not a Linux kernel boot test.
