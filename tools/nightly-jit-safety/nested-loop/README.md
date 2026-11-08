# Bounded native nested-loop probe

This is a preparation, acquisition and diagnostic kit for the restricted numeric
nested-loop milestone. It has **no native acceptance path**. Host tests and synthetic
packets establish fixture and protocol behavior only. The reviewed final159 binary,
source/build binding, owned launcher, common CPU quota, sampler, natural exit and
reaping evidence must still pass the existing [guest gates](../GUEST-GATES.md).

The current native build binding has not been acquired by this task. These files do
not launch Firefox, locate a replacement binary, export compiler sources or bypass
any protected build directory. `prepare.mjs` may produce an unbound inspection
fixture, but the actual guest entry and child refuse to invoke it without a full
reviewed binding. Schema validation is distinct from verification of actual files.

## Fixtures and meaning

Every case is called once with six runtime operands. The `many` shape uses 1,056
outer iterations, two inner iterations and (for depth three) two deepest iterations.
Conditional exits/type changes occur at outer index 1,040, after the current native
1,000 loop-head warmup threshold. Actual startup `pbl.warmup.threshold` remains 10;
that option is not a substitute for the native compiler's loop-head threshold.
Other shapes cover zero outer iterations, zero inner iterations and one iteration.
A numeric contribution after each inner loop distinguishes the inner break from
the labeled outer continue: the latter skips that contribution.

| Case | Intended scope | Interpretation |
| --- | --- | --- |
| `depth2` | Two nested numeric loops | Restricted outer candidate; actual admission unproven. |
| `depth3` | Three nested numeric loops | Restricted outer candidate; inner, middle and outer offsets must be mapped independently. |
| `innerBreak` | Numeric loop with inner break | Candidate with a nested exit; admission depends on the actual compiler. |
| `outerContinue` | Numeric loop with labeled outer continue | Candidate with a nested exit; admission depends on the actual compiler. |
| `typeChange` | Numeric `int32` to exact `double` transition | Guard/bail/fallback diagnostic; Normal is not required or presumed. |
| `earlyReturn` | Array allocation and return inside the nested region | **Unsupported by the restricted milestone; fallback semantics only.** |
| `finallyFallback` | Loop in a try/finally function | **Exception policy rejection/fallback only.** |
| `throwFallback` | Explicit throw after the nested region | **Exception policy rejection/fallback only.** |

Runtime arguments are copied to numeric locals before the outer loop. The nested
regions use those locals because the restricted compiler excludes argument-slot
access. The numeric candidate regions contain no calls, objects, array creation,
allocation or exception constructs. Their result array is allocated after the loop
region. Actual bytecode admission still requires the independently bound guest run.
Each non-throw result contains checksum, outer visits, inner visits and deepest
visits. Independent `BigInt` closed-form sums compute the expected values. The
throw fixture has an independent expected numeric exception. The result counters
are JavaScript semantic counters; they do not measure how much work ran compiled.

`sourceHeads` records distinct source start/end positions, lexical depth and the
work-counter variable for each loop. All bytecode start/end offsets and IC indices
remain `null`. These source positions are review hints. They do not prove the
location of a native `LoopHead`. The observer's `line` is the script start line,
not the loop line. Events are reported by unmapped bytecode offset. A native
mapping must be extracted independently from the exact script and final build.

## Ready-to-run preparation once a candidate is bound

Run from the repository root on verified disk storage. Choose a unique label and
fresh destination for each arm. The existing outer supervisor must verify every
binary, archive, kernel, runtime manifest, review and observer source hash in the
binding before launching the guest.

```sh
node tools/nightly-jit-safety/nested-loop/prepare.mjs \
  --out RUNS/depth3-disabled --label depth3-disabled \
  --case depth3 --scenario many --arm disabled \
  --build-binding REVIEWED_FINAL159_BINDING.json
```

Place the prepared files at the exact guest directory
`/home/admin/nightly-jit-safety/depth3-disabled/`. The owned supervisor launches
fresh Firefox with the prepared restart-only `user.js`, `PBLJIT_OBSERVE=1`,
`PBLJIT_LOG=0`, and unrotated raw stderr redirected to that directory's
`observer.stderr`. The parent actor takes complete-line snapshots below the 2 MiB
cap. Use the generated `console-expression.txt` in the actual guest Browser
Console; it opens and closes its own exact-URI tab and queries it under 12 seconds.
The owned outer supervisor retains the 150-second deadline and all cleanup gates.
A 12-second promise timeout cannot stop synchronous stuck JavaScript, so the outer
process deadline is mandatory.

Export the unchanged preparation files and `result.json`,
`observer.before.stderr`, `observer.after.stderr` after the outer launch/exit gates
finish. Prepare the enabled restart from the disabled result so it receives
**exactly the same runtime operands**:

```sh
node tools/nightly-jit-safety/nested-loop/prepare.mjs \
  --out RUNS/depth3-enabled --label depth3-enabled \
  --case depth3 --scenario many --arm enabled \
  --build-binding REVIEWED_FINAL159_BINDING.json \
  --baseline EXPORTED/depth3-disabled
```

Run/export that arm with the same reviewed outer supervisor, then compare:

```sh
node tools/nightly-jit-safety/nested-loop/analyze.mjs \
  EXPORTED/depth3-disabled EXPORTED/depth3-enabled
```

A single-directory analysis is also supported. Without the disabled directory it
cannot claim baseline verification. Paired analysis verifies exact hashes of the
disabled session, result and raw captures, identical source/build identity,
identical operands, independent oracle equality and disabled/enabled equality.
These consistency checks are not signatures or an attestation of native origin.
A launcher must establish provenance and all outer gates independently.

Normal (`kind=1`), Bail (`kind=2`), Interrupt (`kind=3`) and NoEntry (`kind=0`) stay
separate. An exit requires an observed matching source, offset, main thread, TLS,
epoch and installed function. Eviction retires its installation. Unknown events,
malformed fields, oversized/nonregular export files, raw-log truncation/rotation, exhausted emission budgets, and
source activity before the owned invocation fail closed. Shared aggregate run
counters do not establish Normal exits. Missing rejection events do not prove
admission because rejection recording can be deduplicated.

Even a matching checksum plus source-specific Normal leaves outer-loop identity,
useful compiled inner/outer work, native execution and full-JIT acceptance pending.
Performance is not claimed or measured by this kit.

## Host validation

Run inside the verified common ancestor CPU quota (at most three CPUs), with an
explicit disk-backed `TMPDIR`, `TMP`, `TEMP` and cache directory. The tests create
and delete only fresh subdirectories under that `TMPDIR`.

```sh
for file in tools/nightly-jit-safety/nested-loop/*.mjs; do node --check "$file"; done
node --experimental-vm-modules tools/nightly-jit-safety/nested-loop/test.mjs
```

The matrix covers 8 cases × 4 shapes × 3 seeds × 3 steps = 288 semantic checks and
288 comparisons across separate host evaluations with identical operands. It also
checks negative evidence diagnostics, prepared-file hashes, disabled/enabled
pairing, parent-only IO ownership/order/caps and trusted child acquisition using
mocked actor APIs. No test is actual guest evidence.
