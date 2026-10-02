# GNU Wasm scheduler and nonblocking semaphore packet

Adds three unchanged GNU-generated syscall streams and five unchanged GNU
semaphore implementations to the verified 191-object runtime. The original
GNU make targets sched_setp.o, sched_getp.o, sched_sets.o and sem_post.o pass.
Native 48573/0 and FPCAST23i64 48584/0 real guest gates preserve all inherited
regressions. No musl/WASI, abort/cancel stub or unresolved-symbol suppression.

Set GLIBC_TASK to a fresh ext4 task and the input variables from the accepted
next26 packet config, plus GLIBC_NEXT26_PACKET to its immutable directory.
Do not replay into any accepted/frozen task. All temporary/cache/profile paths
stay below GLIBC_TASK. The supervisor owns finite process groups, checks 2 GiB
cap, 8 GiB launch reserve and 5 GiB terminal reserve.

```sh
source tools/glibc/sched-sem/env.sh
python3 tools/glibc/sched-sem/supervise.py prepare 600 bash tools/glibc/sched-sem/prepare.sh
python3 tools/glibc/sched-sem/supervise.py wrappers 300 bash tools/glibc/sched-sem/build-wrappers.sh
python3 tools/glibc/sched-sem/audit-wrappers.py
python3 tools/glibc/sched-sem/layout-probe.py
python3 tools/glibc/sched-sem/supervise.py make4 300 python3 tools/glibc/sched-sem/build-make.py
python3 tools/glibc/sched-sem/supervise.py runtime 180 bash tools/glibc/sched-sem/build-runtime.sh
python3 tools/glibc/sched-sem/supervise.py package 180 bash tools/glibc/sched-sem/build-guest.sh "$GLIBC_TASK/objects/sched-sem.wasm" initial
GLIBC_HTTP_PORT=4203 GLIBC_CDP_PORT=9413 python3 tools/glibc/sched-sem/supervise.py native 180 node tools/glibc/sched-sem/run-guest.mjs jit "$GLIBC_TASK/native-run1" "$GLIBC_TASK/native-package-initial"
GLIBC_HTTP_PORT=4203 GLIBC_CDP_PORT=9413 python3 tools/glibc/sched-sem/supervise.py fpcast 180 node tools/glibc/sched-sem/run-guest.mjs jit "$GLIBC_TASK/fpcast-run1" "$GLIBC_TASK/fpcast-package-initial"
python3 tools/glibc/sched-sem/verify-inherited.py
python3 tools/glibc/sched-sem/audit.py
```

The actual GNU sem_wait.c translation unit is compiled. Dead-section GC drops
its unreferenced blocking/cancellation path; sem_trywait is reached through a
volatile typed public reference. Blocking wait/wake, cancellation, default
NPTL and full libc/sysroot/Nightly remain pending. The kernel sched_param probe
compiles the exact declaration bytes extracted from the actual retained
kernel header under its true name, with offsets/hash recorded; it does not
claim compilation of the complete kernel-internal header.
