GNU glibc 2.44 native Wasm warning metadata and sigaltstack routing

The owned early LLVM IR adapter preserves the exact selected GNU warning
assembly and constant text as native Wasm custom sections. GNU source bytes
remain unchanged. Empty .gnu.glibc-stub.NAME sections remain present, so the
original GNU Makerules recipe and llvm-objdump generate the actual __stub_*
header entries. Dangerous-function warnings and static-link warnings remain
distinct from ENOSYS stub markers. Metadata retention does not enforce linker
warnings; that diagnostic behavior remains unsupported.

The adapter accepts only audited paired GNU .section/.previous patterns and
the matching internal constant referenced solely by llvm.used. It preserves
unrelated llvm.used entries and rejects unknown assembly, missing warning text
and runtime references to warning constants. The driver emits unoptimized
textual LLVM IR before assembly validation, translates markers, invokes frozen
GNU jump lowering, then opt O2 and llc native Wasm EH. Failed commands and IR
remain owned task artifacts; successful warning units retain unique attempts.
This diagnostic driver has not accepted general optimization/PIC/LTO/debug,
assembly, C++ or dependency-file behavior for a production GNU toolchain.

Set GLIBC_TASK to a NEW ext4 owned task, GLIBC_TOOLCHAIN to LLVM 22.1.8,
GLIBC_KERNEL_HEADERS to retained Linux/Wasm UAPI, GNU_RELEASE_ARCHIVE to the
pinned signed GNU 2.44 archive, and GLIBC_CHROMIUM to an installed Chromium.
env.sh sets TMPDIR/TMP/TEMP/caches and enforces a stricter 2 GiB task cap,
8 GiB launch reserve, 5 GiB hard stop. Builds use at most -j2.

```sh
bash tools/glibc/fullmake/replay.sh
source tools/glibc/env.sh
python3 tools/glibc/jumps/package.py "$TASK/objects/fullmake-warnings.wasm" native-package
node tools/glibc/fullmake/run-guest.mjs jit "$TASK/guest-native-run1" "$TASK/native-package"
wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$TASK/objects/fullmake-warnings.wasm" -o "$TASK/objects/fullmake-warnings-fpcast.wasm"
wasm-validate --enable-all "$TASK/objects/fullmake-warnings-fpcast.wasm"
python3 tools/glibc/jumps/package.py "$TASK/objects/fullmake-warnings-fpcast.wasm" fpcast-package
node tools/glibc/fullmake/run-guest.mjs jit "$TASK/guest-fpcast-run1" "$TASK/fpcast-package"
python3 tools/glibc/fullmake/audit.py
bash tools/glibc/syscalls/dependencies.sh
"${GLIBC_HOST_CXX:-/usr/bin/g++}" tools/glibc/fullmake/warnings.cpp $("$TOOLCHAIN/bin/llvm-config" --cxxflags) -M -MF "$TASK/logs/full-dependencies-complete/host-warnings.d"
```

replay.sh explicitly expects the current genuine full-make failure at
dlmopen's __builtin_return_address. It retains the failed module and commands.
test-metadata.py emits a clearly labeled metadata-only inspection object from
that module; it contains no dlmopen runtime functions. GNU Makerules uses this
inspection object alongside genuine compiled revoke, sigreturn and sigstack.

The new exact GNU sigaltstack signature uses the selected Linux stack_t:
size12/alignment4, ss_sp0/ss_flags4/ss_size8. The real kernel returns ENOSYS
without memory access. Both aliases, null/invalid pointers and unchanged
output memory are tested; there is no alternate-stack support. Genuine GNU
revoke and sigreturn stubs retain ENOSYS behavior. Linux sigstack retains its
conversion and actual sigaltstack failure. The prior bounded malloc, abort,
time64, concurrent locks, native jumps and 17 generated GNU wrappers remain
linked. Three private close conventions remain fixture probes, not public GNU
cancellable close acceptance.

Startup still uses fixed fixture reservations and a single GNU arena policy;
the old rootfs launcher is outside the GNU payload closure. Manual GNU cleanup
chains do not establish pthread creation/cancellation or C++ cleanup. Full
libc.a, installed sysroot, GNU CRT/NPTL/loader, Nightly, JIT and GPU remain
incomplete. No musl/WASI library or unresolved-symbol suppression is linked.
