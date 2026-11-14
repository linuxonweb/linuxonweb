# LinuxOnWeb continuation — claude-fable session 2026-11-13/14 (leading status)

Branch claude-fable-linuxonweb-20261113, commits e8c07fc, 1dfe41c, 0ba489e, 0d98b06, 8cda69c on top of be48594. Request: improve I/O and boot, measure Firefox boot, extend the Firefox JIT toward native speed. Neither the30s usable-Firefox target nor near-native JS is met. The historical45/100 status below is unchanged apart from what is stated here; no rescoring was done. Nothing was published to web/desktop/latest-build; production Firefox image is still1a3951f0c48d/4b20a717.

## Boot and I/O (committed, default-on in the working tree served by port3000)

- local-hostname: guest hostname plus /etc/hosts entry; removes a ~10s musl DNS timeout in Firefox profile locking. Opt-out ?local-hostname=0.
- io-cache: IndexedDB linuxonweb.compose memo (kinds scan, extras-raw, extras-gz, extras-pgz) keyed by image sha and extras identity, with GC of other identities. Opt-out ?io-cache=0.
- io-fs: FUSE keepCache + stableReaddir for /home. Opt-out ?io-fs=0.
- Precompressed single-member web/linux/desktop-extras.cpio.gz (18342831 bytes, sha256 1939fee9…d789) pinned in desktop-extras.cpio.json. The .gz is untracked like the raw cpio; regenerate both with tools/guest-rootfs/package-desktop-extras.py --existing-archive web/linux/desktop-extras.cpio --output <dir>/desktop-extras.cpio. Any publication MUST ship the .gz with the manifest.
- Tests: node --test web/linux/io-compose-cache.test.mjs (10 pass); cd tools/guest-rootfs && python3 -m unittest test_gpt6_codex_desktop_extras (8 pass).

Measured in headed Chromium,3 guest CPUs, one shared3CPU cap, about:robots typed into the URL bar, seconds from navigation start; single runs, run-to-run spread about5s:

| run | Firefox window | homepage | robots painted |
|---|---|---|---|
| defaults, new browser profile | 27.1 | 36.2 | 42.5 |
| defaults, warm | 25.1 | 30.1 | 39.4 |
| defaults, warm repeat | 25.1 | 31.1 | 40.5 |
| all three opt-outs, warm | 36.2 | 41.2 | 51.8 |

Warm runs made no network fetches. Warm phases: image ready0.6s, initramfs unpack2.0s, Run /init5.8s, first GL context9.4–10.1s (20.6s with opt-outs). Remaining time is the CPU-bound GL-context→window→homepage phase (~15–20s at ~2.9 cores). V8 flags --no-wasm-tier-up / --no-wasm-lazy-compilation were within noise. Not attempted: startup-cache lifecycle (.purgecaches still present), block-root for Firefox mode, kernel unpack changes.

## JIT (committed source; candidate image NOT published, NOT runtime-accepted)

tools/pbl-jit/PblJit.cpp (0ba489e) now compiles loops over fixed-length Int32Array/Float64Array (exact class guard at entry, per-access bounds check, Int32 stores only), arrays of arrays, Int32 Mul with the −0 check elided only where provably unobservable, and (a±b)|0. Typed-array .length is rejected at compile time (reason "typed length") because it is a redefinable inherited accessor; a review caught the earlier version reading the internal slot. Proper support needs an entry-time shape/proto/getter purity check. Host test2101/2101 under ASan/UBSan: /mnt/p3/codex-build/claude-20261113/jit/scripts/hosttest.sh <OUT> <abs PblJit.cpp> <abs tools/pbl-jit> (absolute paths required; needs the external mock headers).

Guest JS shell, steady ms/call, before → after: typed58–111 → 0.5–3.4; matmul10–31 → 6–7.6; intloop7.4–8.9 → 0.3–0.6 at the top tier. calls61–82, props13–59, strings11–21 unchanged; V8 optimized is0.3–0.8ms on the same cases. Remaining PBLJIT rejects: nested loops, Math natives, string heads, object elements, GetProp.

In-Firefox comparison through the real browser path (benchmark data: URL typed into the guest URL bar, steady ms/call, each column one run, all checksums equal the reference in every run):

| case | published jb-base | published jb-pub-2 | cand5 cold jb-c5-1 | cand5 warm jb-c5-2 |
|---|---|---|---|---|
| intloop | 8.8 | 11.6 | 0.4 | 0.3 |
| typed | 90.8 | 65.6 | 0.5 | 0.4 |
| matmul | 1.8 | 1.8 | 0.3 | 0.4 |
| calls | 74.7 | 61.6 | 60.3 | 66.9 |
| props | 19.8 | 11.5 | 12.3 | 19.1 |

