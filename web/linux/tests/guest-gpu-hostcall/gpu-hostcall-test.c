// SPDX-License-Identifier: MIT
// Actual-guest test of the GPU hostcall channel (web/linux/dist/guest-gpu-hostcall.js
// and guest-gpu-owner.js): round-trip latency, owner access to guest memory,
// concurrent callers, argument validation, the WebGPU adapter probe, the
// writeBuffer/SharedArrayBuffer probe and owner loss. Blocked callers must not
// hold their virtual CPU: timers, other tasks, signals and exit_group keep
// working while a thread waits in a long hostcall.
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

#define SYS_gpu_hostcall 0x6a470001
#define SYS_gpu_hostcall_stats 0x6a470002
#define SYS_gpu_hostcall_control 0x6a470003

enum {
    OP_ECHO = 1, OP_CHECKSUM = 2, OP_FILL = 3, OP_ADAPTER_INFO = 4, OP_WRITEBUFFER_PROBE = 5, OP_SLEEP = 6,
    OP_TEST_HANG = 0x100, OP_TEST_CLOSE = 0x101, OP_TEST_TERMINATE = 0x102,
};
enum { CTL_RESPAWN = 1, CTL_SET_STALL_MS = 2 };
enum { ST_VERSION, ST_OWNER_STATE, ST_OWNER_GEN, ST_SLOT, ST_HEARTBEAT, ST_CALLS, ST_DEAD_REASON, ST_FLAGS,
       ST_THREAD_CALLS, ST_STALL_MS, ST_THREAD_YIELDS, ST_WORDS };
#define EBUSY_ 16

static int passes, failures;
#define CHECK(name, cond)                                                                  \
    do {                                                                                   \
        if (cond) {                                                                        \
            __atomic_add_fetch(&passes, 1, __ATOMIC_SEQ_CST);                              \
        } else {                                                                           \
            __atomic_add_fetch(&failures, 1, __ATOMIC_SEQ_CST);                            \
            printf("GUEST_GPUHC FAIL %s (%s:%d)\n", name, __FILE__, __LINE__);             \
            fflush(stdout);                                                                \
        }                                                                                  \
    } while (0)

static long hc(int op, long a0, long a1, long a2, long a3, long a4) {
    long r = syscall(SYS_gpu_hostcall, op, a0, a1, a2, a3, a4);
    return r < 0 ? -errno : r;
}
static long ctl(int cmd, long arg) {
    long r = syscall(SYS_gpu_hostcall_control, cmd, arg);
    return r < 0 ? -errno : r;
}
static long stats(uint32_t *out) {
    long r = syscall(SYS_gpu_hostcall_stats, out);
    return r < 0 ? -errno : r;
}
static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}
static uint32_t fnv1a(const uint8_t *p, size_t n) {
    uint32_t h = 0x811c9dc5u;
    for (size_t i = 0; i < n; i++)
        h = (h ^ p[i]) * 0x01000193u;
    return h;
}
static uint8_t fill_byte(uint32_t seed, uint32_t i) {
    return (uint8_t)((seed ^ (uint32_t)(i * 0x9E3779B1u)) >> 13);
}
static uintptr_t memory_end(void) {
    return (uintptr_t)__builtin_wasm_memory_size(0) * 65536u;
}
static int cmp_u64(const void *a, const void *b) {
    uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return x < y ? -1 : x > y;
}

