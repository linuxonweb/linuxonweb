#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
test -f "$TASK/logs/layout.json"
python3 "$ROOT/overlay.py"
python3 "$ROOT/select-generated.py"
for input in "$TASK/source/selected-final16-syscalls/"*.c; do
 storage_check
 name=$(basename "$input" .c)
 python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/generated-final16-$name.d" -c "$input" -o "$TASK/objects/guest/generated-final16-$name.o" > "$TASK/logs/generated-final16-$name.log" 2>&1
done
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/final16-signatures.d" -c "$ROOT/signatures.c" -o "$TASK/objects/final16-signatures.o" > "$TASK/logs/final16-signatures.log" 2>&1
storage_check
