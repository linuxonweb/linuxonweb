# Guest JIT packet 3a: Portable Baseline Interpreter (PBL) diagnosis

Date: 2026-09-30. Scope: static analysis of existing artifacts plus a measurement
plan. No browser, guest boot or Firefox rebuild was run. Scratch and outputs:
`/mnt/p6/build/guest-jit-pbl-diag-20260930` (ext4 on nvme0n1p6). Scripts are in its
`tools/`: `wasmscan.py` is a minimal wasm parser/decoder, and `step1.py`/`step2.py`
drive it. Raw numbers are in `out/step1.txt` and `out/step2.json`.

## Question

The PBL candidate (`ENABLE_PORTABLE_BASELINE_INTERP` + `_FORCE`, Firefox 128.14.0,
`JS_CODEGEN_NONE`) was rejected on 2026-09-26 as "slower". See
`docs/host-graphics-and-firefox-jit-20260926.md` and the evidence files
`guest-js-baseline-batched.json`, `guest-js-pbl-v3-batched.json` and
`pbl-v3-comparison.json`. This packet asks where any slowdown could come from,
and what the cheapest measurement is that decides it before JIT packet 4 (a PBL-to-wasm specializer)
builds on PBL.

## Artifacts compared

| Role | Path | SHA-256 (prefix) | Bytes |
|---|---|---|---:|
| PBL final (fpcast) | `.cache/runtime-graphics-20260926/pbl-candidate-v3/firefox-pbl.wasm` | `319c01c2` | 157,905,187 |
| PBL raw (named) | same dir, `firefox-pbl-raw.wasm` | `7478efbf` | 198,755,383 |
| Baseline final | `.cache/reliability-performance-20260926/firefox-mmap-aligned/firefox-media.wasm` | `68b86f1d` | – |
| Baseline raw (named) | same dir, `firefox-media-raw.wasm` | – | – |
| Currently accepted | `web/linux/initramfs-firefox.cpio.gz` member `opt/firefox/firefox` | `644ab48f` | 157,421,037 |

`tools/build-firefox-portable-baseline.py` reuses the exact baseline
`link-static-media-command.txt`. It swaps in only the PBL `libjs_static.a` and then runs
`wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu`
(no `-O`). The PBL/baseline pair is therefore a matched link.

The packaged pair used in the 2026-09-26 run is also exact:

- Baseline archive: `/mnt/p6/build/firefox-ready-20260926/baseline-images/initramfs-firefox.cpio.gz`,
  SHA-256 `6c7fad94…`, 88,186,382 B, manifest version `fa0217b54d99`.
- PBL archive: `web/linux/tests/runtime-candidates/pbl-v3/`, archive `6febc628…`.
  It differs from the baseline archive only in `opt/firefox/firefox`; all other
  11,468 records are identical.
- Both use the same kernel `21c15250…` and plain rootfs `3abcabf2…`.

## Findings

### Whole modules

| Module | Functions | Table (min=max) | Elem entries | Code bytes |
|---|---:|---:|---:|---:|
| PBL raw | 336,766 (+4 imports) | 177,857 | 177,854 | 115,934,817 |
| PBL final | 514,620 | – | – | 118,679,951 |
| Baseline raw | 335,962 | 177,851 | 177,848 | 115,442,791 |
| Baseline final | 513,810 | – | – | 118,210,191 |

PBL adds 804 functions and about 0.49 MB of code. Every PBL-specific function is
in `js::pbl::`, and there are only six of them (86,687 B, about 0.075% of code).

### Hot interpreter functions (raw named modules)

| Function (index) | Params | Locals | Bytes | Instrs | br_table (count; largest) | call_indirect |
|---|---:|---:|---:|---:|---|---:|
| `js::pbl::PortableBaselineInterpret` (247472) | 6 | 37 | 63,433 | 27,378 | 42; 198 | 0 |
| `js::pbl::ICInterpretOps` (247473) | 8 | 36 | 20,951 | 9,925 | 8; 128 | 1 |
| `js::pbl::PortableBaselineTrampoline` | – | – | 1,481 | 629 | – | – |
| `js::Interpret` (baseline, 232754) | 2 | 43 | 55,301 | 23,079 | 20; 200 | 11 |

`js::Interpret` is byte-identical in the PBL module. With `FORCE` and warm-up
threshold 0 (`JitOptions.cpp:140-142`), essentially all non-trivial script
execution moves from `js::Interpret` into `PortableBaselineInterpret`.

