# JIT packet 6: specializer coverage (let/TDZ, args, control flow) (2026-10-01)

**Builds on.** Packet 4 (`docs/guest-jit-pbl-spec-20261001.md`, loop specializer)
and packet 5 (`docs/guest-jit-rebase-20261001.md`, rebased onto the promoted
Firefox link).

**Problem.** The packet-4 compiler accepted only straight-line int32 loop
bodies. In the JIT 5 bench the most common reject reasons were `Uninitialized`
(let/TDZ), `In`, `GetArg`, internal jumps (if/else) and `Mod`/`Neg`/`And`/`Coalesce`.

**Task root.** `/mnt/p6/build/guest-jit-spec6-20261001` (`$T`). It is ext4, and
TMPDIR/TMP/TEMP point to `$T/tmp`.

## Change

`tools/pbl-jit/PblJit.cpp` is adapter source; no upstream file changes. The
packet-4 version is kept at `$T/PblJit.packet4.cpp`.

### Values and vars

- **Static types.** `Int32`, `Boolean`, `undefined`, `null` and the TDZ magic
  (`JS_UNINITIALIZED_LEXICAL`).
- **Vars.** Frame locals and unaliased formal arguments. Each var lives in a
  wasm local.
- **Argument preconditions.** `OnLoopHead` passes `argv` to the generated
  function. A loop that uses arguments is entered only if all of these hold:
  - it is a function frame;
  - `numFormalArgs() >= nargs`;
  - `!argsObjAliasesFormals()`.

### Region, control flow and liveness

- **Region.** It runs from the LoopHead to the last backedge before any nested
  LoopHead.
- **Forward jumps.** Forward jumps inside the region become nested wasm blocks
  (if/else, `&&`, `||`, `??`, `continue`).
- **Joins.** Every join must agree on stack depth and on all types; otherwise
  the loop is rejected with "join depth" / "join type".
- **Liveness.** A forward definitely-written analysis splits vars in two:
  - **Head-live vars** (read before written in an iteration) are type-guarded
    at entry. The entry type is the frame's current tag. The var must keep that
    type at every backedge.
  - **Other vars** start in the "head" state and are written back at the
    backedge and at every exit.

### New ops

| Group | Ops |
|---|---|
| Constants | `Undefined`, `Null`, `Uninitialized` |
| Lexicals | `InitLexical`, `CheckLexical` (rejects "tdz" if the value may be the magic) |
| Arguments | `GetArg`, `SetArg` |
| Arithmetic | `Mod`, `Neg`, `BitNot`, `Pos` |
| Logic | `And`/`Or` (value kept, IC index advanced like PBL), `Coalesce` (static on the known type), `Not` on undefined/null |
| Comparison | Boolean `==`/`===` |
| No-op | `DebugLeaveLexicalEnv` (run2): it is a no-op in PBL for non-debuggee frames, and `OnLoopHead` is never entered for those |

### Bails

Each bail happens *before* the op, so PBL redoes it with exact semantics:

- **`Mod`:** when lhs < 0 or rhs <= 0;
- **`Neg`:** on 0 and INT32_MIN (-0 and overflow);
- **`Add`/`Sub`/`Mul`:** int32 overflow, as before.

### Host test

`tools/pbl-jit/host-test/` adds a mock frame with `argv` and formals, plus 17
emitter cases (10 accepted, 7 rejected).

The accepted cases cover if/else, `&&`/`||`, `continue`, a let body, arguments,
`??` and the Mod/Neg bails.

The rejected cases and the reason each one must produce:

| Case | Reason |
|---|---|
| join type | join type |
| TDZ read | tdz |
| aliased args | arguments |
| arg index >= formals | argument index |
| no argv | arguments |
| head type guard | head type |
| nested loop | nested loop |

`run.mjs` executes the generated wasm against a fake frame with ASan/UBSan.
`$T/host-run2/run.out` passes 114 checks with 0 failures. It covers values,
tags, exits (kind, pc, ic, sp), interrupt exits and the entry guards.

## Builds

```sh
python3 tools/build-firefox-pbl-jit.py --candidate ../.cache/runtime-graphics-20260926/pbl-candidate-v3 \
  --link-command /mnt/p6/build/firefox-tls-20260926/resume-build-run1/link-command.json --output $T/build-run2
python3 tools/guest-rootfs/package-pbl-candidate.py --source web/linux/initramfs-firefox.cpio.gz \
  --source-manifest web/linux/boot-manifest.json --candidate-report $T/build-run2/report.json \
  --output web/linux/tests/runtime-candidates/pbl-jit-spec6-run2
```

| Run | PblJit.cpp | Firefox wasm SHA-256 | Archive | Version |
|---|---|---|---|---|
| run1 | without the DebugLeaveLexicalEnv nop | `8c61a880…3b8b48` (157,936,636 B) | `02fba333…060f47` (88,903,877 B) | `test-pbl-02fba3337dafcf01` |
| run2 (final) | `17c2dce8…e1cf99` (committed) | `d4d05e99…41f1b7` (157,936,636 B) | `25c06bc9…60e79d3` (88,903,880 B) | `test-pbl-25c06bc9ce505703` |

**Both builds:**

- compile against the real SpiderMonkey headers with no new warnings (the same 6 upstream `Unicode.h` warnings as JIT 5);
- use table min 177857;
- link in about 61 s.

**Package.** It changes only `opt/firefox/firefox`. All 11,469 other records
and the persistent `/init` are identical.

