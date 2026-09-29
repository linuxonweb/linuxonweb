# Guest JIT packet 2: Firefox module prep (2026-09-28)

Implements packet 2 of `docs/guest-jit-design-20260928.md`: the Firefox wasm
function table becomes growable by a post-link splice, the stack-pointer plan is
fixed with evidence from the actual module, and the uniform fpcast ABI for
installed code is proven in the real guest. This is preparation only.
SpiderMonkey is unchanged and still `--disable-jit`. No JIT is running in Firefox.
Nothing is promoted into `web/linux` or `web/sites`.

Compact evidence: `docs/evidence/guest-jit-20260928/firefox-prep.json`.
Task root: `/mnt/p6/build/guest-jit-ffprep-20260928` (ext4, all scratch there).

## 1. Growable table by post-link splice

Tool: `tools/guest-rootfs/package-firefox-jit-table.py --source ARCHIVE
--manifest MANIFEST --output NEW_DIR`. It follows the pinned pattern of
`package-firefox-devtools.py`: it checks the source archive, manifest and member
hashes, then rewrites only the Table section of `opt/firefox/firefox`:

| | bytes at offset 526204 | limits |
|---|---|---|
| before | `04 09 01 70 01 bbed0a bbed0a` | min = max = 177851 |
| after | `04 06 01 70 00 bbed0a` | min 177851, no max (what `wasm-ld --growable-table` emits) |

The module shrinks by 3 bytes. The output equals `prefix + new section + suffix`.
The table was already exported as `__indirect_function_table`, so no export was
added. `wasm-validate --enable-all` passes. `call_indirect` bounds checks use the
dynamic length, which stays 177851 until the runtime grows the table.

Note: the design doc's 174179 came from an older deployed binary. The current
module (identical in v9 `29331a186e50` and in `b21b2cac65a3`) has 177851.

Candidate `candidate-run1`, version **`a9438150f676`**:
`initramfs-firefox.cpio.gz` is 88,378,858 bytes, SHA-256
`557019a9b425f483588f3ea5f715150a7e9f1b16744bec2a14343fe44e7f3cf3`. Its
manifest SHA-256 is `e9f35b8a...745e`. Module after: 157,421,034 bytes, SHA-256
`ffcfcbf3...efa7`. Before: `644ab48f...610f`.

**Base image:** `b21b2cac65a3` (DevTools fix, promoted in `ee20f16`, archive
`d3d9afca...002b`). The snapshot in `src-snapshot/` is byte-equal to the current
`web/linux` archive. No rebase was needed. An independent audit
(`verify-run1/audit.json`) checks all 11,470 CPIO records. Order and the archive
tail are equal. Only `opt/firefox/firefox` differs, and only in its filesize
header field. Module bytes differ only inside the Table section. The manifest
changes only `version` and the Firefox `bytes`/`sha256`.

## 2. Stack-pointer decision: option (c)

**Generated code never touches the C shadow stack pointer.** It keeps scratch
state in wasm locals and reads and writes PBL BaselineFrames on the auxiliary
stack in linear memory, through a frame pointer it receives as an argument.
Anything that needs C stack space is a helper call through the table.

Evidence from the actual module (`scripts/sp_scan.py`, `inspect2/sp-scan.json`):

- `global[0]` is `i32 mutable`, init 16777216 (the shadow stack pointer). It is
  neither exported nor imported, and it is per Instance, so per thread. The
  module has no name section.
- 124,075 of 513,810 functions start with `global.get 0` (the SP prologue).
- All 177,848 static table entries are straight-line fpcast thunks: they convert
  the parameters and make one direct call. None touches any global. A
  `call_indirect` from installed code therefore lands in a thunk. The thunk
  calls the real function, which runs in the thread's own Firefox Instance and
  saves and restores its own `global[0]`.

Guest proof that this works: a C callee that uses the shadow stack
(`stack_user`, with a buffer and `snprintf`) is reached through an installed
trampoline. It records the same frame address as a direct call, and the
caller's guard bytes stay intact. 2000 iterations pass, as does
JIT->C->JIT reentry at depth 50.

