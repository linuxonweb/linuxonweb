# 2026-10-03 — Run58 final runtime package passes independent review

The transformed Firefox binary is **189,453,198 bytes (189.45 MB)** at
`/mnt/p6/project/build/nightly-native-package-run58-20261003/transform/firefox.fpcast.wasm`,
SHA256 `50beabf9da029b8cb15cb2fba2933d73ca749cbe465a7ea0668a6ccaffc302b3`.
The default-page runtime archive is **281,631,147 bytes (281.63 MB)** at
`/mnt/p6/project/build/nightly-native-package-run58-20261003/overlay/candidate-run58/initramfs-firefox.cpio.gz`.
This archive includes the Linux guest and Firefox runtime resources.
Five real linker warning/fatal controls, seven transformed modules and 143 ABI
checks pass. Root streamed the original guest archive, full package and overlay,
checking all eight installed executable records and preserved guest files.
All 31 static phase processes are terminal and reaped; actual guest startup,
JIT and Firefox GPU acceptance remain pending. The current-client compute
hardware/software runs are admitted before the ordinary baseline test.

Two review mistakes were corrected without weakening actual input checks.
An unused default linker search directory need not exist when every selected
library resolves to a pinned real file. Historical source descriptors must be
compared with their retained original copy, rather than a newer mutable source
file. The updated stack adapter changed three defs.mk lines; the original
frozen defs and accepted current source remain separately verified. Preserve
failed review attempts and identify the exact assumption that was wrong.

# 2026-10-03 — Run58 ordinary relink completes; guest acceptance still pending

Run58 completed the real ordinary linker and original Binaryen O2 for all
three browser programs in **1,594.14 seconds**. The owner reaped exit 0;
exact process group 850747 is empty. The raw Firefox executable is
**175,835,975 bytes (175.84 MB)** at
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/dist/bin/firefox`,
SHA256 `ab62aaa8084d83b4c9c9bb217aa072d649c616a5ffd8e7ccf920583bdb4dce62`.
The three refreshed browser binaries contain no DWARF sections and all seven
raw executables pass Wasm validation. Four helper binaries and the native
Rust archive retain their Run57 bytes. Root independently checked the actual
hashes, section names, post-start browser mtimes and empty process groups in
`/mnt/p6/project/build/nightly-native-stack-20261003/root-run58-terminal-raw-review.json`.
Direct linker checks, fresh transforms/package and actual cold/warm startup
follow; this build result does not establish Firefox startup, JIT or GPU.

The first direct-command capture omitted the sourced build environment and
correctly rejected unresolved `-lepoxy` before replay. Preserve that attempt;
capture commands with the actual selected environment rather than adjusting
library inputs to make an incomplete environment appear valid.

The standalone actual Nightly Rust-client compute benchmark is compiled and
packaged, with 174 uniform indirect-call targets. Root verified 1,086 bound
files and the single changed initramfs executable. Its hardware/software ABBA
runs remain held until heavy optimization and postlink work finish; running a
CPU software renderer beside the optimizer would bias the comparison. Keep
the earlier **18.1778×** Vulkan-to-wgpu versus host SwiftShader result separate.
Firefox GPU testing remains ordered after the simple benchmark gate.

# 2026-10-03 — Native main-thread stack query regression passes

The observed Run57 startup trap belongs to the selected musl implementation
of `pthread_getattr_np`. Its main-thread `t->stack == NULL` branch deliberately
calls `a_crash`; main TLS initialization does not fill those stack fields.
The native adapter uses the executable's real linker `__stack_low` and
`__stack_high`, preserves actual detach/guard fields, and delegates queries
for created threads to libc. It leaves the thread control block unchanged.

A real Linux/Wasm guest passes **55/0** checks: both 8 MiB and 2 MiB linker
stacks, live frame containment, main/worker cross-queries, exact original
worker attribute bytes, cancellation and cleanup. Calling unmodified libc on
the main thread reproduces **exit 139**. All real CPU counts match six; owned
process groups are empty. This proves the adapter, not Firefox startup or JIT.
The tested adapter is `/mnt/p6/project/build/nightly-native-stack-20261003/native-stack.o`
(**853 bytes**, SHA256 `46c762f103d7f09c899afccd9997a96e9da21db466fc75b58f5c10e0c4d00cda`).
The independent review is `root-guest-stack-review.json` in that task root.
The production archive is **1,016 bytes** at
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-stack-accepted-run1/libnightly-native-stack.a`,
SHA256 `9a4fc27adfbc60dd1bf3752a36e46a1f6655fb000c0f240a63f65bb70fa7285f`.
Firefox still needs the normal relink, fresh packaging and guest baseline.
Run58's first ordinary make completed in 45.5 seconds but emitted no final
links: `defs.mk` was absent from the executable dependency list. Record this
as a no-op. Preserve the three real browser `.list` files and touch only their
mtimes to invoke the normal linker and optimizer; a successful make exit alone
does not prove the changed linker settings reached the executable.

