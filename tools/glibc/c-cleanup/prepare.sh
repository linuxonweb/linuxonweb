#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
[ ! -e "$TASK/source/glibc-2.44" ] || { echo 'fresh signed replay required' >&2; exit 2; }
bash "$ROOT/../replay-source.sh" "$GNU_RELEASE_ARCHIVE"
bash "$ROOT/../probes/configure-port.sh"
bash "$ROOT/../probes/generate-metadata.sh"
python3 "$ROOT/../jumps/prepare.py"
"${GLIBC_HOST_CXX:-/usr/bin/g++}" "$ROOT/../jumps/lower.cpp" $("$TOOLCHAIN/bin/llvm-config" --cxxflags --ldflags --libs core irreader bitwriter support --system-libs) -o "$TASK/objects/lower" > "$TASK/logs/lower-build.log" 2>&1
"${GLIBC_HOST_CXX:-/usr/bin/g++}" "$ROOT/../fullmake/warnings.cpp" $("$TOOLCHAIN/bin/llvm-config" --cxxflags --ldflags --libs core irreader bitwriter support --system-libs) -o "$TASK/objects/warnings" > "$TASK/logs/warnings-build.log" 2>&1
python3 "$ROOT/../jumps/fullmake-overlay.py"
python3 "$ROOT/../fullmake/prepare.py"
bash "$ROOT/../fullmake/configure.sh"
make -C "$TASK/objects/fullmake" -j1 "$TASK/objects/fullmake/abi-versions.h" "$TASK/objects/fullmake/libc-modules.h" "$TASK/objects/fullmake/dl-tunable-list.h" "$TASK/objects/fullmake/libc-abis.h" > "$TASK/logs/fullmake-metadata.log" 2>&1
source "$ROOT/../probes/gnu-flags.sh"
printf -v generator_cc '%q ' "$TOOLCHAIN/bin/clang" "${flags[@]}"
python3 "$SRC/scripts/gen-as-const.py" --cc "$generator_cc" "$SRC/csu/sem_t-align.sym" > "$TASK/objects/fullmake/sem_t-align.h"
storage_check