// ---- memory access --------------------------------------------------------
static void test_memory(void) {
    size_t big = 8u << 20;
    uint8_t *buf = malloc(big + 64);
    CHECK("malloc 8MiB", buf != NULL);
    if (!buf)
        return;
    uint32_t x = 12345;
    for (size_t i = 0; i < big + 64; i++) {
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        buf[i] = (uint8_t)x;
    }
    uint32_t sum = 0;
    CHECK("checksum 8MiB", hc(OP_CHECKSUM, (long)buf, (long)big, (long)&sum, 0, 0) == 0);
    CHECK("checksum 8MiB value", sum == fnv1a(buf, big));
    size_t odd = 3 * 65536 + 17;
    CHECK("checksum unaligned multi-page", hc(OP_CHECKSUM, (long)(buf + 1), (long)odd, (long)&sum, 0, 0) == 0);
    CHECK("checksum unaligned value", sum == fnv1a(buf + 1, odd));
    CHECK("checksum zero length", hc(OP_CHECKSUM, (long)buf, 0, (long)&sum, 0, 0) == 0 && sum == 0x811c9dc5u);

    uint8_t before = buf[4], after_byte = buf[5 + 5 * 4096 + 123];
    size_t flen = 5 * 4096 + 123;
    CHECK("fill multi-page", hc(OP_FILL, (long)(buf + 5), (long)flen, 0xabcdef01, 0, 0) == 0);
    int bad = 0;
    for (size_t i = 0; i < flen; i++)
        bad += buf[5 + i] != fill_byte(0xabcdef01u, (uint32_t)i);
    CHECK("fill bytes", bad == 0);
    CHECK("fill guards", buf[4] == before && buf[5 + flen] == after_byte);
    CHECK("fill 8MiB", hc(OP_FILL, (long)buf, (long)big, 7, 0, 0) == 0);
    bad = 0;
    for (size_t i = 0; i < big; i += 4093)
        bad += buf[i] != fill_byte(7, (uint32_t)i);
    CHECK("fill 8MiB sampled bytes", bad == 0);
    CHECK("checksum after fill", hc(OP_CHECKSUM, (long)buf, (long)big, (long)&sum, 0, 0) == 0 && sum == fnv1a(buf, big));

    // Grow memory after the first attach; the owner must see the new pages.
    uintptr_t end0 = memory_end();
    size_t grow = 64u << 20;
    uint8_t *late = malloc(grow);
    uintptr_t end1 = memory_end();
    CHECK("malloc after attach", late != NULL);
    CHECK("memory grew", end1 > end0);
    if (late) {
        CHECK("fill grown memory", hc(OP_FILL, (long)late, (long)grow, 99, 0, 0) == 0);
        bad = 0;
        for (size_t i = 0; i < grow; i += 65521)
            bad += late[i] != fill_byte(99, (uint32_t)i);
        bad += late[grow - 1] != fill_byte(99, (uint32_t)(grow - 1));
        CHECK("fill grown memory bytes", bad == 0);
        CHECK("checksum grown memory",
              hc(OP_CHECKSUM, (long)late, (long)grow, (long)&sum, 0, 0) == 0 && sum == fnv1a(late, grow));
        uintptr_t tail_gap = end1 - (uintptr_t)(late + grow);
        printf("GUEST_GPUHC MEMORY end0=%lu end1=%lu late=%p tail_gap=%lu\n", (unsigned long)end0,
               (unsigned long)end1, (void *)late, (unsigned long)tail_gap);
        // The last 64 bytes of the buffer, as close to the memory end as malloc placed it.
        CHECK("fill tail of grown buffer", hc(OP_FILL, (long)(late + grow - 64), 64, 5, 0, 0) == 0 &&
                                               late[grow - 1] == fill_byte(5, 63));
    }
    // Pages at the very end of linear memory.
    uintptr_t end = memory_end();
    CHECK("checksum last page", hc(OP_CHECKSUM, (long)(end - 4096), 4096, (long)&sum, 0, 0) == 0 &&
                                    sum == fnv1a((const uint8_t *)(end - 4096), 4096));
    CHECK("checksum last 3 pages", hc(OP_CHECKSUM, (long)(end - 3 * 65536), 3 * 65536, (long)&sum, 0, 0) == 0 &&
                                       sum == fnv1a((const uint8_t *)(end - 3 * 65536), 3 * 65536));
    CHECK("checksum empty at end", hc(OP_CHECKSUM, (long)end, 0, (long)&sum, 0, 0) == 0);

    // Bad pointers and lengths.
    CHECK("EFAULT crossing end", hc(OP_CHECKSUM, (long)(end - 16), 32, (long)&sum, 0, 0) == -EFAULT);
    CHECK("EFAULT beyond end", hc(OP_CHECKSUM, (long)end, 1, (long)&sum, 0, 0) == -EFAULT);
    CHECK("EFAULT high pointer", hc(OP_CHECKSUM, (long)0xfffff000u, 4096, (long)&sum, 0, 0) == -EFAULT);
    CHECK("EFAULT null pointer", hc(OP_CHECKSUM, 0, 16, (long)&sum, 0, 0) == -EFAULT);
    CHECK("EFAULT null out", hc(OP_CHECKSUM, (long)buf, 16, 0, 0, 0) == -EFAULT);
    CHECK("EFAULT out crossing end", hc(OP_CHECKSUM, (long)buf, 16, (long)(end - 2), 0, 0) == -EFAULT);
    CHECK("EFAULT fill high", hc(OP_FILL, (long)0xfffff000u, 16, 1, 0, 0) == -EFAULT);
    CHECK("EINVAL huge length", hc(OP_CHECKSUM, (long)buf, 0x20000000, (long)&sum, 0, 0) == -EINVAL);
    CHECK("EINVAL negative length", hc(OP_FILL, (long)buf, -1, 1, 0, 0) == -EINVAL);
    CHECK("EINVAL unknown op", hc(0x55, 0, 0, 0, 0, 0) == -EINVAL);
    CHECK("ENOSYS op 0", hc(0, 0, 0, 0, 0, 0) == -ENOSYS);
    CHECK("EINVAL sleep too long", hc(OP_SLEEP, 20000, 0, 0, 0, 0) == -EINVAL);
    CHECK("EINVAL writeBuffer odd length", hc(OP_WRITEBUFFER_PROBE, (long)buf, 3, (long)buf, 64, 0) == -EINVAL);
    CHECK("channel alive after errors", hc(OP_ECHO, 77, 0, 0, 0, 0) == 77);
    free(late);
    free(buf);
}

