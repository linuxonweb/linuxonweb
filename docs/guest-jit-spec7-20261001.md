# JIT packet 7: doubles (7a) and dense arrays (7b) (2026-10-01)

**Builds on.** Packet 6 (`docs/guest-jit-spec6-20261001.md`): the int32-only
loop specializer with let/TDZ, arguments and forward control flow.

**Problem.** In the JIT 6 bench most browser-chrome loops were rejected at the
entry guard ("head type"), because a head-live var held a double or an object.
Numeric fixture loops with `/`, fractional constants or arrays stayed
interpreted.

**Task root.** `/mnt/p6/build/guest-jit-spec7-20261001` (`$T`). It is ext4, and
TMPDIR/TMP/TEMP point to `$T/tmp`.

## Change

`tools/pbl-jit/PblJit.cpp` is adapter source; no upstream file changes. The
7a-only version is kept at `$T/PblJit.wip.cpp`.

### 7a: doubles

- **Types.** `Double` is a number type beside `Int32`. Each var and each operand
  stack slot has an i32 local and an f64 local. A Double var accepts an Int32 or
  a double at entry (converted to f64).
- **Widening retry.** A numeric var whose Int32/Double type differs around the
  loop or at a join is marked, and the loop is translated again with that var
  as Double. The meta block records `attempts`.
- **Ops on doubles.** `Add`/`Sub`/`Mul` in f64 when an operand is a double
  (int32 x int32 keeps the overflow/-0 bail), `Div` always in f64 (`Mod` stays
  int32-only), `Inc`/`Dec`,
  `Neg`/`Pos`, all comparisons (mixed Int32/Double), `Double` constants, truthiness
  (`JumpIfFalse`/`Not`/`And`/`Or` with NaN and ±0 falsy).
- **ToInt32.** Bitwise ops on a double convert in wasm when the value is within
  the int32 range; outside it they bail before the op.
- **Boxing.** Doubles are stored to the frame as raw bits, and NaN is stored as
  the canonical JS NaN, so no result can alias a NUNBOX32 tag.

### 7b: dense arrays

- **Array vars.** A head-live var whose value is an `Array` becomes an array
  type at entry. The entry guard follows `obj->shape->base->clasp` and compares
  the class with `&ArrayObject::class_`. The var must not be written in the
  loop ("array var written").
- **Element type.** Compile time samples the first 64 dense elements (holes
  skipped). The result is Int32, Double (any number) or unknown ("element type"
  reject). Writing a Double into an Int32-sampled array marks it, and the loop
  is translated again with Double elements (`attempts=2`).
- **New ops.**

  | Op | Fast path | Bails before the op |
  |---|---|---|
  | `GetElem` | Int32 index below the initialized length, number element | out of bounds, hole, non-number element |
  | `SetElem`/`StrictSetElem` | Number over an existing number element (no GC barrier needed) | out of bounds, frozen, old element a hole or non-number |
  | `GetProp "length"` | `ObjectElements` length | length > INT32_MAX |
  | `Dup2` | `a[i] op= v` | – |
  | `NopIsAssignOp` | no-op (decompiler hint after the op of `x op= y`) | – |

- **Layout.** The real build uses `JS::shadow::Object::shape`
  (`JSObject::offsetOfShape` is protected), `Shape::offsetOfBaseShape`,
  `BaseShape::offsetOfClasp`, `NativeObject::offsetOfElements` and the
  `ObjectElements::offsetOf*` header fields.
- **IC indices.** `GetElem`, `SetElem`, `StrictSetElem` and `GetProp` are JOF_IC
  and advance the static IC index; `NopIsAssignOp` and `Dup2` do not.

### Host test

`tools/pbl-jit/host-test/` adds mock arrays (`kMockArrayClasp`, an elements
header, holes as magic values) and 17 emitter cases:

- **7a (7):** divsum, mixcmp, bitdbl, bitovf, incneg, truthy, nanbox, slotjoin.
- **7b (5 accepted, 4 rejected):** arrsum, arrfill, arrinc
  (`Dup2, GetElem, Add, NopIsAssignOp, StrictSetElem`), arrdbl, arrwiden; rejects
  not-an-Array, element type, array var written, and a GetProp atom other than
  `length`.

