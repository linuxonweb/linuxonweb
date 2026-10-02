# Native checked jumps in genuine GNU make

`prepare.sh` performs a fresh signed GNU replay and accepted cumulative
configure/metadata generation. `overlay.py` verifies the frozen native jump
helper, then separates its unchanged ordinary and checked bodies into GNU's
actual architecture-selected source units. The checked unit includes GNU's
internal `setjmp.h` declaration. No generic Linux fallback, unchecked alias or
new jump ABI is introduced.

Use the standard `tools/glibc/env.sh` task/toolchain/kernel settings, plus
`GLIBC_STAT_RUNTIME_PACKET`, `GLIBC_C_CLEANUP_PACKET` and `GNU_RELEASE_ARCHIVE`
for the immutable prerequisites. All storage/temp/cache goes in the ext4 task.
Run finite supervision with unique labels:

```sh
python3 tools/glibc/cumulative-make/supervise.py prepare1 240 \
  bash tools/glibc/checked-jump-make/prepare.sh
python3 tools/glibc/cumulative-make/supervise.py build1 120 \
  python3 tools/glibc/checked-jump-make/build.py run1
```

`build.py` invokes genuine GNU subdirectory make for `setjmp/__longjmp.o`
and `debug/____longjmp_chk.o`. It validates Wasm, actual selected sources,
retained compiler attempts and distinct symbol providers. Repeated labels
must be unique; completed objects from the same fresh task may be reused.
This is GNU source-selection/compile acceptance. Runtime substitution of both
objects into the complete regression payload is a separate required gate.