Read the pinned structure layout before labeling optimized field loads:
offset 52 is the stack pointer, 56 is stack size, and 60 is guard size. The
first interpretation mislabeled offset 52 as stack size. Two adapter compile
failures also exposed musl's private feature macros and header include order;
retain those failed commands and use the actual matching private headers.
Derive stack bounds from the linker rather than assuming Firefox's 8 MiB
setting applies to every executable. A worker querying the main thread must
not validate the worker's frame against the main stack.

# 2026-10-03 — Run57 rebuild completed; actual Rust GPU client passes three backends

The fresh Run57 transformed Firefox is now **189,452,969 bytes** at
`/mnt/p6/project/build/nightly-native-package-run57-20261003/transform/firefox.fpcast.wasm`,
SHA256 `2f6994ce78f7239c0eb5f5b3e8a35507f241d5b88b7a00139950aa42f661b4a8`.
The compressed default-page runtime archive is **281,631,172 bytes** at
`/mnt/p6/project/build/nightly-native-package-run57-20261003/overlay/candidate-run57/initramfs-firefox.cpio.gz`.
All seven transformed modules/143 ABI predicates/31 successful bounded phases
pass. Root streamed both archives to verify all eight installed executable
bodies, the page/default URL, exact overlay changes and preserved init/home.
The actual ordinary cold baseline subsequently failed in **25.99 seconds**:
Firefox exited with **status 139**, and the warm case did not run. The previous
NSPR initialization error and abort-recursion messages are absent. The new
first runtime cause was subsequently captured as a Wasm `unreachable` trap.
The unchanged-package diagnostic failed in **25.55 seconds**, with an exact
stack beginning at function **217188**, module **2d2b4aa6**, offset **0x7dbb981**.
All input hashes remained unchanged; 458 synchronous events fit within the
capture limits, none were dropped, and both owned groups are physically empty.
The build owner is mapping the stack to linked symbols before choosing a fix.
Actual CPU counts match six and
guest RAM is 4096 MiB; the owner reaped exit 1, closed the server, and both
owned groups are empty. Startup, JIT, Firefox GPU and deployment remain
unaccepted. The first preflight correctly
rejected missing admitted scratch directories; create only those directories
and retain the failed phase before retrying, without loosening admission.