// ---- latency --------------------------------------------------------------
#define ECHO_ROUNDS 10000
static uint64_t samples[ECHO_ROUNDS];
static void test_latency(void) {
    int wrong = 0;
    uint64_t t0 = now_ns();
    for (int i = 0; i < ECHO_ROUNDS; i++) {
        long v = (long)((uint32_t)i * 2654435761u);
        uint64_t a = now_ns();
        long r = hc(OP_ECHO, v, 0, 0, 0, 0);
        samples[i] = now_ns() - a;
        wrong += r != (v & 0x7fffffff);
    }
    uint64_t total = now_ns() - t0;
    CHECK("10000 echoes exact", wrong == 0);
    // Clock overhead: the same loop without the hostcall.
    uint64_t c0 = now_ns();
    for (int i = 0; i < 1000; i++) {
        uint64_t a = now_ns();
        (void)(now_ns() - a);
    }
    uint64_t clock_pair = (now_ns() - c0) / 1000;
    qsort(samples, ECHO_ROUNDS, sizeof samples[0], cmp_u64);
    printf("GUEST_GPUHC LATENCY rounds=%d total_ns=%llu mean_ns=%llu min_ns=%llu p50_ns=%llu p90_ns=%llu "
           "p99_ns=%llu p999_ns=%llu max_ns=%llu clock_pair_ns=%llu\n",
           ECHO_ROUNDS, (unsigned long long)total, (unsigned long long)(total / ECHO_ROUNDS),
           (unsigned long long)samples[0], (unsigned long long)samples[ECHO_ROUNDS / 2],
           (unsigned long long)samples[ECHO_ROUNDS * 9 / 10], (unsigned long long)samples[ECHO_ROUNDS * 99 / 100],
           (unsigned long long)samples[ECHO_ROUNDS * 999 / 1000], (unsigned long long)samples[ECHO_ROUNDS - 1],
           (unsigned long long)clock_pair);
    // Histogram in microsecond buckets (log2).
    int buckets[24] = {0};
    for (int i = 0; i < ECHO_ROUNDS; i++) {
        uint64_t us = samples[i] / 1000;
        int b = 0;
        while (us > 0 && b < 23) {
            us >>= 1;
            b++;
        }
        buckets[b]++;
    }
    printf("GUEST_GPUHC HISTOGRAM us_log2");
    for (int b = 0; b < 24; b++)
        if (buckets[b])
            printf(" <%d:%d", 1 << b, buckets[b]);
    printf("\n");
    fflush(stdout);
}

