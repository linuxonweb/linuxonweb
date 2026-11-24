# Native Wasm forced-unwind first prototype — 2026-10-02

The first bounded ABI/IR prototype is implemented in
`tools/glibc/forced-unwind-prototype`. It executes 32 native host Wasm C/C++
cleanup/SjLj cases with 192 passing checks. **The complete design remains FAIL**:
LLVM rejects the planned direct-rethrow guard, and ordinary tag0 escape to the
host leaves a48-byte linear-stack-pointer drift. The successful alternative
forwards the same payload through a new native tag0 throw; it does not preserve
the host WebAssembly.Exception wrapper identity. This is not GNU forced-unwind,
libc++abi personality, public pthread lifecycle or Linux guest acceptance.

The task is `/mnt/p6/build/glibc-forced-unwind-prototype-20261002`, on ext4 with
task-local TMP/TMPDIR/TEMP/cache. It is held for root review, not frozen.
No frozen GNU/compiler/kernel tree, shared document, Git, browser or service
was changed. The accepted private C frontend and raw LLVM22.1.8 tools were
reused; the new host adapter alone was compiled against LLVM static libraries.
No subsequent optimizer or LTO runs after frame/guard instrumentation.

## Actual ABI measurement

Four zero-import native Wasm modules include either the genuine GNU unwind
header or the pinned LLVM header, in both C and C++. Node22.22.2 executes the
measurements. C and C++ agree independently for each header:

| Record | Size | Alignment | Class | Cleanup offset | Private1 | Private2 |
| --- | --- | --- | --- | --- | --- | --- |
| GNU2.44 `_Unwind_Exception` |24|8|64bit|8|12|16|
| LLVM22.1.8 `_Unwind_Exception` |32|16|64bit|8|12|16|

Pointer and stop-function-pointer sizes are4, class offset0. This confirms the
source design's ABI mismatch; a genuine GNU NPTL descriptor's embedded record
cannot be reinterpreted as LLVM's larger record. The prototype's payload uses
actual GNU's record. A coherent GNU/libc++abi/unwinder header rebuild remains
mandatory before implementing real GNU unwind. No dummy CFA or cancellation
stub is present.

## Concrete IR/native result

`force-ir.cpp` inserts escaping frame records in the five finite fixture
functions, captures actual pre-call `llvm.stacksave` values, checks actual
CFA against local/root stack addresses, delivers stops once before original
cleanup, and removes records on normal return and escaping cleanupret. Unknown
function definitions reject exit3; indirect call coverage explicitly rejects.
The internal prototype bookkeeping/raise/record functions are declared
boundaries for this finite diagnostic closure, not a complete application
coverage contract. The state is single-module diagnostic state, not production
GNU TP/compiler-TLS ownership or thread-isolation acceptance.

The original guard had a catchswitch unwinding to caller so stop-produced tag1
could reach native SjLj, while its `llvm.wasm.rethrow` invoke forwarded tag0 to
the old cleanuppad. Actual LLVM verification rejects it:

```
Unwind edges out of a catch must have the same unwind dest as the parent catchswitch
```

That failed attempt's exact adapter source snapshot and diagnostics are retained
in `source/adapter-c-attempt1` and `logs/adapter-c.log`.

The alternate guard catches tag0, obtains the original payload, calls a separate
may-throw stop, exits via catchret, then invokes an owned native tag0 forwarding
helper outside that catch. The forwarding invoke targets the original cleanup.
The stop call stays in a catchswitch that unwinds to caller; LLVM native SjLj
lowering routes its tag1 to the live setjmp invocation. This shape passes the
verifier, native backend and link with zero imports. The helper uses a new
native throw with the same payload. It is a diagnostic alternative requiring
an explicit semantic decision and genuine foreign/C++ ABI regression gates
before production adoption; it is not reported as direct native rethrow.

Sixteen repetitions each of C and C++ nested cleanup exercise:

- three stop deliveries with actual live frame/CFA checks;
- nested cleanup order2,1 for C and4,3 for C++;
- stop-produced tag1 reaching the live SjLj target with value37;
- retained target cleanup9 absent at recovery, then executing once on return;
- no live frame record after return and exact linear-SP restoration.

The C++ fixture compiles actual language destructors using the accepted private
frontend. Its no-throw recording routine is real owned bookkeeping. It does
not link libc++abi or exercise genuine C++ typed/foreign catches. The native
SjLj backend uses the genuine retained GNU-owned24-byte common jump prefix;
no frozen jump file or root checked-jump make overlay is modified.

The ordinary tag0-to-host control executes nested and target cleanups and
removes all frame records, but fails linear-SP restoration:
`before65536, after65488`. This failure is retained in
`logs/shape-execute-attempt2.log`; source snapshot
`source/shape-execute-attempt2` includes its exact test. The final finite passing
run tests only the two tag1 recovery modes and reports192checks/32cases. It does
not turn the ordinary-control failure into a success.

## Replay, evidence and terminal state

All commands are supervised with separate owned process groups, timeout,
2GiB task cap and5GiB free-space hard stop. Task initialization checked the
8GiB launch reserve. The accepted private frontend is
`/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang`; tools are the
retained `xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8` store artifact.
Source/tool pins, actual object pins and independent reread results are in
`source-provenance.json`, `object-provenance.json` and `logs/reread.json`.
`logs/native-disassembly.log` contains actual native catch/throw/SjLj code.

From the repository cwd, with owned TMP variables:

```sh
python3 tools/glibc/forced-unwind-prototype/run.py
python3 tools/glibc/forced-unwind-prototype/prepare.py
python3 tools/glibc/forced-unwind-prototype/build-shape.py
python3 tools/glibc/forced-unwind-prototype/execute.py
```

These scripts use only the owned task and repository packet paths. Commands
append attempts and snapshot packet sources; exact argv/PID/PGID/exit are in
`logs/commands.json`. `logs/terminal-groups.json` checks every retained group
with killpg(...,0) after wait: all are empty. Actual terminal examples:
shape execution PID/PGID3875852 exit0, native disassembly3875867 exit0, uncovered
coverage rejection3875869 exit3; fresh ABI execution3877603 exit0. The last
ABI replay exists because the initial supervisor overwrote aggregate command
history; early logs remain, while the fresh replay retains complete command
and group evidence. The first host-adapter compile failed for a missing
IntrinsicsWebAssembly header and lacks its original pre-fix source snapshot;
that historical limitation is recorded rather than reconstructed as original.
All subsequent failing IR/execution attempts retain source snapshots.

Next bounded gate: decide/implement a faithful native guard routing solution,
fix ordinary escaping-frame linear-SP restoration with actual frame state,
then audit complete call/frame coverage before extending genuine Unwind-wasm
and libc++abi against the coherent GNU exception ABI. Real GNU unwind_stop,
foreign catch/rethrow/fatal-on-swallow and concurrent GNU TLS ownership must
pass before public exit/cancel/join. Default NPTL stacks/guards and interrupted
syscall cancellation remain independent mandatory gaps. This prototype does
not justify a full libc/sysroot or Nightly build.