Run57 completed the ordinary original-O2 build successfully in **1,602.41 seconds**.
Its owner reaped exit 0 and exact PGID 710076 is empty. The current raw Firefox
is **175,835,746 bytes (175.84 MB)** at
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/dist/bin/firefox`,
SHA256 `e40ba4bc22b009694c2547d0c381b2152ccad6f67d493e9f193de2b76ceec8f9`.
All seven raw executables pass Wasm validation; all three browser and two NSS
direct links pass signature checks and separate fatal-warning controls.
Current BuildID remains **20261003042618** after this incremental rebuild;
bind actual source and binary hashes rather than inventing a new stamp.
Fresh transforms/package pass; cold baseline failed as recorded above. The
preserved Run56 transformed module below is historical, not the Run57 package.

The separate actual Nightly Rust GPU client passed hardware WebGPU, host
SwiftShader WebGPU and genuine Rust WebGL copy/map runs. Each actual guest
verifies 16 copied words inside the FFI map callback, four single callbacks,
twelve Rust-generated messages, five dispatches and zero owners at teardown.
CPU admission matches six real host/browser/requested/kernel CPUs. No Firefox
executable ran in these tests. This is transport/client acceptance, not Firefox
DOM/IPC/rendering or FPS acceptance. The simple Vulkan → wgpu rendering benchmark
already passed **18.1778×** versus host SwiftShader; Firefox GPU testing remains
ordered after that prerequisite. Reviewed source and evidence are in
`web/linux/tests/nightly-webgpu-current/actual-client` and
`docs/evidence/nightly-actual-rust-gpu-client-20261003.json`.
Task binaries and raw logs stay under
`/mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003`.

The initial planner command omitted `-Xclang -fc++-abi=webassembly`; fatal
linking caught the real `nsTSubstring` destructor signature mismatch. Use the
same native C++ ABI as the accepted browser objects. The first hardware guest
incorrectly required a nonempty adapter name; WebGPU privacy returns empty
strings legitimately. Keep exact IDs, limits, callback ownership and hardware
identity checks while permitting privacy-reduced metadata. Publish mapped
bytes before callback success; copy borrowed strings before callback return.
The read-only review first expected a bare linker flag instead of the actual
`-Wl,--fatal-warnings`, then normalized CRLF when comparing raw log bytes.
Both review mistakes were corrected without rebuilding or changing guest runs.
Fresh subagent creation still hits the agent thread limit; the existing owner
continues full-build/package/baseline work, and root reviewed the GPU runs.

# 2026-10-03 — NSPR static lifecycle and fatal termination pass in the guest

The two-file candidate passes a real Linux/Wasm guest with **25/25 checks**:
21 NSPR lifecycle checks and four negative/fatal controls. It retains actual
initialization, symbol calls, reference counts, final unloading and cleanup;
unsupported dynamic requests still fail honestly. Fixing initialization alone
is insufficient: the retained partial control fails both final static unloads.
Native Wasm `abort()` now emits a trap, preserving the original crash reason
rather than recursing through `mozalloc_abort`. Normal non-Wasm preprocessed
bodies remain identical. Evidence and independent review are under
`/mnt/p6/project/build/nightly-native-static-loader-20261003`, especially
`guest-run-retry2/guest-console.txt` and `root-guest-acceptance.json`.

The actual run used six host/browser/kernel CPUs and 1 GiB guest RAM, finished
in 14.82 seconds, and closed its server and both owned process groups. This
proves the loader/fatal fix; Firefox startup, JIT and GPU remain unaccepted.
The exact reviewed sources and idempotent recipe are applied. Both normal
component rebuilds emitted bytes identical to the guest-tested objects. Run57
is now the ordinary full build, unified 75670 / owned PGID 710076, with original
automatic optimization and existing bounds. Until it completes, the completed
Run56 raw Firefox is preserved as **176,096,386 bytes** at
`/mnt/p6/project/build/nightly-native-static-rebuild-20261003/run56-independent-originals/firefox`;
its completed transformed module remains **189,713,492 bytes** at
`/mnt/p6/project/build/nightly-native-package-run56-20261003/transform/firefox.fpcast.wasm`.
These are Run56 results, not measurements of the pending corrected build.

Requesting a bare `.o` make target reported up-to-date without compilation: this
build includes dependency files only for its normal aggregate targets. Use
`target-objects` and require actual fresh output evidence; the corrected two
component targets completed in 2.05 seconds. Preserve immutable prior binaries
before relinking instead of referring to mutable output paths as old evidence.

Two launch mistakes were retained and corrected: a task temporary path made
Chromium's Unix socket hit the 108-byte limit, and a strict disk reader treated
normal cache deletion as a fatal error. Include the terminating NUL when
checking socket paths; a shorter disk-backed scratch path fixed the first.
For disk accounting, keep the full task total, permit bounded ENOENT churn
only inside admitted owned cache/scratch paths, and reject other errors.
A cleanup status also raced process teardown; retain the original status and
add a fresh physical empty-group proof rather than rewriting old evidence.
The first root review used a greedy disassembly regex, then incorrectly
expected a literal aggregate marker instead of shell counters; both inspection
errors were corrected without changing the tested source or fixtures.

# 2026-10-03 — Recover the first fatal message before fixing startup

A bounded task-only worker observer captured the first abort caller without
changing the Firefox executable or package. Its preceding stderr message was
`failed to initialize shared libraries [Dynamic loading not supported]`.
The exact message occurs in NSPR's `_PR_InitLinker`, where `dlopen(0, RTLD_LAZY)`
fails. The capture and caller stack are retained at
`/mnt/p6/project/build/nightly-first-abort-20261003/trace2/first-abort-capture.json`.
This identifies the next startup fix; it does not establish startup acceptance.

The first diagnostic had a concrete mistake: it watched Linux i386 syscall
numbers 4 and 146. The selected Wasm musl libc actually emits 64 and 66, using
the seven-i32 Linux import ABI. Synthetic forwarding tests passed with the
wrong numbers because their fixture repeated that assumption. Bind diagnostic
fixtures to the actual selected headers, archive members and emitted code.
The corrected controls independently verify those members, reject the old
numbers, and retain normal syscall arguments and return values. Preserve the
failed diagnostic and its source copies rather than replacing its evidence.

The fatal path has a separate proven defect: native Wasm falls through to a
null-memory store and `abort()`, while Mozilla overrides `abort()` to call
`mozalloc_abort`. Linear address zero is writable, so the actual compiled
functions recurse instead of promptly trapping. Recover the first message and
stack before that recursion; distinguish the original failure from the broken
fatal termination mechanism. NSPR's existing static-loader strategy also needs
its actual unload lifecycle checked: a null executable handle must not lead to
`dlclose(NULL)` for a registered static library.

# 2026-10-03 — Run56 transformed runtime package

The fresh transformed Firefox executable is **189,713,492 bytes (180.92 MiB)**
at `/mnt/p6/project/build/nightly-native-package-run56-20261003/transform/firefox.fpcast.wasm`.
SHA256: `1b1d0d9d26ad9abe262f50cc96d28d17567cb1b3ec7536e01d262a9b76a20d93`.
All seven transformed executables pass actual Wasm validation and 143 ABI
predicates. The exact linker replays for all three browser programs and both
NSS utilities pass without signature mismatches; separate fatal-warning
controls also pass after removing only the five inert ELF warning pairs.

The compressed default-page runtime archive is **281,714,694 bytes** at
`/mnt/p6/project/build/nightly-native-package-run56-20261003/overlay/candidate-run56/initramfs-firefox.cpio.gz`.
SHA256: `ea5ca129fc98668dcc7f9d5d93d3902547b63ba1d671a9d4aba01be8f043003f`.
This archive includes Firefox, its helper programs, Linux userspace and the
default page; its size is not the Firefox executable size. Independent review
rehashed 114 files, checked 31 successful bounded processing phases, and
streamed the actual archive to verify all eight installed executable records.
The report is
`/mnt/p6/project/build/nightly-baseline-guest-20261003/root-final-package-review-run56.json`.
Static package acceptance permits baseline guest testing; it does not establish
Firefox startup, JIT, GPU or release acceptance.

The actual cold baseline subsequently failed its 420-second default-page
deadline. Its log repeatedly reports `Redirecting call to abort() to
mozalloc_abort`; the original fatal cause is still unknown. The warm case did
not run. The owner reaped the test, closed its server, and verified both owned
process groups empty; independent review confirmed those groups were empty.
CPU admission matched six host/browser/guest CPUs and 4096 MiB guest RAM.
Keep this failure distinct from the previously proven constructor ABI trap.

A retained first inspection attempt failed because its owned-task admission
still named the old output root. Rebase only the exact task-root literals in
task-local tools, preserve the failed attempt, and verify the byte-level delta
before retrying. Do not weaken ownership checks to admit a fresh package.

The simple guest Vulkan → host Rust wgpu benchmark has already passed, with
matched readbacks and **18.1778×** speedup over host SwiftShader. This satisfies
the user's prerequisite for subsequent Firefox GPU testing. The result measures
completed offscreen rendering; it does not establish Firefox GPU integration
or presentation FPS.

# 2026-10-03 — Run56 native C++ runtime rebuild

The corrected ordinary full build, Run56, completed in **1805.69 seconds**.
Its owner reaped unified session 65279 with exit 0 and verified exact PGID
520663 empty. The current raw Firefox binary is **176,096,386 bytes
(167.94 MiB)** at:

`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/dist/bin/firefox`

SHA256: `b4c5280318add68ddad1072bc3e954b24946e6bceb932b605c10022e6fde398d`.
The three large programs completed the original automatic Binaryen `-O2`.
All five final inspected executables have native Wasm magic and no `.debug_*`
sections. pingsender and gfxtest retained their unchanged prior output bytes;
their existence is not evidence of recompilation during Run56. Actual sizes,
hashes and sections are in
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/status/build-run56-final-binaries.json`.
This records completed build output, before fresh ABI transformation,
packaging and guest startup acceptance. JIT, Firefox GPU and deployment remain
unaccepted.

