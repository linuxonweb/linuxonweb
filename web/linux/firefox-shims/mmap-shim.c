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

/* MAP_SHARED coherence inside one Wasm address space.
 *
 * The nommu Wasm kernel cannot alias page-cache pages into a process's
 * WebAssembly.Memory, so every file-backed mapping is a heap copy.  To give
 * MAP_SHARED its Linux meaning within one process, all shared mappings of one
 * file, keyed by (st_dev, st_ino), point into a single per-file backing that
 * covers file offsets [0, capacity).  A mapping of any offset/length inside the
 * capacity returns backing + offset, so two fds, dup'ed fds, memfd/shm_open
 * handles and differently sized views alias byte for byte.
 *
 * The backing is the authority while mapped: it is written back to the file
 * (clipped to the current file size) on msync and when its last view is
 * unmapped, so a later mapping or pread after the last unmap sees the data.
 * write(2)/pwrite(2) to the file are NOT reflected in live mappings unless
 * lowland_mmap_refresh() is called, and read(2) does not see mapped writes
 * until msync() or the last munmap().  Different processes never alias.
 *
 * Capacity is the larger of the requested end and the file size at first map,
 * rounded up to the page size, so ftruncate growth that stays inside the last
 * page keeps aliasing.  A later mapping beyond the capacity creates a new
 * backing generation seeded from the old one; views of the old generation stay
 * valid but are no longer coherent with the new one and are not written back.
 */
struct shared_file {
  char *base;
  size_t capacity;
  dev_t device;
  ino_t inode;
  int fd;               /* dup'ed; writable if any view was writable */
  int fd_writable;
  int dirty;            /* a view was mapped with PROT_WRITE */
  int superseded;       /* replaced by a larger generation */
  unsigned views;
  struct shared_file *next;
};
struct shared_view {
  char *addr;
  size_t length;
  struct shared_file *file;
  struct shared_view *next;
};
static struct shared_file *shared_files;
static struct shared_view *shared_views;
static int shared_maps_lock;

/* Memory allocation and free are never called with the lock held: an
 * allocator that itself maps memory must not deadlock against munmap. */
