/* Real-guest test for the Firefox mmap shim's MAP_SHARED aliasing.
 *
 * Links web/linux/firefox-shims/mmap-shim.c exactly as Firefox does (the
 * shim's mmap/munmap/msync override musl's). Prints one line per check and a
 * final GUEST_MMAP_RESULT line parsed by run-guest.mjs. */
#define _GNU_SOURCE
#include "sys/mman.h"

#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

int lowland_mmap_refresh(void *addr, size_t length);

static int passed, failed;
#define CHECK(name, cond) do { \
    if (cond) { ++passed; } \
    else { ++failed; printf("GUEST_MMAP_FAIL %s line=%d errno=%d\n", name, __LINE__, errno); } \
  } while (0)

static long page;

static int temp_file(const char *tag, off_t size) {
  char path[128];
  snprintf(path, sizeof(path), "/tmp/mmap-shared-%s-%d", tag, (int)getpid());
  int fd = open(path, O_RDWR | O_CREAT | O_TRUNC, 0600);
  if (fd >= 0 && ftruncate(fd, size) != 0) { close(fd); return -1; }
  return fd;
}
static void temp_path(char *path, size_t n, const char *tag) {
  snprintf(path, n, "/tmp/mmap-shared-%s-%d", tag, (int)getpid());
}
static int file_has(int fd, off_t offset, const char *text) {
  char buf[64];
  size_t n = strlen(text);
  return pread(fd, buf, n, offset) == (ssize_t)n && !memcmp(buf, text, n);
}
static int aligned(const void *p) { return ((uintptr_t)p & (uintptr_t)(page - 1)) == 0; }

static void two_fds(void) {
  char path[128];
  int a = temp_file("twofds", 2 * page);
  temp_path(path, sizeof(path), "twofds");
  int b = open(path, O_RDWR);
  CHECK("twofds.open", a >= 0 && b >= 0);
  char *pa = mmap(NULL, 2 * page, PROT_READ | PROT_WRITE, MAP_SHARED, a, 0);
  char *pb = mmap(NULL, 2 * page, PROT_READ | PROT_WRITE, MAP_SHARED, b, 0);
  CHECK("twofds.map", pa != MAP_FAILED && pb != MAP_FAILED);
  CHECK("twofds.aligned", aligned(pa) && aligned(pb));
  CHECK("twofds.alias", pa == pb);
  strcpy(pa + 100, "written-through-a");
  CHECK("twofds.read-b", !strcmp(pb + 100, "written-through-a"));
  pb[page + 5] = 'q';
  CHECK("twofds.read-a", pa[page + 5] == 'q');
  CHECK("twofds.unmap-a", munmap(pa, 2 * page) == 0);
  CHECK("twofds.b-survives", !strcmp(pb + 100, "written-through-a"));
  CHECK("twofds.unmap-b", munmap(pb, 2 * page) == 0);
  CHECK("twofds.writeback", file_has(a, 100, "written-through-a") && file_has(b, page + 5, "q"));
  close(a); close(b); unlink(path);
}

static void fd_dup(void) {
  char path[128];
  temp_path(path, sizeof(path), "dup");
  int a = temp_file("dup", page);
  int b = dup(a);
  CHECK("dup.open", a >= 0 && b >= 0);
  char *pa = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, a, 0);
  close(a); /* the mapping must outlive the fd it came from */
  char *pb = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, b, 0);
  CHECK("dup.alias", pa != MAP_FAILED && pa == pb);
  memcpy(pb, "dup!", 4);
  CHECK("dup.read", !memcmp(pa, "dup!", 4));
  CHECK("dup.unmap", munmap(pb, page) == 0 && munmap(pa, page) == 0);
  CHECK("dup.writeback", file_has(b, 0, "dup!"));
  close(b); unlink(path);
}

/* SharedMap/MemMapSnapshot pattern on an anonymous shared-memory file:
 * memfd when the kernel has it, else the shim's shm_open (what Firefox's
 * shared memory falls back to when memfd_create is ENOSYS). */
