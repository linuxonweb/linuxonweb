# Bounded GNU full-make inventory

This packet replays signed GNU glibc 2.44 and committed Wasm foundation,
jump, syscall and warning metadata overlays, then runs genuine
`make -k -j2 lib` for at most 600 seconds. It records actual build progress
and failures. It does not accept a libc archive, GNU sysroot, CRT, NPTL,
Nightly browser, JIT or GPU release.

Set `GLIBC_TASK` to a new persistent ext4 task directory,
`GLIBC_TOOLCHAIN` to the pinned LLVM 22.1.8 root,
`GLIBC_KERNEL_HEADERS` to retained Linux/Wasm UAPI headers, and
`GNU_RELEASE_ARCHIVE` to signed GNU glibc 2.44 tar.xz. The inherited
storage setup requires 8 GiB free before launch, stops at 5 GiB free and
uses a stricter 2 GiB task cap. TMPDIR/TMP/TEMP and caches live in the task.
No musl or WASI headers/archive are used.

```sh
bash tools/glibc/inventory/replay.sh
python3 tools/glibc/inventory/verify-group.py
python3 tools/glibc/inventory/audit.py
python3 tools/glibc/inventory/classify.py
GLIBC_NIGHTLY_SOURCE=/path/to/pinned/firefox-159.0a1 \
  python3 tools/glibc/inventory/loader-plan.py
```

`run.py` retains commands, periodic disk/progress checks, exit status and
owned PID/PGID. It disables core files, terminates only that owned group
on bounds and verifies descendants are gone even after the make parent
exits. `audit.py` pins retained failed compiler commands/intermediates,
source snapshots and Wasm v1 object size/hash/section completeness.
GNU textual `stamp.o` metadata is counted separately. Stage and GNU
working-directory inference are labeled; the frozen compiler did not
record per-stage statuses or actual cwd. Generated syscall streams have
explicit command and source proof.

The recorded first run used the preserved original supervisor, which
counted `.o` paths and lacked final descendant verification. A separate
terminal process-group proof and final object audit supplement that run;
the improved supervisor was not rerun against the GNU tree. The original
stamp misclassification is retained separately. Failed source snapshots
are immutable by content-addressed filename; auditing is repeatable.

The source-only loader plan preserves GNU error/public API machinery and
proposes a native static export registry with explicit function/data/TLS
kinds, reference counts, scope and caller provenance. It is not a loader
implementation. Read the accompanying packet document and JSON evidence
before selecting any next implementation.
