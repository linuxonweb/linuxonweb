# Guest JIT runtime code-install primitive (packet 1), 2026-09-28

Implements packet 1 of `docs/guest-jit-design-20260928.md`: a guest process can
emit a WebAssembly module image into its own memory, have the host compile and
instantiate it against the process memory and function table, and call the
exported functions through ordinary C function pointers. This is the runtime
primitive only. It is **not** a SpiderMonkey JIT; Firefox is unchanged and its
fixed-size table still refuses installs (`-ENOMEM`).

## Interface

Private syscall numbers, intercepted in the `linux.syscall` closure of
`web/linux/dist/worker.js` before the kernel call. The kernel, its image and the
four-import user ABI are unchanged.

| nr | call | result |
|---|---|---|
| `0x6a490001` | `jit_install(module_ptr, len, flags=0, out_ptr)` | 0 or -errno; `out_ptr[i]` = table index of export `fi` |
| `0x6a490002` | `jit_free(base, count)` (must match one whole install) | 0 or -EINVAL |
| `0x6a490003` | `jit_sync()` | current epoch (replays pending log entries) |
| `0x6a490004` | `jit_stats(out_ptr)` | 0; 12 u32 diagnostic words |

Errors: `ENOEXEC` (validation/compile/link), `E2BIG` (> 1 MiB), `EFAULT`,
`EINVAL` (flags, bad free), `ENOMEM` (table growth refused/arena full),
`ENOSPC` (log full), `ENOSYS` (no control block or no exported table).

Allowed installed-module imports: `env.memory` (shared, with maximum),
`env.table` (funcref) and immutable i32 `env.__jit_table_base` (the base index,
so sibling exports can `call_indirect` each other). Rejected: any other import
(including functions), defined memories, start function, active data/element
segments, non-function exports, exports not named `f0..fN-1`. No host function
is ever supplied to installed code.

## Implementation

- `web/linux/dist/guest-jit.js` (new, all logic): per-process control
  SharedArrayBuffer (growable, 16 MiB arena max) with lock, epoch, table base,
  bump pointer, free list with per-entry free epoch, 128 thread slots
  `[in_use, acked_epoch]`, install/tombstone log and module-image arena.
  `JitThread` per user Instance: hash-keyed (FNV-1a + byte compare) Module
  cache, `table.grow` + `table.set`, replay of missing log entries.
- `worker.js` hooks (33 lines): import; range check before the kernel call;
  `pending()` (one `Atomics.load`) then replay at syscall exit; create
  `JitThread` and replay right after user Instance creation (threads, fork
  children, exec); fresh control block per exec'd image; `cloneJitControl` on
  fork-COPY (child gets a private copy of allocator/log/arena, thread slots
  cleared); release thread slot on `worker_exit` and on instance replacement.
- Indices start at the static table length. Freed ranges become tombstones
  (slot set to null, calling traps) and are reused only after every live
  thread slot has acknowledged the tombstone epoch. If more than 128 threads
  exist, reuse is disabled for that process (safe fallback).
- Cross-thread visibility: a thread sees another thread's install at its next
  syscall exit or `jit_sync()`; lock-free consumers must call `jit_sync()`
  before first use (design section 2).

## Evidence (actual guest, 1 GiB / 2 CPUs verified from kernel markers)

Task root `/mnt/p6/build/guest-jit-20260928/` (ext4). Build `build-run2`:
`guest-jit-test.wasm` 50,774 bytes, SHA-256 `946a2268...18e2`, growable table
(initial 17, no max), imports only env.memory/linux.syscall/get_thread_area.
Test archive changes only packed `/init` and adds `bin/guest-jit-test`; 3,846
other records byte-identical; accepted `web/linux/` images untouched.

`guest-run4/result.json`: **62 checks passed, 0 failed**, guest exit 0,
browser exit 0, server closed, no Runtime exceptions. Covers:
- f0(x)=x+1; f1 `call_indirect` into a main-module function and into f0;
  f2 load/add/store on shared memory; two-export module calling its sibling via
  `__jit_table_base`; identical reinstall (module cache hit) at a new index.
- Negative: function import, unshared memory, mutable global, start function,
  active data, active element, non-`fN` export, oversized (E2BIG), garbage,
  bad pointer (EFAULT), flags (EINVAL), bad/partial/double free (EINVAL).
- Second pthread: sees earlier installs at creation; after `jit_sync()` sees a
  later install and the tombstone of a freed slot; its own two-export install is
  visible to the main thread.
- Fork (clone without CLONE_VM, memory COPY): child replays the whole log, sees
  copied memory, installs privately (reusing the freed index in its own copy;
  parent's slot remains null).
- Exec: new image starts with epoch 0, empty allocator, first index = its table
  length.
- Freed index reused by the parent after the thread joined; new code runs.

Microbenchmark, 1e7 calls `acc = f(acc)` through a function pointer, best of 3:
native static function **15.348 ns/call**, installed f0 **15.677 ns/call**
(ratio 1.021; rounds 15.35-15.95 vs 15.68-16.18). Syscall round trip
(200k calls): kernel `getppid` 1131.6 ns, host-only `jit_sync` 155.6 ns.
Final stats: 11 epochs, 10 compiles, 1 cache hit, 0 replay errors.

Regression with the modified worker.js: `aurora-run1` (existing
`aurora-ready` runner and package, 4 GiB / 2 CPUs Firefox image) passes all 23
checks; served `worker.js`/`guest-jit.js` hashes match the tested sources.

Failed attempts preserved: `guest-run1` (browser startup deadline),
`guest-run2` (old test let the thread reuse the freed slot, so the fork child's
null-slot check failed; later segfault), `guest-run3` (runner evaluated before
the document existed; fixed with a null-safe, retried snapshot).

## Limitations

- No measured baseline of normal-syscall overhead against the unmodified
  worker.js; the added cost is one integer range check and one `Atomics.load`
  per syscall (not measured separately).
- Firefox's table is fixed-size (initial = max); installs there fail until the
  table section is relinked/spliced (packet 2+). SpiderMonkey is untouched.
- Compilation is synchronous; large modules block the calling thread.
- Arena and log are append-only per process image (16 MiB / 16,384 entries);
  no compaction. Thread slots leak if a Worker dies without `worker_exit`
  (only disables reuse; never unsafe).
- Validation targets ABI mistakes, not a trust boundary (guest code is already
  sandboxed in its own memory).
- Headless Chromium; timings are single-run
  observations, not a Firefox speedup.
