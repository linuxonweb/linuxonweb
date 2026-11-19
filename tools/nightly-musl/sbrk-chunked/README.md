# sbrk-chunked

Link-time replacement for the wasm musl sysroot member `libc.a(brk.o)`
(`WASM_MUSL_SYSROOT`, see `../recipe/environment.sh`). No sysroot rebuild.

Why: musl `sbrk` (called by `__malloc_map_alloc` in `libc.a(map.o)`, by
`malloc.o` and by `lite_malloc.o`) ran `memory.grow` for exactly the missing
64 KiB pages. On shared memory every grow makes V8 notify every worker and walk
every instance that imports the memory. The guest JIT creates one instance per
install, so Firefox minor GCs stalled for seconds (c125/c126 notes).

What changes: when the break passes the end of memory, the grow asks for
`max(needed, 16 MiB, min(memory_size / 8, 64 MiB))`, in whole pages, capped at
the wasm32 limit of 65536 pages. If that fails (memory maximum), it retries
with exactly the needed pages, then fails like musl (`ENOMEM`, `(void *)-1`).

Everything else matches the disassembled original: the initial break is
`&__heap_end`, the limit is read lazily from `memory.size` (and read again
after each grow), there's no shrinking (`sbrk(negative)` and `brk(lower)` fail
with ENOMEM), `sbrk(0)` returns the break, and one pthread mutex covers brk and
sbrk. `brk.o` defines only `brk` and `sbrk`. This object defines both, so
wasm-ld never fetches `brk.o` (no duplicate symbols).

Build (same compiler wrapper and target features as the guest objects):

    source ../recipe/environment.sh
    $CC -O2 -Wall -c sbrk_chunked.c -o sbrk_chunked.o

Link: put `sbrk_chunked.o` on the wasm-ld command line before every archive
(e.g. right after `crt1.o`). To verify, check that the link map shows
`sbrk_chunked.o:(sbrk)` and no `libc.a(brk.o)`.

Debugging: `-DSBRK_CHUNKED_EXACT=1` restores exact-page growth, for counting
baseline grows. `SBRK_CHUNKED_STATS=1` in the guest environment prints
`sbrk-chunked: grows=N pages=P memory_pages=M` to stderr at exit.

Trade-off: a process can use up to about 64 MiB more linear memory than it
needs, and fork copies that too. That is far less than a fixed 1 GiB pregrow.
