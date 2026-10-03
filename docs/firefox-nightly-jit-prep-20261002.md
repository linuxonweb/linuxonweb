The musl Nightly159 integer JIT preparation is isolated from the running full build. The source overlay matches official build `20261002211853`, Hg `dfc77f7a6d716f1a20a2576597638d4fc21cd916`, Git mirror `bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23`. Acquisition proof establishes the reviewed 198-file overlay and eight canonical Hg/Git pairs; whole-tree Hg/Git identity remains an inference. The old audit's earlier Nightly pin and glibc prerequisite are superseded. No Nightly binary, guest JIT, browser regression or performance acceptance is established by this packet.

The live input is `/mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1`. Output and task TMPDIR/TMP/TEMP stay under `/mnt/p6/build/firefox-nightly-jit-musl-prep-20261002`, capped at 2 GiB for preparation. The generator writes only a fresh output directory and records original input hashes, output hashes and patches. The prior audit/snapshots, existing 128-specific adapter/builder, baseline source/objects, runtime payloads, user processes and deployed Sites v10 are preserved.

| Surface | Latest-source preparation |
| --- | --- |
| PBL hook | `vm/PortableBaselineInterpret.cpp`, after real asynchronous interrupt and coverage handling. Uses `frame->script()` and `ctx.frameMgr.cxForLocalUseOnly()`. Both local `icEntry` and `frame->interpreterICEntry()` are updated on compiled exits. |
| Context discipline | The adapter and emitted loops must not GC, walk the stack or call JS/runtime functions. Allocation uses C malloc; the integer phase has no object/native callback execution. No `__wasi__`, fake pthreads or dropped interrupt checks. |
| Browser enable | Copied `XPCJSContext.cpp` explicitly sets `JSJITCOMPILER_PORTABLE_BASELINE_ENABLE` and warmup threshold10 under native `__wasm__` plus PBL. Safe Mode disables PBL. FORCE/zero-threshold is excluded. Upstream defaults PBL to false despite configuring the tier. |
| Bytecode | All 239 opcode IDs/lengths/specifications regenerate from the current `Opcodes.h`. Loop admission allows exactly 42 symbolic integer/local/branch/typed-stack operations and rejects every other opcode. No old IDs or indirect table ordinals are reused. |
| Integer phase | Live head locals must be Int32; comparisons produce intermediate booleans. Argument access, doubles, lexicals/TDZ, arrays, properties, globals and Math are rejected. Translation has one attempt and never widens to Double. Runtime formal-argument frame reads are deferred. |
| Exceptions | Hot handler/explicit-throw scripts are rejected before the first JitScript allocation, `baselineDisabled()` caches rejection, and the copied `Jit.cpp` returns directly to ordinary interpreter policy. Wider PBL call behavior still needs guest verification. |
| GC/cache | Existing script+PC identity, same-global guard, incremental-GC skip, major-epoch eviction, code-byte recheck and bailout disable bound are preserved. Mock checks call the actual OnLoopHead identity path without installing Wasm. |
| Watchtower | The latest conservative `watchesPropertyValueChange` API replaces removed `watchesPropertyModification` in the dormant broad compiler. Property opcodes cannot enter the integer phase. |
| ABI | Native Wasm compile assertions check pointer4/Value8/tag shift32, existing value tags and JS_CODEGEN_NONE. Musl TLS, heap, syscall and generated callback ABI must still pass executable guest checks. |

The selected packet is `overlay-run4/manifest.json`: 14 preparation checks pass, with 239 source-derived opcodes and 42 allowed operations. `host-run2/result.json` passes **972 assertions, zero failures** using ASan+UBSan and real emitted Wasm modules in Node shared memory. It covers arithmetic/control-flow correctness, full PC/SP/IC and operand restoration, overflow and negative-zero bailout, no-entry mutation safety, interrupt exits, every excluded named opcode and unnamed raw byte, underflow, shared-bytecode script identity, cache collisions, global mismatch, incremental-GC skip and major-GC invalidation. These are host checks with mocked SpiderMonkey layouts. They do not establish the actual Nightly guest frame/callback/TLS ABI.