// ---- concurrency ----------------------------------------------------------
#define THREADS 4
#define THREAD_ROUNDS 2000
static pthread_barrier_t start_barrier, end_barrier;
struct worker { int id, wrong, rounds; uint32_t slot, slot_before; uint64_t ns, until_ns; };
static void *echo_thread(void *arg) {
    struct worker *w = arg;
    // Claim a slot, then wait until every caller holds one, so the slot check
    // below is about simultaneous callers (a slot is legitimately reused once
    // its thread exits).
    w->wrong += hc(OP_ECHO, (long)w->id << 20, 0, 0, 0, 0) != (long)w->id << 20;
    uint32_t st[ST_WORDS];
    w->slot_before = stats(st) == 0 ? st[ST_SLOT] : 0xffffffffu;
    pthread_barrier_wait(&start_barrier);
    uint64_t t0 = now_ns();
    for (int i = 0; i < THREAD_ROUNDS; i++) {
        long v = ((long)w->id << 20) | i;
        w->wrong += hc(OP_ECHO, v, 0, 0, 0, 0) != v;
    }
    w->ns = now_ns() - t0;
    w->slot = stats(st) == 0 ? st[ST_SLOT] : 0xffffffffu;
    pthread_barrier_wait(&end_barrier);
    return NULL;
}
static void *reuse_thread(void *arg) {
    struct worker *w = arg;
    // Fixed rounds, or keep calling until until_ns (spanning a stale completion).
    for (int i = 0; w->until_ns ? now_ns() < w->until_ns : i < THREAD_ROUNDS; i++) {
        long v = ((long)w->id << 20) | (i & 0xfffff);
        w->wrong += hc(OP_ECHO, v, 0, 0, 0, 0) != v;
        w->rounds++;
    }
    uint32_t st[ST_WORDS];
    w->slot = stats(st) == 0 ? st[ST_SLOT] : 0xffffffffu;
    return NULL;
}
struct sleeper { long ms, result; uint64_t start_ns, done_ns; uint32_t yields; };
static void *sleep_thread(void *arg) {
    struct sleeper *s = arg;
    __atomic_store_n(&s->start_ns, now_ns(), __ATOMIC_SEQ_CST);
    s->result = hc(OP_SLEEP, s->ms, 0, 0, 0, 0);
    s->done_ns = now_ns();
    uint32_t st[ST_WORDS];
    s->yields = stats(st) == 0 ? st[ST_THREAD_YIELDS] : 0;
    return NULL;
}
static void test_concurrency(void) {
    pthread_t threads[THREADS];
    struct worker w[THREADS];
    pthread_barrier_init(&start_barrier, NULL, THREADS + 1);
    pthread_barrier_init(&end_barrier, NULL, THREADS + 1);
    for (int i = 0; i < THREADS; i++) {
        w[i] = (struct worker){.id = i + 1};
        CHECK("pthread_create", pthread_create(&threads[i], NULL, echo_thread, &w[i]) == 0);
    }
    pthread_barrier_wait(&start_barrier);
    uint64_t t0 = now_ns();
    // The main thread calls concurrently too.
    int wrong = 0;
    for (int i = 0; i < THREAD_ROUNDS; i++)
        wrong += hc(OP_ECHO, 0x7000000 | i, 0, 0, 0, 0) != (0x7000000 | i);
    uint64_t main_ns = now_ns() - t0;
    pthread_barrier_wait(&end_barrier);
    uint64_t total = now_ns() - t0;
    for (int i = 0; i < THREADS; i++)
        pthread_join(threads[i], NULL);
    pthread_barrier_destroy(&start_barrier);
    pthread_barrier_destroy(&end_barrier);
    CHECK("main concurrent echoes", wrong == 0);
    uint32_t st[ST_WORDS];
    stats(st);
    int distinct = 1, stable = 1;
    for (int i = 0; i < THREADS; i++) {
        CHECK("thread echoes exact", w[i].wrong == 0);
        stable &= w[i].slot == w[i].slot_before;
        distinct &= w[i].slot != st[ST_SLOT] && w[i].slot < 256;
        for (int j = 0; j < i; j++)
            distinct &= w[i].slot != w[j].slot;
    }
    CHECK("simultaneous threads use distinct slots", distinct);
    CHECK("slot stable for a thread's lifetime", stable);
    printf("GUEST_GPUHC CONCURRENT threads=%d+main rounds_each=%d total_ns=%llu main_ns=%llu calls_per_s=%llu "
           "thread_ms=%llu,%llu,%llu,%llu slots=%u,%u,%u,%u main=%u\n",
           THREADS, THREAD_ROUNDS, (unsigned long long)total, (unsigned long long)main_ns,
           (unsigned long long)((uint64_t)(THREADS + 1) * THREAD_ROUNDS * 1000000000ull / (total ? total : 1)),
           (unsigned long long)(w[0].ns / 1000000), (unsigned long long)(w[1].ns / 1000000),
           (unsigned long long)(w[2].ns / 1000000), (unsigned long long)(w[3].ns / 1000000),
           w[0].slot, w[1].slot, w[2].slot, w[3].slot, st[ST_SLOT]);

    // Two threads blocked in asynchronous owner requests on a two-CPU guest:
    // the main thread's timer sleep and its own calls must not wait for them.
    // Control: the same nanosleep with no blocked caller.
    struct timespec pause = {0, 50 * 1000000}, tick = {0, 1000000};
    uint64_t c0 = now_ns();
    nanosleep(&pause, NULL);
    uint64_t control_ns = now_ns() - c0;
    pthread_t sleepers[2];
    struct sleeper s[2] = {{.ms = 400}, {.ms = 400}};
    uint64_t s0 = now_ns();
    for (int i = 0; i < 2; i++)
        CHECK("sleeper create", pthread_create(&sleepers[i], NULL, sleep_thread, &s[i]) == 0);
    // Thread start costs a Web Worker spawn; measure only once both sleepers
    // are inside their calls (and past the short pure-wait phase).
    while (!__atomic_load_n(&s[0].start_ns, __ATOMIC_SEQ_CST) || !__atomic_load_n(&s[1].start_ns, __ATOMIC_SEQ_CST))
        nanosleep(&tick, NULL);
    struct timespec settle = {0, 20 * 1000000};
    nanosleep(&settle, NULL);
    uint64_t n0 = now_ns();
    nanosleep(&pause, NULL);
    uint64_t nanosleep_ns = now_ns() - n0;
    int both_blocked = n0 > s[0].start_ns && n0 > s[1].start_ns;
    wrong = 0;
    for (int i = 0; i < 200; i++)
        wrong += hc(OP_ECHO, i, 0, 0, 0, 0) != i;
    uint64_t echoes_done = now_ns();
    for (int i = 0; i < 2; i++)
        pthread_join(sleepers[i], NULL);
    CHECK("echo during sleep exact", wrong == 0);
    CHECK("sleep results", s[0].result == 0 && s[1].result == 0);
    CHECK("sleeps lasted", s[0].done_ns - s[0].start_ns >= 400000000ull && s[1].done_ns - s[1].start_ns >= 400000000ull);
    CHECK("sleepers yielded their CPUs", s[0].yields > 0 && s[1].yields > 0);
    CHECK("measured while both sleepers blocked", both_blocked && n0 + nanosleep_ns < s[0].done_ns && n0 + nanosleep_ns < s[1].done_ns);
    CHECK("nanosleep not held by blocked callers", nanosleep_ns < 150000000ull);
    CHECK("echoes finished before sleepers", echoes_done < s[0].done_ns && echoes_done < s[1].done_ns);
    printf("GUEST_GPUHC INTERLEAVE sleep_ms=400 sleepers=2 control_nanosleep_50_us=%llu nanosleep_50_us=%llu "
           "sleeper_start_ms=%llu,%llu measure_start_ms=%llu echoes_done_ms=%llu sleeper_done_ms=%llu,%llu sleeper_yields=%u,%u\n",
           (unsigned long long)(control_ns / 1000), (unsigned long long)(nanosleep_ns / 1000),
           (unsigned long long)((s[0].start_ns - s0) / 1000000), (unsigned long long)((s[1].start_ns - s0) / 1000000),
           (unsigned long long)((n0 - s0) / 1000000), (unsigned long long)((echoes_done - s0) / 1000000),
           (unsigned long long)((s[0].done_ns - s0) / 1000000), (unsigned long long)((s[1].done_ns - s0) / 1000000),
           s[0].yields, s[1].yields);

    // Four blocked callers on two CPUs are served concurrently by the owner.
    pthread_t many[4];
    struct sleeper m[4];
    uint64_t m0 = now_ns();
    for (int i = 0; i < 4; i++) {
        m[i] = (struct sleeper){.ms = 500};
        CHECK("parallel sleeper create", pthread_create(&many[i], NULL, sleep_thread, &m[i]) == 0);
    }
    for (int i = 0; i < 4; i++)
        pthread_join(many[i], NULL);
    uint64_t parallel_ms = (now_ns() - m0) / 1000000;
    int ok = 1;
    uint64_t last_start = 0, first_done = UINT64_MAX, last_done = 0;
    for (int i = 0; i < 4; i++) {
        ok &= m[i].result == 0 && m[i].done_ns - m[i].start_ns >= 500000000ull;
        last_start = m[i].start_ns > last_start ? m[i].start_ns : last_start;
        first_done = m[i].done_ns < first_done ? m[i].done_ns : first_done;
        last_done = m[i].done_ns > last_done ? m[i].done_ns : last_done;
    }
    CHECK("parallel sleeps", ok);
    // Thread start (a Worker spawn each) is staggered; the requirement is that
    // all four calls are outstanding at the same time and served in parallel.
    CHECK("four blocked callers outstanding together on two CPUs", last_start < first_done);
    CHECK("four blocked callers served in parallel", last_done - last_start < 700000000ull);
    printf("GUEST_GPUHC PARALLEL sleepers=4 sleep_ms=500 total_ms=%llu overlap_ms=%llu tail_ms=%llu start_ms=%llu,%llu,%llu,%llu\n",
           (unsigned long long)parallel_ms, (unsigned long long)((first_done - last_start) / 1000000),
           (unsigned long long)((last_done - last_start) / 1000000), (unsigned long long)((m[0].start_ns - m0) / 1000000),
           (unsigned long long)((m[1].start_ns - m0) / 1000000), (unsigned long long)((m[2].start_ns - m0) / 1000000),
           (unsigned long long)((m[3].start_ns - m0) / 1000000));

    // Thread slots are released at thread exit and reused.
    struct worker again = {.id = 9};
    pthread_t t;
    CHECK("reuse create", pthread_create(&t, NULL, reuse_thread, &again) == 0);
    pthread_join(t, NULL);
    CHECK("reused slot echoes", again.wrong == 0);
    uint32_t lowest = w[0].slot;
    for (int i = 1; i < THREADS; i++)
        lowest = w[i].slot < lowest ? w[i].slot : lowest;
    CHECK("reused slot is the lowest free", again.slot == lowest);
    printf("GUEST_GPUHC SLOT_REUSE slot=%u\n", again.slot);
    fflush(stdout);
}

