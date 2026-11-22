# Independent GNU stat conversion controls — 2026-10-02

Actual GNU stat/stat64, lstat/lstat64, fstat/fstat64 and fstatat/fstatat64 pass
**10,308 assertions** across native and FPCAST23i64 Wasm modules. Volatile
genuine public function pointers force real table dispatch. The Linux statx
transport alone is synthetic; these results do not establish real guest
filesystem behavior or a completed GNU sysroot.

The independent JS fixture encodes256-byte statx data using Linux UAPI offsets.
It supplies inode values beyond32 bits, file sizes beyond4GiB,64-bit block counts,
timestamps beyond2038 and before1900 with nonzero nanoseconds, and boundary
Linux device numbers. The genuine GNU conversion produces the expected128-byte
public structures, with leading/trailing canaries intact and errno preserved.
ENOENT/EINVAL/ENOSYS retain the original output bytes and set genuine GNU errno.
Negative fstat descriptors return EBADF without invoking the synthetic kernel.

The probe links15 actual objects: nine immutable GNU stat-family units, eight
public header/reference checks, unchanged GNU errno/errno-location/memset,
genuine GNU-make makedev and one owned C caller. Upstream makedev bytes match
the pristine GNU source. No missing APIs or symbols are synthesized. The sole
import is linux.syscall; TLS uses the actual linker metadata and GNU errno.
Both finite build and test groups exited0 with no owned members remaining.

Evidence is in `/mnt/p6/build/glibc-stat-host-20261002`. Executed caller/build/
test source versions, GNU compiler-stage argv, real makedev source/attempt,
linked input copies, final module hashes and result bytes are retained. The
freeze includes the complete immutable stat provenance and independently pins
the next26 compiler driver used for the new probe. A scoped local checkpoint
is separate from deployment. Real guest stat/time64/dirfd/symlink/error gates
remain required under the isolated stat-runtime task.
