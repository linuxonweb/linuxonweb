# GNU stat-family compilation on native Wasm — 2026-10-02

The isolated `/mnt/p6/build/glibc-stat-20261002` packet builds nine genuine
GNU make targets and eight public function/type references. It closes the two
original `fstatat64.o` and `fxstat64.o` compile failures by selecting GNU's
existing statx conversion route through an owned architecture overlay.
**Public runtime behavior remains unaccepted.**

The kernel's legacy stat64 structure is104 bytes; GNU's actual public time64
stat/stat64 structures are128 bytes. A real pinned kernel statx implementation
exists at Linux syscall291. Owned kernel_stat.h includes GNU's original header,
marks those kernel/public structures as different, and removes legacy fstat64
selectors only inside the stat translation units. Owned statx_cp.c includes
the unchanged GNU converter. The architecture kernel-features.h selects the
real statx capability; public raw syscall numbers remain unchanged elsewhere.

Actual GNU make builds stat64, lstat64, fstat64, fstatat64, statx_cp, xstat64,
lxstat64, fxstat64 and fxstatat64. All outputs validate as Wasm. Upstream GNU
source bytes match the pristine signed release, including both original failed
source snapshots. Raw frontend IR for the five implementation units calls291;
ordinary stat wrappers call the genuine fstatat64 provider. Strong internal and
weak public stat/stat64 aliases have identical function addresses.

Independent genuine-header assertions verify wasm32 pointers/long,64-bit
time_t/off_t,128-byte public structures,256-byte statx,64-bit seconds/file sizes
and eight exact public function pointer types. The input audit records290
actual source/header/object/dependency/IR inputs and verifies their bytes.
The three supervised prepare/build/signature groups exited0 and are empty.

The first supervisor launch failed before a child because its logs directory
was absent; stdout/stderr are retained. A first ad-hoc signature helper failed
before compilation in path handling; its helper text was not saved. The owned
corrected replay preserves exact argv/output. Frozen compiler originalArgs is
normalized frontend input rather than raw GNU argv; the signature replay
restores -c explicitly. Actual stage commands and GNU make logs are retained.

The freeze captures this packet,12 exact repository paths, actual compile
inputs,144 independently verified borrowed tools, the private compiler's
immutable source/archive lineage, signed GNU source/archive, reused runtime
object provenance and the pinned kernel. It excludes unrelated mutable agent
trees. Supervisor output and terminal proof are kept outside the packet.
The repository freeze precedes a scoped local checkpoint; no push/deploy.

Real native and FPCAST guest acceptance belongs to a separate stat-runtime
task. It must close genuine __gnu_dev_makedev, compare actual output fields
with raw statx, check canaries/errno, links/symlinks/dirfds/errors and beyond2038
timestamps with nonzero nanoseconds while retaining all earlier runtime
regressions. This compile packet establishes neither a completed libc/sysroot
nor Nightly/JIT/GPU acceptance. See [the plan](glibc-stat-plan-20261002.md).
