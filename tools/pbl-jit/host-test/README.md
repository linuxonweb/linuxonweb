# PBL JIT host verification

`emit.cpp` includes the canonical `../PblJit.cpp` and emits real WebAssembly.
`mock.h` supplies minimal SpiderMonkey scaffolding and symbolic bytecode operands;
it does not replace compiler output. The opcode identities match the pinned
final159 header. Actual native bytecode eligibility is a separate gate.

## Complete candidate gate

Run from the repository root inside the unchanged approved finite owner, using
fresh disk-backed output directories:

```sh
python3 tools/guest-packages/bounded.py --cwd . \
  --out ../array-host-owner --seconds 120 -- \
  python3 tools/pbl-jit/host-test/check-array.py --output ../array-host
```

The helper hash-pins source/test inputs, sets owned disk-backed temporary/cache
paths, compiles the real emitter with ASan/UBSan, emits fixtures, and runs the
original baseline, numeric nested, and array runners. It clears diagnostic case
filters and requires the full array suite contract. It does not replace the
outer owner's CPU quota, process continuity, sampling, and cleanup policy.

## Coverage and exact current status

The original numeric nested tier remains bounded at three levels, eight headers,
and 512 bytecode bytes. Its independent interpreter verifies loop/control flow,
widening, precise bailout PC/stack/IC state, and interrupts including a signal
sent while a worker executes a long inner loop. The eleven original hostile
fixtures remain rejected. Two reason strings change because invalid array uses
now reach more specific reference-write/underflow checks.

The array candidate adds immutable head Array references, read-only unaliased
formal arguments, numeric element reads/writes, exact frame-only lexical TDZ
initialization, and guarded in-capacity sequential initialization. Calls,
allocations, arbitrary object properties and captured lexical environments remain
unsupported. The original cube JavaScript source is unchanged and extracted
separately as an arithmetic oracle. Matrix bytecode fixtures are symbolic.

`run-array.mjs` independently interprets bytecode with ordinary JavaScript arrays,
compares complete exits, and resumes after bailouts/interrupts. Sparse own-key and
length snapshots preserve huge/negative indexed assignments without traversing
billions of holes. The final contract includes six emitted modules, 87 cases,
six compiler rejections, and 38 shared initialization-proof cases. Native and
host readers supply raw facts to the same production proof walker.

**The final shared-walker candidate has not passed execution.** Its compiler was
stopped on a real cgroup membership transition by the unchanged strict owner.
The new 38 proof cases and final six-module/87-case contract are UNEXECUTED.
An earlier hash-preserved version passed sanitized compilation/emission, 1,969
baseline checks, 20 cache checks, 2,702 numeric nested checks across 184 cases,
and (after fixing a retained sparse-oracle timeout) 12,896 array checks across
86 cases/five modules. Those passes must not be assigned to the final compiler.

See `docs/firefox-jit-nested-arrays-20261110.md` and
`tools/pbl-jit/evidence/nested-arrays-20261110/` for exact source hashes, original
failed receipts, a verified earlier source/fixture archive, and continuation.
Native Firefox execution, GC acceptance, actual bytecode admission and performance
remain unaccepted. Existing pre-array host packets must be regenerated with all
new fixture assets and runners before integration.