static void memfd(int use_memfd) {
  int fd;
  if (use_memfd) {
    fd = (int)syscall(SYS_memfd_create, "mmap-shared", 0);
    if (fd < 0 && errno == ENOSYS) {
      printf("GUEST_MMAP_NOTE memfd_create ENOSYS in this kernel\n");
      return;
    }
    CHECK("memfd.create", fd >= 0);
  } else {
    char name[64];
    snprintf(name, sizeof(name), "/mmap-shared-anon-%d", (int)getpid());
    fd = shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0600);
    CHECK("memfd.shm-create", fd >= 0 && shm_unlink(name) == 0);
  }
  if (fd < 0) return;
  CHECK("memfd.truncate", ftruncate(fd, 3 * page) == 0);
  char *writer = mmap(NULL, 3 * page, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  char procpath[64];
  snprintf(procpath, sizeof(procpath), "/proc/self/fd/%d", fd);
  int reopened = open(procpath, O_RDONLY);
  int cloned = dup(fd);
  /* SharedMap-style reader: a second descriptor, different length, read-only. */
  char *reader = mmap(NULL, 3 * page - 17, PROT_READ, MAP_SHARED, cloned, 0);
  CHECK("memfd.map", writer != MAP_FAILED && reader != MAP_FAILED);
  CHECK("memfd.alias-len", reader == writer);
  strcpy(writer + 2 * page + 1, "memfd-bytes");
  CHECK("memfd.read", !strcmp(reader + 2 * page + 1, "memfd-bytes"));
  if (reopened >= 0) {
    char *third = mmap(NULL, page, PROT_READ, MAP_SHARED, reopened, 2 * page);
    CHECK("memfd.proc-reopen-alias", third == writer + 2 * page);
    CHECK("memfd.proc-reopen-unmap", munmap(third, page) == 0);
    close(reopened);
  } else {
    printf("GUEST_MMAP_NOTE memfd /proc reopen unavailable errno=%d\n", errno);
  }
  /* Writer drops first (MemMapSnapshot reset); a later reader still sees data. */
  CHECK("memfd.unmap-writer", munmap(writer, 3 * page) == 0);
  CHECK("memfd.reader-survives", !strcmp(reader + 2 * page + 1, "memfd-bytes"));
  CHECK("memfd.unmap-reader", munmap(reader, 3 * page - 17) == 0);
  char *late = mmap(NULL, 3 * page, PROT_READ, MAP_SHARED, cloned, 0);
  CHECK("memfd.late-reader", late != MAP_FAILED && !strcmp(late + 2 * page + 1, "memfd-bytes"));
  CHECK("memfd.late-unmap", munmap(late, 3 * page) == 0);
  close(cloned); close(fd);
}

static void shm(void) {
  char name[64];
  snprintf(name, sizeof(name), "/mmap-shared-shm-%d", (int)getpid());
  int a = shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0600);
  int b = shm_open(name, O_RDWR, 0600);
  CHECK("shm.open", a >= 0 && b >= 0);
  CHECK("shm.truncate", ftruncate(a, page) == 0);
  CHECK("shm.unlink", shm_unlink(name) == 0);
  char *pa = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, a, 0);
  char *pb = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, b, 0);
  CHECK("shm.alias", pa != MAP_FAILED && pa == pb);
  pb[7] = 'S';
  CHECK("shm.read", pa[7] == 'S');
  CHECK("shm.unmap", munmap(pa, page) == 0 && munmap(pb, 4096) == 0);
  close(a); close(b);
}

