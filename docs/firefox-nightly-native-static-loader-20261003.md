# Nightly native static loader and fatal termination

The first synchronous abort capture from the unchanged Run56 package retained
`failed to initialize shared libraries [Dynamic loading not supported]`.
Its source is NSPR `_PR_InitLinker`, which calls `dlopen(0, RTLD_LAZY)` before
creating its executable loadmap. Native Linux/Wasm has no dynamic loader.
The existing Firefox abort override then recursed through `mozalloc_abort`:
the generic crash path writes to linear address zero, which can be writable.
The recursive abort stack did not reveal the initial cause.

The two-file patch selects NSPR's existing null-handle initialization strategy
only for Linux/Wasm outside WASI. It retains real monitor initialization,
loadmap creation, static registration, symbol lookup and reference counting.
Registered `staticTable` objects skip `dlclose` on that target; real final
unload still removes and frees the object. Unsupported dynamic loads and
missing symbols still fail. Other platforms retain their original branches.
The native Firefox `abort()` override uses `__builtin_trap()` so fatal paths
terminate without recursion. The original `MOZ_CRASH` annotation survives.

The real Linux/Wasm guest passes 21 NSPR lifecycle checks and four negative
controls, for **25/0**. Original initialization prints the retained fatal
message and exits 139. Fixing initialization without the static unload guard
fails exactly two unload checks (19/2). Direct `abort` and `mozalloc_abort`
terminate with real traps. Six host Wasm controls additionally verify the
original recursion and preserved patched crash annotations. Non-Wasm
preprocessed function bodies remain equal. The guest uses six CPUs and 1 GiB
RAM; its browser and server close, the owner reaps exit zero, and both exact
process groups are empty.

The replay script takes explicit source and evidence directories:

```sh
python3 tools/nightly-musl/recipe/native-static-loader-port.py \
  --source /path/to/firefox-159.0a1 --evidence /fresh/port-evidence
```

It admits only the exact reviewed original or already-patched source hashes,
backs up originals before applying a pinned patch without fuzz, rejects
partial or unexpected changes, and records the result. A second actual replay
accepts the patched bytes without changing them. The same script and patch
are copied into the current recovery recipe for later source rebasing.

Normal `make target-objects` rebuilt only the two affected unified objects.
Both production object hashes equal the objects used by the guest fixture.
Bare `.o` make goals initially did no work because the generated rules load
dependency files for `target-objects`, `target`, `all` and `default`; that
no-op is retained separately. Existing compiler warnings are preserved.

The evidence packet records this unit gate and the start of ordinary Run57
under the unchanged j1/original-O2 recipe. It does **not** establish a completed
Run57 build or Firefox baseline/JIT/GPU acceptance. Those require terminal
ownership, raw validation, actual direct-LLD warning gates, fresh transformed
packaging and real guest startup. Run56 raw executables and its accepted native
Rust archive have independent, hash-verified copies before mutable relinks.

Evidence: [nightly-native-static-loader-20261003.json](evidence/nightly-native-static-loader-20261003.json).
