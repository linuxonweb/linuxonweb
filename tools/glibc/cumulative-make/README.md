# Cumulative GNU Wasm build discovery

This replays signed GNU glibc 2.44 and accepted architecture overlays into a
fresh task, then runs genuine `make -k -j2 lib` for at most 600 seconds. It
compiles sources selected by GNU make; it does not copy the accepted runtime
object set into the build or claim a complete libc, sysroot, CRT or NPTL.

Use a new disk-backed `GLIBC_TASK` and export `GNU_RELEASE_ARCHIVE`,
`GLIBC_TOOLCHAIN`, `GLIBC_KERNEL_HEADERS`, `GLIBC_LLVM_SOURCE`,
`GLIBC_INVENTORY_PACKET`, `GLIBC_C_CLEANUP_PACKET`, `GLIBC_FENV_PACKET`,
`GLIBC_FIXED_PACKET`, `GLIBC_NEXT26_PACKET`, `GLIBC_STAT_PACKET` and
`GLIBC_STAT_RUNTIME_PACKET`. The verifier pins borrowed tools and compiler
inputs to the immutable stat-runtime manifest recorded in `verify-inputs.py`.
The task cap is 2 GiB; launch requires 8 GiB free and execution stops below
5 GiB free. `env.sh` places temporary files and caches in the task.

From the repository root:

```sh
source tools/glibc/cumulative-make/env.sh
python3 tools/glibc/cumulative-make/supervise.py prepare 240 \
  bash tools/glibc/cumulative-make/prepare.sh
python3 tools/glibc/cumulative-make/run.py run1
python3 tools/glibc/cumulative-make/supervise.py audit 180 \
  python3 tools/glibc/cumulative-make/audit.py run1
python3 tools/glibc/cumulative-make/supervise.py finish 120 \
  python3 tools/glibc/cumulative-make/finish-audit.py
```

The configure/query and assembly path uses the verified private Clang with
`-no-canonical-prefixes`, which prevents its owned driver entry point from
prepending an extra argument during cc1/cc1as re-execution. C compilation keeps
the accepted early GNU jump and warning adaptations and native C cleanup
frontend. This bounded driver uses an O2 IR pipeline; it is not acceptance of
all production compiler, debug, PIC, LTO or dependency flags.

Every C attempt retains source, driver, stage argv, cwd, IR and exit status.
Non-C invocations retain source and command records. The audit validates
complete Wasm objects, bitcode, GNU text stamps, partial outputs, archive
members, actual include bytes and the original 168-failure comparison.
Historical failed attempts remain distinct from each target's latest result.
The final supplement classifies missing kernel memory syscall numbers from
their actual errors, verifies every retained driver version, and records
unchanged GNU archive/install/stub recipes separately from build outcomes.
The original fixture/runtime gates remain separate evidence.

No scheduler/semaphore work in progress or subsequent data-alias experiment
is included in this discovery build. Genuine caller-address, cancellation,
memory-provider and other failures remain failures until their architecture
semantics are implemented and tested.