The fresh Rust archive is **204,613,232 bytes**, with **7,136 native members**.
Content comparisons found zero legacy-only runtime members; the selected
shared-mutex constructor now has the expected `(i32) -> i32` signature.
This fixes the proven archive ownership defect, but does not itself establish
whole-program ABI coherence or successful Firefox startup.

Another mistake was relying on silence in the ordinary build log: the Run55
log recorded zero signature mismatch warnings despite the direct linker replay
proving mismatches and synthetic traps. Mach's normal warning reporting is
insufficient for this acceptance gate. Capture raw output from exact current
linker rows for all browser programs and NSS utilities. Retain known unsupported
ELF `-z` warnings separately; any signature mismatch or unexpected warning must
fail acceptance. A separate `--fatal-warnings` control may omit only those
explicitly reviewed inert flags while preserving the exact original replay.

# 2026-10-03 — Nightly 159 native Linux/Wasm no-debug rebuild

The actual ordinary full build, Run55, succeeded in 1672.26 seconds. Its owner
reaped unified session 72115 with exit 0 and verified exact PGID 300325 empty.
The final raw Firefox executable is **175,262,059 bytes (167.14 MiB)** at:

`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/dist/bin/firefox`

SHA256: `973b387bc6784538fcca077c191aacb72fb7e58caea07962ed8423835ff87a64`.
The completed Firefox, plugin-container, xpcshell, pingsender and gfxtest are
native Wasm, fresh after the no-debug configure, and contain no `.debug_*`
sections. Final paths, sizes, hashes and sections are retained in
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/status/build-run55-final-binaries.json`.
This is the raw linked executable, before the separate ABI transformation and
runtime packaging. Build success alone does not establish guest, JIT, Firefox
GPU or deployment acceptance.

Actual `wasm-validate --enable-all` passed on all five final executables under
16 GiB address-space/core-zero limits. Every input hash remained unchanged;
each validator was reaped with exit 0 and its process group was empty before
the next check. The static report is
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/status/build-run55-final-raw-validation.json`.

