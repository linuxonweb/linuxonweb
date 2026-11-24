/* Native Wasm/Linux legacy stat64 input for genuine GNU xstat conversion.
   The field widths follow retained Linux asm-generic/stat.h, not GNU's
   public time64 structure. This is an internal architecture provider. */
struct __wasm_kernel_stat_time
{
  int tv_sec;
  unsigned int tv_nsec;
};
struct kernel_stat
{
  unsigned long long st_dev, st_ino;
  unsigned int st_mode, st_nlink, st_uid, st_gid;
  unsigned long long st_rdev, __pad1;
  long long st_size;
  int st_blksize, __pad2;
  long long st_blocks;
  struct __wasm_kernel_stat_time st_atim, st_mtim, st_ctim;
  unsigned int __unused4, __unused5;
};
_Static_assert (sizeof (struct kernel_stat) == 104, "legacy kernel stat64");
_Static_assert (_Alignof (struct kernel_stat) == 8, "native alignment");
#define _HAVE_STAT_NSEC 1
#define _HAVE_STAT64_NSEC 1
#define _HAVE_STAT___PAD1 1
#define _HAVE_STAT___PAD2 1
#define _HAVE_STAT64___PAD1 1
#define _HAVE_STAT64___PAD2 1
