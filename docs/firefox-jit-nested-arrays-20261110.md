# Nested numeric arrays: candidate and exact evidence — 2026-11-10

The isolated PBLJIT candidate now implements bounded nested loops over immutable
Array references, read-only unaliased formal arguments, frame-only lexical
initialization, and allocation-free initialization of numeric array elements.
The original cube benchmark is unchanged. An earlier version passed the host
compiler/emitter and numerical differential checks. The final shared proof-walker
refactor is source-reviewed but **has not passed its required execution gate**:
the unchanged resource owner stopped its compiler on a real cgroup migration.
No native package, public runtime, native eligibility result, speed result, or
project acceptance score changes follow from this work.

## Ownership and versions

- Worktree: `../linuxonweb-firefox-array-jit-20261110` under the existing
  disk-backed codex-build tree.
- Branch: `gpt-6-astra-pro_linuxonweb-array-jit_20261110`.
- Base: `6cde3359135439b1bc582446e210749e6eb68d30`; checkpoint
  `checkpoint-linuxonweb-array-base-20261110-6cde335`.
- Exact earlier evidence checkpoint:
  `6b409de348cbb32f4e970bf8d353161e248d05cf`, tag
  `checkpoint-linuxonweb-array-host-evidence-20261110`.
- Tested earlier compiler SHA256:
  `510906f035ed50da59f954f95ce799295292253caabc8f54776992babfffe3f6`.
- Final source-reviewed compiler SHA256:
  `2e977217fb0e86cd932e241ae04c326814b83aecd13fa02723bc645be625acfc`.

The primary checkout and native build agent's integration worktree were not
modified. The accepted runtime and existing private/untracked materials remain
outside this change. The source/test asset manifest is
`tools/pbl-jit/evidence/nested-arrays-20261110/final-source-manifest.json`.
It binds each result to its source version rather than assigning earlier passes
to the final compiler.

## Why the original matrix needed more than numeric nested loops

`tools/guest-rootfs/firefox-gpu-check/gpu-check.html` has the original
`multiply(a, b)` at line 210. It reads plain Array formal arguments, uses three
nested `let` loops, and writes sequentially into `new Array(16)`. The existing
nested tier rejected arrays and arguments. Existing dense stores only overwrote
already initialized numeric elements, so merely permitting the opcodes would
still bail on the initially absent output elements.

The pinned final159 source supplies two additional facts:

1. `ArrayConstructorImpl` in `js/src/builtin/Array.cpp` calls
   `NewDensePartlyAllocatedArrayWithProto`; `NewArrayWithShape` eagerly ensures
   elements up to `ArrayObject::EagerAllocationMaxLength`. The value in
   `js/src/vm/ArrayObject.h` is `(1 << 16) - ObjectElements::VALUES_PER_HEADER - 1`.
   A length of 16 is within that allocation bound. Capacity remains guarded at
   every generated store; no allocation assumption overrides the runtime header.
2. `EmitterScope::clearFrameSlotRange` in `js/src/frontend/EmitterScope.cpp`
   emits `Uninitialized`, `InitLexical`, and `Pop` for lexical frame slots.
   `CForEmitter::emitCond` emits a top-tested LoopHead. Captured bindings require
   an environment operation, which this candidate continues to reject.
   Frame-only scope exit uses `DebugLeaveLexicalEnv`.

These are source-based findings. The new fixture follows these frontend rules,
but it is **symbolic bytecode, not a captured final159 disassembly**. A host
oracle separately extracts and executes the unchanged original JavaScript
function. That verifies arithmetic semantics; it does not establish which actual
native loop region is admitted.

## Implemented safety boundary

The region bounds remain 512 bytecode bytes, eight loop headers, and three nesting
levels. Calls, allocations, environment creation, arbitrary objects, exceptions,
and formal assignment remain unsupported in nested regions. A head-live Array
reference must never be rebound. A nested store through a formal argument is
rejected; any output alias of another head Array variable returns NoEntry before
loop work. Aliasing read-only inputs remains allowed.

