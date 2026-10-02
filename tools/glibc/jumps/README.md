GNU glibc 2.44 native Wasm signal jumps

This extends the bounded static GNU runtime foundation. It is a direct-call
compiler contract, not an independently callable setjmp function: LLVM 22
lowers setjmp inside its caller using native Wasm EH. The adapter invokes
unchanged GNU __sigjmp_save first, records linear SP/thread owner, and preserves
the mask flag in LLVM's helper. Genuine GNU longjmp/checked-longjmp restore
masks and invoke actual NPTL pthread_cleanup_upto before the architecture throw.
Public longjmp declarations, including function pointers, target GNU handling.
Indirect/escaping setjmp and direct InvokeInst setjmp are rejected explicitly.

With the parent env.sh requirements set and a fresh disk-backed GLIBC_TASK:

```sh
source tools/glibc/env.sh
bash tools/glibc/replay-source.sh "$GNU_RELEASE_ARCHIVE"
bash tools/glibc/probes/configure-port.sh
bash tools/glibc/probes/generate-metadata.sh
python3 tools/glibc/jumps/prepare.py
bash tools/glibc/build.sh guest
bash tools/glibc/jumps/build.sh
bash tools/glibc/prepare-guest.sh
python3 tools/glibc/jumps/package.py "$GLIBC_TASK/objects/jumps.wasm" native-package
node tools/glibc/jumps/run-guest.mjs jit "$GLIBC_TASK/guest-native" "$GLIBC_TASK/native-package"
wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$GLIBC_TASK/objects/jumps.wasm" -o "$GLIBC_TASK/objects/jumps-fpcast.wasm"
python3 tools/glibc/jumps/package.py "$GLIBC_TASK/objects/jumps-fpcast.wasm" fpcast-package
node tools/glibc/jumps/run-guest.mjs jit "$GLIBC_TASK/guest-fpcast" "$GLIBC_TASK/fpcast-package"
```

Set GLIBC_CHROMIUM to an installed Chromium executable. Build uses a GNU-compatible
host C++ compiler (/usr/bin/g++ default) plus the pinned LLVM headers/static
libraries; this host tool is an IR adapter, not the guest libc. The guest payload
uses genuine GNU source and owned Wasm providers, with no musl/WASI or cancellation
stub. See the dated report for precise gate paths and failures.

The new backend/jmp_buf sizes are 24/156 bytes, alignment4, and differ from the
foundation ABI. All clients/dependencies must rebuild coherently. Fortify checks
known linear-stack bounds, downward direction and owner; it cannot detect every
stale invocation, corruption, or inaccessible guard page. Tests exercise manual
GNU cleanup chains, not pthread creation/cancellation or C++ destructors. No jump
crosses a live kernel signal callback. The static startup remains a bounded fixture,
with real linker main-stack bounds and explicit child bounds, not general CRT.

fullmake-overlay.py supplies architecture source markers for compiler-only saves,
excludes invalid generic returning wrappers, and installs genuine backend/tag code.
compiler.py is a diagnostic GNU make driver: it forces LLVM O2 and does not validate
all PIC/LTO/debug/assembly/optimization/dependency or Nightly flag combinations.
Apply only in a fresh owned source tree, configure with this driver, and use bounded
make -j2 lib. A completed setjmp subdir is not a complete libc archive or sysroot.
