# Genuine GNU libio data aliases — 2026-10-02

The owned native adapter compiles the retained genuine `libio/vtables.c`
frontend into a valid Wasm object while preserving its table and public alias
addresses. Its original ELF assembly was a fullmake blocker. No GNU source,
stdio implementation, loader or runtime algorithm is replaced.

`_IO_file_jumps` and `_IO_wfile_jumps` alias the original `__io_vtables` array
at offsets168 and420. GNU's selected jump-table structure is84bytes (two32-bit
placeholders and19 Wasm32 function pointers). The strict frontend adapter
recognizes both complete genuine GNU directive groups and emits LLVM offset
aliases. Unexpected target/layout/directives fail; unrelated assembly stays
subject to the existing metadata verifier.

The first backend/linked address controls passed, but independent Wasm symbol
inspection found LLVM records alias sizes1008 and756: the remaining backing
array extents. That initial probe, acceptance and executed source are preserved
under `/mnt/p6/build/glibc-data-alias-probe-20261002/attempt1`. The object adapter
now corrects only these two linking-symbol size fields to GNU's exact84bytes,
checking the original array extent, same segment, expected offsets and global
binding. Independent section comparison proves code, data, relocations and
all other sections outside linking metadata are byte-identical.

Final controls pass 8 independent linked assertions: exported alias addresses,
offsets, separate-consumer pointer identity and actual indirect function
calls. Seven malformed frontend controls and eleven malformed object-metadata
controls fail; repeated metadata correction is byte-idempotent. Ordinary non-alias IR passes
unchanged. The genuine GNU frontend compiles and validates; its actual symbol
table has the original hidden1176-byte storage and public84-byte aliases.
No missing GNU function is faked or resolved permissively: the linked dispatch
control uses explicitly labeled fixture storage and a separate native C
consumer, rather than claiming a complete GNU stdio runtime.

Final evidence is in `/mnt/p6/build/glibc-data-alias-final-20261002/acceptance.json`
and retained command/stdout/stderr files. The original frontend is an immutable
fullmake-inventory input, SHA256
`c812a10d5896333c3bf303c3a98eec712d890c98bfd44034a3a52816675cba80`.
Replay/integration instructions are in
[the adapter README](../tools/glibc/data-alias/README.md).

This adapter was not integrated into the completed cumulative fullmake
run. A separate subsequent genuine GNU target rebuild must prove that closure;
full stdio, GNU archive/sysroot/NPTL and Nightly/JIT/GPU remain unfinished.
