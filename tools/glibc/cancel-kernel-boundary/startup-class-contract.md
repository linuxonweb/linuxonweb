# Source-only bootstrap admission proposal

This proposal is not compiled, admitted, or runtime acceptance. Class 8 is a
separate finite pre-owner bootstrap seal. Class 2 remains import-free and class 4
continues to publish genuine records. The exact module/body/type SHA seals are
checked before compiler modifications. Source attributes cannot grant any seal.
The unchanged runtime descriptor table contains only classes 2 and 4; bootstrap
functions are not forced-unwind targets or a second frame chain.

The source delta targets the immutable producer27 snapshot. It does not include
producer30's ongoing fixed-frame correction. The producer must rebase the exact
startup delta after that correction, retaining both source pairs. The existing
primitive query, primitive prepare body, and primitive machine audit stay byte
identical. A separate query authenticates class 8. Peer native EH routing must
use that separate query to reject or omit outer EH guards only for the audited
bootstrap closure; extending the primitive query is prohibited.

## Compiler contract

The external manifest retains every actual function body/type/class pin. Version
1 permits only declaration 0 and definitions 2/4. Version 2 adds definition 8 and
requires a `startup` version-1 object with phase contract
`gnu-mask-tls-tp-admit-record-v1`. Its `symbols` object lists every class-8 function
exactly once, with phase 1 (block), 2 (pre-TLS prepare), or 3 (TLS-ready TP/admit),
and an ordered `calls` array containing SHA-256 of the actual printed LLVM call
instructions, excluding only compiler-authenticated early capture/poll markers.
The instruction hashes bind actual argument expressions as well as callees.
The whole-module pin independently binds globals, static buffers, and branches.

Each external direct callee is sealed by its actual LLVM type. An import also
binds its `wasm-import-module` and `wasm-import-name` attributes. An assembly
callee requires an actual object path/hash and an independently reviewed final
body audit hash. Merely declaring a linker TLS helper is rejected: its real final
body must first be produced and inspected, with a matching artifact and final
binding. In particular, the handwritten `_start`/TLS getter object and the linker
`__wasm_init_tls` body are separate inputs; they are not invented LLVM functions.

All pre-owner source bodies reject linear allocas, invoking/indirect/assembly
calls, EH pads/personality, variadic modes, unsealed intrinsics and source-supplied
seals. Phases 1/2 reject C TLS operands. The actual machine audit rejects any
linear frame, stack-pointer definition/write, EH catch/throw/rethrow, or unsealed
machine call. Class-8 functions cannot escape as function addresses or be called
from class-4 code. No function is classified by a namespace or filename. All
ordinary allocating helpers, restoration, GNU signals and cleanup code remain 4.

The source patch is deliberately insufficient for runtime admission on its own.
IR metadata records the startup function identities, not a native loader seal.
The final manifest binds actual module bytes and a separately audited startup
machine closure, including final symbol/type/call order. No-start/constructor and
host phase evidence are mandatory before instantiation. A manifest field naming
a body-audit hash cannot substitute for independently verifying that proof.

## Loader and actual import phase contract

Before a GNU instance is constructed, parse its actual bytes and reject section
8 (Wasm start). Reject `llvm.global_ctors`/`llvm.global_dtors` at producer input.
The final linked artifact and actual worker path must prove no constructor/init
function or guest import is invoked before `_start`. Compilation/inspection is
safe; `new WebAssembly.Instance` is the execution boundary. Legacy v1 payloads
retain their existing behavior. The candidate parser is `startup-module.mjs`;
its compile-level controls are not an owner seal or guest cancellation proof.

The unconditional constructor rejection is a boundary of this diagnostic gate.
It does not support Nightly's ordinary C++ constructor list. A later production
route must preserve legitimate initializers as descriptor4 code, invoke them
only after genuine owner publication, and separately prove that neither the
loader nor the final Wasm start function executes them before admission. Removing
this diagnostic rejection alone would not establish that route.

Per actual worker/task/instance epoch, admit only this single-use order:

1. Loader admits exact final startup bytes and enters `_start` once. No owner or
   canonical head exists. First guest syscall must be raw `rt_sigprocmask(134,
   SIG_BLOCK=0, fullMask, savedMask, 8, 0, 0)`. Verify actual buffer geometry and
   full two-word mask values against sealed final symbols. Kernel applies the
   mask before its exit-to-user signal loop. Keep the genuine old mask/pending
   state; KILL/STOP still use real process control. A failed mask may only invoke
   genuine `exit_group(94,93)` and must never resume bootstrap.
2. While genuinely masked, `startup_prepare` validates actual linker TLS size and
   alignment, returns the owned TLS reservation, and assembly calls the actual
   `__wasm_init_tls` exactly once. Actual TLS getter/initializer machine bodies
   and ordering must be verified in the final object/module. No guessed TLS base.
3. After compiler TLS initialization, initialize the genuine 1184-byte GNU
   descriptor/DTV. Accept only the sealed raw set_thread_area244 descriptor,
   set_tid_address96 joinstate, gettid178 and actual raw-TP getter operations.
   Authenticate import arguments and real kernel return values; no generic
   pre-owner syscall exemption. Failure exits90/91/92 are terminal.
4. `boundary_admit_v3` authenticates actual kernel raw TP, worker task/instance
   epoch, genuine descriptor fields/TLS canaries, and the compiler-emitted
   immutable root. Immutable root generation remains separate from worker epoch.
   Transition once. The host helper closure must itself be class2 stack-free;
   it cannot call allocating/unadmitted guest code or manufacture frame state.
