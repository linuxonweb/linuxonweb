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
bash "$ROOT/../build.sh" guest
bash "$ROOT/../jumps/build.sh"
"${GLIBC_HOST_CXX:-/usr/bin/g++}" "$ROOT/warnings.cpp" $("$TOOLCHAIN/bin/llvm-config" --cxxflags --ldflags --libs core irreader bitwriter support --system-libs) -o "$TASK/objects/warnings" > "$TASK/logs/warnings-build.log" 2>&1
python3 "$ROOT/../jumps/fullmake-overlay.py"
python3 "$ROOT/prepare.py"
bash "$ROOT/configure.sh"
make -C "$TASK/objects/fullmake" -j2 "$TASK/objects/fullmake/sysd-syscalls" > "$TASK/logs/generated-rules.log" 2>&1
set +e
timeout 90s make -C "$TASK/objects/fullmake" -j2 lib > "$TASK/logs/fullmake-lib-run1.log" 2>&1
status=$?
set -e
printf '%s\n' "$status" > "$TASK/logs/fullmake-lib-run1.exit"
# The current next blocker must remain an error, never be silently substituted.
[ "$status" = 2 ]
rg -q "hasn't implemented __builtin_return_address" "$TASK/logs/fullmake-lib-run1.log"
bash "$ROOT/build-guest.sh"
bash "$ROOT/../prepare-guest.sh"
python3 "$ROOT/test-metadata.py"
