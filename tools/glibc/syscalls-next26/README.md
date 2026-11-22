# GNU Wasm next 26 fixed syscall wrappers

This packet adds 26 exact GNU-generated wrappers to the preceding 53-wrapper
runtime. It preserves GNU public prototypes, strong implementation symbols,
public weak aliases, genuine errno, and generated stream bytes. Four selected
kernel facilities (`swapoff`, `swapon`, `acct`, `fanotify_init`) return ENOSYS.
The accepted native/FPCAST gates pass 48,554/0 and 48,567/0.

The runtime exercises public function pointers, errno isolation, filesystem IDs
and priorities, hostname/domain restoration, a real tgkill signal callback,
pidfd sharing, configured-source ramfs mounts, isolated setsid/chroot, and public
execve into fresh GNU argv/environment/TLS/constructors. The existing startup,
allocator, signal/abort, jump, C cleanup/once and fixed-rounding suites remain.
Raw fixture I/O, uname, priority queries and unmount are clearly identified in
`fixture.c`. The retained rootfs setsid/shell launcher is outside the new GNU
payload closure. Public cancellable close and full NPTL remain unaccepted.

The first native/FPCAST payloads exposed a real kernel bug: a modern mount with
NULL/default source assigns a static `"none"` string, but Wasm
`is_kernel_rodata` always returns false and delayed mount cleanup frees it.
Both warning-bearing runs are retained and unaccepted. The accepted gate uses
the genuine `fsconfig(FSCONFIG_SET_STRING, "source", "gnu-next26", 0)` option;
default-source mount compatibility remains incomplete. No warning is suppressed.

Replay into a new task with `GLIBC_TASK`, `GLIBC_TOOLCHAIN`,
`GLIBC_KERNEL_HEADERS`, `GNU_RELEASE_ARCHIVE`, `GLIBC_LLVM_SOURCE`,
`GLIBC_INVENTORY_PACKET`, `GLIBC_C_CLEANUP_PACKET`, `GLIBC_FENV_PACKET`,
`GLIBC_FIXED_PACKET`, and `GLIBC_CHROMIUM` set to independently verified inputs.
All temporaries/caches/profiles use the task on disk. The supervisor checks the
2 GiB task cap, 8 GiB launch reserve, 5 GiB terminal reserve and owned PGIDs.

```sh
source tools/glibc/syscalls-next26/env.sh
python3 tools/glibc/syscalls-next26/supervise.py prepare 600 bash tools/glibc/syscalls-next26/prepare.sh
python3 tools/glibc/syscalls-next26/supervise.py wrappers 300 bash tools/glibc/syscalls-next26/build-wrappers.sh
python3 tools/glibc/syscalls-next26/audit-wrappers.py
python3 tools/glibc/syscalls-next26/build-make.py
python3 tools/glibc/syscalls-next26/supervise.py runtime 120 bash tools/glibc/syscalls-next26/build-runtime.sh
python3 tools/glibc/syscalls-next26/supervise.py package 180 bash tools/glibc/syscalls-next26/build-guest.sh "$GLIBC_TASK/objects/next26.wasm" initial
GLIBC_HTTP_PORT=4202 GLIBC_CDP_PORT=9412 python3 tools/glibc/syscalls-next26/supervise.py native 180 node tools/glibc/syscalls-next26/run-guest.mjs jit "$GLIBC_TASK/native-run" "$GLIBC_TASK/native-package-initial"
GLIBC_HTTP_PORT=4202 GLIBC_CDP_PORT=9412 python3 tools/glibc/syscalls-next26/supervise.py fpcast 180 node tools/glibc/syscalls-next26/run-guest.mjs jit "$GLIBC_TASK/fpcast-run" "$GLIBC_TASK/fpcast-package-initial"
python3 tools/glibc/syscalls-next26/audit-results.py --label initial --native-run native-run --fpcast-run fpcast-run
```

`recompile-runtime.sh UNIQUE_LABEL fixture|startup` compiles only that owned
input and relinks to unique task-local output/map/cache directories, preserving
the previous objects. The accepted historical attempt4 uses this route after
the source-option correction. Logs retain exact initial driver source versions,
the failed stream selection, missing-header/missing-public-mask link attempts,
and both warning-bearing guest runs.

The bounded C-only compiler driver forces O2 and is a diagnostic build driver.
It is not acceptance of all production compiler flags, GNU libc.a/ELF CRT,
static/dynamic loader APIs, NPTL forced unwind/C++ cancellation, a coherent
Firefox sysroot, Nightly, JIT, GPU or Sites deployment.
