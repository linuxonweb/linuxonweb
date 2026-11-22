#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/arity-fixture-v2.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/arity-fixture.o" > "$TASK/logs/arity-fixture-v2.log" 2>&1
bash "$ROOT/link.sh"
