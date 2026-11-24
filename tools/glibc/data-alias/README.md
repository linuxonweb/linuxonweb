# GNU libio aliases on native Linux/Wasm

`normalize.py input.ll output.ll` recognizes only the two genuine GNU
`libio/vtables.c` ELF offset-alias directive groups. It preserves table storage
and runtime IR, and emits native LLVM aliases for `_IO_file_jumps` and
`_IO_wfile_jumps` at offsets 168 and 420. Unexpected layouts/directives fail.
Other assembly remains for the existing warning/metadata verifier.

LLVM's Wasm backend sizes an offset alias through the end of its backing array.
After the backend, `fix-symbol-sizes.py input.o output.o` restores both GNU
84-byte alias sizes in the linking symbol table. It validates the alias binding,
segment, offset and backing-array extent. Every other code/data/relocation
section remains byte-identical. Run this object adapter only on the recognized
GNU vtable translation unit. Neither adapter changes GNU source or supplies
missing stdio implementations.

Run independent linked controls in a new ext4 task directory:

```sh
PYTHONDONTWRITEBYTECODE=1 \
GLIBC_ALIAS_TASK=/mnt/p6/build/glibc-data-alias-new-check \
python3 tools/glibc/data-alias/test.py
```

The test compiles retained immutable genuine GNU frontend IR, rejects malformed
alias inputs, checks actual Wasm symbol offsets/sizes, and links a separate C
consumer against fixture storage. Exported addresses, pointer identity and
indirect dispatch are checked by Node. The pinned LLVM 22.1.8 toolchain and
original fullmake frontend are exact test prerequisites. All temporary files
are task-local. This is native alias acceptance; fresh GNU make and complete
stdio/sysroot acceptance remain separate.