// ---- signals and exit while blocked in a hostcall -------------------------
static volatile uint64_t handler_ns;
static volatile long handler_nested;
static void on_usr1(int sig) {
    (void)sig;
    handler_ns = now_ns();
    handler_nested = hc(OP_ECHO, 5, 0, 0, 0, 0); // the thread's call is still outstanding
}
static int kill_pipe[2];
static void *child_blocked_thread(void *arg) {
    (void)arg;
    uint32_t slot = 0xffffffffu, st[ST_WORDS];
    if (hc(OP_ECHO, 3, 0, 0, 0, 0) == 3 && stats(st) == 0)
        slot = st[ST_SLOT];
    if (write(kill_pipe[1], &slot, sizeof slot) != sizeof slot)
        _exit(3);
    hc(OP_SLEEP, 3000, 0, 0, 0, 0); // killed by exit_group long before this returns
    _exit(4);
    return NULL;
}
static char kill_child_stack[65536] __attribute__((aligned(16)));
static int kill_child_main(void *arg) {
    (void)arg;
    pthread_t t;
    if (pthread_create(&t, NULL, child_blocked_thread, NULL) != 0)
        return 2;
    struct timespec pause = {0, 300 * 1000000};
    nanosleep(&pause, NULL);
    _exit(0); // exit_group while the other thread waits in the hostcall
}
static void test_blocked(void) {
    // A signal to a thread blocked in a hostcall runs its handler promptly; the
    // call itself continues (it is not interrupted) and a nested call is -EBUSY.
    struct sigaction sa = {0};
    sa.sa_handler = on_usr1;
    sigemptyset(&sa.sa_mask);
    CHECK("sigaction", sigaction(SIGUSR1, &sa, NULL) == 0);
    pthread_t t;
    struct sleeper s = {.ms = 1500};
    handler_ns = 0;
    CHECK("signal target create", pthread_create(&t, NULL, sleep_thread, &s) == 0);
    struct timespec pause = {0, 200 * 1000000};
    nanosleep(&pause, NULL);
    uint64_t k0 = now_ns();
    CHECK("pthread_kill", pthread_kill(t, SIGUSR1) == 0);
    pthread_join(t, NULL);
    uint64_t handler_after_ms = handler_ns ? (handler_ns - k0) / 1000000 : 999999;
    printf("GUEST_GPUHC SIGNAL handler_after_ms=%llu nested=%ld call=%ld call_ms=%llu handler_before_end=%d\n",
           (unsigned long long)handler_after_ms, handler_nested, s.result,
           (unsigned long long)((s.done_ns - s.start_ns) / 1000000), handler_ns != 0 && handler_ns < s.done_ns);
    CHECK("signal handler ran while blocked", handler_ns != 0 && handler_ns < s.done_ns);
    CHECK("signal handler prompt", handler_after_ms < 250);
    CHECK("nested call from handler EBUSY", handler_nested == -EBUSY_);
    CHECK("blocked call completes after signal", s.result == 0 && s.done_ns - s.start_ns >= 1500000000ull);

    // exit_group of a process whose other thread waits in a hostcall ends
    // promptly; its slot returns and the late owner completion is discarded.
    CHECK("pipe", pipe(kill_pipe) == 0);
    uint64_t c0 = now_ns();
    pid_t child = clone(kill_child_main, kill_child_stack + sizeof kill_child_stack, SIGCHLD, NULL);
    CHECK("clone kill child", child > 0);
    uint32_t child_slot = 0xffffffffu;
    CHECK("child slot reported", read(kill_pipe[0], &child_slot, sizeof child_slot) == sizeof child_slot);
    int status = -1;
    CHECK("waitpid kill child", child > 0 && waitpid(child, &status, 0) == child);
    uint64_t exit_ms = (now_ns() - c0) / 1000000;
    CHECK("kill child exited 0", WIFEXITED(status) && WEXITSTATUS(status) == 0);
    CHECK("exit_group not held by blocked call", exit_ms < 1500);
    close(kill_pipe[0]);
    close(kill_pipe[1]);
    // A new thread reuses the dead thread's slot and keeps calling across the
    // time the abandoned 3 s request completes in the owner (about c0+3.3 s);
    // that late completion must not be taken as the answer to a new request.
    struct worker w = {.id = 11, .until_ns = c0 + 4000000000ull};
    pthread_t r;
    CHECK("stale window create", pthread_create(&r, NULL, reuse_thread, &w) == 0);
    pthread_join(r, NULL);
    uint32_t st[ST_WORDS];
    stats(st);
    printf("GUEST_GPUHC EXIT_BLOCKED exit_ms=%llu child_slot=%u reuse_slot=%u main_slot=%u rounds_after=%d wrong=%d\n",
           (unsigned long long)exit_ms, child_slot, w.slot, st[ST_SLOT], w.rounds, w.wrong);
    CHECK("dead thread's slot reused", child_slot < 256 && w.slot == child_slot);
    CHECK("no stale completion observed", w.wrong == 0 && w.rounds > 0);
    fflush(stdout);
}

