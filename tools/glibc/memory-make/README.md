This packet selects owned native Wasm memory architecture providers through
GNU glibc's actual make rules, retaining unchanged GNU misc/sbrk.c. The kernel
does not supply brk/mmap/mremap/munmap; the nonrecursive provider uses native
memory.grow and an atomic lock rather than a malloc-backed bootstrap shim.

The logical process break is independent of mapping placement. Break expansion
after an intervening mapping returns ENOMEM rather than overlap live mappings.
Shrinking the break or releasing a mapping changes logical allocation state;
Wasm pages remain physically accessible. Protection requests return ENOTSUP.
Anonymous read/write mappings, range reuse and supported remapping retain the
accepted authority implementation. MAP_STACK, file mappings, MAP_SHARED and
default public NPTL thread creation are not accepted by this packet.

Set GLIBC_TASK to a fresh ext4 directory under /mnt/p6/build, GLIBC_TOOLCHAIN
to the retained raw LLVM22.1.8 toolchain, GLIBC_KERNEL_HEADERS to the actual
Linux/Wasm UAPI, GNU_RELEASE_ARCHIVE to the signed GNU2.44 archive,
GLIBC_STAT_RUNTIME_PACKET to the frozen stat-runtime packet, and
GLIBC_C_CLEANUP_PACKET to the retained native C cleanup compiler packet.
The inherited environment keeps temporary files and caches in the owned task
and enforces its storage reserve and budget.

From the repository root:

```sh
bash tools/glibc/memory-make/prepare.sh
python3 tools/glibc/memory-make/build.py run2
bash tools/glibc/memory-make/build-host.sh run2
python3 tools/glibc/memory-make/audit.py
```

The tested task retains a first build failure: GNU generated syscall metadata
preceded the memory overrides and selected unsupported mprotect/madvise syscall
templates. Regenerating that owned metadata fixes source selection without
modifying GNU's generator. prepare.sh now invalidates that stale metadata.
Replay labels are unique; never reuse an existing task or overwrite old logs.
Use the existing cumulative-make/supervise.py with a unique label and finite
deadline around prepare/build/host commands.

Thirteen actual GNU make targets comprise six pristine GNU units and seven
owned architecture providers. Closed host modules in native and FPCAST23i64
configurations each pass291 assertions. Volatile public-header function pointers
exercise the true Wasm indirect ABI, off64_t and variadic mremap declarations.
This is a single-thread host gate, not a Linux guest run or complete sysroot.