calls and props overlap between builds (published repeats differ by up to ~30%), so only the three loop cases show a change. cand5 booted without logged errors (window27.0/21.8s, homepage35.1/26.9s cold/warm; published repeat23.8/28.9s); the fetched image carried sha 2e79b6c25b58…. This is a narrow microbenchmark plus two boots, not runtime acceptance.

Candidate packages (work dir, not repo): /mnt/p3/codex-build/claude-20261113/jit/cand5/package (built from 0ba489e; gzip sha256 2e79b6c25b58519ad9d7e5c7df37b749c700dfb7dfe71addab3065ac102da827,116031922 bytes; native wasm ebc827970bd8…,208809559 bytes; replaces native 26e380d2… in base1a3951f0c48d). cand4 in the sibling dir predates the .length fix and must never be published. Before any publication run the full release gate plus the original JIT safety workloads on cand5.

Proposed order for real-page speed (estimates, unmeasured): profile which tier Firefox content actually spends time in; rate-based disable plus nested loops; shape-guarded object elements/properties in PBLJIT; direct compiled→compiled calls and small-function inlining (first step likely to move real pages); PBLBC unboxed registers with inline IC fast paths; strings/allocation with GC-safe stack maps.

## Harness (work dir /mnt/p3/codex-build/claude-20261113, disk-backed)

- io/scripts/run.sh <profile> <run> <secs> <url> [--input] boots under the cap and the shared lock runtime.lock; summ.py and robots.py summarize; results in io/runs/<run>.
- In-Firefox JS bench: INPUT_TEXT="$(cat io/scripts/bench-url.txt)" BENCH_WAIT=40 INPUT_KEY_MS=20,30 io/scripts/runbench.sh <profile> <run>240 "<url>" --input; read io/runs/<run>/shots/zbench-*.png. Reference checksums: intloop −313053760, typed5201603248, matmul662400, calls705382704, props197984.
- jit/scripts: compile-objects.sh, link.sh, link-shell.sh, candidate5.sh, package5.py, finish5.sh; jit/bench holds the shell benchmark.
- cand-serve/serve-cand.mjs (3041, cand4) and serve-cand5.mjs (3042, cand5) are loopback test servers; they were stopped at session end.

---

## Continuation after 0d98b06 (2026-11-14, same session; goals still unmet)

Work dirs: calls-diag/ (scripted-call diagnosis and V8 tier runs d2..d5), boot-prof/ (startup CPU profiles prof1, prof2), jit/c6 (FunctionThis shell build and guest test), jit/c7 (direct-call work) under /mnt/p3/codex-build/claude-20261113.

- 8cda69c PBLBC inlines FunctionThis for object receivers. Shell guest test: identical results with the method tier on/off and against c4; p.get() ~340-370 -> ~288 ns per iteration. Not linked into a Firefox candidate. tools/nightly-musl/pbl-jit/method-loop-gc.test.mjs fails on HEAD ('pbltier' has not been declared); unrelated, unfixed.
- Scripted-call cost (c4 shell, ns per iteration, all tiers): empty loop 2-9, empty call 259-285, add3 291-301, p.get() 342-444, gx(p) 284-308, Math.abs 8, calls case 613-639. The method tier compiles caller and callee but every scripted call and return goes through the interpreter (caller exit, interpreter frame push, pblbc::Hook into callee, callee exit at Return, interpreter pop, Hook back into caller), about 230 ns per call. PBLJIT rejects loops containing scripted calls (reason "constant object": callee function object not tenured; only Math natives are allowed).
- Pure PBL (PBLIC=0 PBLBC=0 PBLJIT=0) costs ~300 ns per empty-loop iteration, twice the C++ interpreter (148 ns). This is not a V8 baseline-compiler artifact: Chromium --js-flags=--no-liftoff 334 ns, --liftoff-only 257 ns, --no-wasm-dynamic-tiering 315 ns (single runs, calls-diag/runs/d3..d5; flags not recorded in argv logs, but --liftoff-only changed other cells by ~2.4x, e.g. all-tiers calls 639 -> 1540 ns). Cause still unmeasured.
- Startup CPU profile (CDP worker sampling roughly doubles boot time, use as relative weights): after the second GL context, Firefox wasm is ~49% of sampled CPU and flat (1251 functions, top 100 = 36%); kernel spinlocks ~8% (sched_balance_rq, wake_up_new_task from kernel_clone); 53 Firefox threads are created between 8.7 s and 35 s, each paying new WebAssembly.Instance; V8 background compile threads use ~28 s CPU over the run. The published Firefox wasm has no name section, so per-function attribution needs a name map.
- web/linux/dist/worker.js compile_end compiles every exec'd guest binary with synchronous new WebAssembly.Module(bytes) copied out of guest memory. V8 only caches optimized wasm code for WebAssembly.compileStreaming/instantiateStreaming of a URL-keyed Response (v8.dev/blog/wasm-code-caching: >=128 kB resource, TurboFan code only, about 150 MB of cached wasm code per profile, "very large modules may not fit"), so the 208 MB Firefox module is re-baselined and re-tiered on every boot. Unbuilt idea: opt-in path where the page compileStreaming()s the Firefox module from an immutable URL and compile_end substitutes that Module when the exec'd bytes match. Unverified: whether a 208 MB module's hot subset fits the cache, HTTP-cache entry limits for the resource, CacheStorage eligibility.

