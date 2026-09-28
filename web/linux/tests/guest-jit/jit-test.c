// SPDX-License-Identifier: MIT
// Actual-guest test of the runtime code-install primitive (guest-jit.js).
// Builds tiny WebAssembly modules in memory, installs them through the private
// syscalls and calls them through ordinary C function pointers.
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define SYS_jit_install 0x6a490001
#define SYS_jit_free 0x6a490002
#define SYS_jit_sync 0x6a490003
#define SYS_jit_stats 0x6a490004

typedef int (*fn1)(int);
typedef int (*fn2)(int, int);

static int passes, failures;
#define CHECK(name, cond)                                                                  \
    do {                                                                                   \
        if (cond) {                                                                        \
            passes++;                                                                      \
        } else {                                                                           \
            failures++;                                                                    \
            printf("GUEST_JIT FAIL %s (%s:%d)\n", name, __FILE__, __LINE__);               \
            fflush(stdout);                                                                \
        }                                                                                  \
    } while (0)

// ---- module builder -------------------------------------------------------
typedef struct {
    uint8_t *p;
    size_t n, cap;
} buf;
static void put(buf *b, uint8_t v) {
    if (b->n == b->cap) {
        b->cap = b->cap ? b->cap * 2 : 256;
        b->p = realloc(b->p, b->cap);
        if (!b->p)
            abort();
    }
    b->p[b->n++] = v;
}
static void putn(buf *b, const void *d, size_t n) {
    for (size_t i = 0; i < n; i++)
        put(b, ((const uint8_t *)d)[i]);
}
static void leb(buf *b, uint32_t v) {
    do {
        uint8_t byte = v & 0x7f;
        v >>= 7;
        put(b, byte | (v ? 0x80 : 0));
    } while (v);
}
static void sleb(buf *b, int32_t v) {
    for (;;) {
        uint8_t byte = v & 0x7f;
        v >>= 7;
        if ((v == 0 && !(byte & 0x40)) || (v == -1 && (byte & 0x40))) {
            put(b, byte);
            return;
        }
        put(b, byte | 0x80);
    }
}
static void name(buf *b, const char *s) {
    leb(b, (uint32_t)strlen(s));
    putn(b, s, strlen(s));
}
static void section(buf *m, uint8_t id, buf *c) {
    put(m, id);
    leb(m, (uint32_t)c->n);
    putn(m, c->p, c->n);
    c->n = 0;
}

enum { IMP_MEMORY = 1, IMP_TABLE = 2, IMP_GLOBAL = 4, IMP_FUNC = 8, IMP_UNSHARED_MEMORY = 16,
       IMP_MUTABLE_GLOBAL = 32 };
enum { BAD_START = 1, BAD_ACTIVE_DATA = 2, BAD_EXPORT_NAME = 4, BAD_ACTIVE_ELEM = 8 };
// Types: 0 = (i32)->i32, 1 = (i32,i32)->i32, 2 = ()->()
typedef struct {
    uint8_t type;
    const uint8_t *code;
    size_t len;
} func;