// ---- a separate process (fork-style clone with a copied memory) -----------
static char child_stack[65536] __attribute__((aligned(16)));
static int child_main(void *arg) {
    (void)arg;
    int bad = 0;
    bad |= hc(OP_ECHO, 4242, 0, 0, 0, 0) != 4242;
    uint8_t *mine = malloc(3 * 65536);
    if (!mine)
        return 2;
    bad |= hc(OP_FILL, (long)mine, 3 * 65536, 31337, 0, 0) != 0;
    for (uint32_t i = 0; i < 3 * 65536; i += 97)
        bad |= mine[i] != fill_byte(31337, i);
    uint32_t sum = 0;
    bad |= hc(OP_CHECKSUM, (long)mine, 3 * 65536, (long)&sum, 0, 0) != 0 || sum != fnv1a(mine, 3 * 65536);
    uint32_t st[ST_WORDS];
    bad |= stats(st) != 0;
    printf("GUEST_GPUHC CHILD pid=%d slot=%u bad=%d\n", getpid(), st[ST_SLOT], bad);
    fflush(stdout);
    return bad ? 1 : 0;
}
static void test_process(void) {
    static uint8_t marker[4096];
    memset(marker, 0x11, sizeof marker);
    pid_t child = clone(child_main, child_stack + sizeof child_stack, SIGCHLD, NULL);
    CHECK("clone child", child > 0);
    int status = -1;
    CHECK("waitpid child", child > 0 && waitpid(child, &status, 0) == child);
    CHECK("child passed", WIFEXITED(status) && WEXITSTATUS(status) == 0);
    int untouched = 1;
    for (size_t i = 0; i < sizeof marker; i++)
        untouched &= marker[i] == 0x11;
    CHECK("parent memory untouched", untouched);
    CHECK("parent still works", hc(OP_ECHO, 5, 0, 0, 0, 0) == 5);
}