## Continuation after 6a345f2 (2026-11-14; goals still unmet)

Work dirs under /mnt/p3/codex-build/claude-20261113: jit/c7 (direct-call shell and guest test), wasm-cache/ (code-cache probe, traces w1/w2), io/runs/t0..t5 (boot vs Chromium flag runs), memgrow/ (memory-growth batching).

### Boot time vs Chromium wasm tier flags (untraced, single runs, seconds: window / homepage / about:robots typed and painted)

| run | window | homepage | typed |
|---|---|---|---|
| t0 cold default | 26.17 | 34.24 | 41.57 |
| t1 warm default | 22.04 | 29.11 | 37.52 |
| t5 warm default repeat | 23.12 | 29.14 | 35.48 |
| --js-flags=--liftoff-only | 22.10 | 26.11 | 33.36 |
| --no-wasm-lazy-compilation | 30.19 | 34.23 | 42.48 |
| --wasm-tiering-budget=1000000 | 28.20 | 35.22 | 44.78 |

Only liftoff-only is at or below the defaults, by about the run-to-run spread; a page cannot set V8 flags, so this only says optimizing-tier compile contention costs a few seconds at most.

### Direct compiled-to-compiled scripted calls (4d0bd92, PBLBC_DIRECT=1, default OFF)

pblbc::CallScripted pushes the callee frame from compiled code and runs the callee's compiled function; returns 0 (refused, caller exits at the Call as before), 1 (frame switch: interpreter resumes in the innermost frame) or the caller's new sp. Depth bound 32. Refuses on argc < nargs, class constructors, cross-realm, environment-object callees, debuggee/coverage, callee not compiled.

Guest shell test jit/c7/test (boot.sh, tt.js, run.sh, gen.py; result runs/x1): 33 semantic cases (recursion, overflow, exceptions, finally, generators, async, getters, bound, classes, GC during calls, realm, redefinition) print identical output in 9 configurations (direct on/off twice, c6 shell, method tier off, loop tier off, logging, C++ interpreter); all benchmark checksums equal. ns per iteration, direct on vs off: add3 96-100 vs 270-274; method 108-117 vs 281-319; field getter fn 104-105 vs 266-293; calls case 223-234 vs 521-577; Math.abs 8 vs 8; empty callee 258-287 vs 209-211 (slower with direct on). C++ interpreter: 539-1028 on the same cases.

Round 2 (ad1ce4a, shell jit/c8/shell/js.fpcast.wasm, test jit/c8/test run x2): the empty-callee slowdown was a refusal on every call because the callee's first op (RetRval) is an exit op; such callees now return inline. Same 33 cases identical in 7 configurations including the C++ interpreter (md5 prefix fcec16466853 as in x1). ns per iteration direct on vs off: empty 73-75 vs 205-222; add3 96-102 vs 251-270; method 112-141 vs 271-272; fget 103-104 vs 265-273; calls 217-228 vs 529-537. Counters print one "PBLBC direct:" line at exit with PBLBC_DIRECT=1 and PBLBC_HITS set. On this test: pushes 4,998,241; inline returns 4,143,922; frame switches because the callee left compiled code at a non-return op 795,837, nested 57,558, depth 924; refusals 154,029 (entry op is an exit op 90,885; argc < nargs 47,947; no JitScript 6,187; cross-realm 5,978; env objects 2,989). Underflow padding was not added: the interpreter's own fast path also refuses it.

