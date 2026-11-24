#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../env.sh"
: "${GNU_RELEASE_ARCHIVE:?Set pinned signed GNU glibc 2.44 archive}"
[ ! -e "$TASK/source" ] || { echo 'fresh owned task required' >&2; exit 2; }
bash "$ROOT/../replay-source.sh" "$GNU_RELEASE_ARCHIVE"
bash "$ROOT/../probes/configure-port.sh"
bash "$ROOT/../probes/generate-metadata.sh"
python3 "$ROOT/../jumps/prepare.py"
"${GLIBC_HOST_CXX:-/usr/bin/g++}" "$ROOT/../jumps/lower.cpp" $("$TOOLCHAIN/bin/llvm-config" --cxxflags --ldflags --libs core irreader bitwriter support --system-libs) -o "$TASK/objects/lower" > "$TASK/logs/lower-build.log" 2>&1
storage_check
"${GLIBC_HOST_CXX:-/usr/bin/g++}" "$ROOT/../fullmake/warnings.cpp" $("$TOOLCHAIN/bin/llvm-config" --cxxflags --ldflags --libs core irreader bitwriter support --system-libs) -o "$TASK/objects/warnings" > "$TASK/logs/warnings-build.log" 2>&1
python3 "$ROOT/../jumps/fullmake-overlay.py"
python3 "$ROOT/../fullmake/prepare.py"
bash "$ROOT/../fullmake/configure.sh"
storage_check
python3 "$ROOT/run.py"