static buf build(unsigned imports, const func *funcs, int nfuncs, unsigned bad) {
    buf m = {0}, c = {0};
    static const uint8_t header[] = {0, 'a', 's', 'm', 1, 0, 0, 0};
    putn(&m, header, sizeof header);
    // types
    leb(&c, 3);
    static const uint8_t t0[] = {0x60, 1, 0x7f, 1, 0x7f}, t1[] = {0x60, 2, 0x7f, 0x7f, 1, 0x7f},
                         t2[] = {0x60, 0, 0};
    putn(&c, t0, sizeof t0);
    putn(&c, t1, sizeof t1);
    putn(&c, t2, sizeof t2);
    section(&m, 1, &c);
    // imports
    int nimports = !!(imports & (IMP_MEMORY | IMP_UNSHARED_MEMORY)) + !!(imports & IMP_TABLE) +
                   !!(imports & (IMP_GLOBAL | IMP_MUTABLE_GLOBAL)) + !!(imports & IMP_FUNC);
    int imported_funcs = !!(imports & IMP_FUNC);
    if (nimports) {
        leb(&c, (uint32_t)nimports);
        if (imports & IMP_FUNC) {
            name(&c, "env");
            name(&c, "host");
            put(&c, 0x00);
            leb(&c, 0);
        }
        if (imports & IMP_TABLE) {
            name(&c, "env");
            name(&c, "table");
            put(&c, 0x01);
            put(&c, 0x70);
            put(&c, 0x00);
            leb(&c, 0);
        }
        if (imports & (IMP_MEMORY | IMP_UNSHARED_MEMORY)) {
            name(&c, "env");
            name(&c, "memory");
            put(&c, 0x02);
            if (imports & IMP_MEMORY) {
                put(&c, 0x03);
                leb(&c, 1);
                leb(&c, 65536);
            } else {
                put(&c, 0x00);
                leb(&c, 1);
            }
        }
        if (imports & (IMP_GLOBAL | IMP_MUTABLE_GLOBAL)) {
            name(&c, "env");
            name(&c, "__jit_table_base");
            put(&c, 0x03);
            put(&c, 0x7f);
            put(&c, (imports & IMP_MUTABLE_GLOBAL) ? 1 : 0);
        }
        section(&m, 2, &c);
    }
    int start_index = -1;
    int total = nfuncs + ((bad & BAD_START) ? 1 : 0);
    leb(&c, (uint32_t)total);
    for (int i = 0; i < nfuncs; i++)
        leb(&c, funcs[i].type);
    if (bad & BAD_START) {
        leb(&c, 2);
        start_index = imported_funcs + nfuncs;
    }
    section(&m, 3, &c);
    // exports
    leb(&c, (uint32_t)nfuncs);
    for (int i = 0; i < nfuncs; i++) {
        char nm[16];
        snprintf(nm, sizeof nm, (bad & BAD_EXPORT_NAME) ? "g%d" : "f%d", i);
        name(&c, nm);
        put(&c, 0x00);
        leb(&c, (uint32_t)(imported_funcs + i));
    }
    section(&m, 7, &c);
    if (start_index >= 0) {
        leb(&c, (uint32_t)start_index);
        section(&m, 8, &c);
    }
    if (bad & BAD_ACTIVE_ELEM) {
        // Active segment writing function 0 at table offset 0 of the imported table.
        static const uint8_t elem[] = {1, 0x00, 0x41, 0x00, 0x0b, 1, 0};
        putn(&c, elem, sizeof elem);
        section(&m, 9, &c);
    }
    if (bad & BAD_ACTIVE_DATA)
        leb(&c, 1), section(&m, 12, &c); // data count
    // code
    leb(&c, (uint32_t)total);
    for (int i = 0; i < total; i++) {
        const uint8_t *code = i < nfuncs ? funcs[i].code : (const uint8_t[]){0x0b};
        size_t len = i < nfuncs ? funcs[i].len : 1;
        leb(&c, (uint32_t)(len + 1));
        put(&c, 0); // no locals
        putn(&c, code, len);
    }
    section(&m, 10, &c);
    if (bad & BAD_ACTIVE_DATA) {
        static const uint8_t data[] = {1, 0x00, 0x41, 0x00, 0x0b, 1, 0x55};
        putn(&c, data, sizeof data);
        section(&m, 11, &c);
    }
    free(c.p);
    return m;
}

// Function bodies (without the locals vector).
static const uint8_t body_inc[] = {0x20, 0, 0x41, 1, 0x6a, 0x0b};                  // x+1
static const uint8_t body_callback[] = {0x20, 1, 0x20, 0, 0x11, 0, 0, 0x0b};       // table[a](b)
static const uint8_t body_memory[] = {0x20, 0, 0x20, 0, 0x28, 2, 0, 0x20, 1, 0x6a, // *p += v
                                      0x36, 2, 0,    0x20, 0, 0x28, 2, 0,    0x0b}; // return *p
// isnull(x) = x >= table.size || table[x] == null (bounds-checked table probe)
static const uint8_t body_isnull[] = {0x20, 0, 0xfc, 0x10, 0, 0x4f, 0x04, 0x7f, 0x41, 1, 0x05,
                                      0x20, 0, 0x25, 0, 0xd1, 0x0b, 0x0b};
