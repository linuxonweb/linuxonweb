# GNU glibc full-make failure inventory — 2026-10-02

A fresh signed GNU glibc 2.44 replay with the committed native Wasm
foundation, jump, typed syscall and warning metadata overlays ran genuine
`make -k -j2 lib`. It naturally returned **exit 2 after 314.15 seconds**,
within the 600-second bound. No libc archive was produced. The result is
build discovery, not full GNU libc, CRT, NPTL, Nightly, JIT or GPU acceptance.
Frozen predecessors and the public release remain unchanged.

The owned packet is `/mnt/p6/build/glibc-fullmake-inventory-20261002`.
`logs/inventory-command.json`, `fullmake-inventory.log`, `inventory-exit.json`
and `terminal-group-proof.json` record commands, failures and cleanup.
Owned PID/PGID 3020374 had zero live members at terminal verification;
no terminal signal was needed. The first supervisor was saved as
`source-snapshots/active-run-supervisor-original.py`. Its candidate-object
progress count is superseded by the final object audit; the repository
supervisor now verifies Wasm magic and terminal group membership. Owned
parent core limits were changed to zero during the original run and the
command is recorded in `logs/owned-core-policy.json`; future runs disable
cores before launch. The final supervisor was not used to repeat this build.

`logs/object-inventory.json` pins **1,733 attempted object targets, 1,565
structurally complete Wasm v1 objects and 168 failed GNU lib targets**.
Every completed object has size, SHA-256, magic and bounded section-length
validation. This does not prove linking, symbols or runtime behavior.
Thirty GNU text `stamp.o` files are separate metadata, with **zero partial
or non-Wasm object outputs**. The earlier stamp misclassification is retained
in `object-inventory-first-stamp-classification-retained.json`.
Four configure probe failures are separate from GNU lib target failures.

`logs/primary-failures.json` records exact unit/source, retained intermediate
IR and commands for each failure. Stage is inferred from the first missing
intermediate; actual stage status/cwd were not recorded by the frozen
compiler. GNU cwd is inferred from the target subdirectory, while generated
streams have explicit invocation proofs. Failed source bytes are copied by
hash into `source-snapshots/failed-sources`; the fresh GNU source/header tree,
generated streams and dependency files are also frozen.

| Independent class | Units | Concrete evidence / remaining work |
| --- | ---: | --- |
| C cleanup exception format | 50 | Actual GNU `scandir64-tail`, `pthread_once` and stdio units emit `__gcc_personality_v0`, DWARF `landingpad`/`invoke`; llc native Wasm instruction selection crashes. Preserve cleanup semantics and fix C frontend native EH generation. |
| Unaudited generated syscall signature | 93 | Architecture template rejects unsafe public signatures. Expand exact typed APIs with width/layout and real-kernel tests; alias undeclared diagnostics after rejection are cascades. |
| Caller provenance | 5 | Four GNU dlfcn units and `gmon/mcount` require unsupported `llvm.returnaddress`. Loader scope and generic profiling/backtrace are separate requirements. |
| Floating-point environment | 8 | `FE_TONEAREST` missing in selected architecture fenv headers, with later undeclared-name cascades. Native Wasm fixed rounding does not supply full GNU exception/rounding APIs. |
| GNU library-name metadata | 3 | `pthread_cancel`, `pthread_create`, `pthread_exit` need `gnu/lib-names.h`. Header generation does not solve their runtime lifecycle/unwind dependencies. |
| Omitted memory syscalls | 3 | Genuine GNU `brk`, `mmap64`, `mremap` select missing kernel numbers. Wire real native memory providers coherently, including honest unsupported flags/guards. |
| Stat ABI selection | 2 | `fstatat64` fallback requires missing `kernel_stat64` conversion; `fxstat64` needs absent `__NR_fstat`. Statx selection/kernel minimum must be source-verified and guest-tested before assumptions. |
| Scheduler header dependency | 1 | `sem_post` includes NPTL internaltypes without complete `sched_param`/`cpu_set_t`; correct selected header dependency. |
| Checked jump architecture selection | 1 | Full make selects Linux `____longjmp_chk.c` needing `jmpbuf-offsets.h`, rather than the accepted owned checked backend. Rebuild coherent layout/backend selection. |
| Cancellable syscall markers | 1 | `syscall_cancel` emits instruction-range labels; llc says data symbol `__syscall_cancel_arch_start` needs `.size`. This is distinct from the 50 C cleanup failures and requires real cancellation range semantics. |
| Libio alias assembly | 1 | `libio/vtables` emits `.global _IO_file_jumps`; exact warning adapter rejects unknown module asm. Implement genuine Wasm aliases rather than discarding it. |

