#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
python3 "$ROOT/build-make.py" "$1"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/memory-fixture-v3.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/memory-fixture.o" > "$TASK/logs/memory-fixture-v3.log" 2>&1
bash "$ROOT/link.sh"
