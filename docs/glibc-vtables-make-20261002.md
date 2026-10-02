# GNU native Wasm vtables make closure

A fresh signed GNU glibc 2.44 replay built the actual `libio/vtables.o` make
target successfully. GNU `libio/vtables.c` is unchanged, SHA-256
`9c161c7cb8e8e29ce76622165cc9bef9c058c5ddb08ade1413687918f6861a18`.
The resulting 5,242-byte native Wasm object has SHA-256
`4d740463ea8b1ba997dde317bc5c8251fc3e35ddf1834826b1e3b5f57e34e09a`.

The owned driver applies the frozen GNU offset-alias adapter before the
accepted warning and jump passes, then corrects only the two known Wasm
linking-symbol size fields. Independent object inspection confirms strong
public `_IO_file_jumps` at offset 168 and `_IO_wfile_jumps` at offset 420,
both exactly 84 bytes in the same segment as the unchanged hidden 1,176-byte
`__io_vtables` storage. All eleven other sections, including executable code,
data and relocations, are byte-identical before and after the size correction.
The final object passes Wasm validation.

Evidence lives under `/mnt/p6/build/glibc-vtables-make-20261002`. The audit in
`logs/vtables-audit.json` pins 364 actual source/header dependencies, the
unchanged GNU source and its retained snapshot, the compiler driver version,
raw IR, every stage command/cwd/exit, and the actual GNU make invocation.
Replay, build and audit supervisors exited zero and left no live owned group
members. The reviewed adapter prerequisites are the separate immutable
`/mnt/p6/build/glibc-data-alias-final-20261002` packet; its linked pointer,
value and dispatch controls are not represented as a new GNU runtime gate.

This is one genuine compilation closure after the cumulative build discovery.
No GNU implementation or vtable entry was removed, no unresolved provider was
suppressed, and no preceding frozen object or source was modified. Genuine
undefined stdio and loader providers remain in this relocatable object. A
complete `libc.a`, installed sysroot, stdio runtime, NPTL, Nightly browser,
JIT and GPU acceptance remain unfinished. The compiler entry point is bounded
to this target and retains the prior forced O2 diagnostic pipeline.

Replay commands and required environment are in
`tools/glibc/vtables-make/README.md`. The inherited disk-backed 2 GiB task cap,
8 GiB launch reserve, 5 GiB hard stop, task-local temporary/cache directories
and at most two make jobs apply.