`InspectArrayForInit` now has one shared bounded proof walker. The native
`ReadArrayInitNode` only supplies raw facts through real getters. The host reader
supplies an independent graph of facts and runs the same proof predicates.
A writable receiver must be an Array, not a dictionary object, not indexed or
nonextensible, have writable length, and require no Watchtower add/value hook.
Its exact shape is guarded at entry. Only `FIXED` and `NON_PACKED` element flags
are permitted for the initialization path; nonwritable, nonextensible, sealed,
frozen, shared, shifted, iteration, and unknown flags fail before the store.

Every prototype must be a tenured Array or PlainObject, have no dictionary or
indexed properties, and have initialized dense length zero. The entire chain is
bounded at eight objects and must terminate at null. Each recorded shape and
current dense initialized length is guarded at entry. This is deliberately more
restrictive than upstream `CanAttachAddElement`: even a writable dense indexed
prototype property is rejected. Class restrictions exclude proxies, typed arrays,
wrappers, and custom lookup/set/add hooks. Prototype pointers are only embedded
when tenured. Receiver pointers are reloaded from rooted frame/formal slots.

Each initialization store requires all of the following before mutation:

- An Int32 index, checked unsigned against both array length and dense capacity.
- The index is no greater than initialized length, so gaps never expose
  uninitialized slots.
- For an existing slot, the old boxed value is a number or the exact
  `JS_ELEMENTS_HOLE` value. GC things and other magic values bail unchanged.
- For an append at initialized length, no old memory is read. The numeric value
  is stored before publishing exactly `index + 1` as initialized length.

There is no call, allocation, bailout, or interrupt between the append's numeric
store and its initialized-length publication. Array length is never increased;
capacity is never grown. A missing initialization proof retains the existing
numeric-overwrite-only path. Numeric values and exact holes need no GC write
barrier. The existing incremental-GC exclusion, major-epoch eviction, and interrupt
check at every nested backedge are unchanged. Actual native GC acceptance remains
required.

The only new lexical sentinel assignment is `InitLexical` into an outer-head-dead
local. A live TDZ read fails compilation. Bailout and interrupt snapshots preserve
that exact non-GC sentinel alongside the operand stack, locals, resume PC, and IC
cursor. Environment creation and captured lexical loops remain unsupported.

## Executed host evidence

All rows below refer to the earlier compiler `510906f…`, except the explicitly
blocked final row. Original baseline input code and check counts were preserved.

| Gate | Result | Scope |
|---|---|---|
| ASan/UBSan compile | Pass, 13.100 s, empty stderr | Earlier canonical compiler/fixture snapshot |
| Sanitized emission | Pass, 0.043 s, empty stderr | Original and new emitted Wasm fixtures |
| Original baseline | 42 modules; 1,969 checks, zero failures | Existing runner unchanged |
| Existing cache identity checks | 20 checks, zero failures | `cache-tests.json` |
| Original numeric nested suite | 9 modules; 2,702 checks across 184 cases | All 11 hostile inputs remain rejected |
| First array runner | Failed its unchanged 20 s limit | Sparse-reference oracle defect, retained |
| Bounded trace | Failed at its 20 s deadline | Last case was output index 2,147,483,647 |
| Corrected sparse oracle | 12,896 checks across 86 cases; 5 modules and 6 compile rejections | Earlier emitted modules; no native claim |
| Final shared proof walker | **UNEXECUTED** | Compiler stopped on resource policy before completion |
| New 38 shared proof cases | **UNEXECUTED** | Source-reviewed test definitions only |
| Final 6-module / 87-case runner contract | **UNEXECUTED** | Includes unsafe-prototype proof fallback fixture |

The earlier array suite covers seeded 4x4 matrices and the extracted original
function, integer/double widening, NaN/infinities/signed zero, existing holes,
capacity/length/initialized-length failures, old GC/magic values, input holes and
non-numbers after earlier appends, receiver/prototype shape changes, prototype
dense additions without shape change, frozen/nonextensible/nonwritable flags,
input/output aliases, sparse large and negative keys, partial-work bailout
resumption, and inner/outer interrupt state. The original long-inner-loop
cross-thread interrupt test also passed in the numeric suite.

