# Nightly XPTCall on native Wasm

Run43 reached final linking but had no Wasm backend for XPCOM interface calls.
Run44 compiles a new adapter against the actual Firefox159 Nightly headers and
resolves those missing stub and invocation symbols. It does not link the
complete browser yet: four runtime functions remain unresolved.

The adapter uses the already required Binaryen23-i64 indirect-call ABI. It
marshals input and output values using current XPIDL metadata instead of a
bounded list of specific signatures. Integer/pointer/f32 slots zero-extend;
i64 and f64 retain all bits. Hidden context and optional-argument positions
match the current CallMethodHelper. Proxy creation rejects over-capacity
interfaces before they escape. Reference methods and all five sentinel slots
are retained; the two vtable header words and allocation lifetime are preserved.

There are three narrowly gated upstream hook files: select the new backend,
initialize its per-interface vtable at proxy creation, and own/account for the
vtable allocation. The backend is a new adapter file. These hooks are necessary
because the original platform graph selects no Wasm implementation and the
original object cannot install metadata-driven virtual entries. Non-Wasm
platforms retain their original behavior. Source preimages are preserved.

Actual native xptcall.o and xptcall_wasm32.o are linked into an isolated probe
using real current headers and a fixture XPT catalog. Fourteen real Wasm cases
cover both directions,13 scalar types, high64-bit values, signed zero and NaN
payloads, hidden context/argc ordering, zero arguments, indirect out storage,
reference methods, slot249,22 argument capacity and invalid-capacity rejection.
The raw module traps on the mismatched calling convention as expected. The
required fpcast module passes every case and independent rerun; every one of
its511 actual indirect targets has the23-i64 signature. Real browser/guest
startup is still required, and raw modules must never be packaged as executable
browser candidates with this adapter.

The complete generated metadata census has7853 method records, maximum14
arguments including hidden arguments, within the22 available argument slots.
Root3879 predicates bind the actual native graph, exact four generated-input
changes, compiled symbols, source/log/module hashes, real validator calls and
actual executions. Existing Rust archive content remains unchanged and all763
Pixman consumers are coherent. Scope is explicit: these are isolated Wasm
semantics and native build checks, not guest JIT or browser acceptance.

Run44 remains terminal with exit2. Next missing symbols are
`__cxa_thread_atexit_impl`, `_Unwind_GetCFA`,
`_Unwind_FindEnclosingFunction` and `_Unwind_Backtrace`. Preserve real Wasm
exception handling and implement the destructor lifecycle before retrying.
Evidence: `tools/nightly-musl/evidence/native-xptcall.json`. Public Sites v10
and production runtime payloads remain unchanged.

The calling-convention design was checked against Binaryen's
[FuncCastEmulation implementation](https://github.com/WebAssembly/binaryen/blob/main/src/passes/FuncCastEmulation.cpp)
and verified using the locally installed transformer on the actual probe.
