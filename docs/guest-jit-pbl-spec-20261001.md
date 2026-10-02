# JIT packet 4: runtime PBL-to-wasm loop specializer (2026-10-01)

**Design.** `docs/guest-jit-design-20260928.md` (runtime PBL specializer). This
packet builds on:

- the `jit_install` primitive (packet 1, `docs/guest-jit-runtime-primitive-20260928.md`);
- the growable-table splice (packet 2, `docs/guest-jit-firefox-prep-20260928.md`);
- the 3b GO verdict (`docs/guest-jit-pbl-bench-20261001.md`).

**Task root.** `/mnt/p6/build/guest-jit-spec-20261001` (`$T`). It is ext4, and
TMPDIR/TMP/TEMP point to `$T/tmp`.

## Result

This is the first real guest JIT in Firefox. Hot int32 loops in page JS are now
compiled at runtime into wasm functions. They are installed into the running
Firefox instance and executed in place of the interpreter.

| Case | PBL ms/rep (boots 1,4,5) | PBL+JIT ms/rep (boots 2,3,6) | ratio | Verdict |
|---|---|---|---|---|
| int-loop (10k iters) | 2.61 2.49 2.58 | 0.01 0.01 0.01 | **~0.005 (~190x)** | **faster** |
| call-recursion fib(14) | 0.43 0.41 0.43 | 0.45 0.44 0.42 | 1.023 | equal within noise |
| throw-flat | 0.40 0.37 0.40 | 0.41 0.41 0.38 | 1.025 | equal within noise |
| throw-deep | 0.38 0.35 0.38 | 0.41 0.38 0.37 | 1.000 | noise-bound |
| throw-error | 0.37 0.36 0.39 | 0.39 0.38 0.36 | 1.027 | equal within noise |
| prop-mono | 1.47 1.40 1.40 | 1.53 1.54 1.44 | 1.093 | equal within noise |
| native-call | 2.05 1.93 2.00 | 2.12 2.12 2.01 | 1.060 | equal within noise |
| json | 0.51 0.49 0.52 | 0.56 0.57 0.48 | 1.098 | noise-bound |

**Int-loop timing is quantised.** Firefox's `performance.now()` has 1 ms
resolution here, and a JIT batch of 100 reps takes 0–3 ms.

- Mean over all 99 timed batches per arm: PBL **254.6 ms**, PBL+JIT **1.33 ms**.
  That is about **191x** (~1.3 ns per iteration).
- Even the worst JIT batch (3 ms) is 81x faster than the best PBL batch (244 ms).
- The target was ≥3x.

**Correctness.** Every one of 24 case checksums is identical across all six boots
and both arms (`checksumsIdentical: true`). They are also identical to the 3b
PBL run, and every individual rep is checked against its expected value.

**Run.** `$T/run1/result.json` passes:

- **Boots.** Order ABBAAB, 6 boots, all pass. Navigation needed 2 attempts in
  boots 4 and 6.
- **Inputs.** All inputs are unchanged.
- **Network.** 287 DNS refusals in total, 0 TCP.
- **Cleanup.** Every browser exited 0 and the server closed.

| Arm | Version | Firefox archive SHA-256 |
|---|---|---|
| A PBL (3b arm B) | `test-pbl-6febc628d9f6f796` | `6febc628d9f6f7968bdb228d1590adcff83daabd8c6c4b63c8bb6a71c9afb486` |
| B PBL+JIT | `test-pbl-0ba71ef269c7910a` | `0ba71ef269c7910ab973227efe06b16cdb7ab32e646e266f12f72c744f17d433` |

Kernel `21c15250…` and plain rootfs `3abcabf2…` are the same in both arms.

**No regressions.** None of the seven other cases gets a "slower" verdict.

- `prop-mono` (1.093) and `json` (1.098) sit just below the 1.10 threshold.
- Neither has every JIT boot slower than every PBL boot.
- `json` is noise-bound in the JIT arm (spread 1.188).

The plausible residual cost is the hook itself. Every LoopHead of a rejected
loop still makes one out-of-line call, a thread-local load and one cache probe
(`prop-mono` runs 4000 LoopHeads per rep). This could be measured and inlined
later; it is below the verdict threshold here.

**Launch markers (ms).** PBL 17998 / 17923 / 18926, PBL+JIT 18434 / 17944 /
18935. The two arms are equal.

**JIT log (guest stderr).** In each JIT boot:

- The int-loop region compiles once: `compile #1 …pblbench-b-N.html:19 off=24
  len=56 ops=18 locals=2 depth=2 wasm=601 idx=177857`.
  - `idx=177857` is the first slot after the spliced table minimum.
  - The `stats` line prints at compile time, so its `runs=0` is not a final count.
  - There are no `disable` lines.
