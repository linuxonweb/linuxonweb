#include "sys/mman.h"

#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/stat.h>
#include <unistd.h>

/* Consumers such as Rust memmap2 recover the mapping base by rounding down
 * using sysconf(_SC_PAGESIZE). Linux Wasm reports 64 KiB, so a hard-coded
 * 4 KiB allocation can turn a valid mapping into an invalid free at munmap. */
static int allocate_mapping(void **address, size_t length) {
  long page_size = sysconf(_SC_PAGESIZE);
  if (page_size < (long)sizeof(void *) ||
      ((unsigned long)page_size & ((unsigned long)page_size - 1))) {
    errno = EINVAL;
    return -1;
  }
  int error = posix_memalign(address, (size_t)page_size, length);
  if (error) { errno = error; return -1; }
  return 0;
}

/* MAP_SHARED needs aliases in one wasm address space and explicit file
 * exchange when the consumer runs in a different address space. */
struct shared_map {
  void *addr;
  size_t length;
  off_t offset;
  dev_t device;
  ino_t inode;
  int fd;
  unsigned refs;
  struct shared_map *next;
};
static struct shared_map *shared_maps;
static int shared_maps_lock;

static void lock_maps(void) {
  while (__atomic_exchange_n(&shared_maps_lock, 1, __ATOMIC_ACQUIRE)) {}
}
static void unlock_maps(void) {
  __atomic_store_n(&shared_maps_lock, 0, __ATOMIC_RELEASE);
}
static struct shared_map *find_file(dev_t device, ino_t inode,
                                    off_t offset, size_t length) {
  for (struct shared_map *m = shared_maps; m; m = m->next) {
    if (m->device == device && m->inode == inode &&
        m->offset == offset && m->length == length) return m;
  }
  return NULL;
}
static struct shared_map *find_address(void *addr, size_t length) {
  uintptr_t start = (uintptr_t)addr;
  for (struct shared_map *m = shared_maps; m; m = m->next) {
    uintptr_t base = (uintptr_t)m->addr;
    if (start >= base && length <= m->length &&
        start - base <= m->length - length) return m;
  }
  return NULL;
}
static int read_backing(int fd, void *addr, size_t length, off_t offset) {
  size_t done = 0;
  while (done < length) {
    ssize_t n = pread(fd, (char *)addr + done, length - done,
                      offset + (off_t)done);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) return -1;
    if (n == 0) break;
    done += (size_t)n;
  }
  memset((char *)addr + done, 0, length - done);
  return 0;
}
static int write_backing(int fd, const void *addr, size_t length, off_t offset) {
  size_t done = 0;
  while (done < length) {
    ssize_t n = pwrite(fd, (const char *)addr + done, length - done,
                       offset + (off_t)done);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return -1;
    done += (size_t)n;
  }
  return 0;
}

void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset) {
  (void)prot;
  if (length == 0) {
    errno = EINVAL;
    return MAP_FAILED;
  }

  /* Commit / decommit over a previously reserved region. */
  if ((flags & MAP_FIXED) && addr != NULL) {
    return addr;
  }

  if (!(flags & MAP_ANONYMOUS)) {
    /* File-backed private mappings retain copy-on-map behavior. */
    if (fd < 0) {
      errno = EBADF;
      return MAP_FAILED;
    }
    struct stat st;
    if (fstat(fd, &st) != 0) return MAP_FAILED;
    if (flags & MAP_SHARED) {
      lock_maps();
      struct shared_map *existing = find_file(st.st_dev, st.st_ino,
                                              offset, length);
      if (existing) {
        existing->refs++;
        void *alias = existing->addr;
        unlock_maps();
        return alias;
      }
      unlock_maps();
    }
    void *p = NULL;
    if (allocate_mapping(&p, length) != 0) {
      return MAP_FAILED;
    }
    if (read_backing(fd, p, length, offset) != 0) {
      free(p);
      return MAP_FAILED;
    }
    if (flags & MAP_SHARED) {
      struct shared_map *m = malloc(sizeof(*m));
      if (!m) { free(p); errno = ENOMEM; return MAP_FAILED; }
      int owned_fd = dup(fd);
      if (owned_fd < 0) { free(m); free(p); return MAP_FAILED; }
      lock_maps();
      struct shared_map *existing = find_file(st.st_dev, st.st_ino,
                                              offset, length);
      if (existing) {
        existing->refs++;
        void *alias = existing->addr;
        unlock_maps();
        close(owned_fd); free(m); free(p);
        return alias;
      }
      *m = (struct shared_map){p, length, offset, st.st_dev, st.st_ino,
                               owned_fd, 1, shared_maps};
      shared_maps = m;
      unlock_maps();
    }
    return p;
  }

  void *p = NULL;
  if (allocate_mapping(&p, length) != 0) {
    return MAP_FAILED;
  }
  memset(p, 0, length);
  return p;
}

