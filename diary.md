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
