# JIT packet 7c: Int32 property keys (2026-10-01)

**Problem.** JIT 7b rejected the compound array update loop in
`guest-jit-spec7b-bench.html`: `a[i] += i` emits `ToPropertyKey` before `Dup2`.
The previous host arrinc test omitted that instruction. This packet completes
the intended Int32 fast path; it does not expand property-key conversions.

**Task root.** `/mnt/p6/build/guest-jit-spec7c-20261001` (`$T`), verified ext4
with 68 GiB free before work. TMPDIR/TMP/TEMP were `$T/tmp` throughout.
Native wasm only; no new upstream edits, promotion, deployment or commit.

## Change and host checks

`tools/pbl-jit/PblJit.cpp` accepts `ToPropertyKey` when the operand stack's
top type is Int32. It leaves the value and stack depth unchanged and advances
the static IC index once, as required by `JOF_IC`. Empty stacks and all other
types reject compilation. Dense-element operations retain their bounds and
element guards, including rejection of negative array indices.

The host opcode mock now includes opcode 47, verified against Firefox
128.14.0's `Opcodes.h`. The arrinc bytecode includes `ToPropertyKey`, and its
static target IC index is updated. New checks cover the exact bailout pc,
IC index, stack slots and side effects for overflow, holes, bounds, negative
indices and frozen arrays; double keys fail the entry guard. Boolean,
undefined, null and double conversions, plus stack underflow, reject.

ASan/UBSan host emitter and generated-wasm tests: **402 checks, 0 failures**
in `$T/host-run1/run.out` (previous suite: 335). Arrinc emits a 1,378-byte
module in one translation attempt.

The exact 7c source and host tests are preserved in `$T/PblJit-7c.cpp`,
`$T/host-test-7c/` and `$T/source-snapshot.json`. JIT8 subsequently owns the
live adapter files; the build fingerprint below identifies the 7c snapshot.

## Build and package

```sh
python3 tools/build-firefox-pbl-jit.py \
  --candidate ../.cache/runtime-graphics-20260926/pbl-candidate-v3 \
  --link-command /mnt/p6/build/firefox-tls-20260926/resume-build-run1/link-command.json \
  --output "$T/build-run1"
python3 tools/guest-rootfs/package-pbl-candidate.py \
  --source web/linux/initramfs-firefox.cpio.gz \
  --source-manifest web/linux/boot-manifest.json \
  --candidate-report "$T/build-run1/report.json" \
  --output web/linux/tests/runtime-candidates/pbl-jit-spec7c-run1
```

Build PASS in 91.12 seconds; six existing upstream Unicode warnings, no new
compile errors. The function table is growable with minimum 177857.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Adapter snapshot | — | `329f01d8f0a96f05506712476b5908cd244b4a4ba9ff305be963a3e88ba513ac` |
| `$T/build-run1/firefox-pbl-jit.wasm` | 157,954,523 | `5c28049ac7b3b949106810fe7d85d76baafe75ae3870388d35ba9938dc10b9c6` |
| Candidate archive | 88,908,337 | `1b53911f106c11e4519aec0f2a0d838bea5c32edc81428e2a89b102b4fdf82d0` |

Candidate directory: `web/linux/tests/runtime-candidates/pbl-jit-spec7c-run1`.
Manifest version: `test-pbl-1b53911f106c11e4`. Package audit PASS: all 11,470
records audited, only `opt/firefox/firefox` changed; `/init` and all other
records preserved. Build and package reports live beside their artifacts.

## Real guest startup and update gates

Validation evidence root: `/mnt/p6/build/guest-jit-validation-20261001`.
These gates were run by the validation agent using the frozen 7c package.

| Gate | Result | Launch time | System-image requests |
|---|---|---|---|
| `jit7c-startup-run1` cold / warm | PASS | 14,327 / 11,349 ms | 2 / 0 |
| `jit7c-update-run1` baseline / updated | PASS | 12,384 / 16,968 ms | 2 / 0 |

Home data, user.js and the prior download survive; guest input and download
checks pass. Owned browsers exit 0, servers close, and all inputs stay
unchanged. Exact results are each gate's `result.json`; commands and harness
details are in `docs/guest-jit-validation-20261001.md`.

The completed six-boot ABBAAB 7b versus 7c comparison passes semantics,
unchanged inputs and cleanup in `bench-7c-arrays-run1`. Compound array updates
fall from a median 621 to 13 ms per 100 repetitions (about 47.8× faster).
The native-call control has a 1.102 median ratio and substantial host variance;
JIT8 subsequently specializes that case. This packet alone does not resolve
the earlier exception/property/native regressions versus the promoted build.

## Separate guest safety fixture

`web/linux/tests/guest-jit-safety.html` adds 25 semantic cases over three
rounds (75 PBLBENCH case rows). Each test runs once per round; memoized batch
timings are transport metadata, not performance evidence. It warms 18
supported hot functions before mutations and emits exact function/script
line requirements for guest compilation-log validation, divided by JIT7
and JIT8 support. Test-only guest logging needs a budget of at least 300.

Cases cover shifted/sealed/frozen/holey/accessor arrays, prototype getters,
out-of-bounds and negative keys, overflow after partial writes, numeric
signed zero/NaN/conversion edges, property shapes/dynamic slots/accessors/
readonly/type changes, Math callee/global/accessor replacement, Math edge
values, catch/finally/rethrow/iterator cleanup and mixed calls. Math edge
checks precede mutations; the accessor changes Math's shape only in the
final round. GC pressure is exercised, but collection and interrupts are
not forcibly triggered.

Node-only fixture verification PASS: **7,850 assertions**, 75 rows, and all
compilation-metadata lines match the source. Evidence/snapshot:
`$T/safety-host-run4/`. Final fixture SHA-256:
`06800e6d6499afe7a1fbf497e050169bb417aed9b17b46f11b7e0190cfc96178`.
Real guest safety acceptance, including positive compilation evidence, is
pending with the validation agent. Node results alone do not prove guest
JIT correctness.

The fixture was subsequently strengthened to 8,408 assertions per boot and
18 compiled helpers. Exact candidate `ce0d881dec8cea07` passes the full six-boot
guest safety gate with all helpers compiled before mutation. Its final fixture
hash and evidence are in `docs/guest-jit-validation-20261001.md`. The original
Node snapshot above remains historical evidence for the earlier fixture.
JIT7c is an audited coverage control for JIT8; it is not promoted independently.
