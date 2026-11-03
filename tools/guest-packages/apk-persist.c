/* Explicit signed APK generations for the Linux/Wasm desktop.
 * Native checked I/O and subprocess statuses; no shell transaction assumptions.
 * Package payloads/world persist. Arbitrary changes outside /home do not.
 */
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/wait.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <openssl/sha.h>
#include <signal.h>
#include <spawn.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <zlib.h>

extern char **environ;
#define STATE "/home/.linuxonweb-packages"
#define BASE "/etc/linuxonweb-packages"
#define APK "/sbin/apk"
#define MAX_PACKAGES 256
#define MAX_OPTIONAL 128
#define MAX_ENTRIES (MAX_OPTIONAL + 3)
#define MAX_SNAPSHOT (256ULL * 1024 * 1024)
#define MAX_METADATA (4 * 1024 * 1024)

typedef struct { char name[128], version[128], checksum[128]; } Package;
typedef struct { Package p[MAX_PACKAGES]; size_t n; } Inventory;
typedef struct { char name[256], hash[65]; } Entry;
typedef struct { Entry e[MAX_ENTRIES]; size_t n; } Manifest;
typedef struct { char name[128], hash[65], dir[PATH_MAX]; } Generation;
static volatile sig_atomic_t interrupted;
static pid_t owned_child = -1;
static char stage_path[PATH_MAX];
static int state_lock = -1, database_lock = -1;
static double operation_deadline;

static void on_signal(int sig) { interrupted = sig; }
static double now(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t)) {
    fprintf(stderr, "apk-persist: monotonic clock unavailable\n");
    if (owned_child > 0) kill(owned_child, SIGKILL);
    _exit(1);
  }
  return t.tv_sec + t.tv_nsec / 1e9;
}
static void pause_ms(unsigned ms) {
  struct timespec t = { ms / 1000, (long)(ms % 1000) * 1000000 };
  while (nanosleep(&t, &t) && errno == EINTR) {}
}
static void stop_child(void) {
  if (owned_child <= 0) return;
  /* Keep the leader unreaped until the owned group is terminated: its PID
     cannot be reused as an unrelated process-group identity during cleanup. */
  kill(-owned_child, SIGTERM);
  double end = now() + 1.0;
  while (now() < end) pause_ms(20);
  kill(-owned_child, SIGKILL);
  int status;
  while (waitpid(owned_child, &status, 0) < 0 && errno == EINTR) {}
  owned_child = -1;
}
static _Noreturn void die(const char *format, ...) {
  int saved = errno;
  stop_child();
  fprintf(stderr, "apk-persist: ");
  va_list args; va_start(args, format); vfprintf(stderr, format, args); va_end(args);
  fprintf(stderr, "\n");
  if (stage_path[0]) fprintf(stderr, "apk-persist: no success acknowledgement; staging or completed generation evidence=%s\n", stage_path);
  if (database_lock >= 0) close(database_lock);
  if (state_lock >= 0) close(state_lock);
  errno = saved;
  exit(interrupted ? 128 + interrupted : 1);
}
static void check_cancel(void) {
  if (interrupted) die("interrupted before acknowledgement");
  if (operation_deadline && now() > operation_deadline) die("operation exceeded300-second total bound");
}
static void acknowledge(const char *format, ...) {
  check_cancel();
  va_list args; va_start(args, format); int n = vprintf(format, args); va_end(args);
  if (n < 0 || fflush(stdout) || ferror(stdout)) die("success acknowledgement could not be written");
}
#ifdef APK_PERSIST_TEST_HOOKS
/* Present only in explicitly instrumented test builds. Default binary must stay
   byte-identical when these source-only checkpoints are added. */
