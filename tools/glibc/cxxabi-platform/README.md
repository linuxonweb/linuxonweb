The native GNU/Linux Wasm target defaults to generic Itanium C++ ABI. Select
`-fc++-abi=webassembly` for **every C++ translation unit** in a fresh coherent
closure: Firefox, libc++, libc++abi, C++ dependency libraries and fixtures.
Keep the actual GNU target and genuine glibc headers/libraries. C units do not
use this C++ option. Constructor/destructor return conventions and member
pointer representations change, so generic Itanium objects cannot be mixed
into the new closure. Historical build trees remain separate.

The option supplies the catchret exits missing from the default GNU-target
C++ frontend and fixes odd function-table indices in member-function pointers.
The diagnostic here checks nonvirtual calls, virtual overrides and adjusted
`this` pointers for multiple inheritance, with actual native Wasm execution
and zero imports. It covers O0 and O2. Its default-ABI negative controls retain
the actual traps; the selected-ABI variants must pass all 256 calls per mode.
This is compiler ABI evidence, not acceptance of glibc, a guest or Firefox.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/glibc/cxxabi-platform/run.py \
  --task /mnt/p6/build/NEW-cxxabi-diagnostic \
  --toolchain /path/to/raw/llvm-22.1.8 \
  --node /path/to/node
```

The task must be fresh. Sources, commands, module disassembly, actual member
pointer words, all traps and input/output hashes are retained. Each subprocess
has a 60-second deadline, an owned process group and unconditional cleanup.
All temporary/cache paths are under the task; launch reserve is 8 GiB, hard
stop 5 GiB and task cap 2 GiB. The source fixture is header-free and links with
strict unresolved-symbol checks; it cannot hide a substituted libc.

The first accepted root run is
`/mnt/p6/build/glibc-wasm-member-pointer-root1-20261002/proof.json` (SHA256
`177c6618f5142f668a9f871e56770ce799ec12aaf3b19384fd7fc3c2243df24c`).
Selected ABI passes 512/0 across O0/O2; generic Itanium traps 128 times per
mode, including the odd-index nonvirtual and adjusted calls. An independent
reread verifies all 19 pins and freshly confirms 16 terminal groups empty.
