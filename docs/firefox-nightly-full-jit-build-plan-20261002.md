# Full Nightly PBL/JIT build transition — updated 2026-10-03

This packet specifies the next full PBL/JIT build; it is not JIT acceptance.
The baseline owner is running Run57, unified session 75670/owned PGID 710076,
after the actual native loader/fatal gate passed 25/0. Reinspect that exact handle before
transitioning. No full PBL/JIT browser build or deployment has started.
Planning evidence lives in
`/mnt/p6/build/firefox-nightly-full-jit-build-plan-20261002`, with disk-backed
TMPDIR/TMP/TEMP, a 2 GiB planning cap and a 20 GiB free-space reserve.

Finish and accept the PBL-disabled full Nightly baseline first. Then build the
PBL/JIT browser in a separate full-build task, using a copied immutable accepted
source snapshot and a fresh object tree. Preserve the original baseline source,
objects, runtime, archive, profiles, logs and acceptance packet. Do not relink
the old128 archive or change the active recovery recipe during its owner's run.
Public Sites v10 remains Firefox128 until accepted Nightly JIT is ready; the
two releases are already authorized in
`docs/firefox-nightly-sites-release-plan-20261002.md`.

The pinned source is Nightly159.0a1, official reference BuildID20261002211853,
Hg dfc77f7a6d716f1a20a2576597638d4fc21cd916, Git mirror
bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23. Pin the completed baseline's actual
local BuildID separately. The acquisition proof establishes the reviewed overlay
and canonical source pairs, not whole-tree Hg/Git equality. The accepted
source must retain the cc-rs native C++ runtime selection, its matching Cargo
checksum, the NSS disabled-FIPS signature correction, and the NSPR static
loader/native fatal-trap corrections. The latter passed the actual guest
lifecycle/fatal unit gate; Run57 browser startup is still pending.

1. **Freeze the accepted baseline and choose storage.** Retain hashes of the
   accepted recipe, source inventory, target JSON, generated configuration,
   compiler/link commands, complete runtime inventory, raw/final binaries,
   package and guest evidence. Obtain source-copy input only after the owner has
   stopped mutating it. Capture before/after inventories so a copy cannot mix
   two build corrections. An accepted complete baseline needs actual successful
   full build/link, full runtime packaging, native Wasm validation, startup,
   current NSS/TLS, saved-home and default-page gates; diagnostic objects alone
   are insufficient.

   Use `/mnt/p6/build/firefox-nightly-musl-jit-full-20261002` for the next full
   build, with the authorized 32 GiB task cap and 20 GiB free reserve. Use j4
   for the object-only graph, then j1 for the ordinary full build and original
   automatic Binaryen `-O2`. Both use finite 7200-second phases, inherited
   64 GiB address space, 48 GiB group RSS, 2 GiB available-RAM floor, core0
   and oom_score_adj1000. Preflight still requires 4 GiB available RAM and
   available RAM plus free swap at least 66 GiB. Count source, objects, caches,
   temporary files, post-link outputs and copied artifacts together. This is a separate
   task boundary, not permission to enlarge the original recovery task or the
   planning packet. The next owner must record the policy before allocating.

   `snapshot-run1.json` is a changing-tree size observation, not an estimate of
   the completed binary/build. Its measured allocations are:

   | Item | Bytes | GiB |
   | --- | ---: | ---: |
   | Recovery task | 10,335,186,944 | 9.625 |
   | Source | 5,185,167,360 | 4.829 |
   | Incomplete objects | 4,968,816,640 | 4.628 |
   | Target Rust subtree | 3,367,931,904 | 3.137 |
   | Host release subtree | 773,025,792 | 0.720 |
   | Recovery cache | 163,008,512 | 0.152 |
   | Metadata task | 16,728,064 | 0.016 |
   | Available disk | 83,663,855,616 | 77.918 |

   Those observations describe an unfinished older build, not the eventual
   no-debug/PBL footprint. Recompute from the completed accepted baseline and
   account for source, fresh Rust/C++ outputs, caches, link/optimization/fpcast
   temporaries and complete packaging under the current 32 GiB boundary. Do not
   delete or overwrite the baseline to make room. The historical 20 GiB cap
   does not control the selected new build; the 20 GiB free reserve still does.

   ext4 was observed. Do not assume reflinks work. A plain independent source
   copy costs the measured source allocation and is preferred. A verified
   reflink can reduce allocated bytes while preserving isolation, but requires
   independent-write and allocation evidence. Shared writable hardlinks are
   excluded. Sharing the mutable source with the baseline or deleting baseline
   objects to make room violates preservation. Stop at the allowance/reserve
   boundary and report actual sizes and the remaining operation before any
   enlargement. The current evidence does not establish that enlargement is
   needed.