int munmap(void *addr, size_t length) {
  (void)length;
  lock_maps();
  struct shared_map **slot = &shared_maps;
  while (*slot && (*slot)->addr != addr) slot = &(*slot)->next;
  if (*slot) {
    struct shared_map *m = *slot;
    if (--m->refs != 0) { unlock_maps(); return 0; }
    *slot = m->next;
    unlock_maps();
    close(m->fd); free(m); free(addr);
    return 0;
  }
  unlock_maps();
  free(addr);
  return 0;
}

int mprotect(void *addr, size_t len, int prot) {
  (void)addr;
  (void)len;
  (void)prot;
  return 0;
}

void *mremap(void *old_addr, size_t old_size, size_t new_size, int flags, ...) {
  (void)flags;
  if (new_size == old_size) {
    return old_addr;
  }
  void *p = realloc(old_addr, new_size);
  if (!p) {
    errno = ENOMEM;
    return MAP_FAILED;
  }
  if (new_size > old_size) {
    memset((char *)p + old_size, 0, new_size - old_size);
  }
  return p;
}

int madvise(void *addr, size_t length, int flags) {
  (void)addr;
  (void)length;
  (void)flags;
  return 0;
}

int posix_madvise(void *addr, size_t length, int advice) {
  return madvise(addr, length, advice);
}

int msync(void *addr, size_t length, int flags) {
  (void)flags;
  lock_maps();
  struct shared_map *m = find_address(addr, length);
  int result = m ? write_backing(m->fd, addr, length,
                                 m->offset + (off_t)((uintptr_t)addr -
                                                     (uintptr_t)m->addr)) : 0;
  unlock_maps();
  return result;
}

/* Refresh a shared mapping after its sender has synced it to the backing fd. */
int lowland_mmap_refresh(void *addr, size_t length) {
  lock_maps();
  struct shared_map *m = find_address(addr, length);
  if (!m) { unlock_maps(); errno = EINVAL; return -1; }
  int result = read_backing(m->fd, addr, length,
                            m->offset + (off_t)((uintptr_t)addr -
                                                (uintptr_t)m->addr));
  unlock_maps();
  return result;
}

/* musl's wasm32 port has no POSIX shared-memory namespace.  Firefox's
 * single-process build only needs the usual open-then-unlink file semantics,
 * which an ordinary temporary file provides. */
static int shm_path(char *path, size_t path_size, const char *name) {
  if (name == NULL || name[0] != '/') {
    errno = EINVAL;
    return -1;
  }
  int written = snprintf(path, path_size, "/tmp%s", name);
  if (written < 0 || (size_t)written >= path_size) {
    errno = ENAMETOOLONG;
    return -1;
  }
  return 0;
}

int shm_open(const char *name, int oflag, mode_t mode) {
  char path[256];
  if (shm_path(path, sizeof(path), name) != 0) {
    return -1;
  }
  return open(path, oflag, mode);
}

int shm_unlink(const char *name) {
  char path[256];
  if (shm_path(path, sizeof(path), name) != 0) {
    return -1;
  }
  return unlink(path);
}
