// SPDX-License-Identifier: MIT
// Actual-guest test of the uniform fpcast ABI for installed code (JIT packet 2).
// This program is post-processed with the same Binaryen pass as Firefox
// (wasm-opt --fpcast-emu, max-func-params=23), so every table entry and every
// C indirect call uses (23 x i64) -> i64. Installed functions use exactly that
// type: C calls them through ordinary prototypes, and they call existing C
// table entries (static thunks) with call_indirect of the same type. The
// generated code never touches the C shadow stack pointer (design option c).
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define SYS_jit_install 0x6a490001
#define SYS_jit_free 0x6a490002
#define SYS_jit_stats 0x6a490004

static int passes, failures;
#define CHECK(name, cond)                                                                  \
    do {                                                                                   \
        if (cond) {                                                                        \
            passes++;                                                                      \
        } else {                                                                           \
            failures++;                                                                    \
            printf("GUEST_JIT FAIL %s (line %d)\n", name, __LINE__);                     \
            fflush(stdout);                                                                \
        }                                                                                  \
    } while (0)

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

// Module with only type 0 = (23 x i64) -> i64; imports env.table and
// env.memory; exports f0..f{n-1}. Bodies exclude the local-declaration prefix.
static buf build(const buf *bodies, int n) {
    buf m = {0}, c = {0};
    static const uint8_t header[] = {0, 'a', 's', 'm', 1, 0, 0, 0};
    putn(&m, header, sizeof header);
    leb(&c, 1);
    put(&c, 0x60);
    leb(&c, 23);
    for (int i = 0; i < 23; i++)
        put(&c, 0x7e);
    put(&c, 1);
    put(&c, 0x7e);
    section(&m, 1, &c);
    leb(&c, 2);
    name(&c, "env");
    name(&c, "table");
    put(&c, 0x01);
    put(&c, 0x70);
    put(&c, 0x00);
    leb(&c, 0);
    name(&c, "env");
    name(&c, "memory");
    put(&c, 0x02);
    put(&c, 0x03);
    leb(&c, 1);
    leb(&c, 65536);
    section(&m, 2, &c);
    leb(&c, (uint32_t)n);
    for (int i = 0; i < n; i++)
        leb(&c, 0);
    section(&m, 3, &c);
    leb(&c, (uint32_t)n);
    for (int i = 0; i < n; i++) {
        char nm[8];
        snprintf(nm, sizeof nm, "f%d", i);
        name(&c, nm);
        put(&c, 0);
        leb(&c, (uint32_t)i);
    }
    section(&m, 7, &c);
    leb(&c, (uint32_t)n);
    for (int i = 0; i < n; i++) {
        leb(&c, (uint32_t)(bodies[i].n + 1));
        put(&c, 0);
        putn(&c, bodies[i].p, bodies[i].n);
    }
    section(&m, 10, &c);
    free(c.p);
    return m;
}

static long install(buf *m, uint32_t *out) {
    return syscall(SYS_jit_install, m->p, m->n, 0, out);
}

// ---- existing (static) table entries, called from installed code ----------
static int mix3(int a, int b, int c) { return a * 100 + b * 10 + c; }
static int dmix(double x, int k) { return (int)(x * 2.0) + k; }
static long long wide(long long a, int b) { return a * 3 + b; }
static float fhalf(float x) { return x * 0.5f; }
static int sum20(int a0, int a1, int a2, int a3, int a4, int a5, int a6, int a7, int a8, int a9, int a10,
                 int a11, int a12, int a13, int a14, int a15, int a16, int a17, int a18, int a19) {
    return a0 + 2 * a1 + 3 * a2 + 4 * a3 + 5 * a4 + 6 * a5 + 7 * a6 + 8 * a7 + 9 * a8 + 10 * a9 +
           11 * a10 + 12 * a11 + 13 * a12 + 14 * a13 + 15 * a14 + 16 * a15 + 17 * a16 + 18 * a17 +
           19 * a18 + 20 * a19;
}
static volatile uint32_t sp_seen[2];
// Uses the C shadow stack (address-taken buffer + libc formatting).
__attribute__((noinline)) static int stack_user(int n) {
    char text[96];
    volatile char *probe = text;
    sp_seen[n & 1] = (uint32_t)(uintptr_t)probe;
    int len = snprintf(text, sizeof text, "stack-user-%d-%s", n, n % 2 ? "odd" : "even");
    return len * 1000 + (text[len - 1] == 'd' ? 1 : 2);
}
static void side_effect(int v);
static volatile int side;
static void side_effect(int v) { side = v; }

