# Native GNU cancellation compiler prerequisite subset — 2026-10-02

The sparse private LLVM22.1.8 compiler now emits cleanup-aware source safepoints
and exposes the actual caller-entry stack pointer. Native Node controls pass
O0 **624/0**, O2 **640/0** and O3 **640/0**. This is a bounded subset of the first
[reviewed cancellation plan](glibc-cancel-native-plan-20261002.md). General frame
descriptors, forced unwind, cancellation, NPTL, GNU sysroot, Nightly/JIT/GPU and
release acceptance remain pending.

Owned storage is `/mnt/p6/build/glibc-cancel-compiler-20261002`; repository edits
are only `tools/glibc/cancel-compiler/**` and this document. Frozen predecessor
sources/toolchains, shared runtime, kernel, worker, AGENTS and release references
are unchanged. No browser, service, push or deployment was started.

## Concrete implementation

`-mllvm -wasm-gnu-cancel-prerequisite` is explicitly opt-in and rejects anything
other than wasm32 Linux GNU with native Wasm EH. `CGStmt.cpp` emits the may-throw
`__wasm_gnu_cancel_poll_v1(caller_sp, reason)` through `EmitCallOrInvoke` at source
while/do/for/range loop headers. `StartFunction` invokes that same machinery after
`EmitFunctionProlog`, with exception specifications/parameter cleanup setup live,
covering constructors, destructors and lambda/generated methods emitted through
the common path. This preserves C source language and Clang's actual cleanup
stack rather than attempting to recreate lost cleanups after optimization.

The reserved `__wasm_gnu_caller_sp_v1` marker is replaced in
`WebAssemblyFrameLowering.cpp` using the actual `global.get __stack_pointer` at
prologue entry. A dedicated fresh virtual register preserves that value before
own stack subtraction/realignment. Marker uses read the preserved register;
marker instructions are removed after all prologue insertion, including when
the marker was the original insertion point. Zero-stack, static allocations,
dynamic alloca, recursion and indirect calls use this same lowering; no fixture
function names select frames. Source definitions of the compiler-owned marker
reject. Native input admission rejects any marker reference or external
replacement definition. The original LTO linker remains unable to lower the
marker and its real failure is retained.

The initial mode forces `noinline` and disables tail calls. It does not implement
inline descriptor handoff, general exception routing or a final coverage verifier
for optimization-generated/irreducible loops. Entry capture/polls provide a
measured compiler primitive; no `_Unwind_GetCFA`, context ownership validation,
thread frame chain or general descriptor ABI is installed.

The cumulative sparse patch is
`67473abb362e308fef395f80baffdabb8e5baa8572222b457fefb879911cec40`.
The private compiler hash is recorded in `build-result.json`.
Root reviewed each final edited source against exact pristine LLVM sources before
heavy compilation. A VFS overlay routes only four sparse owned files. Binary ar
inspection preserves all101 ordered frontend occurrences, including duplicate
basenames: only `CGStmt.cpp.o` and `CodeGenFunction.cpp.o` change against the
accepted C-cleanup archive; its existing `CGException.cpp.o` stays byte-identical.
Only `WebAssemblyFrameLowering.cpp.o` changes in the original Wasm backend archive.
Five accepted driver objects and all other LLVM/Clang link archives remain pinned
and independently reread. Measured storage is recorded in `review.json`, under its2GiB task cap, with
launch8GiB reserve/5GiB hard stop and owned ext4 TMP/cache.

## Executed controls and retained limitations

Sixteen repetitions per mode measure root/nested caller SP, indirect/table calls,
recursive admission, actual dynamic allocation and normal global SP restoration.
Optimized zero-stack frames retain capture/polls. C while/do/for cleanup attributes
and C++ while/range/lambda destructors execute exactly once when a diagnostic
ordinary exception arises at a loop poll, with exact JS exception identity.
Constructors/destructors and every emitted definition in both selected control
modules carry the explicit mode attribute. Real native tag0 traverses C cleanup
once; actual Wasm traps bypass cleanup. Neither the tag0 payload nor the mode-off
poll/fatal provider is a GNU exception/cancellation runtime. The unexpected-fatal
provider is never called by the passing controls. The unchanged GNU
wordsize-32 header and predecessor's owned native jump header measure the coherent32-bit/24-byte backend
jump ABI; no sysroot is claimed.

Flags-off optimized ordinary C IR, disabled-EH C IR, host C EH IR and ordinary
native assembly match the accepted compiler byte-for-byte. Target/native-EH
mismatch and source marker-definition controls fail with the explicit diagnostics.
Native link admission rejects both an LTO reference and an independently compiled
mode-off external marker definition. Actual object symbol tables contain no
marker; emitted native assembly and final module disassembly are retained.

Escaping source exceptions still leak global stack space:80 cases per mode,
16bytes each at O2/O3; O0's range/lambda case leaks48bytes. Diagnostic tests restore
SP between cases. Normal returns restore it, but general escaping-frame
restoration is **FAIL/pending**, not hidden inside the passing cleanup count.
The original LTO backend fails with unresolved `__wasm_gnu_caller_sp_v1`; private
LTO linker/backend integration is pending. The independent loader's retained
native tag1/SjLj result still runs the retained target's cleanup prematurely and
again on normal return. This packet snapshots that original failure and makes
no tag1 correction. General descriptors, stop-before-cleanup ordering, resume,
CFA validation, cross-module admission, authenticated async poll dispatch,
public GNU lifecycle, kernel restart and real guest gates remain future work.

## Retained attempts and review artifacts

The first backend compile failed on missing generated
`WebAssemblyGenSDNodeInfo.inc`; genuine llvm-tblgen generation fixes the owned
recipe. A retry supervisor's suffix scanner looped before compilation and only
its owned empty-child group was terminated; the failure record is retained.
Initial assembly preparation failed through the predecessor private driver's
unsupported `.S` preprocessing subprocess path, then uses the pinned ordinary
assembler for the mode-off boundary. An omitted wordsize-32 include failed and
was corrected. Those attempts retain exact logs and scripts.

The first built compiler's native compile failed exit139: erasing a marker
invalidated `InsertPt` in prologue generation. The actual GDB trace, first binary,
archives and source patch are retained. The corrected deferred-erasure patch was
root-reviewed before rebuilding. The first diagnostic link failed on the
compiler's real nested-cleanup abort dependency; its diagnostic mode-off fatal
boundary was added explicitly, without GNU abort acceptance. None of these
failures is rewritten as a passing initial attempt.

Stable artifacts include `compiler.patch`, `source-changes.json`,
`build-result.json`, `logs/archive-proof.json`, `logs/link-inputs.json`,
`objects/controls/{O0,O2,O3}.wasm`, native object/assembly/IR artifacts,
`logs/{O0,O2,O3}-runtime.json`, `test-result.json`, `actual-inputs.json` and
`review.json`. Supervised stages record exact argv/cwd/PID/PGID/status and preserve
numbered failures and output snapshots. Review independently rereads source,
ordered archives, actual includes/link inputs/modules, explicit function coverage
and every recorded terminal process group. See
[the replay README](../tools/glibc/cancel-compiler/README.md). This is a reviewable
prerequisite subset, not a frozen complete compiler/runtime acceptance packet.
