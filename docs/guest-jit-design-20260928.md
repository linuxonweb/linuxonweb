# Guest JIT design: runtime code install for SpiderMonkey (2026-09-28)

Status: research and design only. No source, image or service was changed. All
line numbers refer to the files in `web/linux/dist/` as of this date. Statements
marked "hypothesis" are not measured.

## 1. Runtime facts

The guest is native wasm32 Linux, not an emulator. Every Linux task or thread is
its own Web Worker. Each Worker holds two Instances: the shared kernel
(`vmlinux.wasm`, shared kernel memory) and a private Instance of the user Module
that imports one shared `env.memory`.

- User Instance creation: `worker.js:329-466` (`create_instance`) builds
  `new WebAssembly.Instance(context.module, {env:{memory}, linux:{audio_write,
  syscall, get_thread_area, copy_siginfo}})`. The four-import ABI is fixed by the
  supported-import set at `wasm.js:3-13`.
- Syscall path: the `linux.syscall` closure at `worker.js:390-429` calls the
  kernel export at line 393, then `growForSyscallResult` (line 419,
  `user-memory-growth-adapter.js`), then detects exec by
  `instance !== original_instance` and halts user code (424-427). Numbering is
  i386. A private syscall number can therefore be intercepted in JS before the
  kernel sees it, with no kernel rebuild (the arch/wasm kernel source is not in
  the repo; only a prebuilt `vmlinux.wasm`).
- Run loop and entry: `call` at `worker.js:562-607`, `switch_entry` at 608-622.
  Signal handlers use `__indirect_function_table.get` at 624-648, so the table
  export is already relied upon by the host.
- Compile helpers: `compile_begin/write/end` at `worker.js:486-554` and
  `instantiate` at 467-475, 559. There is no user-module cache in
  `platform.js` (only the kernel uses `compileStreaming`, lines 52-60).
- Worker lifecycle: `start()` at `worker.js:719-852`. Fork with memory COPY
  copies memory at 726-748 and builds `user_context = {module, ...copied}` at
  line 736. `spawn_worker` import at 764-792, kernel Instance at 842,
  `user.prepare()` at 843. Messages at 853-867.
  Main-thread side: `index.js:230-309` (`start_worker`), 310-325
  (`spawn_worker`, asserts not copy), `wasm.js:75-154` (`kernel_imports`,
  `WASM_USER_MEMORY` NONE/SHARE/COPY), `platform.js:61-99` (Worker creation).
- Tables: the user funcref table is defined in the module and exported as
  `__indirect_function_table`. It is per Instance, hence per thread. WebAssembly
  tables cannot be shared across agents. Code installed for one thread is
  invisible to others unless it is replicated.
- Workers running Wasm never return to the event loop, so `postMessage` cannot
  be delivered while guest code runs. Any cross-thread propagation must use
  SharedArrayBuffer polling at points where the host regains control (syscall
  boundaries).
- Firefox module (`.cache/deployed-firefox-current.bin`, inspected with
  wasm-objdump): post-processed with Binaryen `--fpcast-emu`
  (`max-func-params@23`, `Agents.md:76-81`, `tools/build-firefox-portable-baseline.py:258`),
  so every table-called function has the uniform type (23 x i64) -> i64. The
  table is fixed size (initial = max = 174179). Only `_start` and the table are
  exported (no `__stack_pointer`). It has a Start function, passive data
  segments, one EH tag, and a shared imported memory (initial 706 pages, max
  65536). `firefox-callback-adapter.mjs` already patches null entries 0-2.
- SpiderMonkey 128.14 is built `--disable-jit` (JS_CODEGEN_NONE). The Portable
  Baseline Interpreter (PBL, `vm/PortableBaselineInterpret.cpp`, 6336 lines,
  main loop at 3228, computed-goto dispatch macros 3163-3177) keeps BaselineFrames
  on an auxiliary stack, interprets CacheIR, and uses hybrid ICs. Value is
  NUNBOX32 on wasm32 (`js/public/Value.h:153`). There is no weval in 128.
