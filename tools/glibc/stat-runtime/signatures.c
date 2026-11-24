#define _GNU_SOURCE 1
#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>

_Static_assert(sizeof(void *) == 4, "native wasm32 pointers");
_Static_assert(sizeof(long) == 4, "native wasm32 long");
_Static_assert(sizeof(time_t) == 8, "GNU time64");
_Static_assert(sizeof(off_t) == 8, "GNU LFS");
_Static_assert(sizeof(struct stat) == 128, "genuine GNU stat layout");
_Static_assert(sizeof(struct stat64) == sizeof(struct stat), "GNU public aliases");
_Static_assert(sizeof(struct statx) == 256, "Linux statx layout");
_Static_assert(sizeof(((struct stat *)0)->st_atim.tv_sec) == 8, "time64 seconds");
_Static_assert(sizeof(((struct stat *)0)->st_size) == 8, "file size64");

#define CHECK(name, type) \
  _Static_assert(__builtin_types_compatible_p(__typeof__(&name), type), #name); \
  __typeof__(&name) volatile GNU_STAT_REF_##name = &name

CHECK(stat, int (*)(const char *, struct stat *));
CHECK(lstat, int (*)(const char *, struct stat *));
CHECK(fstat, int (*)(int, struct stat *));
CHECK(fstatat, int (*)(int, const char *, struct stat *, int));
CHECK(stat64, int (*)(const char *, struct stat64 *));
CHECK(lstat64, int (*)(const char *, struct stat64 *));
CHECK(fstat64, int (*)(int, struct stat64 *));
CHECK(fstatat64, int (*)(int, const char *, struct stat64 *, int));

const unsigned GNU_STAT_LAYOUT[] = {
  sizeof(struct stat), sizeof(struct stat64), sizeof(struct statx),
  offsetof(struct stat, st_dev), offsetof(struct stat, st_ino),
  offsetof(struct stat, st_mode), offsetof(struct stat, st_nlink),
  offsetof(struct stat, st_uid), offsetof(struct stat, st_gid),
  offsetof(struct stat, st_rdev), offsetof(struct stat, st_size),
  offsetof(struct stat, st_blksize), offsetof(struct stat, st_blocks),
  offsetof(struct stat, st_atim), offsetof(struct stat, st_mtim),
  offsetof(struct stat, st_ctim)
};