`PortableBaselineInterpret` details:

- 259 direct calls to 136 distinct callees.
- 3,183 loads, 2,176 stores, 10,037 `local.get/set/tee` and 160 global ops
  (the shadow stack pointer and stack protector).
- `CacheIRReader::CacheIRReader` and `ICInterpretOps` are each called from 29 sites,
  and neither is inlined. Every IC'd op that is not handled by a hybrid fast path
  therefore costs two out-of-line calls. The second has 8 parameters and pays the
  shadow-stack and stack-protector prologue. `ICInterpretOps` then decodes CacheIR
  bytes through its own 128-way `br_table`.

Both interpreters dispatch through one large `br_table` (198 vs 200 targets)
lowered from computed goto, and their function sizes are similar. Dispatch shape
is therefore not a differential.

### fpcast-emu (indirect-call) overhead

- `--fpcast-emu` adds exactly one thunk per element-segment entry: +177,854 (PBL)
  and +177,848 (baseline) functions, about 2.7 MB of code in each.
- Every `call_indirect` becomes `(23 x i64) -> i64`, with i64 widening at each
  call site. After fpcast, `ICInterpretOps` has +25 instructions and `js::Interpret`
  has +270.
- The PBL opcode loop has **zero** `call_indirect`. IC and helper calls are direct.
  `ICInterpretOps` has exactly one `call_indirect`, of type `(i32,i32,i32)->i32`:
  a JSNative call from a CallNative CacheIR op.
- `js::Interpret` has 11 `call_indirect` (7 x `(i32 x5)->i32`, 1 x `(i32 x4)->i32`,
  2 x `(i32,i32)->i32`, 1 x `(i32,i32)->()`).

Conclusion: the fpcast thunk cost falls only on native and function-pointer calls, and
it is the same or lower under PBL. **fpcast is not a PBL-differential cause.** It is
a global tax on both builds and matters for JIT packet 4, where the specializer's
generated functions must be called directly or through a separately typed table.

### SpiderMonkey `js` shell

None exists:

- No standalone shell was configured or built. The obj tree
  `.cache/firefox-fresh-obj-20260924-071600` has no `js/src/shell` outputs.
- No guest image contains one.
- The only related artifact is `dist/bin/xpcshell.tmp6da2096`, a 2.46 GB wasm from
  an unfinished 2026-09-24 link. It predates the mmap/media shims, but
  `js/xpconnect/shell/xpcshell.o` is present.

An xpcshell relink against the PBL and baseline `libjs_static.a` is possible but
needs a relink plus GRE/omni setup, so it is not the cheapest path (see packet 3c).

### What the 2026-09-26 data actually shows

The comparison came from one manual UI run per build, with 5 samples of 100 reps each
(fixture `web/linux/tests/guest-js-benchmark.html`, fixed-batch-100-v1). Minimum
per-call times, baseline vs PBL:

| Case | Baseline (ms) | PBL (ms) | Result |
|---|---:|---:|---|
| integer loop | 0.20 | 0.22 | about 52 vs 62 ns/iteration, about 16 bytecode ops per iteration |
| object properties | 0.67 | 0.64 | PBL better |
| array callbacks | 1.10 | 0.93 | PBL better |
| JSON and strings | 0.35 | 0.37 | – |
| exceptions and recursion | 0.19 | 0.25 | the only clear regression, about 1.3–1.6x |

The sample spreads of the two builds overlap heavily for every case except
exceptions and recursion.

## Ranked hypotheses

1. **The "PBL is slower" verdict is mostly measurement noise.**
   - It rests on one manual run per build, 5 samples each and no A/B interleaving.
   - Property and array cases already favour PBL. PBL's hybrid ICs and in-activation
     `Call` fast path (no C++ recursion, `CASE(Call)` at line 4832) should help
     call-heavy code.
   - Deciding measurement: interleaved repeats (3b).
2. **Exception unwinding is genuinely slower in PBL.**
   - A throw leaves the opcode loop at `error:` (`PortableBaselineInterpret.cpp:6083`).
   - It then does `PUSH_EXIT_FRAME()` + `jit::HandleException(&rfe)`, the full
     JIT-frame iterator unwinder (`JSJitFrameIter`, try-note search, and
     ResumeFromException plumbing), and re-enters dispatch.
   - `js::Interpret` resolves try notes in-loop, which is cheaper per throw.
   - This matches the only clear regression.
   - It is not relevant to a JIT's steady-state throughput, but it would affect
     exception-heavy chrome JS.
