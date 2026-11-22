/* Owned GNU architecture selection: the retained kernel's legacy 104-byte
   stat64 is not GNU's 128-byte time64 structure. Use genuine GNU statx
   conversion paths; raw public syscall constants stay unchanged elsewhere. */
#ifndef GNU_WASM_NATIVE_STAT_SELECTION_H
#define GNU_WASM_NATIVE_STAT_SELECTION_H
#include <sysdep.h>
#include_next <kernel_stat.h>
#undef STAT_IS_KERNEL_STAT
#define STAT_IS_KERNEL_STAT 0
#undef __NR_fstat64
#undef __NR_fstatat64
#endif