Neither candidate is committed or promoted.

## Gates

Both gates use `test-firefox-session-startup.mjs` with baseline `web/linux`
(promoted `b21b2cac65a3`). Outputs are in `/mnt/p6/build/firefox-homepage-20260926/`.

| Gate | run1 | run2 |
|---|---|---|
| startup cold/warm | `jit6-startup-run1` PASS (8097 / 7094 ms, 2 / 0 image requests) | `jit6-startup-run2` PASS (8107 / 7098 ms, 2 / 0 image requests) |
| update | `jit6-update-run1` PASS | `jit6-update-run2` PASS (prior download preserved, server closed) |

For run1 the warm saved-homepage typing screenshot was also inspected.

## Benchmark: JIT 5 vs JIT 6 (ABBAAB, 6 cold boots)

**Fixture.** `web/linux/tests/guest-jit-spec6-bench.html` is new and derived from
the 3b fixture. It has one innermost-loop case per new feature (10k iterations,
every rep value checked). There are two controls:

- `int-loop`, which JIT 5 already compiles;
- `native-call`, which both arms reject on `GetGName`.

**Runner changes.** `test-firefox-pbl-bench.mjs` gains `PBLBENCH_FIXTURE`. The
expected case-line count is now 3 rounds x the fixture's case rows, which is
still 24 for the 3b fixture.

```sh
PBLBENCH_TASK=$T PBLBENCH_ARMS=$T/arms-run2.json PBLBENCH_FIXTURE=web/linux/tests/guest-jit-spec6-bench.html \
  DISPLAY=:0 node tools/guest-rootfs/test-firefox-pbl-bench.mjs $T/bench-run2
```

**Result.** `$T/bench-run2/result.json` passes:

- **Checksums** are identical in all boots and both arms.
- **Inputs** are unchanged.
- **Network:** 349 DNS refusals, 0 TCP.
- **Cleanup:** every browser exited 0 and the server closed.

The arms are A = JIT 5 `test-pbl-d1284e694e28b982` and B = JIT 6 run2.

| Case | A ms/rep (3 boots) | B ms/rep (3 boots) | B/A | Verdict |
|---|---|---|---|---|
| int-loop (control) | 0.01 0.01 0.01 | 0.01 0.01 0.01 | 1.00 | equal |
| let-body | 4.60 4.61 4.63 | 0.04 0.04 0.04 | 0.009 | **~115x faster** |
| args-loop | 2.91 2.90 2.92 | 0.04 0.04 0.04 | 0.014 | **~73x faster** |
| if-else | 3.43 3.45 3.45 | 0.01 0.02 0.02 | 0.006 | **~230x faster** (B quantised: "noise-bound") |
| mod-continue | 3.53 3.53 3.55 | 0.03 0.03 0.03 | 0.008 | **~118x faster** |
| and-or | 4.65 4.66 4.65 | 0.04 0.04 0.04 | 0.009 | **~116x faster** |
| neg-bitnot | 3.46 3.46 3.48 | 0.03 0.03 0.03 | 0.009 | **~115x faster** |
| coalesce | 3.33 3.35 3.36 | 0.01 0.01 0.01 | 0.003 | **~335x faster** |
| native-call (control) | 2.01 2.01 2.00 | 2.00 2.00 1.99 | 0.995 | equal |

**Timer quantisation.** The JIT batches (100 reps) take 1–4 ms, close to Firefox's
1 ms `performance.now()` resolution. The B column, and so the exact ratios, are
quantised.

**Whole fixture.** It takes A 165–172 s per boot and B 16.1–16.3 s.

**Launch.** Launch-log times are A 8409/7918/7862 ms and B 7916/7849/8366 ms.
They are equal.

**JIT counters.**

- **Compiles.** Every B boot compiles 8 loops: `int-loop` plus the 7 new fixture loops, and no browser-chrome loop.
- **Runs.** Every B boot reports `runs=13230 bails=0`.
- **Rejects.** These are the reject reasons, summed over the three boots of each arm:

| Arm | Reject reasons |
|---|---|
| A (JIT 5) | Uninitialized 15, In 13, GetElem 6, Mod 4, GetArg 4, region size 3, Neg 3, internal jump 3, GetProp 3, GetGName 3, Coalesce 3, And 3, MoreIter 2 |
| B (JIT 6) | head type 30, region size 3, GetGName 3, Dup 2 |

**Why B shows "head type".** Most browser-chrome loops are now rejected at the entry guard, because a head-live var holds an object, string or double. Before, they failed on their first unsupported op. These loops need doubles and object values (packets 7–8).

**Run1.** Bench `$T/bench-run1` was run on the run1 build, without the nop. It passes with the same results, except that `let-body` stays interpreted (B/A 1.002, reject `DebugLeaveLexicalEnv`). That run is why the nop was added.

## Limits and next

**Limits.**

- Types are int32 only: doubles, strings and objects are rejected (at the head guard or at the op).
- No property access, element access or calls.
- Only innermost loops.
- A rejected loop is never retried, even when its head var had a transient type.

**Next.**

- **JIT 7:** double values (f64 vars, Div, mixed int/double), dense `GetElem`/`SetElem` and `.length`.
- **JIT 8:** monomorphic `GetProp`/`SetProp` from the IC shape, and direct JSNative calls (`Math.*`).

The non-PBL regressions recorded in JIT 5 (throw 1.27x, native-call 1.18x,
prop-mono 1.11x vs the promoted build) remain, so do not promote yet.
