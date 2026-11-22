# PBL JIT host verification

`emit.cpp` includes the canonical `../PblJit.cpp` implementation and emits real
WebAssembly modules. `mock.h` supplies the minimal SpiderMonkey scaffolding to
construct bytecode and frame fixtures; it does not replace compiler output.
Its opcode values and lengths match the final159 Firefox source export.

Run these commands from the repository root inside the project's approved,
monitored CPU-capped job. Set `TMPDIR`, `TMP`, `TEMP`, and cache paths to an owned
disk-backed directory first, and use a fresh fixture directory on every run.

```sh
mkdir -p out/pbl-host/fixtures
g++ -std=c++17 -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer tools/pbl-jit/host-test/emit.cpp -o out/pbl-host/emit
ASAN_OPTIONS=detect_leaks=1:abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 out/pbl-host/emit out/pbl-host/fixtures
node tools/pbl-jit/host-test/run.mjs out/pbl-host/fixtures
node tools/pbl-jit/host-test/run-nested.mjs out/pbl-host/fixtures
```

## Nested-loop coverage

The first nested-loop tier supports numeric locals in laminar natural loops,
with at most three nesting levels, eight loop headers, and a 512-byte outer
region. Entry into an inner loop must go through its header. Objects, arrays,
arguments, calls, allocations, and exception operations remain unsupported in a
nested region. Existing GC and exception policy is unchanged.

`run-nested.mjs` validates and executes nine emitted modules, entering each at
its outer header. An independent numeric-bytecode interpreter checks locals,
operand stack, resume PC, and IC index. Closed forms and separate inner, middle,
and outer counters also verify enclosing work.

Fixtures cover rectangular loops, fractional induction and numeric widening,
three nesting levels, inner and outer break/continue, changing bounds, stack
joins, conditional do/while backedges, overflow bailouts, numeric conversion
bailouts, and entry type guards. Each bailout is checked before the failing
operation and then resumed in the reference interpreter. Interrupt tests cover
pending interrupts at inner and outer backedges and an interrupt delivered
while a worker is executing a long inner loop.

Eleven rejected fixtures cover a side entry, an operand-byte target, a header
without a backedge, crossing loops, a non-header backward edge, excessive depth,
a nonempty header stack, nonnumeric locals, calls, and array operations. A
rejected fixture must produce no Wasm module in the fresh output directory.

## Verified result — 2026-11-08

The ASan/UBSan build and emitter completed with empty sanitizer stderr. The
existing suite passed **1,969 checks**, and the nested suite passed **2,702
checks across 184 scenarios**, using nine compiled nested modules and eleven
rejected fixtures. All four verification commands exited zero.

These results establish host emitter behavior. Native Firefox Normal returns,
browser execution, and native performance acceptance still require the
candidate integration and guest probes.
