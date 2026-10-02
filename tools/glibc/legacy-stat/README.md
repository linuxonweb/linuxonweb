# GNU legacy stat conversion architecture provider

This fresh signed GNU glibc 2.44 replay closes the actual `io/xstatconv.o`
make target. It keeps the public native Wasm version constants at zero and
the 128-byte GNU time64 ABI. A distinct measured 104-byte kernel input and
GNU nanosecond/pad capability markers supply the missing architecture layout.
An owned architecture copy of GNU `xstatconv.c` adds only three conditional
guards around duplicate kernel-version labels; GNU conversion bodies and the
original generic source stay unchanged. Version zero selects GNU conversion
to the public format. No 104-byte raw-copy public API is introduced.

Provide the cumulative replay environment and a fresh ext4 `GLIBC_TASK`, plus
`GLIBC_CUMULATIVE_PACKET`. `verify.py` pins all borrowed cumulative tools to
its immutable manifest. The 2 GiB cap, 8 GiB launch reserve, 5 GiB stop and
task-local temporary/cache policy remain enforced.

```sh
source tools/glibc/legacy-stat/env.sh
python3 tools/glibc/legacy-stat/supervise.py prepare 240 \
  bash tools/glibc/legacy-stat/prepare.sh
python3 tools/glibc/legacy-stat/supervise.py build 120 \
  python3 tools/glibc/legacy-stat/build.py
export BINARYEN_CORES=2
python3 tools/glibc/legacy-stat/supervise.py hostbuild 120 \
  python3 tools/glibc/legacy-stat/build-host.py
python3 tools/glibc/legacy-stat/supervise.py hosttest 60 \
  node tools/glibc/legacy-stat/test.mjs "$GLIBC_TASK/objects/native.wasm" \
  "$GLIBC_TASK/objects/fpcast.wasm" "$GLIBC_TASK/logs/host-result.json"
python3 tools/glibc/legacy-stat/supervise.py audit 120 \
  python3 tools/glibc/legacy-stat/audit.py
```

The six actual GNU make units include fresh errno and memory support. The
closed native/FPCAST host modules test synthetic inputs, not kernel syscalls.
Twenty field offsets, size and alignment compare directly with the retained
asm-generic UAPI. Tests cover signed 32-bit timestamps, nanoseconds, 64-bit
fields, full output bytes, errno and invalid versions, with contiguous guards.
GNU clears its named pad fields while leaving reserved/time padding unchanged;
the full-byte expected output explicitly checks that behavior.

The audit preserves configure probes separately from successful selected
units and records every source snapshot, actual dependency, driver, stage and
target-layout diagnostic. No full libc archive, installed sysroot, new stat
guest gate or Nightly acceptance is claimed.
