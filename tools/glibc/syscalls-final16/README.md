# GNU glibc 2.44 generated final16 packet

Owned GNU wasm32 architecture extension, without musl/WASI linkage or kernel/provider changes. The exact original GNU generator streams compile through actual GNUmake targets and the private accepted native C-EH pipeline. Public GNU declarations remain pristine. Runtime inputs combine verified frozen stat203 and sched201 lineages: 190 common non-startup objects are identical, and 10 unique scheduler/semaphore additions produce a 213-object base. Final linkage uses 231 genuine GNU/owned objects and only native Linux transport plus shared memory.

`layout.sh` independently compiles GNU and kernel UAPI types before wrapper builds. Exact immediate canaries surround uname390, sysinfo64, and epoll_event16 storage. Public volatile function pointers execute uname/sysinfo/epoll_ctl with independent raw syscall observations. Epoll readiness changes after ADD/write/MOD/read/DEL, preserving high 64-bit data and input bytes. Thirteen actual kernel ENOSYS implementations retain GNU -1/errno semantics and leave output, iovec and allocated payloads unchanged. Concurrent users preserve actual GNU errno isolation. Every prior stat, scheduler, semaphore, isolated process, allocator, TLS, C cleanup, signal/abort and syscall gate remains required.

All host temp/cache/browser/profile files remain under `$GLIBC_TASK` on ext4. Configure `GLIBC_TOOLCHAIN`, `GLIBC_KERNEL_HEADERS`, `GNU_RELEASE_ARCHIVE`, `GLIBC_LLVM_SOURCE`, `GLIBC_INVENTORY_PACKET`, `GLIBC_CHROMIUM`, and frozen predecessor variables from `env.sh`. Use finite `supervise.py` bounds, -j2, 2 GiB task limit, 8 GiB reserve and 5 GiB hard stop.

Reproduction order (unique supervision labels and fresh task):

```sh
python3 tools/glibc/syscalls-final16/supervise.py prepare 600 bash tools/glibc/syscalls-final16/prepare.sh
python3 tools/glibc/syscalls-final16/supervise.py layout 120 bash tools/glibc/syscalls-final16/layout.sh
python3 tools/glibc/syscalls-final16/supervise.py wrappers 300 bash tools/glibc/syscalls-final16/build-wrappers.sh
python3 tools/glibc/syscalls-final16/supervise.py make 300 python3 tools/glibc/syscalls-final16/build-make.py
python3 tools/glibc/syscalls-final16/audit-wrappers.py
python3 tools/glibc/syscalls-final16/supervise.py runtime 300 bash tools/glibc/syscalls-final16/build-runtime.sh
python3 tools/glibc/syscalls-final16/supervise.py package 150 bash tools/glibc/syscalls-final16/build-guest.sh
python3 tools/glibc/syscalls-final16/supervise.py native 180 node tools/glibc/syscalls-final16/run-guest.mjs jit "$GLIBC_TASK/native-run2" "$GLIBC_TASK/native-package-initial"
python3 tools/glibc/syscalls-final16/supervise.py fpcast 180 node tools/glibc/syscalls-final16/run-guest.mjs jit "$GLIBC_TASK/fpcast-run2" "$GLIBC_TASK/fpcast-package-initial"
```

`registry.py` constructed the checked-in template/types once from pinned planner evidence; it is not a replay build step. `audit.py` pins the historical run2 module and paths from this packet; a fresh replay should use its initial link input/ABI paths. `recompile-startup.sh LABEL` preserves earlier module/object/package versions after an owned startup correction.

The retained first run failed134 because the owned fixture allocated before provider/init/tunables/malloc startup. Its original module/package and executed source snapshots remain retained. The corrected overlay runs after genuine initialization. Unsupported memory protection/pkeys/quota/file handles remain unsupported; mprotect/madvise collisions stay deferred. Raw epoll_pwait has a NULL signal mask and supplies observation only. No public cancellation wait, complete libc/sysroot, default NPTL, forced unwind, C++, Nightly, JIT or GPU acceptance is claimed.
