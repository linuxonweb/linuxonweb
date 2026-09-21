# User-memory growth adapter

`user-memory-growth-adapter.js` is an out-of-tree bridge for the generated
`worker.js` runtime. It applies growth only to the userspace
`WebAssembly.Memory` supplied in a worker context; kernel linear memory keeps
the existing bounded `memory_bytes()` semantics.

The adapter computes the inclusive end of each user range with safe-integer and
overflow checks, rounds to 64 KiB WebAssembly pages, enforces the context
maximum, calls `memory.grow()` for the missing pages, then recreates the view
from the refreshed `memory.buffer` (which is detached by `grow`). Diagnostics
are emitted through `console.debug` and never alter trap behavior.

`worker.js` imports `ensureUserDestination` for user destination paths
(`write`, `write_zeroes`, and user atomic operations), and uses
`growForSyscallResult` when handling a successful `brk`, `mmap`/`mmap2`, or
`mremap` result. The kernel destination used by `read` stays on the existing
bounded `memory_bytes()` path and is never grown. Failed user growth returns
the existing copy/zero/futex failure result; syscall growth failures are
diagnosed and leave the syscall return value unchanged. The generated sibling
tree is intentionally unchanged; this file is provenance for the `linuxonweb`
distribution only.