3. **Per-op bookkeeping that exists only because the target is not `__wasi__`.**
   - Every `DISPATCH()` runs `DEBUG_CHECK()` (`frame->isDebuggee()` load+branch,
     lines 3150-3159; compiled out only under `__wasi__`).
   - Every IC'd op runs `NEXT_IC()`, a read-modify-write of
     `frame->interpreterICEntry` in memory (line 3211).
   - Every `LoopHead` performs the `hasAnyPendingInterrupt()` check (line 5350).
   - With about 16 ops per integer-loop iteration, this plausibly explains a
     10–20% integer-loop gap if one is real.
   - It also inflates the local and memory traffic that V8 must allocate across
     the 27k-instruction function.
4. **Out-of-line IC interpretation cost for non-hybrid ICs.**
   - Covers GetProp, SetProp, GetElem, Call on natives, and similar ops.
   - Each costs `CacheIRReader` construction + an 8-parameter `ICInterpretOps` call,
     then CacheIR decode through a second `br_table`.
   - The C++ interpreter instead calls the VM helpers directly.
   - Could appear on monomorphic property loops even though the aggregate
     "object properties" case was not slower.
5. **FORCE threshold 0 changes whole-browser behaviour.**
   - Every chrome script gets a JitScript/ICs on first execution.
   - This adds memory and GC churn and slows startup, rather than benchmark
     throughput. It is visible as launch-time or memory differences, not per-case
     numbers.
6. **Dispatch shape and function size (br_table, locals).** Almost equal in both
   builds, so very unlikely to be differential. Listed only to close it.
7. **fpcast-emu.** Ruled out as a differential by the static count above.

## Packet 3b: cheapest deciding measurement (about 20 minutes)

This is an automated, interleaved A/B on the exact matched pair above: baseline
`fa0217b54d99` (`6c7fad94`) vs PBL `test-pbl-6febc628d9f6f796`, with the same
kernel and plain rootfs. There is no rebuild. The only new files are one fixture
and one runner.

### Storage and ports

```sh
T=/mnt/p6/build/guest-jit-pbl-bench-20260930
mkdir -p $T/tmp && findmnt -no FSTYPE -T $T   # must be ext4/xfs/btrfs, not tmpfs
export TMPDIR=$T/tmp TMP=$T/tmp TEMP=$T/tmp
```

Ports: HTTP 4201, CDP 9411. Check that both are free first. Ports 4197-4199 and
9407-9409 belong to other packets. Never touch PIDs you did not start.

### Fixture: `web/linux/tests/guest-jit-pbl-bench.html`

Copy the timing harness of `guest-js-benchmark.html`: batches of 100 reps,
`performance.now()`, a checksum per case.

- Split the cases so each hypothesis has its own signal:

  | Case | Code | Hypothesis |
  |---|---|---|
  | `int-loop` | `for (i<40000) sum=(sum+i)\|0` | H3, pure dispatch |
  | `call-recursion` | `fib(12)`, no throw | Call fast path |
  | `throw-flat` | 200 x `try{throw 1}catch{}` in one frame | H2, unwinder only, no Error/stack capture |
  | `throw-deep` | 100 x throw `1` at depth 5, caught at top | H2, frames |
  | `throw-error` | original `f(5)` Error case | continuity with 09-26 |
  | `prop-mono` | 4000 x `o.x = o.x + 1` on one shape | H4, non-hybrid GetProp/SetProp |
  | `native-call` | 4000 x `Math.max(a,i)` | native `call_indirect`/fpcast control, expect equal |
  | `json` | unchanged original case | continuity |

- Protocol per page load:
  - Settle for 15 s.
  - Then 8 warmup batches and 11 timed samples per case.
  - Repeat the whole case list 3 times inside the page, to measure in-boot variance.
- When done, the page calls `console.log('PBLBENCH ' + JSON.stringify(report))`.
  The report holds label, per-case samples, checksums and `navigator.hardwareConcurrency`.
  There is no download and no button.
- It auto-runs when loaded with `?label=X`.

### Runner: `tools/guest-rootfs/test-firefox-pbl-bench.mjs OUT`

Derive it from `test-firefox-gpu-check.mjs`, which already has the pieces:

- disk-backed TMPDIR check (change its task root to `$T`)
- an in-process server variant serving a chosen manifest and archive
- seeding the persistent home on the seed page before boot
- reading `console.log` verdicts from guest stdout

