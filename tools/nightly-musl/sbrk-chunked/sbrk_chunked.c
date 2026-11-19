/*
 * Link-time replacement for the wasm musl sysroot member libc.a(brk.o).
 *
 * libc.a(brk.o) defines exactly two global symbols, brk and sbrk (plus the
 * statics mutex/current/heap_limit/_brk).  Defining both here means wasm-ld
 * never fetches brk.o, so there is no duplicate-symbol conflict.  Users of
 * sbrk in libc: map.o (__malloc_map_alloc), malloc.o, lite_malloc.o.
 *
 * Semantics copied from the disassembled original:
 *  - initial break  = &__heap_end (linker-defined);
 *  - heap_limit     = memory.size << 16, read lazily on first call and
 *                     re-read after every successful grow;
 *  - new break < current break  -> ENOMEM, -1 (no shrinking, sbrk(neg) fails);
 *  - new break <= heap_limit    -> just move the break (sbrk(0) returns it);
 *  - brk returns 0 / -1, sbrk returns the old break / (void *)-1;
 *  - one process-wide pthread mutex around brk and sbrk (abort if lock fails).
 * Only difference: when the break passes heap_limit, memory.grow asks for
 * max(needed, 16 MiB, min(current_size / 8, 64 MiB)) pages (clamped to the
 * wasm32 4 GiB limit).  If that grow fails (e.g. memory maximum), it retries
 * with exactly the needed pages, then fails like musl.
 *
 * Every memory.grow on shared memory makes V8 broadcast to all workers and
 * walk every instance importing the memory, so fewer, larger grows matter.
 *
 * Build switches: -DSBRK_CHUNKED_EXACT=1 restores exact-page growth (for
 * counting baseline grows).  At run time SBRK_CHUNKED_STATS=1 in the guest
 * environment prints "sbrk-chunked: grows=N pages=P" to stderr at exit.
 */
#include <errno.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define WASM_PAGE 65536u
#define WASM32_MAX_PAGES 65536u
#define MIN_CHUNK_PAGES (16u << 20 >> 16)  /* 16 MiB */
#define MAX_FRAC_PAGES (64u << 20 >> 16)   /* 64 MiB */

extern unsigned char __heap_end;

static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static uintptr_t current = (uintptr_t)&__heap_end;
static uintptr_t heap_limit;

unsigned __sbrk_chunked_grows;
unsigned __sbrk_chunked_grow_pages;

static int grow_pages(uint32_t pages)
{
	if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1)
		return -1;
	__sbrk_chunked_grows++;
	__sbrk_chunked_grow_pages += pages;
	return 0;
}

static int _brk(uintptr_t end)
{
	if (!heap_limit)
		heap_limit = (uintptr_t)__builtin_wasm_memory_size(0) << 16;
	if (end < current)
		goto fail;
	if (end <= heap_limit) {
		current = end;
		return 0;
	}
	{
		uint32_t need = (uint32_t)(((uint64_t)end - heap_limit + WASM_PAGE - 1) >> 16);
		uint32_t chunk = need;
#if !SBRK_CHUNKED_EXACT
		uint32_t cur = (uint32_t)__builtin_wasm_memory_size(0);
		uint32_t frac = cur / 8;
		if (frac > MAX_FRAC_PAGES) frac = MAX_FRAC_PAGES;
		if (chunk < MIN_CHUNK_PAGES) chunk = MIN_CHUNK_PAGES;
		if (chunk < frac) chunk = frac;
		if (cur < WASM32_MAX_PAGES && chunk > WASM32_MAX_PAGES - cur)
			chunk = WASM32_MAX_PAGES - cur;
		if (chunk < need) chunk = need;
#endif
		if (grow_pages(chunk) && (chunk == need || grow_pages(need)))
			goto fail;
	}
	current = end;
	heap_limit = (uintptr_t)__builtin_wasm_memory_size(0) << 16;
	return 0;
fail:
	errno = ENOMEM;
	return -1;
}

int brk(void *end)
{
	int r;
	if (pthread_mutex_lock(&mutex))
		__builtin_trap();
	r = _brk((uintptr_t)end);
	pthread_mutex_unlock(&mutex);
	return r;
}

void *sbrk(intptr_t inc)
{
	uintptr_t old;
	int r;
	if (pthread_mutex_lock(&mutex))
		__builtin_trap();
	old = current;
	r = _brk(old + inc);
	pthread_mutex_unlock(&mutex);
	return r ? (void *)-1 : (void *)old;
}

static void sbrk_chunked_report(void)
{
	char b[96];
	int n = snprintf(b, sizeof b, "sbrk-chunked: grows=%u pages=%u memory_pages=%u\n",
			 __sbrk_chunked_grows, __sbrk_chunked_grow_pages,
			 (unsigned)__builtin_wasm_memory_size(0));
	if (n > 0)
		write(2, b, (size_t)n < sizeof b ? (size_t)n : sizeof b - 1);
}

__attribute__((constructor)) static void sbrk_chunked_init(void)
{
	const char *s = getenv("SBRK_CHUNKED_STATS");
	if (s && *s == '1')
		atexit(sbrk_chunked_report);
}