2. **Rebase the recipe and apply only the prepared JIT changes.** Copy the final
   accepted musl source, including every owned architecture/libc/static/NSS/
   wgpu correction and vendored Cargo checksum update, before applying JIT.
   Do not replay old overlays onto a newer corrected file. Re-run
   `tools/nightly-jit-prep/prepare.py --coverage broad` against this accepted
   copy, into a fresh output. The broader preparation and native diagnostic
   compile now pass; see `docs/firefox-nightly-jit-broad-20261003.md`.
   Compare its baseline input hashes to selected
   `/mnt/p6/build/firefox-nightly-jit-musl-prep-20261002/overlay-broad-run1/manifest.json`;
   review changed anchors rather than blindly copying an obsolete full file.
   Replay the 1,969-assertion broad host preparation against the selected new
   packet. Retain the 972-assertion integer control and its separate overlay.

   Copy the six accepted native archives independently, preserving their
   relative task paths; no mutable hardlinks or CMake build trees. The current
   archive inventory is in `/mnt/p6/project/build/nightly-jit-transition-review-20261003/README.txt`.
   Retain `CXXSTDLIB_wasm32_unknown_linux_musl=c++`; rebase
   `WASM_MUSL_CXX_RUNTIME_LIBDIR` to the new task's native-unwind archive root.
   Verify actual Cargo native helper links and archive member hashes against
   these libraries, with no legacy C++ ABI runtime. The explicit-source replay
   script `tools/nightly-musl/recipe/native-static-loader-port.py` admits the
   accepted patched bytes idempotently; preserve its patch and original backup
   provenance. Do not replay an obsolete whole-file overlay over these fixes.

   Copy the final accepted recipe, then rebase *every* recovery-root reference
   in the new recipe/source `.mozconfig`: environment, run-phase root/log/status,
   rustc target/log paths, Cargo log paths, wrappers, shims, mozbuild state,
   Cargo home, Python/cache paths, TMPDIR/TMP/TEMP, and MOZ_OBJDIR. The current
   cargo/rustc wrappers write to recovery logs; copying them unchanged would
   mutate the baseline. Do not execute copied patch helpers: their hardcoded
   paths also target recovery and the accepted source already contains patches.
   Audit references before running configure. Read-only source identity links
   in provenance are allowed; writable compiler/object/log/cache destinations
   must point only to the new task.

   Add `ac_add_options --disable-debug-symbols` alongside `--disable-debug`
   in the fresh shipping configuration. The latter disables debug assertions
   but leaves DWARF enabled by default. Use the updated repository native
   `defs.mk` adapter's browser-program-only `--strip-debug` flag so prebuilt
   dependency archive DWARF is removed by wasm-ld before the unchanged
   automatic Binaryen `-O2`. Keep the accepted baseline's active recipe and
   object tree intact. Verify generated `MOZ_DEBUG_SYMBOLS` is absent/false,
   Rust default flags omit `debuginfo=2` and `strip=none`, and actual C/C++,
   Cargo C/C++ and rustc commands contain no DWARF-generating flags. Retain
   optimized code, native Wasm exceptions and frame-pointer behavior. Details
   and real small-module checks are in
   `docs/firefox-nightly-no-debug-symbols-20261003.md`.

   Keep `--disable-jit` (which selects JS_CODEGEN_NONE). Add
   `ac_add_options --enable-portable-baseline-interp`; omit FORCE, simulator and
   AOT-IC options. Add the prepared standalone PblJit.cpp to the native Wasm PBL
   `SOURCES` list in current `js/src/vm/moz.build`, under the existing
   ENABLE_PORTABLE_BASELINE_INTERP condition. PortableBaselineInterpret.cpp is
   already a standalone SOURCES member there. Keep PblJit.cpp non-unified to
   avoid anonymous namespace collisions; assert exactly one adapter archive
   member at link. Apply the prepared PortableBaselineInterpret.cpp, Jit.cpp
   and XPCJSContext.cpp changes in their source locations. The latter compiles
   through actual `Unified_cpp_js_xpconnect_src0.o`; do not invent a standalone
   XPC object target.

   The browser setter enables PBL at warmup10 and disables it in Safe Mode;
   upstream PBL configuration alone defaults the runtime option to false.
   Specialization starts after1000 loop heads and honors `PBLJIT=0` separately;
   that environment variable disables the specializer, not the PBL tier.
   Keep the generated239 opcodes and original broad compiler rejection paths.
   Arguments, doubles, lexical/TDZ checks, arrays, monomorphic properties,
   guarded globals and supported Math operations belong to this full-build
   candidate. Arbitrary helper calls remain fallback. The explicit42-operation
   integer whitelist belongs only to the separate safety/control overlay.