- `jit/wasm32/*` (about 3,300 lines) is mostly stubs (about 842 MOZ_CRASH sites,
  `generateEnterJIT` crashes). A native MacroAssembler backend is not present.

## 2. Code install primitive

Goal: guest code emits a wasm module image into guest memory; the host compiles
and instantiates it against the same memory and places its functions in the
process function table, callable via `call_indirect`.

### Interface (private syscall, intercepted in JS)

`jit_install(module_ptr, module_len, flags, out_ptr)`, one private i386-range
syscall number handled in the `linux.syscall` closure before the kernel call.
Kernel unchanged; the four-import ABI unchanged.

- Input: bytes of a wasm module in guest memory. The module must import
  `env.memory` (shared, same limits) and `env.table` (funcref), plus optionally
  imported immutable globals for stack pointer and constant bases. It exports
  functions named `f0..fN`, each of type (23 x i64) -> i64 for the Firefox ABI
  (or a plain type for the C test).
- Output: `out_ptr[i]` receives the table index of each export. Return 0 or
  -errno.
- Companion calls: `jit_free(base_index, count)` and `jit_reset()` (tests).

### Table strategy

Each thread has its own table, so indices must be identical everywhere. Use a
process-wide allocator in a control SAB (bump plus free list, atomics), so an
index means the same function in every thread. Installs reserve indices then
each thread sets them in its own table.

- Table must be growable: link with a growable table (`--growable-table` for
  new C tests) and, for Firefox, either relink or byte-splice the Table section
  (max raised to e.g. 174179 + 2^18). Growth is per Instance via `table.grow`
  from JS, done lazily during replay.
- Reserve a JIT index region starting above the static table size so allocation
  never collides with static entries.

### Propagation (broadcast without messages)

A per-process control SAB (in the user context, reachable from every thread of
the process) holds: epoch counter, install log ring, allocator state, and a
bytes arena for module images.

1. Installing thread copies the module image into the arena, appends a log
   entry (index range, arena offset, length, flags), bumps the epoch with
   Atomics, and compiles.
2. Every thread, at each `linux.syscall` exit (and at instantiation), compares
   its local epoch to the SAB epoch and replays missing log entries: compile
   (cache by hash), instantiate with its own `env.memory`/table, and
   `table.set`. Compile results (Modules) are structured-cloneable but cannot be
   sent without messaging, so each thread compiles the image itself; a hash-keyed
   per-thread Module cache avoids repeat work. Compilation of small modules is
   cheap (kernel compile is about 48 ms for a large module).
3. Cost: a JIT thread must trap into the host to observe others' code. That is
   safe because a thread can only call a function it learned of through shared
   memory, and it learns this after some syscall or after a futex/lock
   handoff (the acquiring path makes a syscall). Threads that spin lock-free on
   shared memory and never make a syscall could call an index that is not yet
   in their table (`call_indirect` trap). Mitigation: publish indices to other
   threads only after `jit_install` returns and require consumers to call a
   cheap `jit_sync()` (a syscall that replays the log) before first use of an
   index created by another thread. In SpiderMonkey, code is per-realm and
   executes on the thread that compiled it, so this is normally moot.

### Sync vs async

Synchronous compile via `new WebAssembly.Module(bytes)` on the calling Worker is
allowed for small modules (sync compile is permitted in Workers) and is the
default. Large modules (over a size threshold, e.g. 4 KiB) use
`WebAssembly.compile` only if the caller can suspend; otherwise still sync. The
existing JSPI use in the runtime is not required. The first packet is sync only.

### Freeing

`jit_free` returns indices to the free list and logs a tombstone; each thread
replays it by setting the slot to a trap stub (null entry). Indices are reused
only after all live threads have acknowledged the epoch (per-thread acked-epoch
slots in the SAB), to prevent a stale-call ABA. Instance and Module objects are
dropped by JS GC once the table entries are overwritten.

### Fork, exec, clone