static void test_checkpoint(const char *point) {
  const char *selected = getenv("APK_PERSIST_TEST_STOP");
  if (selected && !strcmp(selected, point)) {
    check_cancel();
    if (raise(SIGSTOP)) die("test checkpoint stop failed");
  }
}
#endif
static void checked_path(char *out, size_t cap, const char *format, ...) {
  va_list args; va_start(args, format); int n = vsnprintf(out, cap, format, args); va_end(args);
  if (n < 0 || (size_t)n >= cap) die("path exceeds supported bound");
}
static bool plain_token(const char *s, bool constraint) {
  if (!*s || *s == '-' || strlen(s) >= 128) return false;
  for (const unsigned char *p = (const unsigned char *)s; *p; ++p)
    if (!( (*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
           (*p >= '0' && *p <= '9') || strchr("._+-", *p) ||
           (constraint && strchr("@=~<>!:", *p)))) return false;
  return true;
}
static bool hex64(const char *s) {
  if (strlen(s) != 64) return false;
  for (size_t i = 0; i < 64; ++i) if (!strchr("0123456789abcdef", s[i])) return false;
  return true;
}
static int open_regular(const char *path) {
  int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) die("open %s: %s", path, strerror(errno));
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode)) { close(fd); die("regular file required: %s", path); }
  return fd;
}
static void write_all(int fd, const void *data, size_t size) {
  const unsigned char *at = data;
  while (size) {
    check_cancel();
    ssize_t n = write(fd, at, size);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) die("write: %s", strerror(errno));
    at += n; size -= (size_t)n;
  }
}
static char *read_text(const char *path, size_t limit, size_t *length) {
  int fd = open_regular(path); struct stat st;
  if (fstat(fd, &st) || st.st_size < 0 || (uint64_t)st.st_size > limit) die("metadata size bound: %s", path);
  size_t cap = st.st_size ? (size_t)st.st_size : (limit < 4096 ? limit : 4096), at = 0;
  char *data = malloc(cap + 1); if (!data) die("out of memory");
  for (;;) {
    check_cancel();
    if (at == cap) {
      if (cap == limit) {
        char extra; ssize_t n = read(fd, &extra, 1);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) die("metadata read: %s", strerror(errno));
        if (n) die("metadata size bound: %s", path);
        break;
      }
      size_t next = cap > limit / 2 ? limit : cap * 2;
      char *larger = realloc(data, next + 1); if (!larger) die("out of memory"); data = larger; cap = next;
    }
    ssize_t n = read(fd, data + at, cap - at);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) die("metadata read %s: %s", path, strerror(errno));
    if (!n) break; at += (size_t)n;
  }
  if (close(fd)) die("close read %s: %s", path, strerror(errno));
  if (memchr(data, 0, at)) die("NUL in metadata: %s", path);
  data[at] = 0; if (length) *length = at; return data;
}
static void sync_dir(const char *path) {
  int fd = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) die("open directory %s: %s", path, strerror(errno));
  if (fsync(fd)) die("directory fsync %s: %s", path, strerror(errno));
  if (close(fd)) die("directory close: %s", strerror(errno));
}
static void write_new(const char *path, const void *data, size_t size) {
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) die("create %s: %s", path, strerror(errno));
  write_all(fd, data, size);
  if (fsync(fd)) die("fsync %s: %s", path, strerror(errno));
  if (close(fd)) die("close %s: %s", path, strerror(errno));
}
static uint64_t copy_new(const char *source, const char *destination) {
  int input = open_regular(source);
  int output = open(destination, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (output < 0) die("create %s: %s", destination, strerror(errno));
  unsigned char buffer[32768]; uint64_t total = 0;
  for (;;) {
    check_cancel();
    ssize_t n = read(input, buffer, sizeof buffer);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) die("read %s: %s", source, strerror(errno));
    if (!n) break;
    total += (uint64_t)n;
    if (total > MAX_SNAPSHOT) die("single file exceeds snapshot bound");
    write_all(output, buffer, (size_t)n);
  }
  if (fsync(output)) die("fsync copied %s: %s", destination, strerror(errno));
  if (close(output)) die("copy output close: %s", strerror(errno));
  if (close(input)) die("copy input close: %s", strerror(errno));
  return total;
}
static void sha256_file(const char *path, char output[65]) {
  int fd = open_regular(path);
  SHA256_CTX context;
  if (!SHA256_Init(&context)) die("SHA256 initialization failed");
  unsigned char data[32768], digest[SHA256_DIGEST_LENGTH];
  for (;;) {
    check_cancel(); ssize_t n = read(fd, data, sizeof data);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) die("hash read %s: %s", path, strerror(errno));
    if (!n) break;
    if (!SHA256_Update(&context, data, (size_t)n)) die("SHA256 update failed");
  }
  if (close(fd) || !SHA256_Final(digest, &context)) die("SHA256 completion failed");
  for (size_t i = 0; i < sizeof digest; ++i) snprintf(output + i * 2, 3, "%02x", digest[i]);
  output[64] = 0;
}
static bool same_text(const char *a, const char *b) {
  size_t an, bn; char *av = read_text(a, MAX_METADATA, &an), *bv = read_text(b, MAX_METADATA, &bn);
  bool equal = an == bn && !memcmp(av, bv, an); free(av); free(bv); return equal;
}
static bool exists(const char *path) {
  struct stat st;
  if (!lstat(path, &st)) return true;
  if (errno != ENOENT) die("stat %s: %s", path, strerror(errno));
  return false;
}
static void run_checked(char *const argv[], unsigned seconds) {
  check_cancel();
  posix_spawnattr_t attributes;
  int rc = posix_spawnattr_init(&attributes);
  if (rc) die("spawn attributes: %s", strerror(rc));
  rc = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP);
  if (!rc) rc = posix_spawnattr_setpgroup(&attributes, 0);
  if (rc) die("owned process-group attributes: %s", strerror(rc));
  rc = posix_spawn(&owned_child, argv[0], NULL, &attributes, argv, environ);
  posix_spawnattr_destroy(&attributes);
  if (rc) { owned_child = -1; die("spawn %s: %s", argv[0], strerror(rc)); }
  double deadline = now() + seconds;
  int status;
  for (;;) {
    pid_t result = waitpid(owned_child, &status, WNOHANG);
    if (result == owned_child) break;
    if (result < 0 && errno != EINTR) die("wait for %s: %s", argv[0], strerror(errno));
    if (interrupted) die("interrupted while %s was running", argv[0]);
    check_cancel();
    if (now() > deadline) die("%s exceeded %u-second operation bound", argv[0], seconds);
    pause_ms(20);
  }
  owned_child = -1;
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0)
    die("native %s failed (status=%d signal=%d); no persistence acknowledgement", argv[0],
        WIFEXITED(status) ? WEXITSTATUS(status) : -1, WIFSIGNALED(status) ? WTERMSIG(status) : 0);
}
static int package_compare(const void *a, const void *b) { return strcmp(((const Package *)a)->name, ((const Package *)b)->name); }
static void inventory_finish(Inventory *out) {
  qsort(out->p, out->n, sizeof out->p[0], package_compare);
  for (size_t i = 0; i < out->n; ++i) {
    Package *p = &out->p[i];
    if (!plain_token(p->name, false) || !plain_token(p->version, true) || strncmp(p->checksum, "Q1", 2) || strlen(p->checksum) < 10)
      die("invalid package identity in native database");
    if (i && !strcmp(p->name, out->p[i-1].name)) die("duplicate package identity");
  }
}
static void field(char *out, size_t cap, const char *in) {
  size_t n = strlen(in);
  if (!n || n >= cap || strpbrk(in, " \r\t\n")) die("invalid package field");
  memcpy(out, in, n + 1);
}
static Inventory parse_database(char *data) {
  Inventory out = {0}; Package current = {0};
  char *line = data;
  for (;;) {
    char *end = strchr(line, '\n'); if (end) *end = 0;
    if (!*line) {
      if (current.name[0]) {
        if (out.n == MAX_PACKAGES) die("package count bound exceeded");
        out.p[out.n++] = current; memset(&current, 0, sizeof current);
      }
    } else if (!strncmp(line, "P:", 2)) field(current.name, sizeof current.name, line + 2);
    else if (!strncmp(line, "V:", 2)) field(current.version, sizeof current.version, line + 2);
    else if (!strncmp(line, "C:", 2)) field(current.checksum, sizeof current.checksum, line + 2);
    if (!end) break;
    line = end + 1;
  }
  if (current.name[0]) {
    if (out.n == MAX_PACKAGES) die("package count bound exceeded");
    out.p[out.n++] = current;
  }
  inventory_finish(&out); return out;
}
static Inventory installed_now(void) {
  char *data = read_text("/lib/apk/db/installed", MAX_METADATA, NULL);
  Inventory out = parse_database(data); free(data); return out;
}
static Inventory read_inventory(const char *path) {
  char *text = read_text(path, MAX_METADATA, NULL), *at = text;
  Inventory out = {0};
  while (*at) {
    char *end = strchr(at, '\n'); if (!end) die("unterminated inventory line"); *end = 0;
    if (out.n == MAX_PACKAGES) die("inventory package count bound");
    char extra[2]; Package *p = &out.p[out.n++];
    if (sscanf(at, "%127s %127s %127s %1s", p->name, p->version, p->checksum, extra) != 3) die("invalid inventory line");
    at = end + 1;
  }
  free(text); inventory_finish(&out); return out;
}
static bool package_equal(const Package *a, const Package *b) {
  return !strcmp(a->name,b->name) && !strcmp(a->version,b->version) && !strcmp(a->checksum,b->checksum);
}
static bool inventory_equal(const Inventory *a, const Inventory *b) {
  if (a->n != b->n) return false;
  for (size_t i = 0; i < a->n; ++i) if (!package_equal(&a->p[i], &b->p[i])) return false;
  return true;
}
static const Package *lookup(const Inventory *i, const char *name) {
  for (size_t n = 0; n < i->n; ++n) if (!strcmp(i->p[n].name, name)) return &i->p[n];
  return NULL;
}
static Inventory optional_packages(const Inventory *all, const Inventory *base) {
  Inventory result = {0};
  for (size_t i = 0; i < base->n; ++i) {
    const Package *p = lookup(all, base->p[i].name);
    if (!p || !package_equal(p, &base->p[i])) die("base package changed: %s; this schema does not persist base replacement", base->p[i].name);
  }
  for (size_t i = 0; i < all->n; ++i) if (!lookup(base, all->p[i].name)) {
    if (result.n == MAX_OPTIONAL) die("optional package count exceeds128");
    result.p[result.n++] = all->p[i];
  }
  return result;
}
static void write_inventory(const char *path, const Inventory *inventory) {
  size_t cap = inventory->n * 400 + 1, used = 0;
  char *text = malloc(cap); if (!text) die("out of memory");
  for (size_t i = 0; i < inventory->n; ++i) {
    const Package *p = &inventory->p[i];
    int n = snprintf(text + used, cap - used, "%s %s %s\n", p->name, p->version, p->checksum);
    if (n < 0 || (size_t)n >= cap - used) die("inventory serialization bound");
    used += (size_t)n;
  }
  write_new(path, text, used); free(text);
}