Rejected alternatives:
- (a) Relinking with SP exported would need a rebuild.
- (a') A splice-exported `global[0]` would be possible, but `guest-jit.js`
  would then have to supply a per-thread mutable-global import. It currently
  rejects that, on purpose. No need for it has been shown.
- (b) An SP cell in linear memory adds C helper maintenance.

## 3. Uniform-ABI helper test

### Real guest (fpcast-ABI C program)

`web/linux/tests/guest-jit-fpcast/` holds `jit-fpcast-test.c`, `build.py`,
`run-guest.mjs` and `index.html`. The program is post-processed with the same
Binaryen pass as Firefox: `wasm-opt --fpcast-emu --pass-arg=max-func-params@23`.
All 13 table entries then have type `(23 x i64) -> i64`. Installed modules
declare only that type.

Test coverage:
- An installed trampoline calls existing C table entries, forwarding i32, f64,
  i64 and f32 values, 20 arguments and a void callee.
- The shadow-stack checks from section 2.
- C calls installed functions directly: 2 args, 3 args (zero padding) and 22
  args.
- JIT->JIT calls, `jit_free`, and a microbenchmark.

Build `fpcast-build-run2`: 40,199 bytes, SHA-256 `9e2c32dd...629d`. The test
archive modifies only `/init`, adds `bin/guest-jit-fpcast-test`, and leaves
3,846 records unchanged.

**`fpcast-guest-run2`: 24 passed, 0 failed, guest exit 0.** Kernel markers show
1 GiB and 2 CPUs. Browser exit was 0, the server closed, and there were no
Runtime exceptions. Microbenchmark, 2e6 calls to `mix3`: direct 18.3-21.0
ns/call, via the installed trampoline 25.6-26.0 ns/call.

### Actual Firefox module (host V8)

`firefox-table-check.mjs` (`host-check/run2`, 11/11 pass) instantiates the real
spliced Firefox bytes in Node v22. The start function only initializes memory.
It uses the unmodified `web/linux/dist/guest-jit.js` install path. Results:

- The install returns 0 at index 177851, and the table grows to 177852.
- An installed `(23 x i64) -> i64` trampoline forwards to 881 existing pure-leaf
  Firefox table entries (fpcast thunk -> i32 leaf). All 3,524 results match an
  independent interpreter.
- Null and out-of-range slots trap, and free nulls the slot.
- The unspliced module refuses with `-ENOMEM` and keeps its length.

### What was not proven

`jit_install` was not called from inside a running guest Firefox. Nothing in
Firefox calls it without a SpiderMonkey change, and a host-side injection into
the Firefox Worker is not possible because the Worker never yields to its event
loop. The in-Firefox install path consists of the same `guest-jit.js`
per-Instance replay (proven in packet 1 and in the fpcast guest test) plus this
module's growable table (proven on the actual bytes in V8). The combination
inside the live Firefox process remains unexecuted until packet 5 adds a caller.

## 4. Firefox regression on the spliced image

These runs used `test-firefox-session-startup.mjs` under
`/mnt/p6/build/firefox-homepage-20260926`, with 4 GiB and 2 CPUs. Their input
hashes show candidate-run1's archive and manifest.

- `jit2-startup-run1` (served `a9438150f676`): cold and warm pass. Real typed
  input and a downloaded JS checksum (7998000) pass. Home and `user.js` are
  preserved. The warm boot makes 0 image requests. Launch log 10.4 s cold and
  7.3 s warm. These are not first paint and not a benchmark. The screenshot
  shows the fixture page rendered with its typed echo.
- `jit2-update-run1`: baseline `b21b2cac65a3` passes, then update and restart
  to `a9438150f676` passes. It makes 0 image requests and preserves the prior
  download.

Both runs had 0 errors, browser exit 0 and a closed server. The candidate has
not changed since, so they were not rerun.

## Failed runs (preserved)

- `fpcast-guest-run1`: 23 passed, 1 failed. This was a test bug: the expected
  value for `stack_user` was inverted (odd strings end in `d` and return +1).
  The ABI, frame-address and guard checks in the same run all passed. The C
  expectation was fixed, and run2 passes.

## Limitations

- There is no in-Firefox `jit_install`, no SpiderMonkey helper calls with real
  JSContext or frames, and no JIT speedup.
- There is no matched benchmark of `call_indirect` cost with a maximum-less
  table in Firefox. Startup launch logs show no regression, but they are not a
  measurement.
- Each Firefox thread grows its own 177851-entry table lazily on first replay.
  The cost of that with many threads is unmeasured.
- The regression gate was local only. There was no public or Sites deployment
  and no promotion.

Self-score: **80/100**. Splice, candidate, independent audit, SP decision with
module evidence, real-guest fpcast ABI test and Firefox regression are done.
The in-process Firefox install is proven only on the actual module bytes in
host V8, not in the running guest Firefox.