3. **Configure and build the complete PBL graph from fresh objects.** Do not
   preinclude a copied header that merely defines PBL. Configuration changes
   `JSRuntime` layout (`portableBaselineStack_`), `DefaultJitOptions` layout,
   BaselineFrame inline behavior, IC/JitCode handling and CacheIR argument
   guards. `snapshot-run1.json` records hashes for22 conditional source/header
   inputs, including Runtime.h, Stack.h, JSContext.h, JitOptions.h,
   BaselineFrame.h, BaselineIC.h and CacheIRWriter.h. Browser translation units
   using those headers also need the same generated configuration. A three-
   or four-object replacement in baseline archives is not an ODR-safe transition.

   After the rebased recipe exists, the finite phase sequence is:

   ```bash
   python3 -B /mnt/p6/build/firefox-nightly-musl-jit-full-20261002/recipe/run-phase.py configure pbl-run1
   python3 -B /mnt/p6/build/firefox-nightly-musl-jit-full-20261002/recipe/run-phase.py pre-export pbl-run1
   python3 -B /mnt/p6/build/firefox-nightly-musl-jit-full-20261002/recipe/run-phase.py export pbl-run1
   python3 -B /mnt/p6/build/firefox-nightly-musl-jit-full-20261002/recipe/run-phase.py mfbt pbl-run1
   export NIGHTLY_BUILD_TIMEOUT_SECONDS=7200 NIGHTLY_ADDRESS_SPACE_GIB=64 NIGHTLY_RESIDENT_MEMORY_GIB=48
   NIGHTLY_OBJECTS_ONLY=1 NIGHTLY_JOBS=4 python3 -B /mnt/p6/build/firefox-nightly-musl-jit-full-20261002/recipe/run-phase.py build pbl-objects-run1
   # After object-stage owner reap/group-empty proof:
   unset NIGHTLY_OBJECTS_ONLY
   NIGHTLY_JOBS=1 python3 -B /mnt/p6/build/firefox-nightly-musl-jit-full-20261002/recipe/run-phase.py build pbl-full-run1
   ```

   Inspect each result before the next phase; continuation builds receive fresh
   evidence names. The accepted runner monitors allocation/reserve and owns a
   process group; preserve bounded interruption logs. Freeze both config.status
   values and generated headers proving wasm32/Linux/musl, JS_NUNBOX32,
   JS_CODEGEN_NONE, ENABLE_PORTABLE_BASELINE_INTERP, absent FORCE, real pthreads
   and no WASI. ENABLE_INTERRUPT_CHECKS and ENABLE_COVERAGE are local defines
   in current PortableBaselineInterpret.cpp, selected by absence of __wasi__;
   inspect the actual preprocessed translation unit, not mozilla-config alone.

   Capture actual expanded compiler and final linker argv while response files
   still exist: PblJit, PBL, Jit's real unified unit, XPC's real unified unit,
   one guest Cargo C++ helper and one host shader tool. Require native Wasm
   EH on exception-enabled target units and WebAssembly C++ ABI selection;
   host tools must retain their host configuration. Record final
   archive membership, target pointer/Value/tag assertions and source/input
   hashes. Build the full browser/runtime; the old128 incremental
   `tools/build-firefox-pbl-jit.py` is reference logic only.

   Safe reuse: immutable compiler/sysroot/Nix inputs and verified downloaded
   package bytes; copy any writable download cache into the new task. Start
   object/backend/generated-header/dependency/Cargo target state fresh. Do not
   seed baseline or diagnostic Rust archives, compiled Cargo trees or object
   members. Accepted runtime primitive archives are the explicit six-library
   exception above; browser/Rust generated outputs are rebuilt for this source
   and PBL configuration. Reusing verified download bytes does not admit old
   build-script outputs. No Firefox128 object is eligible.

