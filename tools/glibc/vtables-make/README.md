# Genuine GNU vtables make integration

This builds unchanged GNU glibc 2.44 `libio/vtables.c` through its actual make
target in a fresh signed-source replay. It integrates the separately reviewed
GNU offset-alias IR adapter and symbol-size correction into an owned compiler
driver. No preceding build tree or object is modified or copied as the result.

Supply the cumulative task's environment, a new ext4 `GLIBC_TASK`,
`GLIBC_CUMULATIVE_PACKET` and `GLIBC_ALIAS_PACKET`. The exact adapter hashes are
pinned in `verify.py`. The inherited 2 GiB task cap, 8 GiB launch reserve,
5 GiB stop and task-local temporary/cache paths apply.

```sh
source tools/glibc/vtables-make/env.sh
python3 tools/glibc/vtables-make/supervise.py prepare 240 \
  bash tools/glibc/vtables-make/prepare.sh
python3 tools/glibc/vtables-make/supervise.py build 120 \
  python3 tools/glibc/vtables-make/build.py
python3 tools/glibc/vtables-make/supervise.py audit 90 \
  python3 tools/glibc/vtables-make/audit.py
```

The driver is selected only for this one make target. Its alias passes require
the exact GNU vtable definitions; it is not a general compiler entry point.
The audit independently checks strong data-symbol offsets/extents, unchanged
code/data/relocation sections, every actual dependency, raw IR and stage exit
status. Failed or malformed inputs remain hard failures.

This closes one real make compilation blocker. Undefined genuine GNU stdio
providers remain in the relocatable object. It does not establish a complete
libc archive, linking closure, installed sysroot or stdio runtime. The separate
alias packet's linked controls remain separately labeled evidence.