Not done: JIT safety suite (tools/nightly-jit-safety, Firefox-based), any Firefox candidate link. Do not default-on before those.

### Wasm code cache probe (parked; files in wasm-cache/src, nothing in the repo tree)

Test server on a spare port served the 208 MB Firefox module at an immutable URL; the page ran WebAssembly.compileStreaming on it (2.7-4.5 s to resolve) while the guest booted.
- Worked: the guest's synchronous new WebAssembly.Module(bytes) for the same bytes hits V8's in-process native-module cache (wasm.GetNativeModuleFromCache, wire_bytes 208805368); SyncCompile then costs 0.7-0.9 s of decode/copy.
- Worked: Chromium wrote code-cache entries (20 v8.wasm.cachedModule events, 3.4 -> 25.7 MB; Code Cache/wasm 302 MB after one boot).
- Failed: the second boot never consumed it (no moduleCacheHit/Invalid event, full unconditional GET again, cache produced again from 3.4 MB). The profile HTTP cache was 496 kB afterwards, i.e. the 208 MB response was not stored, and the code cache hangs off the HTTP cache entry. A fix needs the response to be HTTP-cacheable (smaller transfer, e.g. Content-Encoding, or a different cache route); untested.
- Timings were taken with heavy tracing and without a control run, so there is no boot-time number for this.

### Memory growth during boot (from trace wasm-cache/runs/w1; tracing inflates absolute times)

15,295 wasm.GrowMemory events and 582,436 V8.WasmGrowSharedMemory events (each grow of a shared memory interrupts every isolate sharing it). One worker does 14,301 grows between page-time 5 s and 10 s, each broadcast to ~37 isolates. The Firefox main thread does 410 grows costing 3.1 s wall / 2.6 s CPU, per-grow cost rising from ~0.03 ms early to 15-23 ms late in the boot. Analysis scripts: wasm-cache/scripts/grow.py, grow2.py, grow3.py.

Source of the early grows (code reading plus two boots, memgrow/runs/mg-on1, mg-on2): the kernel grows its own memory inside vmlinux.wasm. The only memory.grow there is materialize_memory, called from arch_alloc_page on every page allocation that extends the high-water mark (kernel source arch/wasm/mm/page.c:7-31 in the nix store under /mnt/p3/project/linux/.tmp-firefox-build/nix-local-store, path mzbhr58f…-source). Every worker shares that memory, hence the broadcast. Opt-in page parameter ?memgrow_kernel_mb=N (web/linux/dist/index.js, default off) grows the kernel memory once before any worker starts; with N=2048 (full guest RAM in the harness) the kernel memory size never changed during boot and Firefox reached its window; with N=1024 it still grew 16384 -> 20992 pages by ~7 s. ?memgrow_log=1 logs kernel memory size changes without changing behaviour. Untraced A/B (io/runs/mgA1..3, mgB1..3, alternating, profile tier, about:robots typed; seconds window / homepage / typed): A 26.11/33.17/not reached (typing did not navigate in that run), 23.10/28.17/35.61, 23.15/28.21/33.54; B (memgrow_kernel_mb=2048) 21.05/27.08/34.32, 23.05/28.09/34.20, 22.14/26.16/34.70. B is about 1 s lower on window and homepage medians, which is within the run-to-run spread; typed-page time is unchanged (34.2-35.6). The harness did not capture the MEMGROW console line in these runs. Left default off. A kernel-side chunked grow would need a kernel rebuild (not attempted).

Firefox's own ~410 grows most likely come from musl brk (src/linux/brk.c grows by exactly the requested pages with the wasm instruction), not from the JS adapter: an opt-in chunked grow in ensureUserBytes logged zero grows in one boot. That experiment is parked as memgrow/src/user-chunk.diff (not in the tree). Fixing it means chunked growth in musl _brk and relinking userspace (not attempted). Also unverified: growForSyscallResult ignores BigInt nr/ret while worker.js compares syscall numbers against BigInt literals, so the mmap/brk growth hook may never run. Same trace, whole process: wasm.TopTierCompilation 38.9 s CPU on 7 threads, wasm.SyncInstantiate 8.1 s CPU over 1942 events on 150 threads, wasm.CompileLazy 72k events 5.9 s.

---

# LinuxOnWeb continuation —45/100, original target unfinished