4. **Derive the actual linked Wasm contract, then fpcast and package.**
   Use tools/nightly-jit-prep/inspect-wasm.py on the actual raw Firefox and its
   later fpcast image (the latter with --require-fpcast). Its actual-helper
   verification is docs/firefox-nightly-wasm-abi-inspector-20261003.md; those
   counts are examples, not the browser ABI. Preserve separate validation.

   Keep raw linked Firefox and complete dist/bin immutable. Inventory imports,
   defined/exported memory/table/globals, limits, element segment offsets,
   target features, type/call_indirect signatures and stack/TLS exports from
   this binary. The accepted native program contract selects an 8 MiB stack
   matching the Rust target, imported shared memory up to 4 GiB, and a growable
   table. Verify the actual newly linked module; old Firefox128 table counts,
   callback ordinals and stack constants must not become predicates.

   Capture exact actual driver/LLD rows for all naturally affected programs
   and NSS helpers. Ordinary Mach logs do not prove absence of signature
   warnings: replay exact current link inputs to diagnostic outputs, reject
   every function-signature mismatch, and retain complete logs. The accepted
   baseline replay has five known inert ELF `-z` warning pairs; the separate
   fatal-warning control removes only those exact pairs and adds
   `--fatal-warnings`, preserving every input and ABI option. Audit current
   native Rust runtime ownership and NSS fallback signatures too.

   Confirm the fresh raw browser has no `.debug_*` custom sections; retain raw
   bytes and a separately named packaging copy. The accepted baseline and new
   full graph must already omit debug information; do not substitute post-build
   stripping for that requirement. Apply
   the current Binaryen23-slot transform, with complete command/log hashes:

   ```bash
   wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu RAW_COPY -o FPCAST_COPY
   wasm-validate --enable-all FINAL_COPY
   ```

   These three paths stand for fresh measured files under the full-build task;
   do not feed an already fpcast-transformed image through the pass again.
   Prove the post-transform static table entries use `(23 x i64) -> i64` and
   the adapter's actual five-pointer-to-i64 C indirect call pads/converts into
   that ABI. Derive the needed bound from all actual indirect call signatures;
   if23 cannot represent this Nightly module, stop and revise worker dispatch,
   emitter, fpcast setting, packager evidence and probes together. A validator
   success alone cannot establish C function-pointer interoperability.

   Exported `__indirect_function_table` must be one funcref table. Prefer an
   audited full-link growable-table flag; otherwise adapt the historical
   byte parser into an owned post-link operation that retains the *measured*
   minimum and removes only a finite maximum. If already growable, record that
   fact. Verify unchanged static elements/index identities and changed bytes,
   then validate the final image. Current emitter imports only env.table and
   env.memory; shared i32 memory import has min1/max65536 pages. Prove actual
   process memory satisfies those limits and remains shared. Runtime accepts
   only that shared memory, funcref table and optional immutable i32
   env.__jit_table_base; no function/tag import, start function, defined memory
   or active data/element segment is allowed in installed modules. Exports are
   consecutive f0..fN-1. The integer emitter exports f0 with23 i64 arguments
   and i64 result, with no global import or shadow-stack access.

   Derive actual frame/Value/interrupt offsets from this configured target,
   inspect the generated call and confirm out storage is sp:u32 at0,
   pcDelta:i32 at4 and icIndex:u32 at8. PBL must restore both its local IC cursor
   and frame->interpreterICEntry(); offsets and opcode numbers come from current
   headers, never old golden files. Generated integer code keeps scratch in
   Wasm locals, touches boxed frame/operand slots through provided pointers,
   and atomically polls interrupt bits at every backedge. It does not import
   mutable __stack_pointer. Any later helper-call expansion requires new ABI
   evidence before admission.

   Use `tools/guest-rootfs/package-firefox-nightly.py` and its documented
   inventory/build-evidence schema with the *new* source/object/runtime roots
   and actual local BuildID. Bind successful full-build, fpcast, final validator
   logs and raw/final hashes. Replace all opt/firefox resources together,
   preserve outside encoded records, then apply the default GPU-page overlay
   with explicit candidate archive/manifest hashes. The binary-only old128
   packager is not a full upgrade. Packaging has its own existing2 GiB boundary;
   check projected complete runtime/archive size rather than assuming it fits.
   Baseline and JIT arms need the same homepage/managed defaults. The first
   milestone may honestly report unsupported GPU; that is not GPU acceptance.

