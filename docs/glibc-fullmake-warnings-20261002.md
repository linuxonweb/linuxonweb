GNU warning metadata and typed sigaltstack — 2026-10-02

The fresh signed GNU 2.44 replay passes the bounded native guest with 48,366
assertions and FPCAST23i64 with 48,373, both zero failures. Each run includes six
new warning/syscall suites, six generated-syscall suites, six GNU jump suites,
three checked-jump abort diagnostics and the earlier real allocator/abort
regressions. Browser processes exit zero and owned servers close. These are
bounded runtime gates, not full libc or Firefox acceptance.

Exact GNU module assembly and warning constants translate to native Wasm
custom sections before optimizer/backend processing. Actual object parsing
matches warning bytes including NUL: revoke47, sigreturn50, Linux sigstack77,
dlmopen131. Empty GNU stub sections occur only for revoke/sigreturn. The actual
GNU Makerules recipe with llvm-objdump emits exactly __stub_revoke and
__stub_sigreturn. Its recipe is unchanged; its dependency list is restricted
to the audited objects. dlmopen's inspection object contains metadata only;
its complete runtime unit still fails compilation. Retained warning metadata
does not implement linker warning enforcement.

Three meaningful adapter boundaries reject unknown module assembly, missing
warning text and a runtime reference to a warning constant with exit3.
An unrelated llvm.used entry survives. Repeated compilation preserves earlier
proofs and yields the same object hash. The diagnostic driver uses textual,
unoptimized frontend LLVM IR, owned warning translation, frozen genuine GNU
jump lowering, forced O2 and native Wasm EH llc flags. General compiler flag,
assembly, C++, PIC/LTO/debug and dependency semantics remain unaccepted.

The additional genuine GNU generated sigaltstack wrapper has exact
int(const stack_t *,stack_t *) semantics. Its actual selected Linux header
defines size12/alignment4 and field offsets0/4/8. Both public/internal aliases
return -1+GNU errno ENOSYS through the real kernel. Invalid pointers also return
ENOSYS; output memory remains unchanged. Linux sigstack retains GNU conversion
and failure behavior. Unchanged GNU revoke/sigreturn retain real ENOSYS stubs.
No alternate-stack support or fake success is introduced.

Actual make -j2 lib returns2 after passing the former warning and sigaltstack
blockers. dlfcn/dlmopen.o now fails native Wasm llc on __builtin_return_address
in __dlmopen and ___dlmopen. GNU uses caller provenance for namespace/RPATH and
RTLD_NEXT map lookup, so a null replacement would lose real semantics. The
next bounded packet must design an architecture static-module/registration
and caller-provenance route, preserve GNU errors for unsupported ELF/namespace
operations, then resume genuine make to the next architecture blocker. CRT,
coherent jmp_buf rebuilds, full pthread lifecycle/stack guards and genuine
forced-unwind/C++ cancellation need separate acceptance. Existing native
libunwind does not supply GNU's forced-unwind/CFA ABI.

Evidence lives in /mnt/p6/build/glibc-fullmake-warnings-20261002:
guest-native-run1 and guest-fpcast-run1 contain result.json, jumps-result.json,
syscalls-result.json and warnings-result.json; logs/metadata-tests.json,
logs/warning-object-audit.json, logs/stack-abi.json and actual Makerules output
pin behavior and object provenance. logs/fullmake-lib-run1.log/.exit and the
retained tmp/fullmake-cc-* modules preserve the genuine build failure.
The early fixture compile failure (wrong output-helper name), pre-worker
package attempt and first missing Makerules output-directory failure remain
retained. All previous packets and releases remain unchanged.

Replay and guest commands are in tools/glibc/fullmake/README.md. Signed source
archive SHA256 remains 37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667.
Task storage is ext4, uses task-local temporary/cache paths and the stricter
2 GiB inherited budget. No Git publication, deployment or Sites mutation was
performed for this packet. Nightly → native JIT → GPU remains the objective.