- **Rejects** are logged once per loop with the first unsupported op:
  - in chrome JS: `GetProp`, `GetElem`, `In`, `Uninitialized`;
  - in the fixture's other loops: `Try`, `GetProp`, `GetGName`, `Uninitialized`.
  - These loops stay on PBL, which is why the other cases are unchanged.

## How it works

### Hook: one upstream hook point, in a copy

`tools/build-firefox-pbl-jit.py` copies the Firefox 128.14.0
`PortableBaselineInterpret.cpp` and makes two exact-count replacements. The
upstream tree is untouched. The diff is written to `build-run2/pbl-jit-hook.patch`.

1. **Declaration.** A forward declaration of `js::pbljit::OnLoopHead`.
2. **Hook in `CASE(LoopHead)`.** It goes after `COUNT_COVERAGE_PC`, guarded by
   `!frame->isDebuggee() && !script->hasScriptCounts()`.
   - It calls `OnLoopHead(script, frame, sp, pc, cx, &exit)`.
   - If that returns true, it sets `sp`, `pc += exit.pcDelta` and
     `interpreterICEntry = icEntries + exit.icIndex`, then `DISPATCH()`.

The tool then:

- compiles both the copy and `tools/pbl-jit/PblJit.cpp` with the PBL object's
  own compile command;
- replaces the object in the coherent `pbl-candidate-v3` archive list;
- relinks with the v3 link command;
- applies `wasm-opt --fpcast-emu` (23 params);
- splices the function table to growable (min 177857, no max);
- runs `wasm-validate`.

**Build.** `build-run2` passes in 61 s. Its `report.json` records:

- candidate SHA-256 `85a16f22…`, 157,941,317 bytes;
- hook source `7c552269…`, specializer `bfa58848…`, upstream `46a08c24…`.

**Package.** `tools/guest-rootfs/package-pbl-candidate.py` builds
`web/linux/tests/runtime-candidates/pbl-jit-run1`.

- Only `opt/firefox/firefox` changes, and the other 11,468 records are identical.
- The package is not committed and not promoted.

### Specializer (`tools/pbl-jit/PblJit.cpp`, adapter source)

**Cache.**

- A per-thread direct-mapped cache of 1024 entries, keyed by LoopHead pc.
- **Compile.** A loop is compiled after 1000 hits.
- **Validate.** Before each run, the stored bytecode copy is checked with
  `memcmp` against the current script. A re-allocated script at the same
  address is therefore evicted, not misrun.
- **Disable.** An entry is disabled (`jit_free`) after 64 bails or no-entries.
- **Caps.** At most 4000 installs.
- **Switches.** `PBLJIT=0` turns the JIT off. `PBLJIT_LOG=N` sets the log budget
  (default 24).

**Region.** From the LoopHead to the single `Goto`/`JumpIfTrue` back to it:

- innermost only (no nested LoopHead);
- at most 512 bytes;
- at most 32 frame locals;
- operand stack depth at most 16;
- every jump is either the backedge or out of the region.

**Supported ops (int32 subset).**

| Group | Ops |
|---|---|
| Control | `Nop`, `JumpTarget`, `JumpIfFalse`, `JumpIfTrue`, `Goto` |
| Constants | `Zero`, `One`, `Int8`, `Uint16`, `Uint24`, `Int32`, `True`, `False` |
| Locals | `GetLocal`, `SetLocal`, `InitLexical`, `CheckLexical` |
| Stack | `Pop`, `Dup`, `Swap` |
| Arithmetic and bitwise | `Add`, `Sub`, `Mul`, `BitOr`, `BitAnd`, `BitXor`, `Lsh`, `Rsh`, `Ursh` |
| Comparison | `Lt`, `Le`, `Gt`, `Ge`, `Eq`, `Ne`, `StrictEq`, `StrictNe` |
| Other | `Inc`, `Dec`, `ToNumeric`, `Not` |

Any other op rejects the loop, and it stays on PBL.

**Generated function.**

- **Signature.** One `(23 x i64) -> i64` wasm function (the fpcast ABI). It
  imports the shared `env.memory` and `env.table`, and is installed by
  `jit_install` into the calling Firefox instance's table.
- **Arguments.** frame, sp, the interrupt-bits address, and an out record.
- **Entry guard.** Every used local must be Int32; otherwise it returns
  NOENTRY and PBL runs the loop.
- **State.** Locals and stack slots live in wasm i32 locals.
- **Overflow and -0.** `Add`/`Sub`/`Mul`/`Inc`/`Dec` overflow, a `Mul` -0 result,
  and an `Ursh` result above INT32_MAX all exit as BAIL *before* the op. PBL
  then redoes the op with full semantics, with the pre-op stack and IC index.
- **Backedge.** Each backedge does an atomic load of the interrupt bits. If any
  are set, it exits at the LoopHead so PBL handles the interrupt.