5. **Migrate and run actual guest gates, in finite packets.** Existing host972
   tests/mock layouts and isolated C++ objects are preparatory. Save kernel SMP
   logs immediately on every cold/update/warm boot, before JIT logs can evict
   them. Record nproc, browser hardwareConcurrency, selected/requested CPUs and
   actual kernel CPU count; reject disagreement and require equal counts across
   comparative arms. Historical8 remains unchanged. One planning execution
   observed nproc6; the follow-up CPU-only observation reports affinity0-7,
   no OMP overrides, nproc8 and nproc--all8. Its cause is unestablished, so do
   not hardcode either observation or excuse a mismatch.

   | Finite gate | Actual evidence required |
   | --- | --- |
   | Native primitive/fpcast | Rebuild the current native-musl C fixtures with the same compiler/fpcast tool; adapt their historical task/output routes and hardcoded2-CPU runners before invocation. Install/call/free through real private syscalls0x6a490001/2, sync0x6a490003 and stats0x6a490004. Preserve negative import/limits/start/segment/free tests. |
   | In-Firefox broad admission | Generate the separate broad fixture with `tools/nightly-jit-safety/generate.mjs OUT LABEL broad`. Require actual source-specific install followed by Normal run for all fourteen admitted cases in both main and Worker: integers/branches, arguments and argument writes, doubles/division, lexical locals, dense array reads/writes/length, monomorphic property reads/writes and Math.abs/Math.max. Check raw logs with `check.py --scope broad`. Exact results alone cannot prove compilation. UA alone is not a build identity: bind application/platform/local BuildID, archive and runtime manifest too. |
   | Bailout/restore and fallback | Overflow, negative zero, modulo edge cases, type changes, branch/stack restoration and partial-work exits agree with interpreter results, with actual installed-function Bail evidence. The broad fixture retains string-change/arbitrary-call fallback and Finally/Throw policy rejection; none can claim compilation. Confirm no repeated hot rejection/incorrect IC cursor. Add actual array bounds/type and object shape/GC mutation guards before full acceptance; the initial broad fixture does not cover them. |
   | Cache/GC | Same shared bytecode in different scripts/globals remains separate; fresh unique integer helpers compile once before mutations. Force a major GC through actual privileged Cu.forceGC/forceShrinkingGC and observe epoch advance plus eviction/recompile. Actual incremental-GC skip needs a privileged verified driver/diagnostic showing GC active and no entry. Allocation pressure or elapsed time is insufficient. |
   | Debugger/coverage | Attach the actual guest debugger, break/step the target integer loop, verify local values/results and no specializer entry while the frame isDebuggee. Separately use current Debugger.collectCoverageInfo/getOffsetsCoverage or real LCOV mode to establish script counts, nonzero coverage and no entry. Test attachment to a previously compiled loop as well as fresh code. Plain console opening does not prove debugging/coverage. |
   | Cancellation | First prove a no-argument integer infinite loop compiled; invoke an actual browser stop/slow-script interruption from outside the blocked page. Require a bounded interrupt exit, control restored and a subsequent page calculation in the same Firefox process. Worker.terminate or killing the guest is cleanup, not proof of interrupt handling. |
   | Two threads/TLS/stack | Use current C primitive's pthread replay/install/free tests, extend fpcast C calls with per-thread TLS/errno and stack canaries, barriers and calls before/after sync. Run both main-thread and actual Firefox Worker loops; record distinct thread identity/TLS cache and coherent process table replay. JIT->C stack/TLS/syscall->JIT callbacks in a native probe must preserve C stack canaries/errno. Two sequential pages are not two threads. |
   | Browser regression/TLS | Cold/warm and profile-preserving v10-to-Nightly update, typed input/download, default version/GPU page, DevTools console/eval/inspector, current-root TLS positive/negative cases, saved user trust and home markers. Require actual HTTPS content, not raw TCP success or preserved119-root seed count. Save profile copies before update and cleanly close every owned browser/server. |

   Minimal runner changes: parameterize candidate/source version expectations,
   current complete runtime/BuildID and package identity; replace stale128 or
   Empty-HAL predicates with measured phase-specific outcomes; use current
   CPU helpers independently at each boot. `test-firefox-pbl-bench.mjs` already
   accepts PBLBENCH_TASK/ARMS/FIXTURE and saves startup SMP evidence; keep that
   logic. Its readiness accepts any Firefox UA, so add exact guest Nightly
   build evidence. The new safety tools have separate integer and broad modes.
   The integer control retains its historical nineteen cases and fallback claims;
   it cannot establish the selected239-opcode broad browser's admission. The
   broad fixture has twenty-five cases in each context, and its checker rejects
   missing/duplicate cases or lowered claims. Generate and retain each mode in
   a fresh directory; do not apply integer exclusion requirements to the broad
   browser. Keep historical safety results unchanged.
   Session-startup assumes pkg.sourceSha256 equals the baseline arm: bind both
   full packages to the correct source archive or provide independently pinned
   arm fields, rather than rewriting proof metadata to make that check pass.

   Privileged browser-console automation for forced/incremental GC, Debugger
   coverage and cancellation is still to be implemented/verified. Current
   source confirms Cu.forceGC/forceShrinkingGC and Debugger.collectCoverageInfo
   exist; that does not prove an available guest driver. If necessary add an
   owned bounded diagnostic observer for actual entry/skip/interrupt events,
   preserving the no-GC/no-runtime-call hook discipline, then validate the
   shipping candidate itself. A standalone shell can help diagnose but cannot
   replace the in-browser gates.

