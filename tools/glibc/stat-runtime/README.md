# GNU stat/time64 runtime gate

This packet builds ten unchanged GNU 2.44 implementation units, including
`misc/makedev.c`, with the reviewed architecture statx selection. It links them
with the verified 191-object GNU runtime lineage. The eight public stat APIs
are called through volatile function pointers; their real kernel output is
compared with an independent raw statx call. Public output is 128 bytes,
kernel statx output is 256 bytes, and the incompatible legacy kernel stat is
104 bytes. No legacy structure is relabeled or copied into the public ABI.

The fixture covers errno and thread isolation, contiguous 16-byte canaries,
file identity/hard links, symlink policy, directory-relative and empty-path
calls, failed calls, bytes surviving metadata operations, and timestamps after
2038 with nonzero nanoseconds. Raw utimensat_time64 (412), statx (291), and
fixture I/O are explicit test transport rather than GNU API acceptance.
All allocator/startup/jump/cleanup/once/abort, earlier syscall, fixed rounding,
isolated setpgid/setsid/chroot, and public exec regressions remain required.
The rootfs BusyBox/setsid launcher remains outside the GNU payload closure.

Provide the same toolchain, retained kernel headers and signed GNU archive
variables as earlier packets, plus `GLIBC_C_CLEANUP_PACKET`,
`GLIBC_FENV_PACKET`, `GLIBC_FIXED_PACKET`, `GLIBC_NEXT26_PACKET` and
`GLIBC_STAT_PACKET`. Set `GLIBC_TASK` to a new ext4 task directory. Source
`env.sh`; its temp/cache paths and storage checks enforce the 2 GiB task cap,
8 GiB launch reserve and 5 GiB hard stop. Commands are supervised with finite
bounds and exact process-group terminal proofs:

```sh
python3 tools/glibc/stat-runtime/supervise.py prepare 300 bash tools/glibc/stat-runtime/prepare.sh
python3 tools/glibc/stat-runtime/supervise.py stat-build 120 python3 tools/glibc/stat-runtime/build.py
python3 tools/glibc/stat-runtime/supervise.py runtime 120 bash tools/glibc/stat-runtime/build-runtime.sh
python3 tools/glibc/stat-runtime/supervise.py package 120 bash tools/glibc/stat-runtime/build-guest.sh "$GLIBC_TASK/objects/stat-runtime.wasm" initial
python3 tools/glibc/stat-runtime/supervise.py native 180 node tools/glibc/stat-runtime/run-guest.mjs jit "$GLIBC_TASK/guest-native-initial" "$GLIBC_TASK/native-package-initial"
python3 tools/glibc/stat-runtime/supervise.py fpcast 180 node tools/glibc/stat-runtime/run-guest.mjs jit "$GLIBC_TASK/guest-fpcast-initial" "$GLIBC_TASK/fpcast-package-initial"
```

For a changed fixture, `recompile-fixture.sh LABEL` creates a unique task-local
object/link/map/cache without changing accepted objects. `build-guest.sh`
requires unique module, tag-report and package destinations. Auditing a
recompiled payload uses `audit.py --label LABEL --run RUN`, matching
`guest-native-RUN` and `guest-fpcast-RUN`; its final snapshot directory is unique.
Use `audit.py --label initial --run initial` for the initial full build. Preserve original failed
attempts and source mappings before retries.

This proves bounded GNU public stat/time64 semantics. It does not establish
legacy `_STAT_VER_KERNEL` compatibility, real files above 4 GiB, full
cancellation/forced unwind, C++ runtime, general CRT/dynamic loading, a complete
sysroot, or Firefox Nightly/JIT/GPU acceptance. The manually reserved startup
and single-arena allocator policy remain inherited fixture limits.