Session start2026-11-03T13:22:11Z; normal deadline18:22:11Z. The exact user request remains in agent/task.md. Active branch is gpt-6-astra-pro_builtin-agents_linuxonweb-20261103-1322; frozen parent81103b2ec04a8a4f8453617ca128448e831645bc and checkpoint tag remain intact. Read the final capturedHead from INCREMENT-MANIFEST.json rather than assuming the earlier runtime-capture commit is final source. Full historical notes are preserved under agent/archive and in Git.

## Accepted state

Score45/100: desktop7/15, I/O/startup10/25, JIT4/15, graphics9/25, packages8/10, mobile3/5, preview/reproducibility4/5. These original weights were independently checked against frozen81103. No95/100 or completion claim. The score increments are real native keyboard correctness, signed common ports, and physical Android package persistence.

The production Firefox image is1a3951f0c48d,116265893bytes, SHA2564b20a71713a8229f52f3ac2702d8d94dd5b4779a53ed28f0bb0d5830bf14b06c. Manifest SHA2569da17bf944a4d25d8f4c4811e93a0dc9ca76b7b37f52579544959c7ae18a4bd5. It contains the accepted native apk-persist helper; original Firefox executable/launcher/purge marker remain unchanged. No cacheLifecycle metadata is enabled. The old plain image3abcabf273287eada1663c5fc4baedc7f7e28b379c580b796cfebea0f531d1be remains current. Do not substitute legacy raw web/linux/boot-manifest.json for the actual served latest-build manifest.

Default host-owned keyboard repeat passed12 real native assertions under the common3CPU cap. Keyup/focus loss/Stop releases are preserved. input-repeat=guest is an explicit diagnostic opt-out. Write buffering, cache seeding and packed Firefox resources remain disabled.

Real signed GNU tar1.35-r1, wget1.25.0-r0 and findutils4.10.0-r1 are published under the existing public trust key. Combined proper-cap recheck:71GNUbehavior+39persistencepositive+54negative=164checks,128.292s, no survivors. Exact native helper stores signed immutable generations and exact world under root-owned /home; files and APK database are replayed together. Native apk alone is ephemeral; use sudo apk-persist add/save/status deliberately. GUI restore failure stops before X and exposes a focused native recovery console; actual typed apk-persist disable and normal Stop/worker destruction passed.

Android accepted: actual MI8/Android15/Brave148,1CPU512MiB; signed Python3.14.6 install30.773s, exact hashes/world/database/generation/userdata/imports after offline replay3.826s, both Stops workers0, owned tab/forward cleaned. Exact6-file console promotion and readback passed. Runtime manifest captures content-addressed console7ffafa012c9072c31e4d0946863fa56ad3a64b9197002e513c922d417d4000a6, unchanged worker81f46bbca8d06843b50ea2fea18e0dab6d30516a398988a7c0761c4eb66c9445 and small image60be177eb68336db15f85129676a5f15a8544139e747272ca633cc8d4e82be74. Device selector/raw ADB data stay private.

## Unfinished gates and exact next work

1. Safe cache lifecycle is off-default. Candidate v3 binds base/init/kernel/resources/raw+gzip extras and loader-issued proof; LastAppDir generation worked in a narrow test. Final cold usable Firefox105.438s from actual Start (106.378s page navigation), exact rapid nonce and distinct visible destination.12 input checks passed afterward. Quit confirmation was clicked before appearing; final screenshot still shows the dialog. This is an unconfirmed-Quit harness failure, NOT90s native shutdown deadlock. Fix observation using actual visible confirmation, then require current-launch native exit0, closed-profile same-generation warm reads and usable navigation. Finish changed-generation, alternate/direct-native, corrupt-cache and interrupted-publication cases before promotion.
2. Native Restart normally still reaches unsupported detached-process operation. A genuine fix needs the permitted native build route; historical object/dependency graph remains root-owned0700 and inaccessible. Do not bypass access controls, reframe permissions or blanket-respawn exits. Existing custom PBLIC/PBLBC/PBLJIT tiers are real but narrow; upstream general JIT remains disabled.
3.50% host performance is unmet: last complete historical matched scene3.4783fps/59.8483fps host≈5.8%, stalls included. Final matched native attempt is incomplete after a process-exit sampling race; no newFPS. A narrow monitor fix excludes only confirmed vanished/reused/Z/X identities and still fails unknown live identities;12 policy cases and actualHTTPS monitoring passed.
4. Graphics explicit WebGPU+CPU/2D readback native WSI fixture passed1443passes/4329draws/1443presents,151first-framecolors, resources0. This is not broad API/conformance or a default presentation change. DirectGPUcanvas export loss reproduction remains. Extend coverage and measure presentation overhead before default changes.
5. Node.js is not ported. Plain-mode no-force signed install/ordinary nonroot bare-command resolution/two-boot replay remains unfinished. Exact Firefox init also has /bin-first PATH; BusyBox shadowing is a source-audit risk there too. No final actualHTTPS terminal lookup ran, so do not fabricate an executed failure. Use explicit /usr/bin paths when evaluating GNU binaries.
6. Full Firefox on Android and iOS remain unaccepted; no iOS device was available. Preserve the accepted small-console HTTPS worker fix and real persistence gate.
7. Final actual publicHTTPS cold load failed150s before nativeVM boot: UI showed Firefox61.9/110.9MB, extras21.5/57.2MB, kernel6.0MBdone. Auth/manifest/footer passed, ownercleanup0. These are application progress labels, not wire-byte measurements. No navigation, package save, ordinary PATH or normalUIStop claim from that final WAN run. Investigate transport/compression/cache safely and measure full real route from Start; do not replace with process-start logs or seed caches silently.

