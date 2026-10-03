# Native Nightly browser link contract — 2026-10-03

Firefox 159.0a1 uses native Linux/musl Wasm. The resolved Firefox linker command
previously had shared memory and table-base=3 from the toolchain, but omitted
import-memory, the memory ceiling, exported/growable table and stack contract.
Rust's static-library target pre-link flags do not reach the final C++ link.
The guest worker uses the exported table for callbacks and runtime JIT.

The existing root defs.mk adapter now adds these flags only to firefox,
plugin-container and xpcshell under the existing Linux_wasm32 gate:

- imported shared memory, maximum 4 GiB;
- exported growable indirect function table;
- exported __stack_pointer and 8 MiB stack, matching the actual Rust target.

The replay delta is tools/nightly-musl/patches/nightly-native-program-contract.patch.
The final adapter is tools/nightly-musl/adapters/defs.mk. Original source is
preserved under the recovery task's static-names-preflight directory.
No upstream Firefox implementation or generated backend input is changed.

Forced real make dry links and actual compiler -### invocations resolve the
flags for all three programs. The forced gfxtest link has none of the new
program-specific flags; shared memory remains its existing toolchain default.
The old xshm-gfxtest-dry-run1.log only said up-to-date; it did not print a link
command and is not evidence of the command's contents. The current forced
probe replaces that weak observation. All 1,417 inspected generated inputs
remain hash-identical.

A separate output from gfxtest's real link command with the proposed contract
links successfully and passes wasm-validate --enable-all. Its actual memory
import is env.memory, initial140/max65536/shared. Its exported table has
initial826 and no maximum; 823 entries begin at index3. Its mutable exported
stack pointer starts at8388608. Element segment geometry and indirect signature
histograms match the earlier helper; function counts differ (1154 vs1180),
so no claim of identical function ordinals is made.

The inspector's stack-global lookup now accepts the actual objdump '- global'
prefix; the raw dump and source snapshot bind the corrected measurement.
Earlier inspector evidence keeps its original source snapshot.

Root review native-program-contract-review-run3.json passes 1,490 predicates
and is pinned by tools/nightly-musl/evidence/native-program-contract.json.
The first scope reviewer wrongly expected no toolchain shared-memory flag in
gfxtest; the first two root review attempts had incorrect field/gate assumptions.
They remain preserved and are not passing results.

The preceding full build Run39 reached its20-minute bound, was reaped with
exit143 and an empty owned process group, and recorded no compiler errors.
It rebuilt189 objects during the phase;265 changed relative to Run38 including
intervening component builds. All3011 graph objects are present;4149 boundary
checks pass. This is progress toward linking, not full browser acceptance.

Next: continue natural shared-header rebuild, then real final Firefox links,
validation and baseline guest startup. Fresh complete PBL/JIT compilation,
benchmarks and guest acceptance follow. No Nightly browser/JIT/GPU acceptance
or deployment is established by this packet; public Sites v10 stays unchanged.
