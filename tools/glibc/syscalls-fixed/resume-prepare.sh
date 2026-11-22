#!/bin/bash
# Retry only configure/metadata after a retained configure failure; no replay.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
bash "$ROOT/configure.sh"
make -C "$TASK/objects/fullmake" -j1 "$TASK/objects/fullmake/abi-versions.h" "$TASK/objects/fullmake/libc-modules.h" "$TASK/objects/fullmake/dl-tunable-list.h" "$TASK/objects/fullmake/libc-abis.h" > "$TASK/logs/fullmake-metadata.log" 2>&1
source "$ROOT/../probes/gnu-flags.sh"
printf -v generator_cc '%q ' "$TOOLCHAIN/bin/clang" "${flags[@]}"
python3 "$SRC/scripts/gen-as-const.py" --cc "$generator_cc" "$SRC/csu/sem_t-align.sym" > "$TASK/objects/fullmake/sem_t-align.h"
python3 "$ROOT/reuse-runtime.py"
storage_check
