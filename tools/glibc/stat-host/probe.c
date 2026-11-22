/* Independent public GNU conversion controls; transport is synthetic Linux. */
#define _GNU_SOURCE 1
#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>

#define REF(name) extern __typeof__(&name) volatile GNU_STAT_REF_##name
REF(stat); REF(lstat); REF(fstat); REF(fstatat);
REF(stat64); REF(lstat64); REF(fstat64); REF(fstatat64);
extern const unsigned GNU_STAT_LAYOUT[];

union value { struct stat ordinary; struct stat64 large; };
struct guarded { unsigned char before[16]; union value data; unsigned char after[16]; };
static struct guarded output;
_Static_assert(offsetof(struct guarded, data) == 16, "leading canary");
_Static_assert(offsetof(struct guarded, after) == 144, "trailing canary");
_Static_assert(sizeof(output) == 160, "no hidden canary gap");

int run(unsigned api, int fd, int flags) {
  memset(&output, 0xa5, sizeof(output));
  memset(output.before, 0xe3, sizeof(output.before));
  memset(output.after, 0x7d, sizeof(output.after));
  errno = 251;
  switch(api) {
    case 0: return GNU_STAT_REF_stat("test-file", &output.data.ordinary);
    case 1: return GNU_STAT_REF_lstat("test-file", &output.data.ordinary);
    case 2: return GNU_STAT_REF_fstat(fd, &output.data.ordinary);
    case 3: return GNU_STAT_REF_fstatat(fd, "test-file", &output.data.ordinary, flags);
    case 4: return GNU_STAT_REF_stat64("test-file", &output.data.large);
    case 5: return GNU_STAT_REF_lstat64("test-file", &output.data.large);
    case 6: return GNU_STAT_REF_fstat64(fd, &output.data.large);
    case 7: return GNU_STAT_REF_fstatat64(fd, "test-file", &output.data.large, flags);
    default: return -9;
  }
}
unsigned payload(void) { return (uintptr_t)&output.data; }
unsigned layout(void) { return (uintptr_t)GNU_STAT_LAYOUT; }
int error(void) { return errno; }