static void lock_maps(void) {
  while (__atomic_exchange_n(&shared_maps_lock, 1, __ATOMIC_ACQUIRE)) {}
}
static void unlock_maps(void) {
  __atomic_store_n(&shared_maps_lock, 0, __ATOMIC_RELEASE);
}
static struct shared_file *find_file(dev_t device, ino_t inode) {
  for (struct shared_file *f = shared_files; f; f = f->next) {
    if (!f->superseded && f->device == device && f->inode == inode) return f;
  }
  return NULL;
}
/* Backing that contains [addr, addr + length), preferring a live generation. */
static struct shared_file *find_backing(const void *addr, size_t length) {
  uintptr_t start = (uintptr_t)addr;
  struct shared_file *found = NULL;
  for (struct shared_file *f = shared_files; f; f = f->next) {
    uintptr_t base = (uintptr_t)f->base;
    if (start >= base && length <= f->capacity &&
        start - base <= f->capacity - length) {
      if (!f->superseded) return f;
      if (!found) found = f;
    }
  }
  return found;
}
static struct shared_view **find_view(void *addr, size_t length) {
  struct shared_view **exact = NULL, **inside = NULL;
  for (struct shared_view **slot = &shared_views; *slot;
       slot = &(*slot)->next) {
    struct shared_view *v = *slot;
    if (v->addr == addr) {
      if (v->length == length) return slot;
      if (!exact) exact = slot;
    } else if (!inside && (uintptr_t)addr > (uintptr_t)v->addr &&
               (uintptr_t)addr - (uintptr_t)v->addr < v->length) {
      inside = slot;
    }
  }
  return exact ? exact : inside;
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
/* Write [offset, offset + length) of a backing to its file without extending
 * the file: mapped bytes past EOF are not file data. */
static int sync_backing(struct shared_file *f, size_t offset, size_t length) {
  struct stat st;
  if (fstat(f->fd, &st) != 0) return -1;
  size_t size = st.st_size > 0 ? (size_t)st.st_size : 0;
  if (offset >= size) return 0;
  if (length > size - offset) length = size - offset;
  return write_backing(f->fd, f->base + offset, length, (off_t)offset);
}
static int fd_is_writable(int fd) {
  int flags = fcntl(fd, F_GETFL);
  return flags >= 0 && (flags & O_ACCMODE) != O_RDONLY;
}
static size_t page_round(size_t length) {
  long page_size = sysconf(_SC_PAGESIZE);
  size_t page = (size_t)page_size;
  /* allocate_mapping reports an invalid page size. */
  if (page_size < (long)sizeof(void *) || (page & (page - 1))) return length;
  if (length > SIZE_MAX - (page - 1)) return 0;
  return (length + page - 1) & ~(page - 1);
}

static void *map_shared_file(size_t length, int prot, int fd, off_t offset,
                             const struct stat *st) {
  if (offset < 0 || (uint64_t)offset > SIZE_MAX - length) {
    errno = EINVAL;
    return MAP_FAILED;
  }
  size_t end = (size_t)offset + length;
  int writable = (prot & PROT_WRITE) != 0;
  int writable_fd = fd_is_writable(fd);
  struct shared_view *view = malloc(sizeof(*view));
  if (!view) { errno = ENOMEM; return MAP_FAILED; }

  /* Fast path: the file already has a large enough live backing. */
  int replacement_fd = -1;
  for (;;) {
    lock_maps();
    struct shared_file *f = find_file(st->st_dev, st->st_ino);
    if (!f || end > f->capacity) { unlock_maps(); break; }
    if (writable_fd && !f->fd_writable && replacement_fd < 0) {
      unlock_maps();
      replacement_fd = dup(fd);
      if (replacement_fd < 0) { free(view); return MAP_FAILED; }
      continue;
    }
    if (replacement_fd >= 0 && !f->fd_writable) {
      int old = f->fd;
      f->fd = replacement_fd;
      f->fd_writable = 1;
      replacement_fd = old;
    }
    f->views++;
    f->dirty |= writable;
    *view = (struct shared_view){f->base + offset, length, f, shared_views};
    shared_views = view;
    unlock_maps();
    if (replacement_fd >= 0) close(replacement_fd);
    return view->addr;
  }
  if (replacement_fd >= 0) close(replacement_fd);

  /* New backing, or a larger generation when a view exceeds the capacity. */
  size_t file_size = st->st_size > 0 ? (size_t)st->st_size : 0;
  size_t capacity = page_round(end > file_size ? end : file_size);
  if (capacity == 0) { free(view); errno = ENOMEM; return MAP_FAILED; }
  struct shared_file *created = malloc(sizeof(*created));
  if (!created) { free(view); errno = ENOMEM; return MAP_FAILED; }
  void *base = NULL;
  if (allocate_mapping(&base, capacity) != 0) {
    int error = errno;
    free(created); free(view);
    errno = error;
    return MAP_FAILED;
  }
  int owned_fd = dup(fd);
  if (owned_fd < 0 || read_backing(owned_fd, base, capacity, 0) != 0) {
    int error = errno;
    if (owned_fd >= 0) close(owned_fd);
    free(base); free(created); free(view);
    errno = error;
    return MAP_FAILED;
  }
  lock_maps();
  struct shared_file *f = find_file(st->st_dev, st->st_ino);
  if (f && end <= f->capacity) {
    /* Another thread created a suitable backing meanwhile. */
    f->views++;
    f->dirty |= writable;
    *view = (struct shared_view){f->base + offset, length, f, shared_views};
    shared_views = view;
    unlock_maps();
    close(owned_fd); free(base); free(created);
    return view->addr;
  }
  if (f) {
    /* Growth: the old generation's bytes are newer than the file. */
    memcpy(base, f->base, f->capacity);
    f->superseded = 1;
    writable |= f->dirty;
    if (f->fd_writable && !writable_fd) {
      /* Superseded generations never write back; keep the writable fd. */
      int swapped = f->fd;
      f->fd = owned_fd;
      f->fd_writable = 0;
      owned_fd = swapped;
      writable_fd = 1;
    }
  }
  *created = (struct shared_file){(char *)base, capacity, st->st_dev,
                                  st->st_ino, owned_fd, writable_fd, writable,
                                  0, 1, shared_files};
  shared_files = created;
  *view = (struct shared_view){created->base + offset, length, created,
                               shared_views};
  shared_views = view;
  unlock_maps();
  return view->addr;
}

void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset) {
  if (length == 0) {
    errno = EINVAL;
    return MAP_FAILED;
  }

  /* Commit / decommit over a previously reserved region. */
  if ((flags & MAP_FIXED) && addr != NULL) {
    return addr;
  }

  if (!(flags & MAP_ANONYMOUS)) {
    if (fd < 0) {
      errno = EBADF;
      return MAP_FAILED;
    }
    struct stat st;
    if (fstat(fd, &st) != 0) return MAP_FAILED;
    /* Only regular files (including memfd and shm_open files) alias; a
     * shared map of a device such as /dev/zero gets its own copy. */
    if ((flags & MAP_SHARED) && S_ISREG(st.st_mode))
      return map_shared_file(length, prot, fd, offset, &st);
    /* File-backed private mappings retain copy-on-map behavior; the copy
     * reflects a live shared mapping of the same file, as the page cache
     * would. */
    void *p = NULL;
    if (allocate_mapping(&p, length) != 0) {
      return MAP_FAILED;
    }
    if (read_backing(fd, p, length, offset) != 0) {
      free(p);
      return MAP_FAILED;
    }
    lock_maps();
    struct shared_file *f = find_file(st.st_dev, st.st_ino);
    if (f && offset >= 0 && (uint64_t)offset < f->capacity) {
      size_t n = f->capacity - (size_t)offset;
      memcpy(p, f->base + offset, n < length ? n : length);
    }
    unlock_maps();
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
  lock_maps();
  struct shared_view **slot = find_view(addr, length);
  if (slot) {
    struct shared_view *v = *slot;
    struct shared_file *f = v->file;
    *slot = v->next;
    if (--f->views != 0) {
      unlock_maps();
      free(v);
      return 0;
    }
    struct shared_file **fslot = &shared_files;
    while (*fslot != f) fslot = &(*fslot)->next;
    *fslot = f->next;
    /* Persist mapped writes so a later mapping or read sees them.  A
     * superseded generation was already copied into its successor. */
    if (f->dirty && f->fd_writable && !f->superseded)
      (void)sync_backing(f, 0, f->capacity);
    unlock_maps();
    close(f->fd);
    free(f->base);
    free(f);
    free(v);
    return 0;
  }
  unlock_maps();
  free(addr);
  return 0;
}

int mprotect(void *addr, size_t len, int prot) {
  /* No page protection in Wasm; only note shared views becoming writable
   * so that their backing is written back on the last munmap. */
  if (prot & PROT_WRITE) {
    lock_maps();
    struct shared_file *f = find_backing(addr, len);
    if (f) f->dirty = 1;
    unlock_maps();
  }
  return 0;
}

void *mremap(void *old_addr, size_t old_size, size_t new_size, int flags, ...) {
  (void)flags;
  if (new_size == old_size) {
    return old_addr;
  }
  lock_maps();
  struct shared_view **slot = find_view(old_addr, old_size);
  if (slot) {
    /* A shared view can only be resized within its backing. */
    struct shared_view *v = *slot;
    struct shared_file *f = v->file;
    size_t room = f->capacity - (size_t)(v->addr - f->base);
    if (v->addr == old_addr && new_size <= room) {
      v->length = new_size;
      unlock_maps();
      return old_addr;
    }
    unlock_maps();
    errno = ENOMEM;
    return MAP_FAILED;
  }
  unlock_maps();
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
  struct shared_file *f = find_backing(addr, length);
  int result = 0;
  if (f && !f->superseded && f->fd_writable) {
    result = sync_backing(f, (size_t)((char *)addr - f->base), length);
  }
  unlock_maps();
  return result;
}

/* Re-read a shared range from its file, e.g. after another address space
 * wrote the file.  Within this process the backing already aliases every
 * shared view, so callers that pair msync with refresh stay correct. */
int lowland_mmap_refresh(void *addr, size_t length) {
  lock_maps();
  struct shared_file *f = find_backing(addr, length);
  if (!f) { unlock_maps(); errno = EINVAL; return -1; }
  int result = read_backing(f->fd, addr, length,
                            (off_t)((char *)addr - f->base));
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