// ---- WebGPU probes --------------------------------------------------------
static char json[65536];
static void test_webgpu(void) {
    uint32_t needed = 0;
    CHECK("adapter ENOSPC", hc(OP_ADAPTER_INFO, (long)json, 16, (long)&needed, 0, 0) == -ENOSPC);
    CHECK("adapter needed length", needed > 16 && needed < sizeof json);
    uint64_t t0 = now_ns();
    long n = hc(OP_ADAPTER_INFO, (long)json, sizeof json - 1, (long)&needed, 0, 0);
    uint64_t dt = now_ns() - t0;
    CHECK("adapter info", n > 0 && (uint32_t)n == needed);
    if (n > 0) {
        json[n] = 0;
        printf("GUEST_GPUHC ADAPTER ms=%llu %s\n", (unsigned long long)(dt / 1000000), json);
        CHECK("adapter available", strstr(json, "\"available\":true") != NULL);
        CHECK("device created", strstr(json, "\"device\":{\"ok\":true") != NULL);
        CHECK("high-performance request", strstr(json, "\"powerPreference\":\"high-performance\"") != NULL);
        const char *vendor = getenv("GPUHC_EXPECT_VENDOR");
        if (vendor && *vendor) {
            char want[96];
            snprintf(want, sizeof want, "\"vendor\":\"%s\"", vendor);
            printf("GUEST_GPUHC EXPECT_VENDOR %s\n", vendor);
            CHECK("adapter vendor as expected", strstr(json, want) != NULL);
            CHECK("not a fallback adapter", strstr(json, "\"isFallbackAdapter\":false") != NULL);
        }
    }
    size_t sizes[2] = {65536, 4u << 20};
    for (int k = 0; k < 2; k++) {
        uint8_t *src = malloc(sizes[k]);
        CHECK("probe malloc", src != NULL);
        if (!src)
            continue;
        for (size_t i = 0; i < sizes[k]; i++)
            src[i] = (uint8_t)(i * 7 + k);
        uint32_t sum_before = fnv1a(src, sizes[k]);
        n = hc(OP_WRITEBUFFER_PROBE, (long)src, (long)sizes[k], (long)json, sizeof json - 1, (long)&needed);
        CHECK("writeBuffer probe", n > 0);
        CHECK("probe restored source", fnv1a(src, sizes[k]) == sum_before);
        if (n > 0) {
            json[n] = 0;
            printf("GUEST_GPUHC WRITEBUFFER %s\n", json);
            CHECK("copy path ok", strstr(json, "\"copySlice\":{\"ok\":true") != NULL);
        }
        free(src);
    }
    fflush(stdout);
}

