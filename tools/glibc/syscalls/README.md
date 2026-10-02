GNU glibc 2.44 generated syscall backend for native Wasm/Linux

The GNU generator, selected syscall lists, public types, weak aliases and hidden
macros remain unchanged. The owned Linux/wasm32 syscall-template.S is C source;
the architecture Makefile compiles the genuine generator stdin as C through
the bounded jump compiler driver. Each accepted name has an explicit GNU C
signature and kernel number. The regular convention sets GNU errno on failure;
NOERRNO preserves the raw result, and ERRVAL returns positive errno. Success
preserves errno in all three. There is no missing-call or layout fallback.

Set GLIBC_TASK to a NEW ext4-backed owned directory, GLIBC_TOOLCHAIN to the
pinned LLVM 22 tree, GLIBC_KERNEL_HEADERS to the retained Linux/Wasm UAPI,
GNU_RELEASE_ARCHIVE to the signed pinned GNU 2.44 archive, and GLIBC_CHROMIUM
to an installed Chromium. TMPDIR/TMP/TEMP/caches are set by env.sh.

```sh
bash tools/glibc/syscalls/replay.sh
source tools/glibc/env.sh
python3 tools/glibc/jumps/package.py "$TASK/objects/generated-syscalls.wasm" native-package
node tools/glibc/syscalls/run-guest.mjs jit "$TASK/guest-native-run1" "$TASK/native-package"
wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$TASK/objects/generated-syscalls.wasm" -o "$TASK/objects/generated-syscalls-fpcast.wasm"
wasm-validate --enable-all "$TASK/objects/generated-syscalls-fpcast.wasm"
python3 tools/glibc/jumps/package.py "$TASK/objects/generated-syscalls-fpcast.wasm" fpcast-package
node tools/glibc/syscalls/run-guest.mjs jit "$TASK/guest-fpcast-run1" "$TASK/fpcast-package"
bash tools/glibc/syscalls/audit.sh
bash tools/glibc/syscalls/dependencies.sh
timeout 90s make -C "$TASK/objects/fullmake" -j2 lib > "$TASK/logs/fullmake-lib.log" 2>&1
```

The replay selects 17 actual GNU generated streams. Private close template
instantiations test regular/NOERRNO/ERRVAL conventions; they are not the selected
GNU public cancellable close implementation. File opening/closing uses genuine
GNU nocancel functions; the file-read fixture calls the actual kernel directly.
The guest retains the bounded allocator, abort, time64 and native-jump gates.
Startup uses static fixture reservations and a single GNU arena test policy;
it is not general CRT or NPTL. The old rootfs launcher is outside the GNU payload
closure. No musl/WASI archive or unresolved-symbol suppression is linked.

This is partial static architecture support. The whitelist is a hard incomplete
boundary: i64/off64/time64, structure-layout conversions, clone and cancellation
need audited architecture implementations, not six generic i32 arguments.
The 19-name template includes two additional signatures (close and renameat)
beyond the 17 selected streams; renameat is not selected or runtime-accepted.
The frozen jump compiler driver forces LLVM O2 and remains diagnostic, with
unvalidated PIC/LTO/debug/dependency/assembly flag combinations. Full make still
fails on unaudited sigaltstack and GNU ELF warning-section directives. GNU stubs
must retain their unsupported behavior and cannot establish runtime acceptance.
No complete libc archive, sysroot, Nightly, JIT, GPU or release is claimed.
