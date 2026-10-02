# Cumulative GNU glibc Wasm build discovery — 2026-10-02

Genuine cumulative GNU glibc 2.44 `make -k -j2 lib` remains **FAIL**, with
1,690 complete native Wasm objects, 44 failed object targets and no archive.
Of the original 168 failed targets, 125 now compile and 43 remain failed.
The newly exposed failure is the legacy `io/xstatconv.o` source selection.
This is actual GNU build discovery, not a completed libc, installed sysroot,
CRT, NPTL or Firefox Nightly build.

The task is `/mnt/p6/build/glibc-cumulative-make-20261002`; repository replay
support is in `tools/glibc/cumulative-make/`. It starts from signed GNU archive
SHA-256 `37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667`
and verifies cumulative borrowed tools and the private C cleanup compiler
against stat-runtime manifest
`4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042`.
It copies no accepted runtime objects into the GNU make output directory.
All 284 borrowed input records are pinned. The actual overlay execution order
is foundation replay/configure/metadata, jumps, warnings, GNU library names
and static pthread requirements, then the owned typed syscall, fixed-rounding
and statx-selection overlays, followed by fresh configure/metadata generation.
The overlay log's order list describes the components rather than command
chronology. Scheduler/semaphore work and the later data-alias experiment are
excluded from this build.

Preparation's initial verifier failure is retained; it occurred before source
replay because stat-runtime files were then frozen but not yet tracked by Git.
The corrected verifier includes the exact frozen repository inventory.
Preparation retry passed in 48.143 seconds. The first make failed in 10.26
seconds at GNU CRT assembly: the private Clang driver prepended an extra
`clang` argument when re-executing cc1/cc1as. A retained integrated-cc1 control
failed; a `-no-canonical-prefixes` control compiled the unchanged GNU source.
The owned query/non-C driver now supplies that flag. No compiler rebuild or
GNU source reinterpretation was used.

The unique second make reused the fresh first attempt's completed objects;
it ran the same genuine GNU target to natural exit status 2 in 359.14 seconds.
Its PID/PGID 3774840 has no live members. The finite supervisor kept task
storage below 2 GiB; final progress was about 502 MiB with over 87 GB free.
The bounded diagnostic driver retains the accepted early jump/warning
adaptations and C cleanup frontend but forces its O2 IR pipeline. This does
not establish arbitrary production compiler/PIC/LTO/debug flag compatibility.

The completed audit validates complete Wasm section framing and hashes,
bitcode where present, GNU text stamps and partial outputs separately:

| Outcome | Count |
| --- | ---: |
| Complete Wasm-v1 objects | 1,690 |
| Complete LLVM bitcode objects | 0 |
| Genuine GNU text stamps | 36 |
| Partial or unknown outputs | 0 |
| Attempted GNU object targets | 1,734 |
| Current failed targets | 44 |
| Archives | 0 |

It preserves 1,739 C compiler attempts and 284 non-C/configure queries, exact
driver versions, source snapshots, stage argv/cwd/exit, raw and lowered IR,
and 2,767 actual include hashes. Its 1,734 distinct source records contain
1,607 unchanged GNU source bodies, seven owned architecture sources and 120
generated/configure source records. Configure failures and prior CRT failures
remain historical attempts, separate from current object failures.

| Current failure class | Count |
| --- | ---: |
| Unaudited generated syscall signatures | 31 |
| Native caller provenance | 5 |
| Omitted kernel memory syscalls | 3 |
| Checked-jump architecture selection | 1 |
| Scheduler header dependency | 1 |
| Cancellation instruction-range assembly marker | 1 |
| Libio ELF offset aliases | 1 |
| Legacy kernel-stat conversion source selection | 1 |

Caller-address failures are the four `dlfcn` APIs plus `gmon/mcount.o`.
Missing raw memory syscall numbers affect `brk`, `mmap64` and `mremap`;
successful manual runtime memory providers have not become these selected
GNU architecture sources. Checked longjmp selects a generic Linux backend
requiring `jmpbuf-offsets.h`; the accepted manual jump backend is not yet
integrated there. Cancellation's instruction-range markers do not establish
forced unwind. The syscall allowlist rejects remaining unaudited signatures
explicitly; it is not full syscall coverage.

`STAT_IS_KERNEL_STAT=0` correctly keeps GNU public 128-byte time64 stat
distinct from the retained kernel's legacy 104-byte layout. It also enables
unchanged GNU `xstatconv.c`, which requires a distinct `struct kernel_stat`
that this architecture port has not supplied. The ordinary/stat64 statx
routes and converter compile; suppressing this legacy unit would not close
the new failure. A future provider needs actual legacy UAPI offset/size
measurements, GNU-compatible timestamp fields with 32-bit legacy seconds,
and genuine conversion tests for versioned 104-byte kernel versus 128-byte
GNU outputs, device values, errno and guards.

No `.a` archive exists in the final make tree. Installed headers were not
attempted. GNU archive and install/stub recipes are unchanged from pristine
GNU source, apart from the previously accepted `abi-versions.h` generation
hook. The final audit records these exact recipes and absent installed GNU
stub headers; copying a header subset would not establish a usable sysroot.
GNU stubs generation depends on real object markers and subdirectory build
results, which remain blocked by the failed targets.

`logs/cumulative-audit.json` retains the original audit, including its overly
broad classification of three missing-memory errors. The explicit final
classification/provenance supplement is `logs/cumulative-final-audit.json`
(SHA-256 `f2d606076112d9c6a27cac7e41dedacad75d3d98cdf6b20d62839c02abeafa5f`).
The first supplement attempt's pristine-Makerules assertion failed on the
known metadata hook and remains retained; retry proves that exact hook and
unchanged archive/install/stub recipes. Both audit process groups terminated
normally. There are no new browser/runtime tests or release changes in this
discovery packet. Freeze and Git remain pending independent review.
