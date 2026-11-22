# GNU native Wasm legacy stat conversion

The actual GNU `io/xstatconv.o` target now builds in a fresh signed GNU 2.44
replay. Its 1,017-byte native Wasm object has SHA-256
`7cbdf9678e102ddfe3154e6f2e0b18e68e3bc7cf2dae55ade2263e48091e44e2`.
Five additional unchanged GNU errno/memory units supply the closed synthetic
test module. This closes the new legacy-conversion compilation failure exposed
by the cumulative discovery build.

The architecture provider distinguishes the retained Linux 104-byte stat64
input from GNU's 128-byte public time64 structure. Twenty field offsets plus
size/alignment are checked against the actual asm-generic UAPI. Kernel seconds
are signed 32-bit, nanoseconds unsigned 32-bit, and large file/inode/block
fields remain 64-bit. The real target layout diagnostic and actual GNU header
dependencies are retained.

Public `_STAT_VER_KERNEL` and `_STAT_VER_LINUX` remain zero. An owned
architecture source copy adds three exact preprocessor guards around the
duplicate raw-kernel case labels, two active and one in the alternate GNU
branch. Every GNU conversion body remains unchanged, verified by reversing
only those guards back to the pristine source. Version zero converts into the
128-byte public format; no raw 104-byte public-copy route is accepted. The
existing ordinary/historical statx callers and public header ABI remain intact.
GNU nanosecond and named-padding capability markers preserve all timestamp
fields. GNU zeros `__pad1`/`__pad2` while reserved and time-padding bytes retain
their previous contents; tests explicitly audit those bytes.

Native and FPCAST modules each pass 24,612 checks with no imports. Synthetic
inputs exercise the three genuine GNU internal converters, signed timestamp
extremes, nonzero nanoseconds, high 64-bit inode/size/block values, 16-byte
contiguous guards, errno preservation and invalid versions returning EINVAL
without output writes. Module hashes are
`d0722aa73cbcc016a7b4a710fefa7c18fc33d574df5d0a8b10352e86c1a9a5ef`
and `f177cc2b68b2ed90ccfa39105c0911eeb8a366e4991f018cbab693bb11243e34`.
These are conversion tests with synthetic data. The accepted real kernel
statx/time64 guest evidence remains the separate stat-runtime packet.

Evidence is under `/mnt/p6/build/glibc-legacy-stat-20261002`:
`logs/selected-make.json`, `logs/host-result.json`,
`logs/legacy-audit.json` and `logs/target-layouts.txt`. The final audit pins
seven selected compile attempts, six GNU units, 281 actual dependencies and
every stage/source/driver version. Its initial failed attempt incorrectly
included intentionally failing configure probes in the selected-unit pass
assertion; that source/log is retained. The corrected audit records those
fifteen configure attempts separately, including their failures. No tested
object or payload changed for that audit correction.

Replay instructions are in `tools/glibc/legacy-stat/README.md`. This packet
does not produce a full archive or installed GNU sysroot, prove another kernel
syscall route, or establish NPTL/Nightly/JIT/GPU support. The cumulative build
still requires a fresh discovery run after accepted closures are integrated.
