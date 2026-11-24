# Genuine GNU stat through Linux/Wasm statx — 2026-10-02

The retained full-make inventory failed at `io/fstatat64.o` and
`misc/fxstat64.o`. Its asm-generic kernel headers advertise legacy fstat64 and
fstatat64, whose 104-byte kernel structure differs from GNU's 128-byte public
time64 structure. GNU selected incompatible legacy branches: an undefined
kernel conversion structure in fstatat64 and an absent old fstat number in
fxstat64. Successful compilation of neighboring wrappers did not establish
correct runtime layouts.

The live kernel has a real 170-byte `sys_statx` implementation at function5161,
table344, with Linux syscall number291 defined in the retained source/UAPI.
Its SHA256 is
`21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`.
This supports selecting the genuine GNU statx conversion route; runtime
execution remains necessary to accept the transport and fields.

The isolated architecture overlay in `tools/glibc/stat` keeps upstream GNU
implementations unchanged. Its kernel_stat.h selects GNU's existing statx
branches only inside stat translation units, marks the direct kernel structure
as different and preserves GNU's equivalent public stat/stat64 aliases. A small
statx_cp.c wrapper includes the unchanged GNU converter with the same selection.
The architecture kernel-features.h asserts only statx availability in addition
to the earlier verified time64 capability. Public raw syscall constants outside
these GNU implementation units stay unchanged.

Build all nine related GNU make targets, pin their actual compiler inputs,
check symbols/aliases and prove that successful raw IR transports use291 rather
than79/80. Public stat/fstat/lstat/fstatat and their64 aliases need real guest
tests: output canaries, errno, file fields and inode identity, hardlinks,
symlink/no-follow behavior, relative dirfds and empty paths, errors, comparisons
against raw statx and time64 timestamps beyond2038 with nonzero nanoseconds.
Native and FPCAST gates must preserve all accepted runtime regressions.

Task evidence belongs under `/mnt/p6/build/glibc-stat-20261002`. All nine
genuine GNU make targets compile, as do independent eight-public-function
prototype/address checks and genuine128-byte stat/stat64,256-byte statx
layout assertions. The audit pins290 actual inputs, genuine original sources,
public weak/strong aliases and raw implementation calls selecting291. Three
supervised build groups are terminal and empty. This is compile acceptance;
public runtime semantics are not accepted. The initial supervisor launch lacked the required logs directory
and failed before starting a build; its stdout/stderr remain retained. A proper
task environment creates directories before the bounded second launch.
A first ad-hoc signature replay failed in the root helper's path handling
before a compiler child started; that helper was not saved. The corrected
owned compile-signatures.py retains the exact executed replay argv and output.
Frozen compiler originalArgs is a normalized frontend list, so the replay
explicitly restores -c; actual stage argv and GNU make logs remain authoritative.

Runtime work owns separate tools/glibc/stat-runtime/** and
`/mnt/p6/build/glibc-stat-runtime-20261002`, reusing verified191-object
next26 runtime evidence without changing it. GNU misc/makedev.o must close
the real __gnu_dev_makedev dependency. Native and FPCAST runtime tests remain
the next acceptance gate; compiling these objects is not a completed libc.
