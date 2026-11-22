# Five GNU syscall wrappers on native Wasm — 2026-10-02

The bounded GNU 2.44 build and real Linux guest gates pass for `capget`,
`capset`, `mount_setattr`, `pidfd_send_signal` and `pivot_root`. Native reports
48,761 assertions with zero failures; FPCAST23i64 reports 48,756 with zero
failures. This is five additional wrapper closures, not a complete GNU
sysroot, CRT, NPTL, Nightly browser, JIT or GPU acceptance.

Evidence is under `/mnt/p6/build/glibc-syscalls-last5-20261002`:
`logs/prepared-acceptance.json`, `logs/wrapper-audit/result.json`,
`logs/layout.json`, `logs/final-runtime-inputs.json`, `guest-native2` and
`guest-fpcast1`. Immutable manifest identities will be recorded separately
after independent review authorizes freezing.

The fresh signed-source replay uses the accepted private Clang C exception
frontend and native warning/SjLj adapters. Five genuine GNU make targets
compile the unchanged generated streams, byte-identical to the original
failed inventory streams. Exact GNU public prototypes constrain the mount
and pidfd definitions. The three historical capability/pivot exports have
typed declarations from the audited ABI; GNU supplies no public declaration
for them. Strong definitions and volatile public address references are
audited. Each has one provider in the actual linked module.

The final link has 239 inputs: 218 Wasm v1 objects and 21 LLVM ThinLTO inputs.
It reuses the immutable 232-object checked-jump runtime, replaces its startup
object and adds five wrappers, a signature consumer and the new fixture.
All current and retained input bytes are pinned. The dependency audit covers
408 actual headers, including separate GNU and kernel layout measurements.
GNU/kernel capability header/data sizes are 8/12 bytes, mount attributes are
32 bytes, and siginfo is 128 bytes. The measured signal fields are signo 0,
errno 4, code 8, pid 12, uid 16 and value 20.

Non-NULL pidfd signal routing uses an owned architecture conversion for
`SI_USER`, `SI_QUEUE` and `SI_TKILL`; other classes return `EOPNOTSUPP`.
NULL input uses the kernel directly. Guest callbacks verify the three codes,
PID/UID, queued payload and errno, with contiguous caller-input guards and
unchanged bytes. Invalid descriptor, signal mismatch, flags and bad pointer
paths return genuine errors. This does not establish all siginfo classes.

Capability tests negotiate the real version, read both v3 data words, perform
an exact no-op capset and confirm unchanged capabilities. They exercise
version, PID, permission and pointer errors without dropping capabilities.
Mount tests create only an owned configured-source ramfs, set readonly and
observe `EROFS`, restore write access, write bytes, then unmount. Exact-size,
short, oversized, invalid-flag and bad-pointer paths are tested; extended
attribute tails are not accepted by this packet. The existing kernel
NULL/default-source rodata-free defect remains unresolved.

An early named process alone chroots into owned ramfs A, pivots A→B→A,
verifies distinct files, restores its original root through a saved outside
directory descriptor and unmounts the owned mounts. The strict pivot and
status-zero markers occur exactly once in each guest. Successful runs prove
restoration; a failed forward pivot has a retained explicit cleanup path
that marks failures instead of accepting partial work. The runner root and
user filesystems are untouched. Raw read/write/unmount fixture transport and
the pinned old rootfs launcher remain outside new GNU API acceptance.

Both guests retain allocator, concurrent errno, startup/TLS, jumps, checked
jumps, cleanup/once, actual abort, public exec, scheduler/semaphore, stat,
fenv, earlier wrappers and isolated process regressions. Six ordinary suites
and one thread marker pass. Actual CPIO inspection finds only `/init`
changed and one new probe, whose bytes match the linked module. Each run's
34 served input hashes match; browsers exit zero, servers close and owned
process groups are empty. No kernel warning or unexpected trap is accepted.

Failures remain preserved: initial inherited startup-copy collision, signed
LLVM layout-text audit parsing, absent configparms during overlay setup,
template allowlist ordering, duplicate startup at the first link and missing
runner CLI argument before browser launch. Exact failed compiler/template
bytes and first link inputs are retained. The initial overlay helper bytes
were not retained before correction; this historical provenance limitation
is explicit. Later tooling changes only improve unique destinations and
retention and do not change the passing modules or repeat their tests.

Replay instructions and owned scripts are in
[`tools/glibc/syscalls-last5/README.md`](../tools/glibc/syscalls-last5/README.md).
The next meaningful measurement is a fresh coherent GNU full make with all
independently accepted architecture overlays, followed by archive, installed
header and link closure inspection.