Differences from that runner:

- Do not use the NVIDIA/headful recipe; headless Chromium is fine for CPU-bound JS.
- Keep the outer settings identical for all boots: 4096 MiB, 2 CPUs, 1280x720,
  canvas2d, one outer Chromium binary, the same host.
- Before each boot:
  - Serve the arm's manifest.
  - Clear the saved system selection.
  - Seed the arm's `admin/.mozilla/firefox/http1-profile/user.js`, clearing the
    old one first, with:
    - `devtools.console.stdout.content=true`
    - `datareporting.policy.firstRunURL=""`
    - `browser.aboutwelcome.enabled=false`
  - Put the fixture into `admin/Downloads/guest-jit-pbl-bench.html`.
- Both archives still carry the pre-v7 init, which forces a Bing CLI URL.
  - After `starting /bin/firefox as admin` plus 20 s, navigate with real input:
    click the address bar, Ctrl+A, type
    `file:///home/admin/Downloads/guest-jit-pbl-bench.html?label=<arm>-<n>`, Enter.
    This is the proven sequence in `probes/firefox-live-acceptance.mjs`.
  - If the server variant proxies DNS/TCP, stub it to refuse so the Bing load
    fails fast. It must be identical in both arms.
- Boot order: **A B B A A B** (6 cold boots, fresh outer profile each), then wait
  for `PBLBENCH` in guest logs (deadline 6 min per boot).
- Record for every boot:
  - `starting /bin/firefox` elapsed time (a secondary H5 signal)
  - the raw guest log
  - a screenshot on failure
- Write `OUT/result.json` with per-arm samples and a verdict per case.
- Afterwards, verify both archives and manifests are byte-unchanged (SHA-256 before/after).
- Close only the Chromium and server that the runner started.

Budget: about 6 x (boot + launch about 1 min, settle 35 s, benchmark about 1 min)
≈ 16 min, plus setup.

```sh
cd /mnt/p6/project/linux/linuxonweb
node tools/guest-rootfs/test-firefox-pbl-bench.mjs $T/run1 \
  > $T/run1.log 2>&1
```

### Pass criteria

1. **Harness passes.**
   - All 6 boots emit `PBLBENCH`.
   - Every case checksum is identical across all boots and both arms.
   - Inputs are unchanged, and no outer exceptions occur.
2. **Noise is bounded.**
   - For each case, per-boot medians within an arm have a relative spread
     (max/min) of at most 1.10.
   - If not, report the case as "noise-bound" and do not classify it.
3. **Classification per case.** Let the ratio be median(PBL boot medians) /
   median(baseline boot medians).
   - "PBL slower": ratio ≥ 1.10 **and** min(PBL boot medians) > max(baseline boot
     medians).
   - "PBL faster": the symmetric condition.
   - Otherwise "equal within noise".
4. **Hypothesis decisions.**
   - H1 (noise) confirmed if `int-loop`, `prop-mono` and `json` are all equal
     within noise.
   - H2 confirmed if `throw-flat` or `throw-deep` is "PBL slower" while
     `call-recursion` is not.
   - H3 supported if `int-loop` is "PBL slower". The next step is then a rebuild
     that compiles `DEBUG_CHECK` out: a guest adapter define, not an upstream edit
     beyond a one-line `#if` hook.
   - H4 supported if `prop-mono` is "PBL slower" while `int-loop` is equal.
   - The fpcast control is valid only if `native-call` is equal within noise.
     Otherwise stop and investigate the harness.
   - H5: report the launch-time delta across 3+3 boots with no verdict unless
     every PBL boot is slower than every baseline boot.
5. **Go/no-go for JIT packet 4.**
   - If H1 holds, or only H2 is confirmed, PBL is an acceptable substrate, and the
     earlier rejection should be recorded as not reproduced.
   - If H3 or H4 is confirmed, packet 4 first removes that overhead in the
     specializer's generated code path. That code path has no per-op dispatch or
     `DEBUG_CHECK`, so it helps either way.

### Deferred (not 3b)

- Packet 3c: relink xpcshell against both `libjs_static.a` files for
  browser-free microbenchmarks. It needs GRE/omni setup, so only do it if 3b is
  noise-bound.
- A `__wasi__`-equivalent build define that drops `DEBUG_CHECK` and the LoopHead
  interrupt poll. This needs a `libjs` rebuild and relink.
