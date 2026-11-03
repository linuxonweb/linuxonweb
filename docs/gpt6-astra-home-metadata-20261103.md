# Persistent home creation: fewer transactions and correct open lifetime

The retained change registers the handle for a newly created empty regular file
as soon as its strict creation transaction commits. The old path reopened the
file through another metadata transaction and, with O_TRUNC, another truncate.
Besides repeated work, a queued unlink could delete the new inode before that
reopen registered its live handle. The final code preserves the existing strict
write/flush/fsync semantics and the last-close cleanup of unlinked files.

Real Chromium 150.0.7871.114 passed all 50 storage checks, including 3 new
concurrent-create/unlink assertions. The final run completed in 6.903 seconds
with no errors and no owned processes remaining. The graphics_jit agent also
independently reviewed commit ordering, O_TRUNC, read-only errors and orphan
cleanup. Original rollback/persistence checks remain unchanged.

A same-browser ABBA sample reduced 64 create/stat/close/unlink cycles from
767.32 to 695.39 ms (9.4%). This is a small workload sample, not a general I/O
speed claim. Read/write paths are unchanged. An earlier explicit-commit
experiment showed mixed throughput and worse random 4-KiB I/O, so it was removed.
Failed and passing observations are retained under
`docs/evidence/gpt6-astra-builtin-rubywebterm-20261103/`.

These checks do not establish responsive Firefox within 30 seconds, full JIT
safety, full Vulkan/OpenGL, phone readiness or the overall project target.