The main configuration mistake was assuming `--disable-debug` also disabled
debug symbols. It disables the debug build but leaves DWARF enabled. The fix
uses `--disable-debug-symbols`, verifies the actual generated C/C++/assembler
and Rust flags, and strips debug metadata in the three browser link rows before
the unchanged automatic Binaryen `-O2` operation. Native exceptions, C++ ABI,
runtime adapters and the original optimizer were retained.

I overlooked section composition before repeated large optimizer retries.
Run52's raw Firefox was 2,335,263,664 bytes; 2,158,893,257 bytes (92.4%) were
debug sections. A separate stripped copy was 176,370,407 bytes with every
non-debug section payload unchanged. Inspect section sizes and actual flags
before repeating an expensive optimizer. An allocation failure under an 8 GiB
address-space limit does not prove the Wasm module is invalid. Time bounds,
host OOM events, explicit stops and the external reboot must retain their
distinct recorded causes rather than acquire an invented common explanation.

Object existence was insufficient proof of a no-debug rebuild. Changed
autoconf/backend dependencies and Cargo fingerprints naturally forced fresh
compilation; terminal inspection checked all 3012 native graph objects were
fresh and had no debug sections. The new Rust archive is 204,433,482 bytes,
with 7098 native members and no debug-bearing member. Its source/configuration
and actual outputs were checked rather than relying on an old archive label.

A proven object-only stage used four jobs and excluded all final program
links; the subsequent ordinary full build used one job for serial final links.
This avoids three simultaneous large optimizers, but `-j1` does not limit
Binaryen's internal threads. The observed plugin optimizer had nine threads,
eight CPUs in its affinity and no `BINARYEN_CORES` override. The main optimizer's
polled peak virtual size was 7.70 GiB. The full phase later recorded a 26.67 GiB
per-process peak during resource generation, so 7.70 GiB must not be reported
as the whole-build peak. The size reduction is measured; this is not a
controlled causal measurement of optimizer memory improvement.

Actual baseline startup later exposed another acceptance gap: native Wasm magic,
freshness, and absence of DWARF do not establish C++ ABI coherence. The Run55
Rust archive bundled legacy sysroot libc++ objects whose constructors return
void, while current native C++ objects expect constructors to return a pointer.
wasm-ld returned zero with signature mismatch warnings and generated trapping
stubs. Optimization inlined the shared_timed_mutex constructor trap into
`_start`, causing the real guest Firefox exit139 before normal startup.

The retained worker stack, exact served executable hash, targeted function
disassembly and a bounded linker-map replay identify RLBox's sandbox_list_lock
static initializer. Data-section hashes match across replay, raw and packaged
modules, binding the map's guard address to the actual trap. Retain a compact
linker map even without DWARF, and reject constructor/destructor signature
mismatches during program-link acceptance. A separate disabled-FIPS NSS
signature mismatch must also be corrected before adopting `--fatal-warnings`.
Changing runtime library selection must produce a fresh Rust static library;
archive member filtering or a static-initializer bypass would hide the cause.
