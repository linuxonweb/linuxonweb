# Nightly 159 startup constructor trap — 2026-10-03

The unchanged Run55 package exits139 during actual guest startup. A bounded,
opt-in CDP recorder captured the owned worker's primitive error stack:
`RuntimeError: unreachable`, module `2d033b6e`, function7, offset `0xf94d1`.
The exported `_start` is function7. This diagnoses baseline startup; Firefox
GPU, JIT, TLS, release and baseline acceptance remain false.

The exact served archive contains the transformed Firefox with SHA256
`12afe0d5be898fbf9448e485b853e86f0f1dc035b67ca5cad27fa27c6906e867`.
Targeted disassembly identifies an explicit `unreachable` after setting the
static initialization guard at address56992048. A bounded direct replay of the
frozen wasm-ld command adds only task-local output and a linker map. The map
identifies that guard as RLBox's `sandbox_list_lock`, a
`std::shared_timed_mutex` in `rlbox_sandbox.hpp:101`, emitted by the actual
parser/htmlparser object.

The replay, ordinary raw Firefox and transformed packaged Firefox have identical
48,076,440-byte Data section payloads, SHA256
`5ac8396f413c19bdfcd73847352fecb0f240f1e8f57bea0db29461f1aa8bf6cf`.
That binds the map's data address to the actual failing module. The trap is
already present in the raw executable; the package transform did not create it.

The linker warned that `_ZNSt3__118shared_timed_mutexC1Ev` was expected to have
signature `(i32)->i32` but the selected `libgkrust.a(shared_mutex.cpp.o)` defined
`(i32)->void`. It returned zero and synthesized a trapping stub; optimization
inlined the trap into `_start`. Cargo's cc-rs hook bundled legacy sysroot C++
runtime objects even though Clang already selected the rebuilt native ABI
runtime. Native Wasm magic, member counts and no-debug sections did not establish
C++ ABI coherence. No RLBox safety bypass or initializer patch is appropriate.

The narrow cc-rs hook accepts `WASM_MUSL_CXX_RUNTIME_LIBDIR` only in its wasm32
Linux C++ branch and retains the original sysroot/lib path when unset. The
recipe explicitly selects the rebuilt native runtime and target-scoped
`CXXSTDLIB=c++`. Real cc-rs compilation confirms the intended native path,
Cargo environment tracking, no extraneous stdc++ on that target, original unset
behavior, and unchanged host Linux behavior. The prior local vendor source had
an already divergent checksum; original bytes and both hashes are retained,
and only its source-file digest is updated for this intentional change.

A genuine standalone guest regression passes 20 checks using the native
archives: guarded construction, overlapping pthread readers, blocked and timed
writers, writer updates, timed readers, and successful acquisition after
release. Selecting legacy libc++/libc++abi with the same native unwinder instead
reproduces exit139 before main. Both runs use fresh host/browser/guest CPU count6
and exact browser affinity, 1GiB guest RAM, Chrome inherited AS2TiB/core0,
RSS12GiB/floor4GiB, task4GiB/reserve20GiB, and finite time bounds. Both browsers
exit0, servers close and exact owned Node/Chrome groups are empty after reaping.
The negative artifact is retained as a failed regression, not acceptance.

The recorder attaches recursively before navigation and resumes waiting
workers. It retains bounded primitive console values and protocol frames,
without remote object evaluation or pausing on all exceptions. A concrete
pre-Firefox worker-cap failure justified128→512 lifetime sessions; event2048,
8MiB and180-second bounds stayed fixed. Host protocol controls pass48, retained
logs12 and existing controls49. Excluded attempts preserve socket-path, worker
cap and transient owned-temp disk errors separately from the Firefox crash.

The successful diagnostic retains six CPUs, 4096MiB guest RAM, Chrome
AS2TiB/core0, 26.45seconds and peak owned-group RSS5.28GiB. Its primary failure
snapshot has379 events and131 enabled/resumed sessions. A late cleanup worker
response mismatch appears only in the final snapshot; all132 sessions detach.
This limitation remains recorded alongside the valid primary crash stack.

Evidence is [the retained packet](evidence/firefox-nightly-startup-trace-20261003.json)
and the task-local `native-cargo-cxx-runtime-review.json`. The original binaries,
archive and failed reports remain frozen. A fresh Rust/browser rebuild is still
required. Program-link acceptance must reject constructor/destructor signature
mismatches; the separate disabled-FIPS NSS signature mismatch must also be
resolved before using `--fatal-warnings`. Retain a compact linker map without
DWARF so future initializer failures remain attributable.