Historical preparation directories are retained. `overlay-run1` stopped because the first parser omitted NULL opcode spellings. `overlay-run2`/`overlay-run3` are intermediate review snapshots. `host-run1` passed951 checks before the additional cache cases and final single-attempt compiler cleanup; the final selected pair is overlay-run4/host-run2.

To reproduce into fresh directories:

```sh
export TMPDIR=/mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
python3 tools/nightly-jit-prep/prepare.py \
  --source /mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1 \
  --output /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/overlay-replay1
python3 tools/nightly-jit-prep/run-host.py \
  --packet /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/overlay-replay1 \
  --output /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/host-replay1
```

`compile-run1/result.json` passes for the copied **PblJit.cpp, PortableBaselineInterpret.cpp and Jit.cpp** using actual wasm32 musl Clang. Their relocatable Wasm objects are 654,531, 2,558,439 and 319,272 bytes respectively; all have Wasm magic and recorded SHA-256. `compile-xpc-run2/result.json` additionally passes the copied **XPCJSContext.cpp** browser PBL setter in its source-context compile flags, derived from the actual configured unified XPC target. These compile successes expose the latest C++ APIs and enforce the copied adapter's wasm32 pointer/Value/tag assertions. Each compilation retains the existing mfbt unsupported-architecture warning; none reports an error. They do not prove the full configured PBL graph, callback layout after fpcast, link, or runtime.

The first XPC dry-run requested a non-existent standalone `XPCJSContext.o` and stopped before compilation; that failure and its empty output directory remain retained. XPCJSContext is actually registered through `Unified_cpp_js_xpconnect_src0.o`; the second dry-run supplied its genuine include/define context for the isolated standalone diagnostic.

An actual-header diagnostic is also prepared in `compile-diagnostic.py`. The builder supplied the frozen `recipe/environment.sh`, `recipe/mozconfig` and `obj-nightly`; baseline PBL is disabled. Read-only `make -r -n` for `js/src/vm/Unified_cpp_js_src_vm0.o` yielded the diagnostic JS compile argv, saved as `js-vm-command-dry-run1.log`. The helper redirects object/dependency/temp outputs to its own directory and replaces only the preincluded mozilla-config header with a copied header defining ENABLE_PORTABLE_BASELINE_INTERP. It retains the musl compiler wrapper and all baseline flags. This is a diagnostic against baseline generated headers, not a substitute for configuring the PBL tier. The captured actual compiler response is retained beside the diagnostic result; it proves SjLj and the WebAssembly C++ ABI flags survived wrapper expansion.

```sh
source /mnt/p6/build/firefox-nightly-musl-recovery-20261002/recipe/environment.sh
python3 tools/nightly-jit-prep/compile-diagnostic.py \
  --packet /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/overlay-run4 \
  --dry-run /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/js-vm-command-dry-run1.log \
  --objdir /mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly \
  --output /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/compile-replay1
```

After the musl baseline builds and passes its browser gates, configure an isolated PBL build with the accepted recipe plus `--enable-portable-baseline-interp`. Obtain actual PBL/Jit/XPC compile commands and dependencies from that build, expand transient response files before the compiler exits, and compile these overlays with the configured headers. Do not reuse128 objects, archive members, link plans, table minimum177851, ABI offsets or callback ordinals. Fresh configuration must confirm JS_CODEGEN_NONE, JS_NUNBOX32, ENABLE_PORTABLE_BASELINE_INTERP and enabled real interrupt checks; the browser initialization setter must be integrated and rebuilt in its actual PBL-enabled XPC context.

The executable acceptance gate then inspects the new linked Wasm memory/import/table/fpcast contract, installs/calls/frees generated modules in the actual Linux guest, and tests integer results/fallback, cancellation of an infinite loop, GC/debugger/coverage exclusion, two guest threads and syscall/TLS/stack isolation. Follow with cold/warm/profile/TLS/DevTools regression and frozen comparative bounds, preserving every sample. Every new guest run must select the host CPU count, assert agreement between nproc and browser hardwareConcurrency, and record/assert requested and actual kernel CPUs. The current count is eight; all new comparative arms must use the same host count. Broader JIT coverage and GPU work follow these gates in the user's requested order.

The XPC setter diagnostic can be reproduced with the same command, using `--dry-run /mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/xpc-command-dry-run2.log`, a fresh `--output` directory and `--unit js/xpconnect/src/XPCJSContext.cpp`.