6. **Freeze comparative acceptance before launching and release only afterward.**
   Primary A is the accepted full Nightly PBL-disabled baseline; B is full
   Nightly PBL/JIT with identical resources/defaults/kernel/plain assets. Run
   ABBAAB, three cold boots per arm, all original eight broad cases
   (int-loop, recursion, flat/deep/error throws, property, Math, JSON), same
   frozen bodies/repetitions/warmups/samples. Retain all144 case rows and raw
   batches, checksums, arm/input hashes, launch/ready time, CPU/SMP, traps and
   cleanup. Each original case's median B/A must be<=1; semantic or cleanup
   failure fails the run. Predeclare any precision confirmation with adequate
   batch duration; never discard inconvenient samples after seeing them.

   Run the selected broad admission fixture and bailout/fallback cases alongside
   the original performance fixture. The original int-loop uses let: require
   its actual compilation evidence under the selected broad coverage. Keep the
   separate no-argument var-local integer control for emitter diagnostics; it
   cannot replace broad acceptance or reduce the original performance cases.
   Optional C is the same B binary with PBLJIT=0, using a verified guest
   environment adapter in a diagnostic comparison; it isolates the specializer
   from PBL policy overhead but does not replace primary A/B acceptance.
   Compare against public v10 with freshly measured same-host-CPU arms as an
   additional release compatibility/performance gate; old2-CPU speedups are
   historical evidence. PBL can change unsupported workloads even though the
   specializer rejects them, so semantic fallback alone does not waive timing
   regressions.

   If the selected broad coverage fails acceptance, fix the affected Nightly
   API/emitter paths and repeat their actual guest gates; do not lower admission
   requirements to make the run pass. Promote only after complete
   original/bounded acceptance and evidence freshness review, then execute
   release1 through the already authorized Sites plan. Accepted Nightly JIT
   becomes GPU rollback baseline. Vulkan/OpenGL/Firefox WebGL/WebGPU work and
   release2 follow it; baseline wgpu backend compilation is not GPU support.

The next executable packet is baseline completion/acceptance by its owner,
followed by the independent source/recipe/PBL-config setup and full build above.
Remaining uncertainties are completed baseline size, PBL full-graph compile/
link blockers, measured Nightly memory/table/fpcast/callback contracts, actual
privileged guest diagnostics, fresh NSS trust initialization and comparative
timings. None is resolved by this planning packet.