// Installed trampoline f0(idx, a...) = call_indirect table[idx](a..., 0).
static uint32_t tramp;
typedef int (*tramp_ii)(uintptr_t, int);
static int reenter(int depth) {
    if (depth == 0)
        return 1;
    return 1 + ((tramp_ii)(uintptr_t)tramp)((uintptr_t)reenter, depth - 1);
}

static double now(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec * 1e-9;
}

int main(void) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    // ---- module A: uniform trampoline ----
    buf body = {0};
    for (int i = 1; i < 23; i++)
        put(&body, 0x20), put(&body, (uint8_t)i);
    static const uint8_t tail[] = {0x42, 0x00, 0x20, 0x00, 0xa7, 0x11, 0x00, 0x00, 0x0b};
    putn(&body, tail, sizeof tail);
    buf a = build(&body, 1);
    uint32_t idx[2] = {0};
    long rc = install(&a, idx);
    CHECK("install trampoline", rc == 0);
    tramp = idx[0];
    printf("GUEST_JIT info trampoline_index=%u module_bytes=%zu\n", tramp, a.n);

    typedef int (*t_mix3)(uintptr_t, int, int, int);
    CHECK("tramp -> mix3", ((t_mix3)(uintptr_t)tramp)((uintptr_t)mix3, 1, 2, 3) == 123);
    CHECK("tramp -> mix3 negative", ((t_mix3)(uintptr_t)tramp)((uintptr_t)mix3, -4, 5, -6) == -356);
    typedef int (*t_dmix)(uintptr_t, double, int);
    CHECK("tramp -> dmix (f64 through i64)", ((t_dmix)(uintptr_t)tramp)((uintptr_t)dmix, 20.75, 9) == 50);
    typedef long long (*t_wide)(uintptr_t, long long, int);
    CHECK("tramp -> wide (i64)",
          ((t_wide)(uintptr_t)tramp)((uintptr_t)wide, 0x100000000LL, -1) == 0x300000000LL - 1);
    typedef float (*t_fhalf)(uintptr_t, float);
    CHECK("tramp -> fhalf (f32)", ((t_fhalf)(uintptr_t)tramp)((uintptr_t)fhalf, 5.0f) == 2.5f);
    typedef int (*t_sum20)(uintptr_t, int, int, int, int, int, int, int, int, int, int, int, int, int, int, int,
                           int, int, int, int, int);
    int expected20 = 0;
    for (int i = 0; i < 20; i++)
        expected20 += (i + 1) * (i - 7);
    CHECK("tramp -> sum20", ((t_sum20)(uintptr_t)tramp)((uintptr_t)sum20, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4,
                                                        5, 6, 7, 8, 9, 10, 11, 12) == expected20);
    typedef void (*t_void)(uintptr_t, int);
    ((t_void)(uintptr_t)tramp)((uintptr_t)side_effect, 4242);
    CHECK("tramp -> void callee", side == 4242);

    // Shadow stack: callee uses the stack; caller's frame and SP stay intact.
    volatile char guard[64];
    memset((char *)guard, 0x5a, sizeof guard);
    typedef int (*t_ii)(uintptr_t, int);
    int ok = 1;
    for (int i = 0; i < 2000; i++) {
        int r = ((t_ii)(uintptr_t)tramp)((uintptr_t)stack_user, i);
        char text[96];
        int len = snprintf(text, sizeof text, "stack-user-%d-%s", i, i % 2 ? "odd" : "even");
        if (r != len * 1000 + (i % 2 ? 1 : 2)) // odd ends in d -> 1
            ok = 0;
    }
    int direct = stack_user(0);
    CHECK("stack_user through trampoline x2000", ok);
    CHECK("stack_user direct", direct > 0);
    uint32_t via_tramp = sp_seen[1];
    stack_user(1);
    CHECK("callee frame address same via trampoline and direct", via_tramp == sp_seen[1]);
    int intact = 1;
    for (size_t i = 0; i < sizeof guard; i++)
        intact &= guard[i] == 0x5a;
    CHECK("caller stack frame intact", intact);
    CHECK("reenter JIT->C->JIT depth 50", reenter(50) == 51);

    // ---- module B: installed functions called directly from C ----
    buf b0 = {0}, b1 = {0};
    static const uint8_t lin[] = {0x20, 0x00, 0xa7, 0x41, 0x07, 0x6c, 0x20, 0x01, 0xa7, 0x6a, 0xad, 0x0b};
    putn(&b0, lin, sizeof lin);
    put(&b1, 0x42), put(&b1, 0x00);
    for (int i = 0; i < 23; i++)
        put(&b1, 0x20), put(&b1, (uint8_t)i), put(&b1, 0x42), put(&b1, (uint8_t)(i + 1)), put(&b1, 0x7e),
            put(&b1, 0x7c);
    put(&b1, 0x0b);
    buf bodies[2] = {b0, b1};
    buf mb = build(bodies, 2);
    rc = install(&mb, idx);
    CHECK("install module B", rc == 0 && idx[1] == idx[0] + 1 && idx[0] == tramp + 1);
    typedef int (*c_lin)(int, int);
    CHECK("C -> installed a*7+b", ((c_lin)(uintptr_t)idx[0])(6, 5) == 47);
    CHECK("C -> installed a*7+b negative b", ((c_lin)(uintptr_t)idx[0])(3, -30) == -9);
    typedef long long (*c_w3)(long long, long long, long long);
    CHECK("C -> installed weighted sum, 3 args (zero padding)",
          ((c_w3)(uintptr_t)idx[1])(1000000000000LL, 2, 3) == 1000000000000LL + 4 + 9);
    typedef long long (*c_w22)(long long, long long, long long, long long, long long, long long, long long,
                               long long, long long, long long, long long, long long, long long, long long,
                               long long, long long, long long, long long, long long, long long, long long,
                               long long);
    long long e22 = 0;
    for (int i = 0; i < 22; i++)
        e22 += (long long)(i + 1) * (i * 1000 - 3);
    CHECK("C -> installed weighted sum, 22 args",
          ((c_w22)(uintptr_t)idx[1])(-3, 997, 1997, 2997, 3997, 4997, 5997, 6997, 7997, 8997, 9997, 10997,
                                     11997, 12997, 13997, 14997, 15997, 16997, 17997, 18997, 19997, 20997) == e22);
    // Installed code reached via the installed trampoline (JIT -> JIT).
    typedef int (*t_lin)(uintptr_t, int, int);
    CHECK("tramp -> installed a*7+b", ((t_lin)(uintptr_t)tramp)((uintptr_t)idx[0], 10, 1) == 71);
    CHECK("free module B", syscall(SYS_jit_free, idx[0], 2) == 0);

    // ---- micro-benchmark: direct C indirect call vs via installed trampoline ----
    int (*volatile direct_fp)(int, int, int) = mix3;
    t_mix3 volatile via = (t_mix3)(uintptr_t)tramp;
    const int N = 2000000;
    for (int round = 0; round < 3; round++) {
        int sink = 0;
        double t0 = now();
        for (int i = 0; i < N; i++)
            sink += direct_fp(i & 7, 1, 2);
        double t1 = now();
        for (int i = 0; i < N; i++)
            sink -= via((uintptr_t)mix3, i & 7, 1, 2);
        double t2 = now();
        printf("GUEST_JIT bench round=%d direct_ns=%.3f trampoline_ns=%.3f\n", round, (t1 - t0) * 1e9 / N,
               (t2 - t1) * 1e9 / N);
        CHECK("bench sink", sink == 0);
    }
    uint32_t stats[12];
    CHECK("stats", syscall(SYS_jit_stats, stats) == 0);
    printf("GUEST_JIT stats epoch=%u compiles=%u table_length=%u table_base=%u next=%u\n", stats[0], stats[2],
           stats[7], stats[8], stats[9]);
    printf("GUEST_JIT_RESULT pass=%d fail=%d\n", passes, failures);
    return failures ? 1 : 0;
}
