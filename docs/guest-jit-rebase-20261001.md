# JIT packet 5: PBL + loop JIT rebased onto the promoted Firefox (2026-10-01)

**Builds on.** Packet 4 (`docs/guest-jit-pbl-spec-20261001.md`). Its candidate
sat on the old fa0217 lineage, which forces a Bing launch URL, so the
session-startup gate could not run. This packet relinks the same PBL
interpreter and specializer against the promoted Firefox link (TLS/NSS resume
build, version `b21b2cac65a3`, with the DevTools fix). It then runs the
startup/update gates and an A/B benchmark against the promoted build.

**Task root.** `/mnt/p6/build/guest-jit-rebase-20261001` (`$T`). It is ext4, and
TMPDIR/TMP/TEMP point to `$T/tmp`.

## Change

`tools/build-firefox-pbl-jit.py` gains `--link-command JSON`. It reuses a
recorded Firefox link argv and replaces only its single `libjs_static.a` and its
`-o` output. Everything else is unchanged: the PBL hook (in a copy of
`PortableBaselineInterpret.cpp`), the `PblJit.cpp` compile, fpcast (23 x i64)
and the growable-table splice. The report records `linkCommand` and
`linkCommandSHA256`. No source changed upstream.

## Build and package

```sh
python3 tools/build-firefox-pbl-jit.py \
  --candidate ../.cache/runtime-graphics-20260926/pbl-candidate-v3 \
  --link-command /mnt/p6/build/firefox-tls-20260926/resume-build-run1/link-command.json \
  --output $T/build-run1
python3 tools/guest-rootfs/package-pbl-candidate.py \
  --source web/linux/initramfs-firefox.cpio.gz --source-manifest web/linux/boot-manifest.json \
  --candidate-report $T/build-run1/report.json \
  --output web/linux/tests/runtime-candidates/pbl-jit-rebase-run1
```

**Build.** `$T/build-run1/report.json` passes in 63.07 s.

- Wasm: 157,942,006 bytes, SHA-256 `ac9a79d540d94629af64b917f7e22b5d91ff04441fe6e69df3ae4f4a1f64d3a1`.
- Table splice: min 177857, no max.
- Link command SHA-256 `d78b14b6…`.
- `PblJit.cpp` SHA-256 `bfa58848…`: the packet-4 source, unchanged.

**Package.** `$T/package-run1.out` passes.

- Archive: version `test-pbl-d1284e694e28b982`, 88,902,034 bytes, SHA-256 `d1284e694e28b9823f78a847e534e0af352700973507cb2c0a3cdba6c5e83711`.
- Source: the promoted archive `d3d9afca…002b`.
- 11,470 records. Only `opt/firefox/firefox` changes, and every other record is identical.
- The persistent `/init` is preserved.

`$T/startup-candidate-run1` holds the same archive plus a candidate manifest and
`package.json` for the session-startup runner. The candidate is **not
committed and not promoted**.

## Gates

Both gates use the baseline `web/linux` (promoted `b21b2cac65a3`):

```sh
H=/mnt/p6/build/firefox-homepage-20260926
node tools/guest-rootfs/test-firefox-session-startup.mjs $H/jit5-startup-run1 $T/startup-candidate-run1 '' web/linux
node tools/guest-rootfs/test-firefox-session-startup.mjs $H/jit5-update-run1  $T/startup-candidate-run1 update web/linux
```

- **`jit5-startup-run1` PASS.**
  - Cold: launch 8454 ms with 2 image requests.
  - Warm: 7550 ms with 0 image requests.
  - Saved homepage restore, real guest typing and the downloaded JS result all pass.
  - The browser and server closed.
- **`jit5-update-run1` PASS.**
  - Real Update & restart from the promoted baseline to the candidate.
  - Exact home/user.js preservation.
  - Prior guest download preserved (`priorDownloadPreserved`).
  - The server closed.

This clears the packet-4 blocker: the startup gate now runs on the JIT build.

## Benchmark (ABBAAB, 6 cold boots)

Run with `node tools/guest-rootfs/test-firefox-pbl-bench.mjs $T/bench-run1`,
arms from `$T/arms.json`. The result `$T/bench-run1/result.json` passes:

- checksums are identical in every boot and both arms;
- inputs are unchanged;
- the server closed.

The arms are:

- **A:** the promoted, non-PBL `b21b2cac65a3`;
- **B:** this candidate, PBL + loop JIT.

| Case | A ms/rep (3 boots) | B ms/rep (3 boots) | B/A | Verdict |
|---|---|---|---|---|
| int-loop | 2.54 2.58 2.55 | 0.01 0.01 0.01 | **0.004** | JIT ~250x faster |
| call-recursion | 0.54 0.54 0.55 | 0.41 0.41 0.41 | 0.759 | faster (PBL) |
| throw-flat | 0.30 0.30 0.30 | 0.38 0.38 0.39 | 1.267 | slower (PBL exceptions, H2) |
| throw-deep | 0.33 0.34 0.34 | 0.36 0.36 0.36 | 1.059 | equal within noise |
| throw-error | 0.34 0.34 0.34 | 0.36 0.36 0.36 | 1.059 | equal within noise |
| prop-mono | 1.30 1.30 1.29 | 1.44 1.47 1.44 | 1.108 | slower (property IC path) |
| native-call | 1.70 1.71 1.71 | 2.02 2.00 2.01 | 1.175 | slower (Call IC path) |
| json | 0.50 0.51 0.50 | 0.50 0.50 0.50 | 1.000 | equal |

**Whole-bench wall time.** A takes about 46.5–46.9 s per boot, B about 34.5–35.4 s.
Most of that difference comes from the int loop.

**Launch.** Launch-log times are A 8418/7857/7858 ms and B 7837/7867/8371 ms.
That is equal, and these are single observations, not first paint.

**Compiles.** Each B boot compiles exactly one loop: the bench int loop, 601 bytes of wasm.

**Rejects.** These are the reasons the specializer rejected loops, summed over the
three B boots:

| Reason | Count |
|---|---|
| Uninitialized | 15 |
| In | 10 |
| Try | 9 |
| GetProp | 6 |
| GetElem | 6 |
| region size | 3 |
| GetGName | 3 |
| MoreIter | 1 |

Most come from browser chrome JS. `let` bindings (Uninitialized/TDZ) are the
most common reason and are the first target of packet 6.

**Stats line.** The `runs=0` value is printed at compile time, so it does not
count executions.

## Verdict

The rebased PBL+JIT build passes the promoted startup and update gates. It keeps
the int-loop speedup and the PBL call-recursion win. It still inherits PBL's
known costs against the non-PBL build:

- exceptions, about 1.27x on flat throws;
- native calls, 1.18x;
- monomorphic property access, 1.11x.

These are the targets of JIT packets 7–8: direct JSNative calls and inlined
monomorphic property ICs. Do not promote this build until those are measured.
Promotion would trade those regressions for loop speed.

**Next.** JIT 6 extends the specializer: `let`/TDZ ops, arguments, if/else and
continue inside the loop body, `&&`/`||`/`??`, Mod/Neg/BitNot, and Bool/Undef/Null
values. Its design and host test are in `docs/guest-jit-spec6-20261001.md`.