// ---- owner loss -----------------------------------------------------------
static void print_stats(const char *tag) {
    uint32_t st[ST_WORDS];
    if (stats(st) == 0)
        printf("GUEST_GPUHC STATS %s version=%u owner=%u gen=%u slot=%u heartbeat=%u calls=%u dead=%u flags=%u "
               "thread_calls=%u stall_ms=%u\n", tag, st[ST_VERSION], st[ST_OWNER_STATE], st[ST_OWNER_GEN],
               st[ST_SLOT], st[ST_HEARTBEAT], st[ST_CALLS], st[ST_DEAD_REASON], st[ST_FLAGS], st[ST_THREAD_CALLS],
               st[ST_STALL_MS]);
    fflush(stdout);
}
static uint32_t stat_word(int i) {
    uint32_t st[ST_WORDS];
    return stats(st) == 0 ? st[i] : 0xffffffffu;
}
static void loss_case(const char *name, int op, long expect_first_ms_max, uint32_t reason) {
    uint32_t gen = stat_word(ST_OWNER_GEN);
    uint64_t t0 = now_ns();
    long r = hc(op, 0, 0, 0, 0, 0);
    uint64_t first_ms = (now_ns() - t0) / 1000000;
    uint64_t t1 = now_ns();
    long r2 = hc(OP_ECHO, 1, 0, 0, 0, 0);
    uint64_t second_ms = (now_ns() - t1) / 1000000;
    printf("GUEST_GPUHC LOSS %s gen=%u first=%ld first_ms=%llu next=%ld next_ms=%llu dead_reason=%u\n", name, gen, r,
           (unsigned long long)first_ms, r2, (unsigned long long)second_ms, stat_word(ST_DEAD_REASON));
    CHECK("loss first call errors", r == -EIO || r == -ENODEV);
    CHECK("loss first call bounded", (long)first_ms <= expect_first_ms_max);
    CHECK("loss next call ENODEV", r2 == -ENODEV);
    CHECK("loss next call immediate", second_ms < 50);
    CHECK("loss owner dead", stat_word(ST_OWNER_STATE) == 3);
    CHECK("loss reason", stat_word(ST_DEAD_REASON) == reason);
    uint64_t t2 = now_ns();
    CHECK("respawn", ctl(CTL_RESPAWN, 0) == 0);
    printf("GUEST_GPUHC RESPAWN %s ms=%llu gen=%u\n", name, (unsigned long long)((now_ns() - t2) / 1000000),
           stat_word(ST_OWNER_GEN));
    CHECK("respawn new gen", stat_word(ST_OWNER_GEN) == gen + 1);
    CHECK("echo after respawn", hc(OP_ECHO, 321, 0, 0, 0, 0) == 321);
    uint32_t sum = 0;
    static uint8_t probe[5000];
    memset(probe, 0x5a, sizeof probe);
    CHECK("memory after respawn", hc(OP_CHECKSUM, (long)probe, sizeof probe, (long)&sum, 0, 0) == 0 &&
                                      sum == fnv1a(probe, sizeof probe));
    fflush(stdout);
}
struct busy { long result; uint64_t ms; };
static void *busy_sleep(void *arg) {
    struct busy *b = arg;
    uint64_t t0 = now_ns();
    b->result = hc(OP_SLEEP, 5000, 0, 0, 0, 0);
    b->ms = (now_ns() - t0) / 1000000;
    return NULL;
}
static void test_loss(void) {
    CHECK("control bad cmd", ctl(99, 0) == -EINVAL);
    CHECK("control bad stall", ctl(CTL_SET_STALL_MS, 5) == -EINVAL);
    CHECK("control set stall", ctl(CTL_SET_STALL_MS, 1000) == 0 && stat_word(ST_STALL_MS) == 1000);
    CHECK("respawn while alive is no-op", ctl(CTL_RESPAWN, 0) == 0);
    print_stats("before-loss");
    // Owner spins forever: callers detect the stopped heartbeat.
    loss_case("hang", OP_TEST_HANG, 3000, 2);
    // Owner asks the page to terminate it (same path as a Worker error/kill).
    loss_case("terminate", OP_TEST_TERMINATE, 1000, 3);
    // Owner closes itself silently.
    loss_case("close", OP_TEST_CLOSE, 3000, 2);
    // Other threads blocked in the owner are woken when it dies.
    pthread_t t;
    struct busy b = {0};
    CHECK("busy create", pthread_create(&t, NULL, busy_sleep, &b) == 0);
    struct timespec pause = {0, 200 * 1000000};
    nanosleep(&pause, NULL);
    long r = hc(OP_TEST_TERMINATE, 0, 0, 0, 0, 0);
    pthread_join(t, NULL);
    printf("GUEST_GPUHC LOSS blocked-thread first=%ld other=%ld other_ms=%llu\n", r, b.result, (unsigned long long)b.ms);
    CHECK("blocked thread errors", b.result == -EIO);
    CHECK("blocked thread woken early", b.ms < 2000);
    CHECK("final respawn", ctl(CTL_RESPAWN, 0) == 0);
    CHECK("restore stall", ctl(CTL_SET_STALL_MS, 3000) == 0);
    CHECK("final echo", hc(OP_ECHO, 99, 0, 0, 0, 0) == 99);
    print_stats("after-loss");
}

int main(void) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    printf("GUEST_GPUHC START\n");
    uint32_t st[ST_WORDS];
    CHECK("stats before first call", stats(st) == 0);
    CHECK("protocol version", st[ST_VERSION] == 1);
    CHECK("owner not started", st[ST_OWNER_STATE] == 0);
    CHECK("test hooks enabled", (st[ST_FLAGS] & 1) != 0);
    CHECK("stats EFAULT", stats((uint32_t *)0) == -EFAULT);
    uint64_t t0 = now_ns();
    CHECK("first echo", hc(OP_ECHO, 1234, 0, 0, 0, 0) == 1234);
    printf("GUEST_GPUHC FIRST_CALL ms=%llu\n", (unsigned long long)((now_ns() - t0) / 1000000));
    print_stats("after-first");
    CHECK("owner alive", stat_word(ST_OWNER_STATE) == 2);
    test_latency();
    test_memory();
    test_concurrency();
    test_blocked();
    test_process();
    test_webgpu();
    test_loss();
    printf("GUEST_GPUHC SUMMARY passes=%d failures=%d\n", passes, failures);
    fflush(stdout);
    return failures ? 1 : 0;
}