`run.mjs` checks bails for holes, out-of-bounds indices, frozen arrays, old
holes and non-number elements, with exact pc, IC index, sp and untouched
elements. `$T/host-run5/run.out` passes 335 checks with 0 failures (ASan/UBSan
emitter). `host-run3` is a kept failed run: `JumpIfFalse` is JOF_IC and the
arrsum IC index was wrong in the test.

## Builds

```sh
python3 tools/build-firefox-pbl-jit.py --candidate ../.cache/runtime-graphics-20260926/pbl-candidate-v3 \
  --link-command /mnt/p6/build/firefox-tls-20260926/resume-build-run1/link-command.json --output $T/build-7b-run2
python3 tools/guest-rootfs/package-pbl-candidate.py --source web/linux/initramfs-firefox.cpio.gz \
  --source-manifest web/linux/boot-manifest.json --candidate-report $T/build-7b-run2/report.json \
  --output web/linux/tests/runtime-candidates/pbl-jit-spec7b-run1
```

| Build | Firefox wasm SHA-256 | Archive | Version |
|---|---|---|---|
| 7a `build-run1` | `870e5853…bfbe6f` (157,946,297 B) | `a405cc68…c2896e` (88,906,610 B) | `test-pbl-a405cc684e1fb352` |
| 7b `build-7b-run2` | `039ede08…92f4bb1` (157,954,406 B) | `cc4937fc…2530e2` (88,908,294 B) | `test-pbl-cc4937fc7c48c88d` |

- Both compile against the real SpiderMonkey headers with only the 6 upstream
  `Unicode.h` warnings, use table min 177857 and link in about 62 s.
- `build-7b-run1` failed (kept): `JSObject::offsetOfShape` is protected.
- Each package changes only `opt/firefox/firefox`; all other records and the
  persistent `/init` are identical.

Neither candidate is committed or promoted.

## Gates

`test-firefox-session-startup.mjs` with baseline `web/linux` (promoted
`b21b2cac65a3`); outputs in `/mnt/p6/build/firefox-homepage-20260926/`.

| Gate | 7a | 7b |
|---|---|---|
| startup cold/warm | `jit7-startup-run1` PASS (8326 / 7103 ms, 2 / 0 image requests) | `jit7b-startup-run1` PASS (9164 / 10120 ms, 2 / 0) |
| update | `jit7-update-run1` PASS | `jit7b-update-run1` PASS (12655 / 15027 ms) |

The 7b gate launch times were taken while the user's Chrome Canary kept the
host at load average 8; they are not comparable with the 7a gates. The bench
below compares launch times interleaved.

## Benchmark 7a: JIT 6 vs JIT 7a (ABBAAB, 6 cold boots)

**Fixture.** `web/linux/tests/guest-jit-spec7-bench.html`: `int-loop` control,
seven double loops (10k iterations, every rep value checked) and the
`native-call` control.

**Result.** `$T/bench-run1/result.json` passes: checksums identical in all
boots and arms, inputs unchanged, server closed, 365 DNS refusals and 0 TCP.
Arms: A = JIT 6 `test-pbl-25c06bc9ce505703`, B = JIT 7a.

| Case | A ms/rep | B ms/rep | B/A | Verdict |
|---|---|---|---|---|
| int-loop (control) | 0.01 | 0.01 | 1 | equal (quantised) |
| div-sum | 2.78–2.82 | 0.02 | 0.007 | ~140x faster |
| mixed-cmp | ~2.66 | 0.01–0.02 | 0.007 | ~140x faster |
| mul-trunc | ~3.72 | 0.05 | 0.013 | ~75x faster |
| dbl-inc | ~2.36 | 0.02 | 0.008 | ~120x faster |
| float-acc | 3.2 | 3.2 | 0.997 | equal: rejected on `NopIsAssignOp` |
| dbl-compare | 3.6 | 3.6 | 1.003 | equal: rejected on `NopIsAssignOp` |
| dbl-truthy | 2.89 | 0.02 | 0.007 | ~140x faster |
| native-call (control) | – | – | 0.99 | equal (`GetGName`) |

