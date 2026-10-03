# Nightly native static inference adapter — 2026-10-03

Nightly159's inference graph still generated an ELF shared library. Native
Wasm linking failed on its soname and version-script options in Run33. The
native Linux/wasm32 branch now uses Library("mozinference"), and xul retains
that static library. The recursive backend flattens its211 implementation
objects into the browser executable graph; a standalone archive was not
produced by this bounded component phase.

The runtime adapter uses Mozilla's existing54-function list to construct an
NSPR static symbol table. Each entry references the actual globally declared
implementation. The native loader registers this table rather than locating
a dynamic library beside the executable. Existing function lookup, unload,
mutex, callbacks and initialization failure handling remain intact. Other
platforms retain the upstream dynamic loader. The two gated hooks are needed
because changing build flags alone leaves the runtime trying to dlopen a
library that cannot exist in this native Wasm profile.

The actual backend phase inference-run1 passes. llama-linker-run1 returned
up-to-date without compiling the changed source and is retained as a no-op,
not accepted compilation evidence. llama-linker-run2 uses the normal
target-objects entry point and recompiles the actual unified Firefox component.
Its native object contains all54 implementation references plus
PR_LoadStaticLibrary/PR_FindSymbol/PR_UnloadLibrary, without
PR_LoadLibraryWithFlags. Its real dependency file includes the new adapter.

Independent root review native-static-inference-review-run1.json under
/mnt/p6/build/firefox-nightly-musl-root-review-20261002 records3,031 checks.
All3,012 expected native object paths remain present. Six generated compile
inputs changed: the inference/llama/parakeet backends and browser/plugin/
xpconnect executable backends. root.mk also changes normally. These changes
are intentional; later full-boundary reviews must compare against the reviewed
new graph rather than assert equality to the old shared-library graph.

Source originals, original unified object and original dependencies are saved
in /mnt/p6/build/firefox-nightly-musl-recovery-20261002/static-inference-preflight.
Both actual component groups are terminal/reaped and empty. This proves native
compilation and graph integration only. Full browser linking and guest
inference behavior remain unverified; JIT/GPU acceptance and both authorized
Sites releases remain pending. Public v10 is unchanged.