static void checked_directory(const char *path, bool create) {
  if (create && mkdir(path, 0700) && errno != EEXIST) die("mkdir %s: %s", path, strerror(errno));
  struct stat st;
  if (lstat(path, &st) || !S_ISDIR(st.st_mode) || st.st_uid != 0 || (st.st_mode & 0022))
    die("root-owned non-writable directory required: %s", path);
}
static void checked_state_file(const char *path) {
  struct stat st;
  if (lstat(path, &st) || !S_ISREG(st.st_mode) || st.st_uid != 0 || (st.st_mode & 0022))
    die("root-owned regular snapshot file required: %s", path);
}
static void require_persistent_home(void) {
  char *mounts = read_text("/proc/self/mounts", MAX_METADATA, NULL);
  bool found = false; char *save = NULL;
  for (char *line = strtok_r(mounts, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
    char source[256], target[256], kind[64], options[256];
    if (sscanf(line, "%255s %255s %63s %255s", source, target, kind, options) == 4 &&
        !strcmp(target, "/home") && !strcmp(kind, "virtiofs")) found = true;
  }
  free(mounts);
  if (!found) die("persistent /home virtiofs mount is required; no state was saved");
}
static int lock_file(const char *path) {
  int fd = open(path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) die("lock file %s: %s", path, strerror(errno));
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid != 0 || (st.st_mode & 0022)) die("unsafe lock file: %s", path);
  if (flock(fd, LOCK_EX | LOCK_NB)) die("another package operation owns %s", path);
  return fd;
}
static void verify_trust(void) {
  char *text = read_text(BASE "/trust.sha256", MAX_METADATA, NULL), *at = text;
  Entry entries[32]; size_t count = 0;
  while (*at) {
    char *end = strchr(at, '\n'); if (!end) die("unterminated trust metadata"); *end = 0;
    if (count == 32) die("too many trust keys");
    char extra[2]; Entry *entry = &entries[count++];
    if (sscanf(at, "%64s %255s %1s", entry->hash, entry->name, extra) != 2 || !hex64(entry->hash) ||
        strncmp(entry->name, "etc/apk/keys/", 13) || !plain_token(entry->name + 13, false)) die("invalid trust metadata");
    char path[PATH_MAX], actual[65]; checked_path(path, sizeof path, "/%s", entry->name);
    checked_state_file(path); sha256_file(path, actual);
    if (strcmp(actual, entry->hash)) die("signing trust changed; explicit compatible image migration required");
    at = end + 1;
  }
  free(text);
  if (!count) die("empty signing trust");
  DIR *dir = opendir("/etc/apk/keys"); if (!dir) die("open trust directory: %s", strerror(errno));
  struct dirent *entry; size_t found = 0;
  while ((entry = readdir(dir))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    bool known = false;
    for (size_t i = 0; i < count; ++i) if (!strcmp(entry->d_name, entries[i].name + 13)) known = true;
    if (!known) die("unexpected signing key; explicit image trust migration required");
    found++;
  }
  if (closedir(dir)) die("close trust directory: %s", strerror(errno));
  if (found != count) die("incomplete signing trust");
}
static bool package_filename(const char *name) {
  size_t n = strlen(name);
  return n > 4 && n < 256 && !strcmp(name + n - 4, ".apk") &&
         name[0] != '.' && !strchr(name, '/') && !strpbrk(name, " \t\r\n") && !strstr(name, "..");
}
static void package_path(char *out, size_t cap, const char *directory, const Package *p) {
  char name[256]; checked_path(name, sizeof name, "%s-%s.apk", p->name, p->version);
  if (!package_filename(name)) die("unsupported package archive filename");
  checked_path(out, cap, "%s/packages/%s", directory, name);
}
static Manifest read_manifest(const char *directory) {
  char path[PATH_MAX]; checked_path(path, sizeof path, "%s/manifest.sha256", directory);
  char *text = read_text(path, MAX_METADATA, NULL), *at = text;
  Manifest manifest = {0};
  while (*at) {
    char *end = strchr(at, '\n'); if (!end) die("unterminated manifest"); *end = 0;
    if (manifest.n == MAX_ENTRIES) die("manifest entry bound exceeded");
    Entry *entry = &manifest.e[manifest.n++]; char extra[2];
    if (sscanf(at, "%64s %255s %1s", entry->hash, entry->name, extra) != 2 || !hex64(entry->hash)) die("invalid manifest entry");
    bool metadata = !strcmp(entry->name, "world") || !strcmp(entry->name, "installed") || !strcmp(entry->name, "compatibility");
    if (!metadata && (strncmp(entry->name, "packages/", 9) || !package_filename(entry->name + 9))) die("unsafe manifest path");
    for (size_t i = 0; i + 1 < manifest.n; ++i) if (!strcmp(entry->name, manifest.e[i].name)) die("duplicate manifest path");
    at = end + 1;
  }
  free(text); return manifest;
}
static const Entry *manifest_entry(const Manifest *manifest, const char *name) {
  for (size_t i = 0; i < manifest->n; ++i) if (!strcmp(manifest->e[i].name, name)) return &manifest->e[i];
  return NULL;
}
static void inspect_directory(const char *directory, const Manifest *manifest, bool packages) {
  DIR *dir = opendir(directory); if (!dir) die("open snapshot directory: %s", strerror(errno));
  struct dirent *entry;
  while ((entry = readdir(dir))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (!packages && (!strcmp(entry->d_name, "packages") || !strcmp(entry->d_name, "manifest.sha256"))) continue;
    char name[256]; checked_path(name, sizeof name, "%s%s", packages ? "packages/" : "", entry->d_name);
    if (!manifest_entry(manifest, name)) die("unlisted snapshot entry: %s", name);
  }
  if (closedir(dir)) die("snapshot directory close failed");
}
static bool read_pointer(const char *path, Generation *generation) {
  if (!exists(path)) return false;
  checked_state_file(path);
  size_t n; char *text = read_text(path, 512, &n), extra[2];
  if (!n || text[n-1] != '\n' || sscanf(text, "%127s %64s %1s", generation->name, generation->hash, extra) != 2 ||
      strncmp(generation->name, "generation-", 11) || !plain_token(generation->name, false) || !hex64(generation->hash)) die("invalid generation pointer: %s", path);
  free(text); checked_path(generation->dir, sizeof generation->dir, STATE "/%s", generation->name); return true;
}
static void atomic_record(const char *name, const Generation *generation) {
  char temp[PATH_MAX], target[PATH_MAX], text[256];
  checked_path(temp, sizeof temp, STATE "/.pointer-XXXXXX");
  int fd = mkstemp(temp); if (fd < 0) die("create pointer staging file: %s", strerror(errno));
  if (fchmod(fd, 0600)) die("pointer permissions: %s", strerror(errno));
  checked_path(text, sizeof text, "%s %s\n", generation->name, generation->hash);
  write_all(fd, text, strlen(text));
  if (fsync(fd) || close(fd)) die("pointer flush failed: %s", strerror(errno));
  checked_path(target, sizeof target, STATE "/%s", name);
  if (rename(temp, target)) die("activate pointer: %s", strerror(errno));
#ifdef APK_PERSIST_TEST_HOOKS
  if (!strcmp(name, "active")) test_checkpoint("after-active-rename");
#endif
  sync_dir(STATE);
}
static void activate(const Generation *generation) {
  Generation old;
  if (read_pointer(STATE "/active", &old)) atomic_record("previous", &old);
  check_cancel(); atomic_record("active", generation);
}
static void verify_generation(const Generation *generation) {
  char path[PATH_MAX], actual[65];
  checked_directory(generation->dir, false);
  checked_path(path, sizeof path, "%s/manifest.sha256", generation->dir);
  checked_state_file(path); sha256_file(path, actual);
  if (strcmp(actual, generation->hash)) die("active manifest checksum mismatch; saved evidence retained");
  Manifest manifest = read_manifest(generation->dir);
  if (!manifest_entry(&manifest, "world") || !manifest_entry(&manifest, "installed") || !manifest_entry(&manifest, "compatibility")) die("generation metadata incomplete");
  uint64_t total = 0;
  for (size_t i = 0; i < manifest.n; ++i) {
    checked_path(path, sizeof path, "%s/%s", generation->dir, manifest.e[i].name);
    checked_state_file(path); struct stat st;
    if (stat(path, &st) || st.st_size < 0) die("snapshot stat failed");
    total += (uint64_t)st.st_size; if (total > MAX_SNAPSHOT) die("snapshot exceeds256MiB bound");
    sha256_file(path, actual);
    if (strcmp(actual, manifest.e[i].hash)) die("saved file checksum mismatch: %s", manifest.e[i].name);
  }
  checked_path(path, sizeof path, "%s/packages", generation->dir); checked_directory(path, false);
  inspect_directory(path, &manifest, true); inspect_directory(generation->dir, &manifest, false);
  checked_path(path, sizeof path, "%s/compatibility", generation->dir);
  if (!same_text(path, BASE "/compatibility")) die("base image ABI/trust generation mismatch; explicit compatible migration or disable required");
  verify_trust();
  for (size_t i = 0; i < manifest.n; ++i) if (!strncmp(manifest.e[i].name, "packages/", 9)) {
    checked_path(path, sizeof path, "%s/%s", generation->dir, manifest.e[i].name);
    char *argv[] = { APK, "--no-network", "verify", path, NULL }; run_checked(argv, 30);
  }
}
static size_t tar_octal(const unsigned char *text, size_t n) {
  size_t value = 0, i = 0;
  while (i < n && (text[i] == ' ' || text[i] == 0)) ++i;
  for (; i < n && text[i] >= '0' && text[i] <= '7'; ++i) {
    if (value > MAX_METADATA / 8) die("APK index tar entry exceeds metadata bound");
    value = value * 8 + text[i] - '0';
  }
  for (; i < n; ++i) if (text[i] && text[i] != ' ') die("invalid APK index tar size");
  return value;
}
static Inventory read_native_index(const char *path) {
  gzFile file = gzopen(path, "rb"); if (!file) die("open native APK index failed");
  size_t used = 0; unsigned char *data = malloc(MAX_METADATA + 1); if (!data) die("out of memory");
  for (;;) {
    check_cancel(); if (used == MAX_METADATA) die("native APK index metadata exceeds4MiB");
    int n = gzread(file, data + used, (unsigned)(MAX_METADATA - used));
    if (n < 0) die("native APK index gzip integrity failed");
    if (!n) break; used += (size_t)n;
  }
  if (gzclose(file) != Z_OK) die("native APK index gzip close failed");
  Inventory result = {0}; bool found = false;
  for (size_t at = 0; at + 512 <= used;) {
    const unsigned char *header = data + at;
    bool zero = true; for (size_t i = 0; i < 512; ++i) if (header[i]) zero = false;
    if (zero) break;
    size_t size = tar_octal(header + 124, 12);
    if (size > used - at - 512) die("truncated native APK index");
    size_t sum = 0; for (size_t i = 0; i < 512; ++i) sum += (i >= 148 && i < 156) ? ' ' : header[i];
    if (sum != tar_octal(header + 148, 8)) die("native APK index tar checksum failed");
    if (!memcmp(header, "APKINDEX\0", 9)) {
      if (found || header[345] || (header[156] && header[156] != '0')) die("invalid APKINDEX tar entry");
      char *text = malloc(size + 1); if (!text) die("out of memory");
      memcpy(text, header + 512, size); text[size] = 0;
      if (memchr(text, 0, size)) die("NUL in native APK index");
      result = parse_database(text); free(text); found = true;
    }
    at += 512 + (size + 511) / 512 * 512;
  }
  free(data); if (!found) die("native index did not contain APKINDEX"); return result;
}
static Inventory archive_inventory(const char *directory, const Inventory *wanted) {
  Inventory result = {0}; if (!wanted->n) return result;
  char temp[PATH_MAX] = "/run/apk-persist-index-XXXXXX";
  if (!mkdtemp(temp)) die("create native index workspace failed");
  char index[PATH_MAX]; checked_path(index, sizeof index, "%s/index.tar.gz", temp);
  char *argv[MAX_OPTIONAL + 9] = { APK, "--no-network", "--repositories-file", "/dev/null", "index", "-o", index };
  char *paths[MAX_OPTIONAL] = {0};
  for (size_t i = 0; i < wanted->n; ++i) {
    paths[i] = malloc(PATH_MAX); if (!paths[i]) die("out of memory");
    package_path(paths[i], PATH_MAX, directory, &wanted->p[i]); argv[7 + i] = paths[i];
  }
  argv[7 + wanted->n] = NULL; run_checked(argv, 60); result = read_native_index(index);
  for (size_t i = 0; i < wanted->n; ++i) free(paths[i]);
  if (unlink(index) || rmdir(temp)) die("clean native index workspace failed");
  return result;
}