5. Return to the exact assembly handoff and immediately enter the descriptor4
   owner gate. Its genuine activation must publish before `owner_restore_signals`
   runs as descriptor4. Restore the authentic old mask using raw134/SIG_SETMASK2.
   Actual restoration failures remain failures; genuine exit cannot return.
   Pending delivery uses real import/callback suppression, restored acknowledgments
   and the canonical head. Every later syscall follows ordinary frame admission.

No class-8 function may be invoked after transition. The final call graph must
prove the only continuation is the recorded gate; worker phase guards reject
repeated admission/exec-stale routes. The host cannot authenticate current source
body just by observing one Boolean, symbol name, module generation, or TP value.
Bind the sealed artifact to the actual compiled module and phase state. Avoid
calling an unrecorded fatal GNU abort from bootstrap; actual exit/exec/trap control
identities invalidate the epoch and never resume abandoned startup.

## Genuine child startup is a separate required boundary

Pristine GNU pthread_create blocks internal signals in the parent around clone;
child inherits that real kernel mask. GNU start_thread may lock/debug/rseq/robust
list before its cancellation anchor, so it cannot use the exec `_start` seal.
The child needs authentic private TLS/TP/stack/module admission before its first
recorded helper. Retain the inherited mask, establish a SAME-live-caller
`__sigsetjmp_cancel` backend64 anchor with genuine `priv.prev`, `priv.cleanup`,
and `self->cleanup_jmp_buf`, then restore actual `pd->sigmask` only with a live
recorded activation and anchor. Do not substitute old24 buffers or a returning C
setjmp wrapper. The real GNU unwind object and weak symbol must resolve to the
actual unchanged definition. A named first-owner gate does not establish general
pthread lifecycle, cancellation, or C++ compatibility.

## Minimum actual executable artifact set and recipe

The existing compile-only bridge, GNU helper/handler, startup/restore, cancellation,
selected cancel-arch, five GNU jump units, backend64 helper, genuine nptl/unwind,
and compiler/module4 providers are inputs, not reusable admitted objects. Re-emit
all their actual early IR with the corrected coherent compiler into a fresh task;
LLVM-link that IR before the record producer to form one real root. Preserve
source/include/header/driver versions. Apply the reviewed GNU early signal-jump
lowering in the same caller and the new64 prepare route, warnings metadata, and
owned native data-alias handling where actually needed. No old backend24 provider.

The exact execution shape, after compiler/manifest/host review, is:

```sh
# GLIBC_OWNER_TASK is a fresh ext4 /mnt/p6/build task; all TMP/cache vars point in it.
# Each frontend invocation uses the genuine selected GNU flags/includes and emits
# early prerequisite IR; compose all participating units before the producer.
"$LLVM_TOOLCHAIN/bin/llvm-link" "$GLIBC_OWNER_TASK"/ir/*.bc \
  -o "$GLIBC_OWNER_TASK/linked.bc"
"$COHERENT_CLANG" --target=wasm32-unknown-linux-gnu -O2 \
  -fexceptions -fwasm-exceptions -matomics -mbulk-memory \
  -mllvm -wasm-gnu-frame-records -mllvm -wasm-gnu-frame-forced-admission \
  -mllvm -wasm-gnu-forced-unwind -mllvm -wasm-enable-sjlj \
  -mllvm -wasm-native-eh-routing -mllvm -verify-machineinstrs \
  -mllvm "-wasm-gnu-provider-manifest=$GLIBC_OWNER_TASK/provider-manifest.json" \
  -c "$GLIBC_OWNER_TASK/linked.bc" -o "$GLIBC_OWNER_TASK/recorded.o"
```

`ir/*.bc` here is an illustrative finite curated inventory, not an acceptance of
arbitrary files. The eventual driver must use an explicit ordered path/hash list,
unique destinations, full command retention and finite owned PGID supervision.
The actual inspected manifest cannot yet be supplied because the corrected
record/context compiler and external TLS machine seal are still pending.

Strict final Wasm linkage must resolve actual GNU `__pthread_unwind` (currently
extern_weak at cancellation callers), actual GNU jump/mask/cleanup definitions,
backend64 registration and delivery, real GNU abort and every forced provider.
No undefined suppression, cancellation stubs, or weak-zero fallback. Inspect
actual root/function addresses and module imports; retain real TLS layout and
no-start proof. Then parameterize the owned guest package/runner with this exact
module and audited candidate kernel c999225b..., native then FPCAST23i64 in fresh
profiles. Existing basic3 runners retain all allocator/abort/exec/signal suites;
a new strict owner marker/status and SAME-live-caller anchor must also pass.
No concrete admitted module/manifest is currently available, so this recipe is
reviewable preparation, not a command claimed to have passed.

First gate: genuine rawTP/compilerTLS, actual root and published activation,
bridge sequential/nested/stale checkpoint tests, getpid positive and invalid read
error/errno preservation, restoration and terminal cleanup. Next cancellation
gate requires blocked read/futex with real enabled pending SIGCANCEL, disabled and
forged/ignored deliveries, nested ordinary handler jump/foreign escape, partial
result+deferred pending preservation, async sideeffect distinction, genuine GNU
cleanup order/anchor stop and exact thread result. One synthetic callback or old
ordinary regression never establishes these semantics.
