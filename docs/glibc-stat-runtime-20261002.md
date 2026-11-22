# GNU stat/time64 runtime — 2026-10-02

Final native and FPCAST23i64 Linux guests pass **48,633/0** and **48,640/0**.
Both execute six stat suites and one concurrent errno suite alongside every
accepted allocator/startup/jump/cleanup/once/abort, fixed-rounding and earlier
syscall regression. Isolated setpgid, setsid, chroot and public exec still pass.
Browser exits are natural status zero, test servers close, and owned groups
are terminal. No kernel warning is accepted.

The fresh signed GNU 2.44 replay selects genuine statx conversion through the
reviewed architecture overlay. Actual GNU make builds nine unchanged stat
units and unchanged `misc/makedev.c`, which supplies the genuine dependency
used by `fstatat64`. All nine stat object hashes match the separate compile
packet. GNU public stat/stat64 output is 128 bytes; raw kernel statx output is
256 bytes. The incompatible legacy kernel stat layout remains 104 bytes.
No public buffer is filled by relabeling that legacy layout.

The actual public APIs `stat`, `stat64`, `lstat`, `lstat64`, `fstat`, `fstat64`,
`fstatat` and `fstatat64` are called through volatile runtime function pointers.
Independent genuine-header type assertions, raw IR references, strong body /
weak public alias identity and unique final link providers are audited.
The linked closure has 203 actual inputs: 182 Wasm-v1 objects and 21 LLVM
bitcode inputs. Compilation evidence pins 543 dependency/source/stage records
and 13 successful attempts, including the final fixture and startup.

Real file tests compare converted fields against a separate raw statx (291)
result: identity, device, inode, mode, links, owner/group, 64-bit size and block
fields, and timestamps. Hard links preserve identity; symlink following and
nofollow differ correctly; directory-relative and `AT_EMPTY_PATH` calls work.
Missing paths, bad descriptors and invalid flags produce genuine errors and
leave the public output unchanged. File payload survives the operations.
Both public and raw outputs have contiguous 16-byte guards on each side,
with compile-time offset/size assertions and checks of every guard byte.

A raw `utimensat_time64` (412) fixture call sets seconds **2,208,988,801** and
**2,208,988,802**, with nanoseconds **123,456,789** and **987,654,321**. The raw
statx result and all eight public calls preserve these timestamps beyond
2038. Raw I/O/statx/time64 calls are independent test transport, not acceptance
of GNU public utimensat or statx APIs. Thread tests verify genuine errno writes
and restore the caller's errno canary.

The initial replay/configure/metadata passed but reuse stopped because jump
preparation already created startup.c. Its script and generated startup are
retained; the narrow retry preserved that source before verified runtime reuse.
Native attempt 1 remains FAIL: its stat suites passed, but the new thread
helper leaked its own errno canary into the caller. The corrected helper
restores caller errno. Attempt 2 passed both guests (48,637/0 and 48,632/0),
but review found four alignment-padding bytes before each output were not
covered by its leading canary. Those payloads, inputs and sources remain
retained as historical passing evidence with incomplete guard coverage.
Only the fixture was rebuilt for attempt 3's contiguous guards; GNU objects
were unchanged. No failed or superseded report was rewritten.

Runtime evidence is under `/mnt/p6/build/glibc-stat-runtime-20261002`:
`acceptance.json`, `logs/final-runtime-inputs.json`, `logs/dependency-audit.json`,
`logs/final-terminal-proof.json`, `logs/historical-source-mappings.json`, and
`guest-{native,fpcast}-run3/{result,stat-result}.json`. The 221 final current /
snapshot records cover 203 objects plus 18 sources/modules. Retained script
versions identify executed helpers separately from later replay improvements.
Replay commands and parameterized unique-attempt build/audit tools are in
[the README](../tools/glibc/stat-runtime/README.md).

This is bounded public GNU stat/time64 acceptance. Real files above 4 GiB,
legacy `_STAT_VER_KERNEL` compatibility, general ELF CRT/loading, full NPTL
creation/cancellation/forced unwind, C++ runtime, a complete GNU sysroot and
Firefox Nightly/JIT/GPU are unfinished. Separate synthetic conversion evidence
must retain its host-only transport label. The inherited startup uses static
reservations, allocator tests use a single-arena policy, and the old BusyBox /
setsid rootfs launcher is outside the GNU payload closure. The earlier
NULL/default-source modern-mount kernel defect remains unresolved.