- Fork COPY: `worker.js:736` copies memory into a new context. Copy the control
  SAB contents into a fresh SAB (the child must not share allocator state with
  the parent), then the child replays the whole log on startup (with an empty
  table baseline) so its table matches the copied memory. Indices are preserved.
- Clone / spawn_worker SHARE: new thread shares the SAB and replays the log
  right after `create_instance` (before `user.prepare()` at 843).
- Exec: the SAB is discarded and a new one created; the tombstone state resets
  (the new image has a fresh table). Exec detection exists at 424-427.

### Validation and safety

Reject anything that is not a module with: only the permitted imports
(`env.memory` shared with matching limits, `env.table`, allowed globals); no
Start function; no `env.*` imports beyond the list; exports of function type only
(use `WebAssembly.Module.imports/exports` for a cheap check and a size cap).
Security note: guest code can already write arbitrary bytes in its own memory
and execute any code it wants inside its own sandbox, so the check exists to
keep the ABI and to reject accidents, not to enforce a trust boundary. Untrusted
guest wasm cannot reach host APIs because the only imports available are the
ones we supply. Do not expose the host `syscall` closure or any additional host
functions to installed modules.

### Kernel

No kernel change is needed. The kernel never sees the private syscall number.
A guest libc wrapper is `syscall(SYS_jit_install, ...)`. If the kernel is ever
rebuilt, the number can be reserved to return -ENOSYS for cleanliness.

### Stack pointer

Installed code that uses the C shadow stack needs the stack pointer global. The
Firefox module does not export it. Options: (a) build/relink with the stack pointer
exported, (b) pass the stack pointer in a linear-memory cell maintained by C
helper code, (c) have JIT code avoid the shadow stack and receive frames via the
PBL auxiliary stack (the PBL design already does this). Option (c) is the
default plan.

## 3. SpiderMonkey strategy

| Option | Size estimate | Verdict |
| --- | --- | --- |
| Full MacroAssembler-wasm32 backend | 50k+ lines (BaselineCodeGen 7k, BaselineCacheIRCompiler 4.4k, CacheIRCompiler 10.8k, MacroAssembler 9.1k, JitFrames 2.6k, plus the wasm32 stubs) | Rejected. MacroAssembler assumes registers, arbitrary labels and gotos, return addresses and code patching; wasm has structured control flow, no patching and no register file. |
| Runtime PBL specializer (bytecode to wasm) | first milestone 2-4k lines C++ plus about 500 lines of glue | Recommended. |
| Offline weval-style specialization | large build-system work; weval not in Firefox 128 | Deferred. |
| Just tune the PBL interpreter | small | Do first as diagnosis (packet 3). |

### Why a specializer over PBL

PBL frames live on an auxiliary stack (BaselineFrame layout), so generated wasm
can read and write frame slots in linear memory just as the interpreter does.
Generated code for a script is a wasm function taking (frame, ctx, resume pc)
that implements the bytecodes with fast paths inline and calls uniform-ABI
helpers (exported through the table) for everything else. Any op or guard that is
not specialized returns a side-exit code with the pc, and the caller resumes the
PBL interpreter at that pc (the frame is already in interpreter layout). This
avoids OSR translation, since the frame layout is identical.

### Blockers and answers

- Frames: reuse PBL BaselineFrame on aux stack; no native frames needed.
- OSR / side exit: enter at loop heads by dispatching on pc through a `br_table`
  at function entry; leave by returning (pc, reason) to the PBL driver.
- Exceptions: helper calls return a status; generated code returns to PBL on
  any error status so PBL runs its existing unwind. No wasm EH inside generated
  code in milestone 1.
- GC: values live in frame slots (in memory), so the GC scans them as today.
  No stack maps needed. Helpers may GC; generated code must not cache values
  across helper calls in wasm locals unless they are non-GC (int32, double).
- ICs: milestone 1 calls the existing interpreted IC helper per site; later
  inline monomorphic shape guards from CacheIR stubs.
