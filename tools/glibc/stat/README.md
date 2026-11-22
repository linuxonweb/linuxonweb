The retained kernel has a 104-byte legacy stat64 ABI, distinct from GNU's
128-byte public time64 stat. This architecture selection routes unchanged GNU
stat/fstat/lstat/fstatat and historical xstat wrappers through real statx291 and
the genuine GNU converters. Public raw syscall constants remain visible;
only GNU stat translation units select the safe statx branch. The architecture
statx_cp.c wrapper includes the actual unchanged GNU implementation.

Source the new task config, run prepare.sh through the frozen finite supervisor,
then build.py. All outputs/temp/cache must stay below the new disk-backed task.
Preserve frozen tools/source trees and all failed attempts. Successful selected
objects do not prove a full GNU sysroot or runtime stat semantics. Real native
and FPCAST guest field, canary, symlink, fd and time64 tests remain required.
