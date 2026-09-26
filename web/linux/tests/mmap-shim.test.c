#define _GNU_SOURCE
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Compile the actual shim, isolating every exported libc name. The allocation
 * wrapper records ownership and makes the 64 KiB alignment assertion
 * deterministic even when the host allocator happens to return such a base. */
static long test_page_size = 65536;
static int allocation_error;
static void *allocations[32];
static unsigned live_allocations;
static long fixture_sysconf(int name);
static int fixture_memalign(void **out, size_t alignment, size_t length);
static void fixture_free(void *address);
#define mmap shim_mmap
#define munmap shim_munmap
#define mprotect shim_mprotect
#define mremap shim_mremap
#define madvise shim_madvise
#define posix_madvise shim_posix_madvise
#define msync shim_msync
#define shm_open shim_shm_open
#define shm_unlink shim_shm_unlink
#define sysconf fixture_sysconf
#define posix_memalign fixture_memalign
#define free fixture_free
#include "../firefox-shims/mmap-shim.c"
#undef mmap
#undef munmap
#undef mprotect
#undef mremap
#undef madvise
#undef posix_madvise
#undef msync
#undef shm_open
#undef shm_unlink
#undef sysconf
#undef posix_memalign
#undef free

static long fixture_sysconf(int name) {
  assert(name == _SC_PAGESIZE);
  return test_page_size;
}
static int fixture_memalign(void **out, size_t alignment, size_t length) {
  assert(alignment == (size_t)test_page_size);
  if (allocation_error) return allocation_error;
  int result = posix_memalign(out, alignment, length);
  if (!result) {
    unsigned i;
    for (i = 0; i < 32 && allocations[i]; ++i) {}
    assert(i < 32);
    allocations[i] = *out;
    ++live_allocations;
  }
  return result;
}
static void fixture_free(void *address) {
  for (unsigned i = 0; i < 32; ++i) {
    if (address && allocations[i] == address) {
      allocations[i] = NULL;
      --live_allocations;
      break;
    }
  }
  free(address);
}
static void *rust_base(void *address) {
  assert(address != MAP_FAILED);
  uintptr_t base = (uintptr_t)address & ~((uintptr_t)test_page_size - 1);
  assert(base == (uintptr_t)address);
  return (void *)base;
}
static void check_bytes(int fd, off_t offset, const char *expected, size_t n) {
  char bytes[32];
  assert(n <= sizeof(bytes));
  assert(pread(fd, bytes, n, offset) == (ssize_t)n);
  assert(!memcmp(bytes, expected, n));
}
static void shared_aliases(int fd, int reverse) {
  const size_t length = 65536;
  int alias_fd = dup(fd);
  assert(alias_fd >= 0);
  char *first = shim_mmap(NULL, length, PROT_READ | PROT_WRITE,
                          MAP_SHARED, fd, 0);
  char *second = shim_mmap(NULL, length, PROT_READ | PROT_WRITE,
                           MAP_SHARED, alias_fd, 0);
  assert(first == second && live_allocations == 1);
  assert(close(alias_fd) == 0);
  assert(rust_base(first) == first && rust_base(second) == second);
  memcpy(first + 17, "alias", 5);
  assert(!memcmp(second + 17, "alias", 5));
  assert(shim_msync(second + 17, 5, MS_SYNC) == 0);
  check_bytes(fd, 17, "alias", 5);
  assert(shim_munmap(rust_base(reverse ? first : second), length) == 0);
  assert(live_allocations == 1); /* first unmap must retain the second owner */
  char *survivor = reverse ? second : first;
  assert(pwrite(fd, "fresh", 5, 23) == 5);
  assert(lowland_mmap_refresh(survivor + 23, 5) == 0);
  assert(!memcmp(survivor + 23, "fresh", 5));
  assert(shim_munmap(rust_base(survivor), length) == 0);
  assert(live_allocations == 0 && shared_maps == NULL);
}
int main(void) {
  char name[] = "/tmp/lowland-mmap-test-XXXXXX";
  int fd = mkstemp(name);
  assert(fd >= 0 && unlink(name) == 0);
  assert(ftruncate(fd, 131072) == 0);
  assert(pwrite(fd, "original", 8, 65536) == 8);
  shared_aliases(fd, 0);
  shared_aliases(fd, 1);

  char *private_map = shim_mmap(NULL, 65536, PROT_READ | PROT_WRITE,
                                MAP_PRIVATE, fd, 65536);
  assert(rust_base(private_map) == private_map);
  assert(!memcmp(private_map, "original", 8));
  memcpy(private_map, "modified", 8);
  assert(shim_msync(private_map, 8, MS_SYNC) == 0);
  check_bytes(fd, 65536, "original", 8);
  assert(shim_munmap(rust_base(private_map), 65536) == 0);
  assert(live_allocations == 0);

  for (size_t length = 1; length <= 65537; length += 32768) {
    unsigned char *anonymous = shim_mmap(NULL, length, PROT_READ | PROT_WRITE,
                                         MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    assert(rust_base(anonymous) == anonymous);
    for (size_t i = 0; i < length; ++i) assert(anonymous[i] == 0);
    anonymous[length - 1] = 0x5a;
    assert(shim_munmap(rust_base(anonymous), length) == 0);
    assert(live_allocations == 0);
  }

  const long invalid_pages[] = {-1, 0, 3, 6144};
  for (unsigned i = 0; i < sizeof(invalid_pages) / sizeof(invalid_pages[0]); ++i) {
    test_page_size = invalid_pages[i];
    errno = 0;
    assert(shim_mmap(NULL, 16, PROT_READ, MAP_PRIVATE | MAP_ANONYMOUS,
                     -1, 0) == MAP_FAILED);
    assert(errno == EINVAL && live_allocations == 0);
  }
  test_page_size = 65536;
  allocation_error = ENOMEM;
  errno = 0;
  assert(shim_mmap(NULL, 16, PROT_READ, MAP_PRIVATE, fd, 0) == MAP_FAILED);
  assert(errno == ENOMEM && live_allocations == 0);
  errno = 0;
  assert(shim_mmap(NULL, 16, PROT_READ, MAP_PRIVATE | MAP_ANONYMOUS,
                   -1, 0) == MAP_FAILED);
  assert(errno == ENOMEM && live_allocations == 0);
  allocation_error = 0;
  assert(close(fd) == 0);
  puts("PASS: 64 KiB mmap bases, shared aliases and both drop orders, backing sync/refresh, private/anonymous cleanup, and allocation errors");
  return 0;
}