The initial oracle used array-length iteration after ordinary JavaScript resumed
an assignment at index 2,147,483,647, creating a huge sparse array. The correction
uses sparse own keys and length, including named negative keys, and retains full
resume comparison. It does not increase any deadline or drop that case. The
corrected direct Node owner did not separately hash-pin the revised runner before
launch; its raw result is preserved without pretending the earlier archived
runner already contains this correction. The final runner also rejects incomplete
case-filtered acceptance, and its wrapper clears the diagnostic filter.

The existing 11 negative numeric fixtures are unchanged. Two expected reason
strings reflect the narrower checks reached after array admission: the array
reference written as a numeric sum now rejects as `array var written`, and the
operand-less GetElem rejects as `underflow`. Neither fixture became accepted.

## Exact strict-owner failure

Final owner `linuxonweb-firefox-array-jit-20261110-host-2-owner` ran from
2026-11-10T16:18:50.421137Z to 16:18:53.027831Z, 2.607 s. It stopped on
`owned_process_shared_cpu_quota_policy_failed`: live compiler identity
PID 2021345 / startTicks 104392787 moved from `cpulimit-70.slice` to
`cpulimit-80.slice`. Both shared the same capped three-CPU ancestor, but the
existing membership-continuity requirement explicitly rejects this transition.
The guard was preserved and the compiler was not retried or renamed. No process
was moved by this work. No approved stable compiler launch route was available.

All four retained owners finished with zero remaining owned processes and no
cleanup inventory errors. The first full owner lasted 35.259 s; the trace owner
20.359 s; the corrected oracle owner 2.005 s. CPU/RSS/available RAM/quota sampling
was one second and PSS sampling five seconds. Short jobs may finish between
samples; sampled PSS and CPU accounting are lower bounds. These durations are
validation-job timings, not JIT or browser performance measurements.

## Recovery and required continuation

`host-1-exact-source-and-fixtures.tar.gz` preserves all twelve source assets only
after matching the recorded pre-run SHA256 values, plus every retained emitted
fixture. Archive/member readback passed. Its manifest explicitly labels the
original whole-suite attempt as failed and the archived original oracle as having
the known sparse bug. The earlier compiled code is recoverable without confusing
it with the final shared-walker source.

The old preflight-3a host packet and native preparation remain pre-array. Future
integration must pin/copy `array-fixtures.h`, run `run-array.mjs`, update the full
fixture/runner contract, and regenerate the complete source-bound host packet.
Do not copy this emitter into an old packet while omitting its new include or
runner, and do not reuse a stale successful packet as final-source acceptance.

After a legitimate stable compiler launch scope is available:

1. Run the final source's unchanged bounded owner with `check-array.py`; require
   clean ASan/UBSan compile/emission, original baseline/cache/nested gates, all
   38 shared proof checks, and the complete six-module/87-case array suite.
2. Regenerate native preflight and build/package evidence from those exact final
   source hashes using the existing reviewed native route. The pre-existing
   final159 Watchtower name adapter remains necessary; this work does not alter
   acquisition or native-build code.
3. Use the existing `tools/nightly-jit-safety/nested-loop/` native probe/checkers
   and original acceptance routes. For the unchanged cube `multiply`, capture
   actual final159 bytecode/LoopHead offsets tied to its source hash, then native
   install/Normal/Bail observations at those exact offsets. Verify that stores
   into the initially hole-filled Array complete through JIT execution, rather
   than accumulating the 64-bail rejection threshold.
4. Run real native hostile prototype/alias/GC/epoch/interrupt cases. Host snapshot
   readers do not execute native getters, relocation, barriers, or GC.
5. Preserve the original eight-case controls, ABBAAB schedule, cube workload,
   startup checks and deadlines. Measure the unchanged actual browser/runtime
   only after all correctness gates pass. Host test duration is not speed evidence.