The attempted build uses the inherited diagnostic C compiler pipeline with
forced O2, early jump lowering and exact GNU metadata adaptation. It is not
acceptance of every GNU or Nightly optimization, assembly, PIC, LTO, debug,
depfile or C++ flag. Generic returning BSD setjmp wrappers are caller-lowering
markers, not accepted standalone jump implementations. No API was removed,
return-address builtin replaced with null, cancellation stub installed or
unresolved symbol suppressed.

The next useful compiler packet is an owned minimal LLVM 22.1.8 C frontend
hook: Clang `getCPersonality` lacks the Wasm exception branch that C++ already
uses. An exact-version `CGException.cpp` rebuild and private CodeGen archive /
driver relink can retain GNU source as C and emit proper scoped cleanup pads.
Validate source/library ABI, ordinary C and non-EH behavior, all 50 failing
GNU units, nested/indirect cleanup execution and real native/fpcast guest
behavior. The separate GNU `_Unwind_ForcedUnwind`/CFA cancellation gap remains.
No compiler implementation is part of this inventory packet.

`logs/static-loader-plan.json` pins actual GNU dlfcn/error/scope sources and
Nightly159 NSPR `prlink.c`. Initial implementation should own one native Wasm
module with linked static libraries sharing process scope. A typed export
registry distinguishes function table values, linear-memory data, optional
versions and TLS resolvers. GNU public/error wrappers should preserve actual
error state, flags, process-handle identity and reference lifetimes. Registered
names can resolve static modules; unknown ELF files/namespaces/unsupported TLS
and versions need genuine errors. This does not create dynamic ELF support.

`dlopen(NULL)` is necessary: NSPR linker initialization calls it and aborts on
failure. `PR_LoadStaticLibrary` installs its real static table and shares the
executable handle. Actual static-table lookup returns NULL on a miss without
`dlsym` fallback, despite a nearby comment suggesting otherwise. Normal NSPR
load/symbol paths still need GNU dl APIs, and unloading closes the shared handle,
so reference handling must preserve process lifetime. `RTLD_DEFAULT`/`RTLD_NEXT`
need real scope order and meaningful owning-module caller provenance; a null
return-address substitution is invalid. Separate static registrations cannot
pretend separate native dynamic module address ranges.

Future loader gates must cover public/internal aliases; stable process handle
and references; function invocation in native and FPCAST modules plus distinct
data addresses; per-thread read-once GNU dlerror; misses/invalid flags/namespace
and ELF errors; caller-aware lookup ordering; nested/indirect calls; explicit
version/TLS limits; and actual NSPR init/register/find/unload after GNU threading
closure. None of these loader gates has been run here.

Replay instructions are in `tools/glibc/inventory/README.md`. Disk-backed
TMPDIR/TMP/TEMP/caches use the owned task; inherited launch reserve is 8 GiB,
hard stop 5 GiB and task cap 2 GiB. This task used about 407 MiB with about
94 GiB free. No unchanged runtime guest suite was repeated because no accepted
runtime source changed. The completed native/fpcast predecessor gates remain
bounded foundation evidence, not full libc/browser acceptance.