static const uint8_t body_triple[] = {0x20, 0, 0x41, 3, 0x6c, 0x0b};                // 3x
// f0(x)+1 via __jit_table_base + 0 (calls its own sibling through the table)
static const uint8_t body_sibling[] = {0x20, 0, 0x23, 0, 0x11, 0, 0, 0x41, 1, 0x6a, 0x0b};

static buf add_const_module(int32_t k) {
    uint8_t code[16];
    buf b = {code, 0, sizeof code};
    put(&b, 0x20), put(&b, 0), put(&b, 0x41);
    sleb(&b, k);
    put(&b, 0x6a), put(&b, 0x0b);
    func f = {0, code, b.n};
    return build(IMP_MEMORY, &f, 1, 0);
}

static long jit_install(const buf *m, uint32_t *out) {
    return syscall(SYS_jit_install, m->p, m->n, 0, out);
}
static int install_errno(const buf *m) {
    uint32_t out[4];
    errno = 0;
    long r = jit_install(m, out);
    return r == -1 ? errno : 0;
}

// ---- main-module callees ---------------------------------------------------
static int __attribute__((noinline)) triple_plus(int x) { return 3 * x + 7; }
static int __attribute__((noinline)) native_inc(int x) { return x + 1; }
static fn1 volatile native_ptr = native_inc;

static uint32_t f0_idx, f1_idx, f2_idx, isnull_idx, pair_idx[2], late_idx, doomed_idx, thread_idx;
static fn1 isnull_fn;
static volatile int shared_word;
static volatile int phase;
static volatile int thread_failures;

static void *thread_main(void *arg) {
    (void)arg;
    // Installed before this thread existed: replayed at instance creation.
    if (((fn1)(uintptr_t)f0_idx)(41) != 42)
        thread_failures |= 1;
    if (((fn2)(uintptr_t)f1_idx)((int)(uintptr_t)triple_plus, 5) != 22)
        thread_failures |= 2;
    phase = 1;
    while (phase != 2)
        usleep(1000);
    long epoch = syscall(SYS_jit_sync);
    if (epoch <= 0)
        thread_failures |= 4;
    if (((fn1)(uintptr_t)late_idx)(5) != 105)
        thread_failures |= 8;
    if (isnull_fn((int)doomed_idx) != 1)
        thread_failures |= 16;
    if (((fn2)(uintptr_t)f2_idx)((int)(uintptr_t)&shared_word, 5) != 15)
        thread_failures |= 32;
    // Install from the second thread; the main thread must observe it. Two
    // exports, so it cannot take the single freed slot (reuse is tested below).
    static const uint8_t add200[] = {0x20, 0, 0x41, 0xc8, 0x01, 0x6a, 0x0b};
    func two[2] = {{0, add200, sizeof add200}, {0, body_triple, sizeof body_triple}};
    buf m = build(IMP_MEMORY, two, 2, 0);
    uint32_t out[2] = {0, 0};
    if (jit_install(&m, out) != 0 || out[1] != out[0] + 1)
        thread_failures |= 64;
    if (((fn1)(uintptr_t)out[1])(7) != 21)
        thread_failures |= 128;
    thread_idx = out[0];
    free(m.p);
    return NULL;
}

static int pipe_fds[2];
static char child_stack[256 * 1024] __attribute__((aligned(16)));
static int child_main(void *arg) {
    (void)arg;
    int code = 0;
    if (((fn1)(uintptr_t)f0_idx)(1) != 2)
        code |= 1;
    if (((fn2)(uintptr_t)f1_idx)((int)(uintptr_t)triple_plus, 1) != 10)
        code |= 2;
    if (((fn1)(uintptr_t)pair_idx[1])(4) != 13)
        code |= 4;
    if (((fn1)(uintptr_t)thread_idx)(1) != 201)
        code |= 8;
    if (isnull_fn((int)doomed_idx) != 1)
        code |= 16;
    // Copied memory: the child sees 15 and its store stays private.
    if (((fn2)(uintptr_t)f2_idx)((int)(uintptr_t)&shared_word, 100) != 115)
        code |= 32;
    buf m = add_const_module(300);
    uint32_t out = 0;
    if (jit_install(&m, &out) != 0 || ((fn1)(uintptr_t)out)(1) != 301)
        code |= 64;
    if (write(pipe_fds[1], &out, sizeof out) != sizeof out)
        code |= 128;
    _exit(code);
}