static void require_base_world(const char *world_path) {
  char *base = read_text(BASE "/base-world", MAX_METADATA, NULL);
  char *world = read_text(world_path, MAX_METADATA, NULL), *save = NULL;
  for (char *wanted = strtok_r(base, "\n", &save); wanted; wanted = strtok_r(NULL, "\n", &save)) {
    bool present = false; const char *at = world; size_t length = strlen(wanted);
    while (*at) {
      const char *end = strchr(at, '\n'); size_t n = end ? (size_t)(end - at) : strlen(at);
      if (n == length && !memcmp(at, wanted, n)) present = true;
      if (!end) break; at = end + 1;
    }
    if (!present) die("base world constraint cannot be removed by persistence v1: %s", wanted);
  }
  free(base); free(world);
}
static Inventory checked_inventory(const Generation *generation, const Inventory *base) {
  verify_generation(generation);
  char path[PATH_MAX]; checked_path(path, sizeof path, "%s/installed", generation->dir);
  Inventory all = read_inventory(path), optional = optional_packages(&all, base);
  Manifest manifest = read_manifest(generation->dir);
  if (manifest.n != optional.n + 3) die("archive set differs from installed snapshot");
  for (size_t i = 0; i < optional.n; ++i) {
    char name[256]; checked_path(name, sizeof name, "packages/%s-%s.apk", optional.p[i].name, optional.p[i].version);
    if (!manifest_entry(&manifest, name)) die("installed package archive is absent: %s", optional.p[i].name);
  }
  Inventory actual = archive_inventory(generation->dir, &optional);
  if (!inventory_equal(&actual, &optional)) die("signed archive P/V/C identity differs from installed snapshot; no package replayed");
  checked_path(path, sizeof path, "%s/world", generation->dir); require_base_world(path);
  return all;
}
static void verify_native_base(void) {
  char *metadata = read_text(BASE "/compatibility", MAX_METADATA, NULL);
  const char *fields[] = {"apkNativeSha256", "busyboxNativeSha256"};
  const char *files[] = {APK, "/bin/busybox"};
  for (size_t i = 0; i < 2; ++i) {
    char key[80], expected[65], actual[65]; checked_path(key, sizeof key, "\"%s\": \"", fields[i]);
    char *at = strstr(metadata, key); if (!at) die("base compatibility metadata incomplete"); at += strlen(key);
    if (strlen(at) < 65 || at[64] != '"') die("invalid base compatibility hash");
    memcpy(expected, at, 64); expected[64] = 0; if (!hex64(expected)) die("invalid base compatibility hash");
    sha256_file(files[i], actual); if (strcmp(expected, actual)) die("protected native package runtime changed: %s", files[i]);
  }
  free(metadata); verify_trust();
}
static void verify_pristine_database(void) {
  char *metadata = read_text(BASE "/compatibility", MAX_METADATA, NULL);
  const char *key = "\"baseInstalledDatabaseSha256\": \""; char *at = strstr(metadata, key);
  if (!at) die("base database identity missing"); at += strlen(key);
  if (strlen(at) < 65 || at[64] != '"') die("invalid base database identity");
  char expected[65], actual[65]; memcpy(expected, at, 64); expected[64] = 0;
  if (!hex64(expected)) die("invalid base database hash");
  sha256_file("/lib/apk/db/installed", actual); free(metadata);
  if (strcmp(expected, actual)) die("restore requires pristine base DB; Stop and Start before restoring");
}
static void snapshot_manifest(const char *directory, const Inventory *optional, char hash[65]) {
  Manifest manifest = {0};
  const char *names[] = {"compatibility", "installed", "world"};
  for (size_t i = 0; i < 3; ++i) field(manifest.e[manifest.n++].name, sizeof manifest.e[0].name, names[i]);
  for (size_t i = 0; i < optional->n; ++i) {
    Entry *entry = &manifest.e[manifest.n++];
    checked_path(entry->name, sizeof entry->name, "packages/%s-%s.apk", optional->p[i].name, optional->p[i].version);
  }
  size_t cap = manifest.n * 330 + 1, used = 0; char *text = malloc(cap); if (!text) die("out of memory");
  uint64_t total = 0;
  for (size_t i = 0; i < manifest.n; ++i) {
    char path[PATH_MAX]; checked_path(path, sizeof path, "%s/%s", directory, manifest.e[i].name);
    int fd = open_regular(path); struct stat st;
    if (fstat(fd, &st) || st.st_size < 0) die("snapshot stat failed");
    total += (uint64_t)st.st_size; if (total > MAX_SNAPSHOT) die("snapshot exceeds256MiB");
    if (fsync(fd) || close(fd)) die("snapshot file flush failed: %s", path);
    sha256_file(path, manifest.e[i].hash);
    int n = snprintf(text + used, cap - used, "%s  %s\n", manifest.e[i].hash, manifest.e[i].name);
    if (n < 0 || (size_t)n >= cap - used) die("manifest serialization bound"); used += (size_t)n;
  }
  char path[PATH_MAX]; checked_path(path, sizeof path, "%s/manifest.sha256", directory);
  write_new(path, text, used); free(text); sha256_file(path, hash);
  checked_path(path, sizeof path, "%s/packages", directory); sync_dir(path); sync_dir(directory);
}
static void save_snapshot(const Inventory *base) {
  double start = now(); verify_native_base();
  database_lock = lock_file("/lib/apk/db/lock");
  Inventory all = installed_now(), optional = optional_packages(&all, base);
  require_base_world("/etc/apk/world");
  /* Upstream APK_SIMULATE clears database write/create flags before opening it. */
  char *simulate[] = {APK, "--no-network", "--repositories-file", "/dev/null", "--simulate", "fix", NULL};
  run_checked(simulate, 60);
  Generation previous; Inventory previous_all = {0}; bool have_previous = read_pointer(STATE "/active", &previous);
  if (have_previous) previous_all = checked_inventory(&previous, base);
  checked_path(stage_path, sizeof stage_path, STATE "/.staging-XXXXXX");
  if (!mkdtemp(stage_path)) die("create snapshot staging directory: %s", strerror(errno));
  char path[PATH_MAX]; checked_path(path, sizeof path, "%s/packages", stage_path); checked_directory(path, true);
  checked_path(path, sizeof path, "%s/compatibility", stage_path); copy_new(BASE "/compatibility", path);
  checked_path(path, sizeof path, "%s/world", stage_path); copy_new("/etc/apk/world", path);
  checked_path(path, sizeof path, "%s/installed", stage_path); write_inventory(path, &all);
  for (size_t i = 0; i < optional.n; ++i) {
    const Package *package = &optional.p[i], *old = have_previous ? lookup(&previous_all, package->name) : NULL;
    char target[PATH_MAX]; package_path(target, sizeof target, stage_path, package);
    if (old && package_equal(old, package)) {
      char source[PATH_MAX]; package_path(source, sizeof source, previous.dir, package); copy_new(source, target);
    } else {
      char packages[PATH_MAX]; checked_path(packages, sizeof packages, "%s/packages", stage_path);
      /* apk2 fetch defaults to exact name matching, not dependency syntax.
         The required installed filename and native C identity are checked below;
         an index containing only a newer/rebuilt payload therefore fails closed. */
      char *fetch[] = {APK, "fetch", "--output", packages, (char *)package->name, NULL}; run_checked(fetch, 90);
      checked_state_file(target);
    }
    char *verify[] = {APK, "--no-network", "verify", target, NULL}; run_checked(verify, 30);
  }
  Inventory archived = archive_inventory(stage_path, &optional);
  if (!inventory_equal(&archived, &optional)) die("fetched signed archive has different P/V/C identity; snapshot was not activated");
  /* Do not accept any extra fetched payload, or a concurrent world/DB change. */
  Inventory current = installed_now(); if (!inventory_equal(&current, &all)) die("native database changed during locked snapshot");
  checked_path(path, sizeof path, "%s/world", stage_path); if (!same_text(path, "/etc/apk/world")) die("world changed during snapshot");
  Generation next = {0}; snapshot_manifest(stage_path, &optional, next.hash);
  Manifest manifest = read_manifest(stage_path); checked_path(path, sizeof path, "%s/packages", stage_path); inspect_directory(path, &manifest, true);
  const char *suffix = strrchr(stage_path, '-'); if (!suffix || strlen(suffix + 1) != 6) die("invalid staging identity");
  checked_path(next.name, sizeof next.name, "generation-%s", suffix + 1);
  checked_path(next.dir, sizeof next.dir, STATE "/%s", next.name);
  if (exists(next.dir)) die("generation identity collision; old data retained");
  if (rename(stage_path, next.dir)) die("finalize immutable generation: %s", strerror(errno));
  checked_path(stage_path, sizeof stage_path, "%s", next.dir); sync_dir(STATE);
#ifdef APK_PERSIST_TEST_HOOKS
  test_checkpoint("before-activate");
#endif
  activate(&next); stage_path[0] = 0;
  if (close(database_lock)) die("database lock close failed"); database_lock = -1;
  acknowledge("APK_PERSIST_SAVED generation=%s optional=%zu elapsed=%.3f manifest=%s\n", next.name, optional.n, now() - start, next.hash);
  fflush(stdout);
}
static void install_archives(const char *directory, const Inventory *optional, bool simulate) {
  if (!optional->n) return;
  char *argv[MAX_OPTIONAL + 9] = {APK, "--no-network", "--repositories-file", "/dev/null"};
  size_t offset = 4; if (simulate) argv[offset++] = "--simulate"; argv[offset++] = "add";
  char *paths[MAX_OPTIONAL] = {0};
  for (size_t i = 0; i < optional->n; ++i) {
    paths[i] = malloc(PATH_MAX); if (!paths[i]) die("out of memory");
    package_path(paths[i], PATH_MAX, directory, &optional->p[i]); argv[offset + i] = paths[i];
  }
  argv[offset + optional->n] = NULL; run_checked(argv, simulate ? 60 : 180);
  for (size_t i = 0; i < optional->n; ++i) free(paths[i]);
}
static void restore_snapshot(const Inventory *base) {
  double start = now(); Generation generation;
  if (!read_pointer(STATE "/active", &generation)) {
    acknowledge("APK_PERSIST_BASE no active generation; native apk changes remain session-only\n"); return;
  }
  verify_native_base(); Inventory wanted = checked_inventory(&generation, base);
  Inventory optional = optional_packages(&wanted, base);
  Inventory current = installed_now();
  if (!inventory_equal(&current, base)) die("restore is only valid before desktop launch from pristine base; Stop and Start");
  verify_pristine_database();
  install_archives(generation.dir, &optional, true);
  install_archives(generation.dir, &optional, false);
  database_lock = lock_file("/lib/apk/db/lock");
  current = installed_now(); if (!inventory_equal(&current, &wanted)) die("replayed package identity mismatch; desktop must remain stopped");
  char source[PATH_MAX], target[PATH_MAX] = "/etc/apk/.world-persist-XXXXXX";
  checked_path(source, sizeof source, "%s/world", generation.dir);
  int fd = mkstemp(target); if (fd < 0) die("create restored world temporary file failed");
  if (close(fd) || unlink(target)) die("prepare restored world temporary path failed");
  copy_new(source, target);
  if (rename(target, "/etc/apk/world")) die("restore exact world failed"); sync_dir("/etc/apk");
  if (!same_text(source, "/etc/apk/world")) die("restored world mismatch");
  char *simulate[] = {APK, "--no-network", "--repositories-file", "/dev/null", "--simulate", "fix", NULL}; run_checked(simulate, 60);
  if (close(database_lock)) die("database lock close failed"); database_lock = -1;
  acknowledge("APK_PERSIST_RESTORED generation=%s optional=%zu elapsed=%.3f offline=1 exactWorld=1\n", generation.name, optional.n, now() - start); fflush(stdout);
}
static void change_packages(int argc, char **argv, const Inventory *base, bool add) {
  if (argc < 3 || argc - 2 > MAX_OPTIONAL) die("usage: apk-persist add|del PACKAGE...");
  char *command[MAX_OPTIONAL + 4] = {APK, add ? "add" : "del"};
  for (int i = 2; i < argc; ++i) {
    if (!plain_token(argv[i], add)) die("invalid package request; options/paths are not accepted");
    char name[128]; size_t n = strcspn(argv[i], "@=~<>!:");
    if (!n || n >= sizeof name) die("invalid package name"); memcpy(name, argv[i], n); name[n] = 0;
    if (lookup(base, name)) die("base package %s is protected; image migration required", name);
    command[i] = argv[i];
  }
  command[argc] = NULL; verify_native_base();
  puts("apk-persist: package operation pending; persistence is acknowledged only by APK_PERSIST_SAVED"); fflush(stdout);
  run_checked(command, 180); save_snapshot(base);
}
static void disable_persistence(void) {
  if (exists(STATE "/active")) {
    /* Preserve even a malformed pointer without parsing or following it. */
    char evidence[PATH_MAX] = STATE "/disabled-evidence-XXXXXX";
    int fd = mkstemp(evidence); if (fd < 0) die("create disabled evidence path failed");
    if (close(fd)) die("close disabled evidence path failed");
    if (rename(STATE "/active", evidence)) die("disable active pointer: %s", strerror(errno));
    sync_dir(STATE);
    acknowledge("APK_PERSIST_DISABLED evidence=%s; saved generations retained; Stop and Start for pristine base\n", evidence);
  } else acknowledge("APK_PERSIST_DISABLED no active pointer; saved generations retained; Stop and Start for pristine base\n");
}
static void activate_saved(const char *pointer, const Inventory *base) {
  Generation generation;
  if (!read_pointer(pointer, &generation)) die("requested saved pointer is absent");
  verify_native_base(); checked_inventory(&generation, base); activate(&generation);
  acknowledge("APK_PERSIST_SELECTED generation=%s; Stop and Start to restore\n", generation.name);
}
int main(int argc, char **argv) {
  umask(077); operation_deadline = now() + 300;
  struct sigaction action = {0}; action.sa_handler = on_signal; sigemptyset(&action.sa_mask);
  if (sigaction(SIGINT, &action, NULL) || sigaction(SIGTERM, &action, NULL) || sigaction(SIGHUP, &action, NULL)) die("signal setup failed");
  if (argc < 2) { fprintf(stderr, "Usage: sudo apk-persist add|del PACKAGE... | save | restore | status | disable | previous\n"); return 2; }
  if (geteuid() != 0) die("run with sudo; persistence state is root-owned");
  require_persistent_home(); checked_directory(STATE, true);
  state_lock = lock_file("/run/apk-persist.lock");
  if (!strcmp(argv[1], "disable")) {
    if (argc != 2) die("disable accepts no additional arguments");
    disable_persistence();
    if (close(state_lock)) die("state lock close failed"); state_lock = -1;
    return 0;
  }
  Inventory base = read_inventory(BASE "/installed");
  if (!strcmp(argv[1], "add")) change_packages(argc, argv, &base, true);
  else if (!strcmp(argv[1], "del")) change_packages(argc, argv, &base, false);
  else {
    if (argc != 2) die("this command accepts no additional arguments");
    if (!strcmp(argv[1], "save")) save_snapshot(&base);
    else if (!strcmp(argv[1], "restore")) restore_snapshot(&base);
    else if (!strcmp(argv[1], "previous")) activate_saved(STATE "/previous", &base);
    else if (!strcmp(argv[1], "status")) {
      Generation generation;
      if (read_pointer(STATE "/active", &generation)) {
        verify_native_base(); Inventory all = checked_inventory(&generation, &base), optional = optional_packages(&all, &base);
        acknowledge("APK_PERSIST_ACTIVE generation=%s optional=%zu verified=1\n", generation.name, optional.n);
      } else acknowledge("APK_PERSIST_BASE no active generation; native apk is session-only\n");
    } else die("unknown command: %s", argv[1]);
  }
  if (close(state_lock)) die("state lock close failed"); state_lock = -1;
  return 0;
}