- Invalidation: generated code is keyed by script plus a guard epoch; on
  invalidate, set the script's jit entry to null and `jit_free` later after a
  quiescent epoch. Bailout is always "return to PBL", so stale code is safe as
  long as the frame is consistent.
- NUNBOX32 Value: tag/payload are two words; int32 add fast path is a tag
  compare plus i32.add with overflow check, in wasm.

### Why PBL was slower (hypotheses, unmeasured)

The candidate was built with -O3 and FORCE (threshold 0) (`docs/host-graphics-and-firefox-jit-20260926.md:311-320`).
Likely contributors: computed goto lowered to one `br_table` in a huge
function that V8 tiers poorly; fpcast-emu adding per-call overhead to every
indirect call; interpreted CacheIR and hybrid ICs adding work; forced entry
also compiles cold scripts. Packet 3 measures rather than assumes.

### Smallest milestone with measurable speedup

Specialize only pure integer loops: ops such as GetLocal/SetLocal (frame
slots), Int8/Int32 constants, Add/Sub/Mul/BitAnd/BitOr, Lt/Le/Gt/Ge, JumpIfFalse,
Goto, LoopHead, Return, with guards on int32 tags. Anything else side-exits.
Benchmark: `for (i=0;i<1e7;i++) s=(s+i)|0;` compared with PBL. Expect a large
factor (bytecode dispatch removed, no per-op tag loads beyond guards) because
the loop body becomes straight wasm; V8 then tiers it to native code. Success
criterion: at least 3x on that loop and identical results with PBL on the same
script.

## 4. Prioritized implementation packets

1. Runtime primitive plus guest C test. Add the private syscall handler,
   control SAB, allocator, log replay at syscall exit and thread instantiation,
   `jit_free`, and the fork/exec behavior. Guest C test (built as in
   `tools/build-wait-for-aurora.py`, with `--growable-table` and
   `--export-table`): builds a tiny wasm module image in memory (a function
   returning arg+1 and one calling back through a shared memory cell), calls
   `jit_install`, `call_indirect` through the returned index, and asserts
   results; then a second thread calls the function after `jit_sync`, then
   fork and verify in child, then free and verify trap or null. Files touched
   are only `worker.js` (dist copy and its source) and a new test under
   `web/linux/tests/`. Gate: run in the real 1 GiB/2 CPU guest, storage policy
   applied.
2. Firefox module prep. Splice or relink the Firefox table as growable, decide
   the stack-pointer plan (option c above), and add a uniform-ABI helper
   export test: generated wasm calls an existing table entry with 23 i64
   arguments and gets the result. Verify the image still boots with unchanged
   behavior (zero regressions in the existing Firefox acceptance).
3. PBL slowdown diagnosis. Instrumented timing of the PBL candidate versus the
   accepted baseline on the fixed-batch-100-v1 fixture, splitting dispatch
   loop, IC, and fpcast-emu call overhead (V8 profile inside the guest
   Chromium, or counters). Decide whether the specializer should target
   dispatch or ICs first.
4. Emitter library: small C++ wasm binary writer inside SpiderMonkey (LEB128,
   sections, function bodies, structured control flow builder), unit tested on
   the host with wasm-validate.
5. PBL hook: after N loop iterations call the specializer; store the jit entry
   on the script; the PBL driver calls it with the frame and handles side-exit
   codes. Integer-loop milestone benchmark.
6. Coverage: property access via ICs, calls, doubles, arrays.
7. Invalidation, lifetime and `jit_free` under GC; multi-thread and fork tests
   with worker threads running JIT code.

## 5. Open risks

- Sync compile cost on every thread when many small modules are installed
  (mitigate with batching and the per-thread cache).
- A thread that never makes a syscall cannot observe new table entries
  (see the propagation caveat).
- V8 tiering of many tiny modules and the table indirection cost are
  unmeasured; packet 1 should include a call-overhead microbenchmark.
- This design is a route to real guest JIT, not a claim that any is running.
  Native JIT, general GL/Vulkan and hardware decode remain incomplete.
