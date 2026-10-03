The full Nightly baseline build now completes the Pixman shared-header rebuild:
all763 actual consumers are current. Run41 rebuilt156 native objects and reached
the three final program links, then exited2 on Expat duplicate definitions.
Its actual boundary review passes4148 predicates; the separate1533-check header
review proves all consumers are coherent. Existence of objects alone is not
browser acceptance. The retained66 error records are link diagnostics, including
the compiler driver's final error, rather than failed C/C++ compilation.

Firefox bundles a UTF-16 Expat implementation behind its `MOZ_XML_*` wrappers;
the static GTK dependency closure also needs its own UTF-8 Expat. Their shared
global names must be separated while retaining both implementations. An actual
native-symbol census finds58 duplicate definitions across the bundled parser's
three objects and the installed static Expat archive. An undefined-symbol scan
of all3011 native graph objects finds12 references to those names, all inside
the bundled parser. This permits a preinclude limited to `parser/expat`.

`tools/nightly-musl/recipe/native-expat-static-port.py` adds the private alias
header and a local `defs.mk`; the normal computed C flags preinclude it only
for native Linux/Wasm and track both files as global prerequisites. All58
colliding public/internal/data symbols receive `_moz_native_static_` names.
No upstream parser source or public header is changed. The installed system
Expat archive remains unchanged, as do all28 source-declared Mozilla wrapper
exports. No whole-program forced include or duplicate-definition suppression
is used.

The actual scoped `mach build --allow-subdirectory-build
parser/expat/target-objects -j4 --verbose` succeeds and rebuilds all three units.
Their actual command lines include the adapter; dependencies record it; each
object passes `wasm-validate --enable-all`. An independent143-check review
confirms all58 private definitions, absence of old definitions/references,
resolution of private cross-unit references, all28 wrapper exports and zero
remaining duplicate definitions against the unchanged system archive.

Evidence is in `tools/nightly-musl/evidence/native-expat-static.json` and
`full-build-boundary-coherence-run41.json`, with logs, source/archive pins and
the full review under `/mnt/p6/build`. The first review mistakenly assumed at
least30 wrappers; source inspection establishes exactly28 with no missing
exports. The corrected review requires exact equality with that source list.
This is native compile/link preparation. The full Firefox retry, transformed
browser validation, guest startup, broad JIT safety/performance and deployment
remain pending.
