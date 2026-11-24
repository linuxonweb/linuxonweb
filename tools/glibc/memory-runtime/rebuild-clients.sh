#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/memory-fixture-v4.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/memory-fixture.o" > "$TASK/logs/memory-fixture-v4.log" 2>&1
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/memory-startup-v4.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/memory-startup.o" > "$TASK/logs/memory-startup-v4.log" 2>&1
bash "$ROOT/link.sh"
