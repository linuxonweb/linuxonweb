# GNU scheduler and nonblocking semaphore closure — 2026-10-02

Accepted bounded gate: native 48,573/0 and FPCAST23i64 48,584/0 in real Linux/Wasm
guests. The201-object runtime retains the immutable 191-object next26 runtime
and every inherited allocator/startup/TLS/jump/signal/abort/C-cleanup/fenv and
79-wrapper regression, including isolated setpgid/setsid/chroot/public exec.
No release, Git commit, shared source/Nix change or production sysroot is
claimed. Root reviewed and authorized freezing this owned packet; independent root rehash follows.

Evidence is under `/mnt/p6/build/glibc-sched-sem-20261002`:
`acceptance.json`, `manifest.json`, `external-terminal-proof.json`, `logs/make-sched-sem-result.json`,
`logs/wrapper-audit/result.json`, `logs/layout-probe.json`,
`logs/semaphore-audit/scheduler-transport.json`, and both `*-run1` directories.
Replay tools are `tools/glibc/sched-sem`.

Fresh signed GNU glibc 2.44 replay and configure metadata use the accepted
architecture cumulative patch. Three GNU generator streams are byte-identical
to their original failing target snapshots. Actual GNU make compiles the
original `posix/sched_setp.o`, `posix/sched_getp.o`, `posix/sched_sets.o` and
`nptl/sem_post.o`; the original failure is resolved by owned architecture
dependency forwarding, using the actual GNU struct_sched_param definition
before Linux compatibility masking and before actual internaltypes. Public
headers, descriptor layouts and all five GNU semaphore algorithms remain
unchanged. Strong GNU implementation/public aliases match in actual objects;
eight volatile typed references prove actual GNU public declarations.

GNU sched_param measures size 4/alignment 4/priority offset 0. A separate Wasm
translation unit compiles byte-preserved declaration bytes from retained
kernel `include/linux/sched.h` under its true struct name, independently
measuring4/4/0; source offsets and hashes are retained. This is a declaration
layout probe, not a complete kernel-internal-header compilation. GNU pthread
remains 1184/alignment 32, pthread_attr 32, sem_t 16/alignment 4 and new_sem 16/alignment 4.
The selected atomic-sem_t branch is genuinely 32-bit; GNU post release-CAS and
trywait acquire-CAS appear in frontend IR and real Wasm atomic instructions.

Each guest exercises public sched_getparam against independent raw-kernel
readback, immediate contiguous 16-byte canaries, successful errno preservation,
negative PID/NULL/missing-task failures and unchanged output. Public setters
preserve or reject actual priority/policy. A separately launched process changes
OTHER→BATCH→OTHER, reads back policy/priority, and restores original identity,
policy and priority before exit. Each mode captures 82 actual scheduler syscall
calls with all six transported arguments and return values; the audit checks
real 2/3-argument placement, zero trailing arguments, errors and BATCH success.
Bad-address EFAULT is not covered.

Genuine public sem_init/sem_post/sem_getvalue/sem_trywait/sem_destroy cover
empty EAGAIN, counts, consumption, overflow EOVERFLOW with unchanged maximum
count and invalid initialization. Two genuine GNU-descriptor raw-clone users
perform 512 producer/consumer transfers through two semaphores. Release/acquire
publication preserves all payload bytes and sequence numbers, exclusive slot
ownership and separate allocated buffers; both final semaphore counts are
checked before genuine destruction. Existing concurrent GNU allocator tests
also preserve nonoverlap and real arena-lock contention: native 3,093 waits/
238 woken/5,277 wakes; FP 3,198/260/5,491, all error 0.

The actual unchanged GNU sem_wait.c unit compiles, and its public sem_trywait
is reachable. Linker dead-section GC removes the unreferenced sem_wait slow/
cancellation path; no undefined-symbol suppression, cancel stub or replacement
abort provider is used. The module imports only env.memory and the existing
linux.get_thread_area, linux.syscall and linux.copy_siginfo functions. Blocking
semaphore wait/wake, cancellation/destructors/default NPTL/create/join remain
pending. The inherited allocator still uses the explicit single-arena policy;
this packet does not add secondary arena protection providers.

Failures remain retained: wrappers attempt 1 rejected a new selector macro
placed after the template acceptance check; attempt 2 required the actual GNU
generated sem_t-align.h include path. The source/driver/front-end diagnostics
and nonzero supervisor statuses remain intact; corrected attempt 3 passes.
Initial 191-object reuse checked every runtime input and original/snapshot pair.
A final full inherited source/snapshot recheck verifies 23,346 files (364MB) and
copies all 191 objects again into verified-input191 before acceptance; future
prepare performs this full recheck before its first copy. All five new GNU
units equal the signed pristine source. The provenance audit checks 425 actual
include dependencies, 201 objects (180 Wasm+21 bitcode), actual make outcomes,
executed driver snapshots, retained failures and real browser/server cleanup.

Task use is about453MiB, within 2 GiB; launch 8 GiB and terminal 5 GiB free-space
reserves pass. Every build, temporary, cache and browser profile stays in the
owned ext4 task. Both browsers exit 0 and both servers close; every supervised
terminal process group is empty. No unrelated service is stopped.