// Exec'd copy: the new image must start with a fresh, empty control block.
static int exec_check(void) {
    uint32_t st[12];
    int code = 0;
    if (syscall(SYS_jit_stats, st) != 0)
        return 1;
    printf("GUEST_JIT exec-check epoch=%u table=%u base=%u next=%u\n", st[0], st[7], st[8], st[9]);
    if (st[0] != 0 || st[1] != 0 || st[8] != 0 || st[9] != 0)
        code |= 2;
    func finc = {0, body_inc, sizeof body_inc};
    buf m = build(0, &finc, 1, 0);
    uint32_t idx = 0;
    if (jit_install(&m, &idx) != 0 || idx != st[7] || ((fn1)(uintptr_t)idx)(5) != 6)
        code |= 4;
    return code;
}
static char *const exec_argv[] = {"guest-jit-test", "exec-check", NULL};
static int exec_main(void *arg) {
    (void)arg;
    execv("/bin/guest-jit-test", exec_argv);
    _exit(99);
}

static double now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}
static double bench(fn1 f, int iterations, int *sink) {
    int acc = 0;
    double start = now_ns();
    for (int i = 0; i < iterations; i++)
        acc = f(acc);
    double elapsed = now_ns() - start;
    *sink += acc;
    return elapsed / iterations;
}

