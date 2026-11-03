# Rejected real-fence candidate — 2026-11-03

This directory preserves unfinished work; it is **not active production code**.
`rejected-real-fence-20261103.patch` applies against the task branch's initial
GL transport/guest driver. The two HTML fixtures belong under
`web/linux/tests/guest-glremote/` when reproducing an isolated candidate.

The candidate implements real WebGLSync objects and native bounded polling,
invalid/deleted-handle checks, context ownership and status queries. A direct
host fixture passed23 checks. The complete real Linux/Wasm native fixture
revealed a regression: after transform-feedback/readback and two workload
loops, a completed fence is followed by failed pixel readback. Chromium logs
`glMapBufferRange: Buffer is bound for transform feedback`, then loses the GPU
context. This occurred with explicit ANGLE OpenGL and Vulkan backend choices.
A matched old/new guest-driver comparison passed only with the old driver.
The exact tests and failure logs are retained; checks were not removed.

Removing the redundant same-context server wait did not fix the regression.
Temporarily detaching transform-feedback state around readPixels also failed
and was reverted. Any comment in the rejected patch attributing the crash to
server wait is an unconfirmed hypothesis, not the established cause.

Production `guest-gl-remote.js`, `glremote.c`, `ops.def` and `glrtest.c` were
restored to their previously reviewed version. Therefore current GL/EGL sync
stubs still do not establish real GPU completion. Full GLES/OpenGL compliance
must not be claimed. The patch is not an accepted SDK or Firefox update.

Retained artifacts: `/mnt/p3/codex-build/g3g/{s2,old1,new1,glfix1,vkfix1,tfdiag1}`;
all runs had one-second CPU/RAM samples and exact owned-process cleanup.
Earlier runs did not capture the controller's three-CPU cgroup migration and
are correctness diagnostics only. The later benchmark runner records live
cgroup quotas and explicitly matches three CPUs across browser and guest.