## Tools, ownership and verification constraints

Use rubywebterm for /mnt/p3/project/linux/linuxonweb. Preserve all unrelated work; create a checkpoint and named branch for a new task. Built-in same-model/same-reasoning agents can divide implementation/review; serialize every guest boot/heavy benchmark/build. CPU/RSS/availableRAM and every owned process group each1s, PSS5s. Require ONE shared ancestor at<=3CPU for all browser/driver/proxy processes; affinity alone is insufficient. Owned Chromium uses a nonexistent private D-Bus socket to avoid desktop migration. Never move cgroups or change the user/global bus. Unknown/unreadable live process identity is fatal. Check actualdeviceavailability beforeADB; never kill unrelated tabs/processes or remove unrelated mappings. Keep failure logs and exact start/end/durations.

Actual desktop URL: https://9209ec251514cc05.5x7aqstuceku.opentunnel.xyz/linux/index.html . Android console: same origin/linux/packages/v1/package-shell.html?cpus=1 . Both require the existing normal authorized preview session; anonymous401 is expected. Use the existing authorized preview access flow, never publish capability URLs/cookies/owner keys. Signed repo: https://a3cf34ce40307517.5x7aqstuceku.opentunnel.xyz .

## Recovery

Runtime entry: https://fileharbor-meak.basicgleam65.chatgpt.site/raw/meaklocaldev/dcd0b1bf-7043-44e3-babf-6b5b7018f710/linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_1322_runtime/index.html . Exact runtime capturecommit339ebf7442ad12f51b2eef724e183e14cffcbf06 is intentionally earlier than finalsourceHEAD; image/runtimebytes stayed fixed. Runtime capture11.007s, full Python-O reconstruction4.002s, provider10/10hash verification412.132s.

Recover full Git/history from original encrypted80a52d19b611175a7dbc3ae98c45b204150c1535 base plus FINAL cumulative increment, using the ORIGINAL private recipient key kept separately. Only publicrecipientcertificate is available here; no full encrypted decryption was performed. Bundle prerequisites/fetch/fsck are verified before encryption. The encrypted increment also preserves package signing-key recovery; never publish plaintextprivate keys. Public-source users additionally apply the exact small browser-dependency supplement; fullGit already tracks those xterm dependencies. Overlay the hash-verified exact runtime and serve latest-build, preserve signed repository trust. Follow final delivery RESTORE.md and manifests; do not invent missing protected native Firefox build inputs.

Primary evidence: docs/gpt6-astra-pro_builtin-agents_rubywebterm_continuation-20261103-1322.md; agent/devsummary.md; tools/startup-benchmark/evidence/continuation-20261103-1322; tools/guest-packages/evidence; tools/graphics-benchmark/evidence/gpt6-astra-webgpu-readback-quota-20261103-1322.json.

## 2026-11-08 continuation checkpoint (score remains 45/100)

Task branch `gpt-6-linuxonweb-20261108-progress` preserves source `db40504` at `checkpoint-linuxonweb-20261108-db40504`. Fixed the lifecycle test's premature blind Quit-dialog click with screenshot-observed, fail-closed prompt detection and exact-generation native exit reporting; 13 local tests pass. No fresh native/HTTPS browser acceptance was run, no new speed result exists and the 45/100 acceptance score is unchanged. See `docs/gpt6-linuxonweb-progress-20261108.md` for evidence, limitations and next steps. Do not enable candidate cache lifecycle without full native close/profile/warm verification.
