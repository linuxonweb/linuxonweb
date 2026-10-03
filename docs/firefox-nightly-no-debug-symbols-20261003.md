# Nightly shipping builds without DWARF — 2026-10-03

The retained baseline was optimized, but its recipe disabled debug assertions
without disabling debug symbols. `--disable-debug` does not imply
`--disable-debug-symbols`. Actual retained `config.status.json` reports
`MOZ_DEBUG_SYMBOLS=1`, C/C++/assembly debug flags beginning `-gdwarf-4`, and
Rust defaults `-C debuginfo=2 -C strip=none`. C/C++ optimization remains `-O2`
(SpiderMonkey `-O3`); these are separate configuration choices.

The reusable shipping recipe now adds `ac_add_options --disable-debug-symbols`.
The native `defs.mk` adapter adds `-Wl,--strip-debug` only to `firefox`,
`plugin-container` and `xpcshell` on Linux/wasm32. Configure prevents DWARF in
new Mozilla and Cargo C/C++/Rust compilation. Final wasm-ld stripping also
removes DWARF from prebuilt native sysroot/dependency archives, **before** the
compiler driver's original automatic Binaryen `-O2`. Linker stripping preserves
function names before optimization; the unchanged automatic `-O2` can remove
them. It preserves native Wasm exceptions, imported shared memory, exported
growable table, stack/TLS globals and the existing eight MiB stack contract.
It does not change `gfxtest`, diagnostic sanitizer fixtures or runtime backtrace
policy. Existing explicitly unavailable native unwind queries remain unavailable.

No active recovery source, recipe, generated configuration, object or browser
was changed by this packet. The user subsequently requested a baseline rebuild
without debug symbols, and its owner stopped/reaped Run52. Applying this packet
to that recovery tree requires the owner's retained exact-group-empty proof
and frozen completed-output/configuration evidence first. Preserve those
completed artifacts; then update both recipe `mozconfig` and source `.mozconfig`
and the source-root native `defs.mk` adapter before ordinary configure/build.
The later whole broad-PBL/JIT build still uses its independent source/object
tree and rebased writable paths.

Reconfigure naturally requires recompilation. The actual upstream
`config/rules.mk:338` places generated `config/autoconf.mk` in `GLOBAL_DEPS`,
and line 524 makes all C/C++ target/host/program objects depend on that list.
`config/config.mk:42` also puts each `backend.mk` there. Removing
`MOZ_DEBUG_SYMBOLS` changes generated autoconf values and the actual
`COMPUTED_CFLAGS`/`COMPUTED_CXXFLAGS` debug entries in backend files. Their
changed bytes and ordinary new mtimes invalidate old objects without deleting
them or falsifying timestamps. `config/makefiles/rust.mk` unconditionally runs
`force-cargo-library-build`; regenerated Rust flags/specifications change Cargo
fingerprints. Cargo's actual release profile has no debug override. This is a
source-derived rebuild guarantee; the actual reconfigure/rebuild is a separate
owned phase and must retain command/object evidence.

Before accepting the rebuild, inspect generated `MOZ_DEBUG_SYMBOLS` as
absent/false; verify C/C++, assembly, Cargo C/C++ and rustc commands do not
generate DWARF, Rust defaults omit `debuginfo=2`/`strip=none`, and optimization
and ABI flags remain intact. Verify all naturally rebuilt Mozilla native
objects and current Rust archive members have no `.debug_*` custom sections.
Imported archives may retain their original DWARF on disk, so verify actual
final program links include the scoped strip flag and linked modules have no
`.debug_*` sections. Keep serial full-build optimization under the current
supervisor bounds. Less DWARF reduces input/output size; it does not prove that
the remaining code IR fits every optimizer memory limit.

The reproducible lightweight probe is
`tools/nightly-musl/probes/no-debug-symbols/probe.py`. Selected evidence is
`/mnt/p6/build/firefox-nightly-no-debug-20261003/probe-run5/result.json`:
101 checks pass, zero fail. It evaluates the actual upstream Rust configure
and C/C++/assembly frontend flag branches, inspects the actual Cargo release
profile, executes real scoped make rows, and compiles real native-Wasm C, C++
and Rust objects with/without DWARF. A deliberately debug-bearing static
archive links through the actual driver with unchanged automatic `-O2`.
Direct execution of the driver-reported wasm-ld row proves DWARF is removed
before Binaryen sees the module. WABT validates both preoptimizer and optimized
images. All noncustom preoptimizer sections are byte-identical; postoptimizer
non-code contract sections and actual instruction sequences also match.
Binaryen groups equivalent local declarations differently without DWARF, so
postoptimizer code-section byte equality is explicitly not claimed. Node's
real WebAssembly engine executes direct/indirect calls and native exception
catching in both optimized modules. These are small-module checks, not Linux
guest or full Firefox acceptance.

Failed probe runs remain retained: Run1 incorrectly assumed the optimizer's
absolute path rather than the actual environment's Binaryen129; Run2 expected
a defined tag section although this fixture correctly imports its native
exception tag; Run3 exposed equivalent local-declaration regrouping after
optimization. Run4 passed 85 checks; Run5 adds Cargo and scoped make checks.
These corrections change evidence predicates, not the compiler, link recipe,
code optimizer or native exception behavior. No browser, GPU or Sites release
acceptance is established here.

## Actual recovery rebuild and object-stage transition

Configure run6-no-debug passed after the narrow native Linux/wasm32 ELF-policy
adapter. Actual generated configuration passes 1556 checks, including C/C++/
assembly flags, Rust defaults and the three strip-before-original-O2 final-link
rows. Run53 naturally rebuilt Cargo: its current libgkrust.a is 204,433,482
bytes with 7098 native Wasm members and no `.debug_*` sections. Its pinned
SHA256 is `773e119a73dd8777f57a143f1620973257a53683b572e2a1f9d8217fac019efd`.

The user authorized faster object compilation followed by serial final links.
Run53 was stopped/reaped (child -15, unified 59109 exit 143, PGID 98039 empty),
retaining 109 fresh non-Cargo native objects and the completed Rust archive.
The explicit opt-in object-only mode admits 577 generated goals whose actual
GNU make closure has 589 nodes and no program links. Its 24 focused admission
and inherited-guard checks pass. Default full-build behavior remains unchanged.

Run54-objects is running under owner `/root/restart_no_debug_nightly`, exact
PGID 160603/unified 4372: j4, 7200 seconds, AS 64 GiB, polled RSS 48 GiB,
available-RAM floor 2 GiB, core 0, oom_score_adj 1000, disk cap 32 GiB and
reserve 20 GiB. All four observed compiler children omit debug flags. Check
its current status rather than treating this launch observation as completion.
Reap and prove the group empty before the ordinary j1 full build/final links
with unchanged original Binaryen-O2. No active source/config/recipe mutation
is permitted while this owner is running. Selected launch and terminal pins
are in `tools/nightly-musl/evidence/object-only-parallel-stage.json`.

Object-stage completion is not full-build acceptance. Actual Mozilla object
freshness/no-DWARF review, serial final build, baseline package/guest acceptance
and later broad JIT acceptance remain required. After the full no-debug rebuild,
write actual final Firefox size/path and lessons/mistakes to repository diary.md;
this mandatory followup remains pending. No optimizer-memory benefit or new
public Sites release is claimed.
