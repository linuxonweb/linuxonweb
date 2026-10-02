GNU native Wasm signal jumps — 2026-10-02

The new isolated packet at `/mnt/p6/build/glibc-native-jumps-20261002` passes
actual browser Linux guest native **48,320/0** (`guest-native-run4`) and
FPCAST23i64 **48,319/0** (`guest-fpcast-run1`). Both have three rejected invalid
owner/stack-bound/past-stack jumps, genuine GNU fortify diagnostics and exit134;
six complete positive jump suites; exit0 for the final concurrent allocator gate;
and browser exit0/server closed. `jumps-result.json` requires the additional jump
results, while `result.json` retains the foundation's startup/lock/abort/time64
gates. The counts differ because measured futex readiness checks vary.

`tools/glibc/jumps` uses the unchanged GNU public jump header and six additional
unchanged GNU implementation units: setjmp/sigjmp.c, setjmp/longjmp.c,
debug/longjmp_chk.c, debug/fortify_fail.c, sysdeps/nptl/jmp-unwind.c and
nptl/pthread_cleanup_upto.c. The 80-unit foundation remains GNU source. The owned
IR adapter runs before LLVM optimization: direct __sigsetjmp calls become genuine
__sigjmp_save followed by LLVM-recognized setjmp **in the same caller**. It records
caller linear SP and GNU thread owner; LLVM's save helper preserves the deliberate
mask flag. `_setjmp` clears mask saving; the public setjmp function saves it.
Public longjmp declaration uses, including pointers, target genuine GNU handling.
The internal checked route stays __longjmp_chk; raw EH rethrows only transport
LLVM's invocation/value, without repeating cleanup/mask restoration.

Tests cover save0/save1, zero→1 and nonzero return values, nested signal masks,
unchanged errno/TLS/local stack, real GNU cleanup order21 from a deeper frame,
and preservation of the target frame's cleanup9. A volatile function pointer
exercises checked longjmp, and a previously signal-saving buffer reused by
_setjmp has its saved flag cleared. All signal callbacks return before any jump.
GNU cleanup chains are installed manually: this does not prove pthread creation,
NPTL cancellation, C++ destructors, or arbitrary signal-handler jumps.

The checked backend verifies known GNU descriptor stack bounds, downward stack
direction, alignment and thread owner. Main bounds come from actual linker
__stack_low/__stack_high; child bounds remain explicit. There is no sigaltstack
ENOSYS fallback. This cannot validate every stale invocation or corrupted buffer,
and native linear memory has no inaccessible guard page. Cancellation/unwind
provision remains incomplete and is not replaced with a stub.

`abi.json` independently compiles and executes actual header measurements:
backend24/alignment4, jmp_buf156/alignment4, maskflag offset24, savedmask28,
savedSP16, owner20, GNU pthread1184/alignment32. This differs from the frozen
foundation's 148-byte jump buffer and requires rebuilding all consumers coherently.
`reject-escaping.c` produces the expected explicit `_setjmp` pointer rejection
(exit3); indirect/escaping setjmp and direct InvokeInst setjmp are unsupported.
C++ call-site/runtime integration is still untested.

Earlier failures remain retained. The first GNU helper build found duplicated
local header extensions; preparation is now idempotent. An overloaded LLVM
stacksave intrinsic initially crashed the adapter, then received its pointer type.
The checked route initially failed linking __longjmp_chk, then __fortify_fail;
genuine GNU implementations were linked. Native run1 failed because the default
Chromium path was absent. Native runs2/3 failed139 on positive EH jumps: stale
frontend nounwind attributes and missing llc Wasm EH flags omitted catches. The
final adapter clears stale function/call assumptions before optimization, and
llc receives `-exception-model=wasm -wasm-enable-eh -wasm-enable-sjlj
-wasm-use-legacy-eh`. Actual native catch blocks are recorded in disassembly.

The fresh full-make diagnostic uses only this task's source and configure tree.
`fullmake-overlay.py` selects compiler-only save marker units instead of GNU's
explicitly invalid returning bsd wrappers, plus the tested backend and LLVM tag.
`compiler.py` applies early lowering to each C translation unit. Configure first
failed on the driver's missing default object output; that was fixed and fresh
configure succeeded. `timeout 90s make -j2 lib` then exited2 at
`sysdeps/unix/syscall-template.S:120/122`, generated `signal/kill.o`, on unsupported
PSEUDO/PSEUDO_END assembly. The setjmp subdirectory compiled before this failure.
Its tag was initially preprocessed without the EH feature define; after fixing
assembly driver flags, a scoped setjmp rebuild passed and llvm-nm records the
real __c_longjmp tag. The original tag object and failure logs are retained.

This driver is a bounded forced-O2 diagnostic, not production acceptance for
PIC/LTO/debug/optimization/dependency/stdin-assembly or Nightly flag combinations.
The manually linked accepted guest runtime/object hashes remain unchanged across
the full-make experiment. Only comments/default host-compiler parameterization
changed after the final guest build, without changing tested guest semantics.

The first freeze found a stale fortify comment in the diagnostic source copy;
that comment was corrected without altering compiled code, and the first manifest
is retained separately. The final manifest was rebuilt and independently rechecked.

Next: implement a native architecture syscall-template backend preserving GNU's
generated aliases and separate normal (-1+errno), NOERRNO raw, and ERRVAL
positive-error conventions. Audit each generated public signature: the six-i32
kernel transport does not universally describe i64 or converted-structure C APIs.
Test invalid descriptors, kill/raise and file operations in both guest modes,
then bounded GNU make to its next real blocker. Subsequently integrate coherent
CRT/TLS/descriptor/NPTL and compiler invocation across all dependency builds.
No complete libc.a/sysroot, general GNU CRT/NPTL, Nightly, new JIT/GPU or Sites
release is claimed. Foundation commit9a375d7, frozen packets, and public releases
are preserved. See [replay instructions](../tools/glibc/jumps/README.md).

The adapter follows the pinned [LLVM22 WebAssembly EH/SjLj lowering source](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/llvm/lib/Target/WebAssembly/WebAssemblyLowerEmscriptenEHSjLj.cpp),
which handles direct recognized setjmp calls and rejects indirect setjmp.
