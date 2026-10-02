# GNU native Wasm: five audited wrappers

This packet closes five genuine GNU make targets and exercises their bounded
semantics in real native and FPCAST23i64 Linux guests. It does not build a
complete libc archive or accept full NPTL or Nightly. Read the scope and
retained failures in [the report](../../../docs/glibc-syscalls-last5-20261002.md).

Use a new ext4 `/mnt/p6/build/<task>` with task-local temporary files/caches.
Set `GLIBC_TASK`, `GLIBC_TOOLCHAIN`, `GLIBC_KERNEL_HEADERS`,
`GNU_RELEASE_ARCHIVE`, `GLIBC_LLVM_SOURCE`, `GLIBC_CHROMIUM`,
`GLIBC_INVENTORY_PACKET`, `GLIBC_C_CLEANUP_PACKET`, `GLIBC_FENV_PACKET`,
`GLIBC_FIXED_PACKET`, `GLIBC_NEXT26_PACKET`, `GLIBC_STAT_PACKET`,
`GLIBC_STAT_RUNTIME_PACKET`, `GLIBC_CUMULATIVE_PACKET` and
`GLIBC_CHECKED_RUNTIME_PACKET` to the signed release/toolchain and immutable
packets. The runtime reuse helper verifies the checked-jump manifest and every
selected original/snapshot pair before copying. No target musl or WASI files
are used. The inherited environment enforces a 2 GiB task limit, 8 GiB launch
reserve and 5 GiB stop reserve.

Run from the repository root, sourcing the configuration in each shell:

```sh
ROOT=tools/glibc/syscalls-last5
source "$ROOT/env.sh"
python3 "$ROOT/supervise.py" prepare 240 bash "$ROOT/prepare.sh"
python3 "$ROOT/overlay.py"
python3 "$ROOT/select-generated.py"
python3 "$ROOT/supervise.py" layouts 120 bash "$ROOT/layout.sh"
python3 "$ROOT/supervise.py" make 120 python3 "$ROOT/build-make.py" replay1
python3 "$ROOT/supervise.py" runtime 180 bash "$ROOT/build-runtime.sh"
python3 "$ROOT/supervise.py" guest-build 120 bash "$ROOT/build-guest.sh" "$GLIBC_TASK/objects/last5.wasm" replay1
python3 "$ROOT/supervise.py" native 240 node "$ROOT/run-guest.mjs" jit "$GLIBC_TASK/native-run1" "$GLIBC_TASK/native-replay1-package"
python3 "$ROOT/supervise.py" fpcast 240 node "$ROOT/run-guest.mjs" jit "$GLIBC_TASK/fpcast-run1" "$GLIBC_TASK/fpcast-replay1-package"
```

`public-flags.sh` uses real GNU public headers, without global `_ISOMAC`.
`compile-syscall.py` preserves exact GNU generator streams, selected template
bytes and driver versions. `last5-signal.h` marshals only the three measured
pidfd siginfo classes. `compiler.py` is a bounded C diagnostic driver with
query passthrough and an O2 native Wasm pipeline, not a production C++/LTO
compiler driver. `layout-dependencies.py` and `audit-wrappers.py` audit actual
dependency bytes, signatures, bindings and addresses.

The accepted packet contains historical attempt-specific module names,
packages and result directories. `audit-results.py` intentionally audits
those exact accepted paths (`last5-attempt2`, native2 and fpcast1); a fresh
replay must supply a separately reviewed audit for its new result paths.
`link.sh` is a unique-destination relink helper for retained objects, not
permission to overwrite accepted artifacts. Failed command/source/IR
records remain in the owned task. The first absent-configparms helper's
original bytes were unavailable; the report retains that limitation.

Freezing is a separate reviewed operation. `freeze.py` requires explicit
authorization, uses `GLIBC_LAST5_PACKET` for the completed packet and runs
through an external supervision workspace. Its own output and terminal
proof must remain outside the immutable task. Repository pins include only
this directory and the scoped report. No Git or deployment operation is
part of these scripts.