int main(int argc, char **argv) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    if (argc > 1 && strcmp(argv[1], "exec-check") == 0)
        return exec_check();
    printf("GUEST_JIT start pid=%d\n", (int)getpid());
    uint32_t stats[12];
    long r = syscall(SYS_jit_stats, stats);
    CHECK("stats-available", r == 0);
    printf("GUEST_JIT initial table=%u epoch=%u\n", stats[7], stats[0]);

    // f0(x) = x + 1
    func finc = {0, body_inc, sizeof body_inc};
    buf m0 = build(0, &finc, 1, 0);
    CHECK("install-f0", jit_install(&m0, &f0_idx) == 0);
    CHECK("f0-index-above-static-table", f0_idx >= stats[7]);
    CHECK("f0(41)", ((fn1)(uintptr_t)f0_idx)(41) == 42);
    CHECK("f0(-1)", ((fn1)(uintptr_t)f0_idx)(-1) == 0);

    // f1(idx, x) = table[idx](x): calls back into the main module.
    func fcb = {1, body_callback, sizeof body_callback};
    buf m1 = build(IMP_TABLE, &fcb, 1, 0);
    CHECK("install-f1", jit_install(&m1, &f1_idx) == 0);
    CHECK("f1(triple_plus,5)", ((fn2)(uintptr_t)f1_idx)((int)(uintptr_t)triple_plus, 5) == 22);
    CHECK("f1(f0,9)", ((fn2)(uintptr_t)f1_idx)((int)f0_idx, 9) == 10);

    // f2(p, v): *p += v; return *p on shared memory.
    func fmem = {1, body_memory, sizeof body_memory};
    buf m2 = build(IMP_MEMORY, &fmem, 1, 0);
    CHECK("install-f2", jit_install(&m2, &f2_idx) == 0);
    shared_word = 7;
    CHECK("f2 returns", ((fn2)(uintptr_t)f2_idx)((int)(uintptr_t)&shared_word, 3) == 10);
    CHECK("f2 stored", shared_word == 10);

    // Table-slot probe: isnull(i) = table[i] == null.
    func fnull = {0, body_isnull, sizeof body_isnull};
    buf mn = build(IMP_TABLE, &fnull, 1, 0);
    CHECK("install-isnull", jit_install(&mn, &isnull_idx) == 0);
    isnull_fn = (fn1)(uintptr_t)isnull_idx;
    CHECK("isnull(f0)==0", isnull_fn((int)f0_idx) == 0);

    // Two exports; f1 calls sibling f0 through __jit_table_base.
    func pair[2] = {{0, body_triple, sizeof body_triple}, {0, body_sibling, sizeof body_sibling}};
    buf mp = build(IMP_TABLE | IMP_GLOBAL | IMP_MEMORY, pair, 2, 0);
    CHECK("install-pair", jit_install(&mp, pair_idx) == 0);
    CHECK("pair contiguous", pair_idx[1] == pair_idx[0] + 1);
    CHECK("pair f0(4)", ((fn1)(uintptr_t)pair_idx[0])(4) == 12);
    CHECK("pair f1(4)", ((fn1)(uintptr_t)pair_idx[1])(4) == 13);

    // Identical image installs again at a new index (per-thread module cache hit).
    uint32_t again;
    CHECK("reinstall-f0", jit_install(&m0, &again) == 0 && again != f0_idx);
    CHECK("reinstall-f0 call", ((fn1)(uintptr_t)again)(1) == 2);

    // Negative tests.
    buf bad;
    bad = build(IMP_FUNC, &finc, 1, 0);
    CHECK("reject function import", install_errno(&bad) == ENOEXEC);
    free(bad.p);
    bad = build(IMP_UNSHARED_MEMORY, &finc, 1, 0);
    CHECK("reject unshared memory", install_errno(&bad) == ENOEXEC);
    free(bad.p);
    bad = build(IMP_MUTABLE_GLOBAL, &finc, 1, 0);
    CHECK("reject mutable global", install_errno(&bad) == ENOEXEC);
    free(bad.p);
    bad = build(0, &finc, 1, BAD_START);
    CHECK("reject start function", install_errno(&bad) == ENOEXEC);
    free(bad.p);
    bad = build(IMP_MEMORY, &finc, 1, BAD_ACTIVE_DATA);
    CHECK("reject active data", install_errno(&bad) == ENOEXEC);
    free(bad.p);
    bad = build(IMP_TABLE, &finc, 1, BAD_ACTIVE_ELEM);
    CHECK("reject active element", install_errno(&bad) == ENOEXEC);
    free(bad.p);
    bad = build(0, &finc, 1, BAD_EXPORT_NAME);
    CHECK("reject non-fN export", install_errno(&bad) == ENOEXEC);
    free(bad.p);
    {
        size_t big = (1u << 20) + 1;
        buf huge = {calloc(1, big), big, big};
        memcpy(huge.p, m0.p, m0.n);
        CHECK("reject oversized", install_errno(&huge) == E2BIG);
        huge.n = 16;
        memset(huge.p, 0xee, 16);
        CHECK("reject garbage", install_errno(&huge) == ENOEXEC);
        free(huge.p);
    }
    {
        uint32_t out;
        errno = 0;
        CHECK("reject bad pointer",
              syscall(SYS_jit_install, (void *)0xfffffff0u, 64, 0, &out) == -1 && errno == EFAULT);
        errno = 0;
        CHECK("reject flags", syscall(SYS_jit_install, m0.p, m0.n, 1, &out) == -1 && errno == EINVAL);
        errno = 0;
        CHECK("reject bad free", syscall(SYS_jit_free, 1, 1) == -1 && errno == EINVAL);
        errno = 0;
        CHECK("reject partial free",
              syscall(SYS_jit_free, pair_idx[0], 1) == -1 && errno == EINVAL);
    }
    CHECK("f0 still works after rejections", ((fn1)(uintptr_t)f0_idx)(99) == 100);

    // Second pthread: sees earlier installs at creation, later ones after sync.
    buf doomed = add_const_module(7);
    CHECK("install doomed", jit_install(&doomed, &doomed_idx) == 0);
    CHECK("doomed(1)", ((fn1)(uintptr_t)doomed_idx)(1) == 8);
    pthread_t thread;
    shared_word = 10;
    CHECK("pthread_create", pthread_create(&thread, NULL, thread_main, NULL) == 0);
    while (phase != 1)
        usleep(1000);
    buf late = add_const_module(100);
    CHECK("install late", jit_install(&late, &late_idx) == 0);
    CHECK("free doomed", syscall(SYS_jit_free, doomed_idx, 1) == 0);
    CHECK("doomed slot cleared locally", isnull_fn((int)doomed_idx) == 1);
    errno = 0;
    CHECK("double free rejected", syscall(SYS_jit_free, doomed_idx, 1) == -1 && errno == EINVAL);
    phase = 2;
    CHECK("pthread_join", pthread_join(thread, NULL) == 0);
    CHECK("thread checks", thread_failures == 0);
    if (thread_failures)
        printf("GUEST_JIT thread_failures=0x%x\n", thread_failures);
    CHECK("shared memory store from thread", shared_word == 15);
    CHECK("thread-installed visible", ((fn1)(uintptr_t)thread_idx)(1) == 201);

    // Fork (clone without CLONE_VM => copied memory and control block).
    CHECK("pipe", pipe(pipe_fds) == 0);
    pid_t child = clone(child_main, child_stack + sizeof child_stack, SIGCHLD, NULL);
    CHECK("clone copy", child > 0);
    int status = -1;
    CHECK("waitpid", child > 0 && waitpid(child, &status, 0) == child);
    CHECK("child exited", WIFEXITED(status));
    CHECK("child checks", WIFEXITED(status) && WEXITSTATUS(status) == 0);
    printf("GUEST_JIT child status=0x%x\n", status);
    uint32_t child_idx = 0;
    CHECK("child reported", read(pipe_fds[0], &child_idx, sizeof child_idx) == sizeof child_idx);
    CHECK("child install private", child_idx != 0 && isnull_fn((int)child_idx) == 1);
    CHECK("parent memory private from child", shared_word == 15);
    CHECK("child reused freed slot privately", child_idx == doomed_idx);

    // Exec after fork: the new image gets a fresh control block and table.
    pid_t execed = clone(exec_main, child_stack + sizeof child_stack, SIGCHLD, NULL);
    CHECK("clone for exec", execed > 0);
    status = -1;
    CHECK("waitpid exec", execed > 0 && waitpid(execed, &status, 0) == execed);
    CHECK("exec child checks", WIFEXITED(status) && WEXITSTATUS(status) == 0);
    printf("GUEST_JIT exec status=0x%x\n", status);

    // Reuse after every live thread acknowledged the tombstone (thread joined).
    buf reuse = add_const_module(500);
    uint32_t reuse_idx;
    CHECK("install reuse", jit_install(&reuse, &reuse_idx) == 0);
    CHECK("freed index reused", reuse_idx == doomed_idx);
    CHECK("reused slot runs new code", ((fn1)(uintptr_t)reuse_idx)(1) == 501);

    // Micro-benchmark: 1e7 indirect calls of a native static function vs installed f0.
    const int iterations = 10000000;
    fn1 native = native_ptr, jit = (fn1)(uintptr_t)f0_idx;
    int sink = 0;
    double best_native = 1e30, best_jit = 1e30;
    for (int round = 0; round < 3; round++) {
        double n = bench(native, iterations, &sink), j = bench(jit, iterations, &sink);
        printf("GUEST_JIT bench round=%d native_ns=%.3f jit_ns=%.3f\n", round, n, j);
        if (n < best_native)
            best_native = n;
        if (j < best_jit)
            best_jit = j;
    }
    CHECK("bench sink", sink == 6 * iterations);
    // Syscall round trips: an ordinary kernel syscall through the hooked
    // closure, and the private jit_sync handled entirely in the host.
    {
        const int calls = 200000;
        long acc = 0;
        double t0 = now_ns();
        for (int i = 0; i < calls; i++)
            acc += syscall(SYS_getppid);
        double t1 = now_ns();
        for (int i = 0; i < calls; i++)
            acc += syscall(SYS_jit_sync);
        double t2 = now_ns();
        CHECK("syscall bench", acc > 0);
        printf("GUEST_JIT_SYSCALL calls=%d getppid_ns=%.1f jit_sync_ns=%.1f\n", calls, (t1 - t0) / calls,
               (t2 - t1) / calls);
    }
    printf("GUEST_JIT_BENCH iterations=%d native_ns=%.3f jit_ns=%.3f ratio=%.3f\n", iterations, best_native,
           best_jit, best_jit / best_native);

    r = syscall(SYS_jit_stats, stats);
    printf("GUEST_JIT stats epoch=%u local=%u compiles=%u cache_hits=%u replay_installs=%u replay_frees=%u "
           "replay_errors=%u table=%u base=%u next=%u free=%u slot=%d\n",
           stats[0], stats[1], stats[2], stats[3], stats[4], stats[5], stats[6], stats[7], stats[8], stats[9],
           stats[10], (int)stats[11]);
    CHECK("no replay errors", r == 0 && stats[6] == 0);
    printf("GUEST_JIT_RESULT pass=%d fail=%d\n", passes, failures);
    return failures ? 1 : 0;
}