- **Exits.** Every exit:
  - writes back all written locals;
  - boxes the operand stack (INT32/BOOLEAN tags, NUNBOX32);
  - reports `sp`, the pc delta and the IC entry index.
- **IC indices** are static: each JOF_IC op on these fast paths calls NEXT_IC
  exactly once, and `JumpTarget`/`LoopHead` reset the index from their operand.

### Host emitter test

`tools/pbl-jit/host-test/` compiles `PblJit.cpp` against `mock.h` with
`PBLJIT_HOST_TEST` defined.

- `emit.cpp` hand-assembles five bytecode loops (intloop, addovf, dowhile,
  stackexit, reject-getarg).
- `run.mjs` runs the generated modules in Node with shared memory and a growable
  table.
- `host-test-run2` passes **47/47**. Checks cover exit kinds, sp, pc delta, IC
  index, locals, boxed slots and tags, the NOENTRY, INTERRUPT and BAIL paths
  (add and mul overflow), and memory below sp left untouched.
- Module sizes are 392–651 bytes.

## Firefox startup regression

**Startup evidence that passes.** The six ABBAAB boots above are also
cold-start checks of the full Firefox image:

- `/bin/firefox` launches in every boot. Launch markers are equal in both arms.
- The page is reached by real typed guest input.
- All 24 cases complete with checksums.
- No fatal guest lines, no outer exceptions; each browser exits 0.

**Session-startup gate: cannot run on this lineage.**
`test-firefox-session-startup.mjs` (the packet 2 gate) was run with this
candidate against base `fa0217b54d99` (the 3b lineage):
`firefox-homepage-20260926/jit4-startup-run3`.

- **Result.** It fails with "guest fixture readiness deadline".
- **What the screenshot shows.** The JIT Firefox is running normally and has
  rendered `https://www.bing.com` over HTTPS with the lock icon.
- **Cause.** The 3b-lineage image still has the forced-Bing CLI argument. It
  predates the homepage fix (`89ec54c81936`), so the saved-homepage fixture never
  appears.
- **Control.** The same gate on the **non-JIT** PBL v3 image
  (`jit4-control-pbl-run1`) fails identically, with an identical screenshot.

Both runs: browser exit 0, server closed, 0 outer errors. The startup and update
gates need the JIT rebased onto the current promoted Firefox, which is the next
packet (see below).

## Failed runs kept

| Run | What happened |
|---|---|
| `$T/host-test-run1` | Exits that come before a `SetLocal` in bytecode order did not write that local back, so the loop exited with a stale sum. Fixed by computing written locals in `scan()`. The test also expected IC index 8 for the mul overflow; the correct value is 7, because `Mul` uses the head entry before NEXT_IC. |
| `$T/build-run1` | Built before that fix; marked `SUPERSEDED.txt`. |
| `firefox-homepage-20260926/jit4-startup-run1-failed-baseline-arg` | The runner defaulted to the v7 baseline, so it stopped at the archive identity check before boot. |
| `firefox-homepage-20260926/jit4-startup-run2-failed-pkg-bytes` | The test `package.json` lacked `bytes`, so it stopped at the live-asset check before boot. |
| `firefox-homepage-20260926/jit4-startup-run3`, `jit4-control-pbl-run1` | Lineage limitation (above); the control fails the same way. |

## Next packet (JIT 5)

1. **Rebase.** Rebase PBL+JIT onto the current promoted Firefox lineage. This
   needs a coherent PBL rebuild from the build tree that produced the promoted
   binary (NSS patch 0004, `firefox-mmap-aligned`).
2. **Gates.** Then run the session-startup cold/warm and update gates.
3. **Specializer.** Extend the specializer, in this order:
   - `GetArg`/`SetArg` and double arithmetic;
   - monomorphic `GetProp`/`SetProp` shape-guarded slot access;
   - direct `JSNative` calls for Call IC native stubs (the 3b `native-call`
     cost);
   - nested loops.

## Limitations

- **Loop shapes.** Only innermost, straight-line int32 loops with jumps out are
  compiled. There are no calls, property or element access, globals, arguments
  (`GetArg`/`SetArg`), doubles, strings, `try`, or nested loops. In practice,
  most chrome JS loops are still rejected. The 3b targets for native calls
  (Call IC) and monomorphic property ICs are the next packets.
- **Debugger.** A debugger that attaches while the loop runs is not noticed
  until the next exit. Entry is skipped for debuggee frames and scripts with
  script counts.
- **Per-thread caches.** Each thread has its own cache and installs. Each
  thread's table grows separately (packet 2 limitation). Evicted entries are
  freed; the 4000-install cap is never reset.
- **Timing.** Int-loop timing is limited by 1 ms timer resolution (see above).
- **Scope.** Local test candidate only. Nothing is promoted or deployed. The
  public Sites v9 and the local promoted Firefox image are unchanged.
