#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
python3 "$ROOT/overlay.py"
python3 "$ROOT/build-make.py"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/arity-fixture.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/arity-fixture.o" > "$TASK/logs/arity-fixture.log" 2>&1
python3 "$ROOT/startup-overlay.py"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/arity-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/arity-startup.log" 2>&1
bash "$ROOT/link.sh"
