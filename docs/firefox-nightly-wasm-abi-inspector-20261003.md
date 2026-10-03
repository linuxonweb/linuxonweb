# Measure the linked Nightly JIT ABI — 2026-10-03

tools/nightly-jit-prep/inspect-wasm.py records a module's actual WABT section
dumps, imports, exports, table/memory/global/tag declarations, stack-pointer
export and initializer if present, and direct/element-target signature census.
It verifies function/code and element counts, rejects unparsed relevant records,
and binds binary/tool/inspector/log hashes. It preserves an inspector snapshot
and rejects an input module that changes during inspection. No table, memory,
stack value or historical Firefox128 identity is assumed or changed.

--require-fpcast accepts only nonempty real element targets whose signatures
are uniformly (23 i64) -> i64. It retains a failed result for a mismatched
signature. A section census does not validate code or establish guest behavior;
run the actual Wasm validator independently. Imported tables and memories are
reported as imports; absent defined sections remain absent.

Actual checks against this Nightly build and the broad emitter:

| Module | Functions | Element entries | Maximum element parameters |
| --- | ---: | ---: | ---: |
| Native pingsender | 616 | 592 | 8 |
| Same helper after actual fpcast | 972 | 592 | 23 |
| Native gfxtest | 1,154 | 823 | 9 |
| Actual broad emitted args loop | 1 | 0 | 0 |

The transformed helper's entire 592-entry element census is (23 i64) -> i64,
and actual wasm-validate passes. Requiring that contract on the raw helper
fails as expected. The emitted loop has the same function signature and imports
the real env.memory/env.table declarations. It has no element or defined-table
section, which the inspector handles through the actual section inventory.
All modules are host-side structural examples; none claims browser/JIT/GPU
guest acceptance. No new guest/browser ran while the full build was loaded.

Evidence: tools/nightly-musl/evidence/nightly-wasm-abi-inspector.json and
/mnt/p6/build/firefox-nightly-musl-root-review-20261002/wasm-inspector-review-run1.json.
The reviewed examples and real helper fpcast/validation logs are retained under
/mnt/p6/build/firefox-nightly-jit-musl-prep-20261002. Existing preparation cap
is 2 GiB with disk-backed scratch and a 20 GiB free reserve.

Run this tool on the actual completed raw Firefox, then on its separately
transformed image with --require-fpcast. Review the raw maximum element
parameter count before choosing the fpcast parameter bound. If Nightly requires
more than 23, revise the emitter/runtime/transform/probes together. Check the
actual table export, memory sharing/limits, stack/TLS exports and initialized
element ranges against the guest loader and JIT runtime. Helper counts above
do not determine the Nightly browser ABI.