- **Whole fixture:** A 137.9/139.0/139.0 s, B 55.6/55.5/55.7 s.
- **Launch:** A 8440/7888/8340 ms, B 8460/7886/8389 ms (equal).
- **JIT counters:** every B boot compiles the 6 fixture loops, all with
  `attempts=1`, and reports 0 bails.
- **B rejects:** head type (self-hosted code, Schemas), region size, GetGName,
  `NopIsAssignOp` x2 and one `Dup2` in UrlbarMuxer (boot 3). The two
  `NopIsAssignOp` rejects led to the 7b nop.

## Benchmark 7b: JIT 7a vs JIT 7b (ABBAAB, 6 cold boots)

**Fixture.** `web/linux/tests/guest-jit-spec7b-bench.html`: `int-loop` and
`native-call` controls plus six array/double loops over 10,000-element arrays
(every rep value checked).

**Result.** `$T/bench-7b-run1/result.json` passes: checksums identical in all
boots and arms, inputs unchanged, server closed, 449 DNS refusals and 0 TCP.
Arms: A = JIT 7a `test-pbl-a405cc684e1fb352`, B = JIT 7b
`test-pbl-cc4937fc7c48c88d`. Values are the median batch time over the three
boots of each arm (min-max in brackets).

| Case | A ms/batch | B ms/batch | B/A | Verdict |
|---|---|---|---|---|
| int-loop (control) | 2 (1-3) | 2 (1-4) | 1 | equal (quantised) |
| arr-sum | 390 (378-459) | 4 (3-5) | 0.010 | ~100x faster |
| arr-fill | 447 (424-489) | 5 (5-9) | 0.011 | ~90x faster |
| arr-inc | 1399 (1356-1741) | 597 (583-609) | 0.43 | partial: `a[i]+=i` rejected on `ToPropertyKey` |
| dbl-arr | 381 (375-485) | 4 (3-4) | 0.010 | ~100x faster |
| arr-widen | 1297 (1268-1421) | 12 (11-14) | 0.009 | ~110x faster |
| float-acc | 369 (348-482) | 2 (2-3) | 0.005 | ~180x faster (7b `NopIsAssignOp`) |
| native-call (control) | 229 (221-274) | 226 (220-269) | 0.99 | equal (`GetGName`) |

- **Whole fixture:** A 271.7/286.4/288.4 s, B 57.3/54.7/58.0 s.
- **Launch:** A 11846/12223/16857 ms, B 11558/13052/12745 ms (no slowdown; the
  16.9 s A boot was under host load).
- **JIT counters:** B boots report 0 bails; all fixture loops compile with
  `attempts=1` except the rejects below.
- **B rejects (3 boots):** head type 15 (self-hosted code, chrome), `ToPropertyKey`
  3 (arr-inc's `a[i]+=i` loop), `GetGName` 3 (native-call), element type 3.
- **arr-inc finding.** Real bytecode for `a[i] += v` is
  `GetLocal a; GetLocal i; ToPropertyKey; Dup2; GetElem; ...`. The host test's
  arrinc case omits `ToPropertyKey`, so it missed this. Fix (next packet):
  treat `ToPropertyKey` on an Int32 key as a no-op that still advances the IC
  index (it is `JOF_IC` in Opcodes.h) and add it to the host case.

## Limits and next

**Limits.**

- Arrays: only dense number elements of Array objects held in a var that the
  loop does not replace. No pushes, appends, holes, typed arrays, strings or
  object elements; writes cannot grow the array.
- No property access other than Array `.length`; no calls.
- Only innermost loops; a rejected loop is never retried.

**Next.** JIT 7c: `ToPropertyKey` no-op for Int32 keys (arr-inc). Then JIT 8: monomorphic `GetProp`/`SetProp` from the IC shape, `GetGName`
of global constants, and direct JSNative calls (`Math.*`).

The non-PBL regressions recorded in JIT 5 (throw 1.27x, native-call 1.18x,
prop-mono 1.11x vs the promoted build) remain, so do not promote yet.
