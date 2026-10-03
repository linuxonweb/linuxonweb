The Nightly JIT preparation now supports both the original integer control and
the existing broader loop specializer. Select the broader migration explicitly
with `tools/nightly-jit-prep/prepare.py --coverage broad`. The default remains
`integer` so existing diagnostic commands retain their meaning. Neither mode
builds or changes the live Firefox source.

The broader overlay preserves arguments, doubles, lexical/TDZ checks, dense
arrays (including compound assignment), monomorphic properties, guarded globals
and inlined Math operations. It regenerates all 239 opcode numbers and lengths
from the pinned Nightly159 source, updates the Watchtower API, and retains the
current PBL local/saved IC cursor, interrupt handling and debugger/coverage
exclusions. Unsupported operations still take the original compiler rejection
path. The integer-only whitelist and Int32-head restriction are absent only in
the explicitly selected broader overlay.

Actual preparation results, under
`/mnt/p6/build/firefox-nightly-jit-musl-prep-20261002`:

| Evidence | Result |
| --- | --- |
| `overlay-broad-run1` | 9 source-anchor checks, 239 source-derived opcodes |
| `host-broad-run1` | 1,969 checks, zero failures; ASan/UBSan and real emitted Wasm |
| `overlay-integer-run5` | All generated overlay bytes equal prior selected run4 |
| `host-integer-run3` | 972 checks, zero failures |
| `compile-broad-run1` | Actual wasm32-musl compiler succeeds; object 663,344 bytes |

The native object SHA-256 is
`55f2d09f24e1bd67fe704660c01abe675af3c9c37e9ece5eb0eb5d57e90f14de`.
It passes `wasm-validate --enable-all`. The source-context command retains
the native WebAssembly C++ ABI and asserts current 32-bit pointers/Value tags.
It uses an isolated diagnostic PBL configuration against baseline-generated
headers. It does not prove a fully configured PBL graph, linked frame/table ABI,
guest execution, performance or GC safety in the real browser.

Root independently checks 83 source, opcode, overlay, unchanged-control,
sanitizer, stdout/result, native object, validator and current hook predicates.
The review is
`/mnt/p6/build/firefox-nightly-musl-root-review-20261002/jit-broad-review-run1.json`,
SHA-256 `cbacfedddf50fdc4853c5f9ecf79076f06e6caef93ec8ed4bd3f1516d7f5ca95`.

Continue the complete Nightly baseline first. Then regenerate this broader
overlay from an immutable accepted source copy and build the entire PBL graph
in the separate task described by the full-build plan. Do not substitute these
diagnostic objects or an old128 archive into the browser. The final requirements
remain actual guest startup, current trust/TLS, frame/callback/table validation,
GC/debugger/coverage/interrupt checks, broad fixture correctness and comparative
performance, followed by the first already authorized Sites release. GPU work
and its second release follow JIT acceptance. Public Sites v10 is unchanged.
