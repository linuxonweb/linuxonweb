This packet builds five genuine GNU make targets through owned wasm32 architecture C implementations. GNU public headers, make rules, original generator stream bytes and aliases remain recorded. It does not establish full glibc or full `prctl` behavior.

Use a fresh task directory on persistent ext4, with at least 8 GiB free. Source the retained task `config.sh`, override `GLIBC_TASK` to the new directory, then source `env.sh`. All temporary storage, caches and browser profiles stay under that task. `supervise.py` enforces a 2 GiB task cap, a 5 GiB completion reserve and finite owned process groups.

From the repository root, the fresh replay is:

```bash
source /mnt/p6/build/glibc-syscalls-arity-20261002/config.sh
export GLIBC_TASK=/mnt/p6/build/glibc-syscalls-arity-replay-20261002
source tools/glibc/syscalls-arity/env.sh
python3 tools/glibc/syscalls-arity/supervise.py prepare 600 bash tools/glibc/syscalls-arity/prepare.sh
python3 tools/glibc/syscalls-arity/supervise.py build 300 bash tools/glibc/syscalls-arity/build.sh
python3 tools/glibc/syscalls-arity/supervise.py package 240 bash tools/glibc/syscalls-arity/build-guest.sh
GLIBC_HTTP_PORT=4204 GLIBC_CDP_PORT=9414 python3 tools/glibc/syscalls-arity/supervise.py native 300 node tools/glibc/syscalls-arity/run-guest.mjs jit "$GLIBC_TASK/native-run" "$GLIBC_TASK/native-package"
GLIBC_HTTP_PORT=4204 GLIBC_CDP_PORT=9414 python3 tools/glibc/syscalls-arity/supervise.py fpcast 300 node tools/glibc/syscalls-arity/run-guest.mjs jit "$GLIBC_TASK/fpcast-run" "$GLIBC_TASK/fpcast-package"
```

The runner mode is `jit` for both forms; the selected package carries either the native module or its FPCAST23i64 transformation. Run browsers sequentially on unoccupied owned ports. No production browser, kernel, Nix store, frozen predecessor or Git changes are required.

The executed packet retains all failed attempts and unique source versions. Its authoritative final modules are `objects/arity-v3.wasm` and `objects/arity-v3-fpcast.wasm`, packages `native-package3` and `fpcast-package3`, and runs `native-run3` and `fpcast-run2`. The earlier `arity.wasm` bytes are preserved for the failed native1 and scoped passing native2 attempts. `package-v2.sh`, `package-v3.sh`, `rebuild-fixture.sh` and `rebuild-closure.sh` reproduce the retained continuation steps; the fresh replay above builds the final implementation directly.

`audit.py` and `verify-terminal.py` audit the executed packet's named attempts. `freeze.py` requires root review authorization and freezes only this tools directory and its report. External terminal proof must precede freeze; freeze output and supervision belong outside the frozen task.