static void offsets_and_growth(void) {
  char path[128];
  temp_path(path, sizeof(path), "grow");
  int fd = temp_file("grow", 100);
  char *small = mmap(NULL, 100, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  CHECK("grow.map-small", small != MAP_FAILED);
  memcpy(small, "head", 4);
  /* Growth inside the mapped page keeps the same backing. */
  CHECK("grow.truncate-inside", ftruncate(fd, page) == 0);
  char *whole = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  CHECK("grow.inside-alias", whole == small);
  memcpy(whole + page - 4, "tail", 4);
  CHECK("grow.inside-read", !memcmp(small + page - 4, "tail", 4));
  /* Growth past the capacity makes a new generation seeded from the old. */
  CHECK("grow.truncate-beyond", ftruncate(fd, 4 * page) == 0);
  char *big = mmap(NULL, 4 * page, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  CHECK("grow.beyond-map", big != MAP_FAILED);
  CHECK("grow.beyond-seeded", !memcmp(big, "head", 4) && !memcmp(big + page - 4, "tail", 4));
  char *third = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 2 * page);
  CHECK("grow.offset-alias", third == big + 2 * page);
  memcpy(third + 9, "offset", 6);
  CHECK("grow.offset-read", !memcmp(big + 2 * page + 9, "offset", 6));
  CHECK("grow.aligned", aligned(big) && aligned(third));
  CHECK("grow.unmap-old", munmap(small, 100) == 0 && munmap(whole, page) == 0);
  CHECK("grow.big-survives", !memcmp(big + 2 * page + 9, "offset", 6));
  CHECK("grow.msync", msync(big + 2 * page, page, MS_SYNC) == 0);
  CHECK("grow.msync-file", file_has(fd, 2 * page + 9, "offset"));
  CHECK("grow.unmap", munmap(third, page) == 0 && munmap(big, 4 * page) == 0);
  CHECK("grow.writeback", file_has(fd, 0, "head") && file_has(fd, page - 4, "tail"));
  struct stat st;
  CHECK("grow.size-kept", fstat(fd, &st) == 0 && st.st_size == 4 * page);
  close(fd); unlink(path);
}

static void private_and_write2(void) {
  char path[128];
  temp_path(path, sizeof(path), "private");
  int fd = temp_file("private", page);
  char *shared = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  memcpy(shared, "live", 4);
  char *copy = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);
  CHECK("private.copy", copy != MAP_FAILED && copy != shared);
  CHECK("private.sees-live", !memcmp(copy, "live", 4));
  copy[0] = 'X';
  CHECK("private.isolated", shared[0] == 'l');
  CHECK("private.no-writeback", msync(copy, page, MS_SYNC) == 0 && munmap(copy, page) == 0);
  /* write(2) is not coherent with live mappings until refresh. */
  CHECK("write2.pwrite", pwrite(fd, "disk", 4, 64) == 4);
  CHECK("write2.not-visible", memcmp(shared + 64, "disk", 4) != 0);
  CHECK("write2.refresh", lowland_mmap_refresh(shared + 64, 4) == 0);
  CHECK("write2.visible", !memcmp(shared + 64, "disk", 4));
  CHECK("private.unmap", munmap(shared, page) == 0);
  close(fd); unlink(path);
}

struct worker { int fd; int id; int ok; };
static void *hammer(void *arg) {
  struct worker *w = arg;
  w->ok = 1;
  for (int i = 0; i < 200; ++i) {
    char *p = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, w->fd, 0);
    if (p == MAP_FAILED) { w->ok = 0; break; }
    p[w->id] = (char)(i & 0x7f);
    if (p[w->id] != (char)(i & 0x7f)) w->ok = 0;
    if (munmap(p, page) != 0) { w->ok = 0; break; }
  }
  return NULL;
}
static void threads(void) {
  char path[128];
  temp_path(path, sizeof(path), "threads");
  int fd = temp_file("threads", page);
  char *anchor = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  pthread_t t[2];
  struct worker w[2] = {{fd, 1, 0}, {fd, 2, 0}};
  int started = pthread_create(&t[0], NULL, hammer, &w[0]) == 0 &&
                pthread_create(&t[1], NULL, hammer, &w[1]) == 0;
  CHECK("threads.start", started);
  if (started) { pthread_join(t[0], NULL); pthread_join(t[1], NULL); }
  CHECK("threads.ok", w[0].ok && w[1].ok);
  CHECK("threads.visible", anchor[1] == (199 & 0x7f) && anchor[2] == (199 & 0x7f));
  CHECK("threads.unmap", munmap(anchor, page) == 0);
  close(fd); unlink(path);
}

int main(void) {
  page = sysconf(_SC_PAGESIZE);
  printf("GUEST_MMAP_START page=%ld\n", page);
  two_fds();
  fd_dup();
  memfd(1);
  memfd(0);
  shm();
  offsets_and_growth();
  private_and_write2();
  threads();
  printf("GUEST_MMAP_RESULT pass=%d fail=%d\n", passed, failed);
  fflush(stdout);
  return failed ? 1 : 0;
}
