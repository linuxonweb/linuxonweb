#define _GNU_SOURCE
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
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
  assert(live_allocations == 0 && shared_files == NULL && shared_views == NULL);
}

static int checks;
#define CHECK(x) do { assert(x); ++checks; } while (0)

/* Different offsets/lengths of one file alias the same bytes. */
static void offsets_alias(int fd) {
  const size_t page = 65536;
  char *whole = shim_mmap(NULL, 2 * page, PROT_READ | PROT_WRITE,
                          MAP_SHARED, fd, 0);
  char *tail = shim_mmap(NULL, page, PROT_READ, MAP_SHARED, fd, page);
  char *small = shim_mmap(NULL, 100, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  CHECK(whole != MAP_FAILED && tail == whole + page && small == whole);
  CHECK(live_allocations == 1);
  CHECK(!memcmp(tail, "original", 8));
  memcpy(whole + page + 8, "-tail", 5);
  CHECK(!memcmp(tail + 8, "-tail", 5));
  small[3] = 'Z';
  CHECK(whole[3] == 'Z');
  /* Rust-style munmap of the aligned base, in any order. */
  CHECK(shim_munmap(whole, 2 * page) == 0);
  CHECK(live_allocations == 1 && tail[8] == '-');
  CHECK(shim_munmap(tail, page) == 0);
  CHECK(live_allocations == 1);
  CHECK(shim_munmap(small, 100) == 0);
  CHECK(live_allocations == 0 && shared_files == NULL && shared_views == NULL);
  /* The last unmap wrote the mapped bytes back to the file. */
  check_bytes(fd, page, "original-tail", 13);
  check_bytes(fd, 3, "Z", 1);
  ++checks;
}

/* ftruncate growth inside the capacity keeps aliasing; beyond it a new
 * generation is seeded from the old bytes; only the live one writes back. */
static void growth(void) {
  char name[512];
  const char *dir = getenv("TMPDIR");
  CHECK(dir && *dir);
  snprintf(name, sizeof(name), "%s/lowland-mmap-grow-XXXXXX", dir);
  int fd = mkstemp(name);
  CHECK(fd >= 0 && unlink(name) == 0);
  CHECK(ftruncate(fd, 100) == 0);
  char *a = shim_mmap(NULL, 100, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  CHECK(a != MAP_FAILED && live_allocations == 1);
  memcpy(a, "grow", 4);
  CHECK(ftruncate(fd, 8000) == 0);
  char *b = shim_mmap(NULL, 8000, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  CHECK(b == a && live_allocations == 1);
  memcpy(b + 7000, "late", 4);
  CHECK(!memcmp(a + 7000, "late", 4));
  CHECK(ftruncate(fd, 3 * 65536) == 0);
  char *c = shim_mmap(NULL, 3 * 65536, PROT_READ | PROT_WRITE, MAP_SHARED,
                      fd, 0);
  CHECK(c != MAP_FAILED && c != a && live_allocations == 2);
  CHECK(!memcmp(c, "grow", 4) && !memcmp(c + 7000, "late", 4));
  memcpy(c + 131072, "big", 3);
  char *d = shim_mmap(NULL, 65536, PROT_READ, MAP_SHARED, fd, 131072);
  CHECK(d == c + 131072 && !memcmp(d, "big", 3));
  memcpy(c, "GROW", 4);
  /* The superseded generation drops without clobbering the file. */
  CHECK(shim_munmap(a, 100) == 0 && shim_munmap(b, 8000) == 0);
  CHECK(live_allocations == 1);
  CHECK(shim_munmap(d, 65536) == 0 && shim_munmap(c, 3 * 65536) == 0);
  CHECK(live_allocations == 0 && shared_files == NULL);
  check_bytes(fd, 0, "GROW", 4);
  check_bytes(fd, 7000, "late", 4);
  check_bytes(fd, 131072, "big", 3);
  struct stat st;
  CHECK(fstat(fd, &st) == 0 && st.st_size == 3 * 65536);
  CHECK(close(fd) == 0);
}

/* Private maps see live shared bytes; read-only fds and devices behave. */
static void private_and_readonly(int fd) {
  char *shared = shim_mmap(NULL, 65536, PROT_READ | PROT_WRITE, MAP_SHARED,
                           fd, 65536);
  CHECK(shared != MAP_FAILED);
  memcpy(shared, "livebyte", 8);
  char *copy = shim_mmap(NULL, 65536, PROT_READ | PROT_WRITE, MAP_PRIVATE,
                         fd, 65536);
  CHECK(copy != shared && !memcmp(copy, "livebyte", 8));
  copy[0] = 'X';
  CHECK(shared[0] == 'l');
  CHECK(shim_munmap(copy, 65536) == 0);

  char path[64];
  snprintf(path, sizeof(path), "/proc/self/fd/%d", fd);
  int ro = open(path, O_RDONLY);
  CHECK(ro >= 0);
  char *view = shim_mmap(NULL, 65536, PROT_READ, MAP_SHARED, ro, 65536);
  CHECK(view == shared && live_allocations == 1);
  CHECK(shim_msync(view, 8, MS_SYNC) == 0);
  check_bytes(fd, 65536, "livebyte", 8);
  CHECK(shim_munmap(shared, 65536) == 0);
  /* The surviving read-only view keeps the backing's writable fd. */
  memcpy(view + 8, "!", 1);
  CHECK(shim_munmap(view, 65536) == 0);
  CHECK(live_allocations == 0 && shared_files == NULL);
  check_bytes(fd, 65536, "livebyte!", 9);
  CHECK(close(ro) == 0);
  CHECK(pwrite(fd, "original-tail", 13, 65536) == 13);

  int zero = open("/dev/zero", O_RDWR);
  CHECK(zero >= 0);
  char *z1 = shim_mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, zero, 0);
  char *z2 = shim_mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, zero, 0);
  CHECK(z1 != MAP_FAILED && z2 != MAP_FAILED && z1 != z2);
  z1[0] = 1;
  CHECK(z2[0] == 0);
  CHECK(shim_munmap(z1, 4096) == 0 && shim_munmap(z2, 4096) == 0);
  CHECK(close(zero) == 0 && live_allocations == 0);

  /* mremap of a shared view stays inside its backing. */
  char *m = shim_mmap(NULL, 100, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  CHECK(shim_mremap(m, 100, 60000, MREMAP_MAYMOVE) == m);
  errno = 0;
  CHECK(shim_mremap(m, 60000, 1 << 20, MREMAP_MAYMOVE) == MAP_FAILED &&
        errno == ENOMEM);
  CHECK(shim_munmap(m, 60000) == 0 && live_allocations == 0);
}
int main(void) {
  char name[512];
  const char *dir = getenv("TMPDIR");
  assert(dir && *dir);
  snprintf(name, sizeof(name), "%s/lowland-mmap-test-XXXXXX", dir);
  int fd = mkstemp(name);
  assert(fd >= 0 && unlink(name) == 0);
  assert(ftruncate(fd, 131072) == 0);
  assert(pwrite(fd, "original", 8, 65536) == 8);
  shared_aliases(fd, 0);
  shared_aliases(fd, 1);
  offsets_alias(fd);
  private_and_readonly(fd);
  growth();

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
  printf("PASS: 64 KiB mmap bases, shared aliases and both drop orders, backing sync/refresh, private/anonymous cleanup, allocation errors; %d aliasing checks\n", checks);
  return 0;
}
