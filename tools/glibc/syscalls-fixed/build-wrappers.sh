#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
python3 "$ROOT/overlay.py"
python3 "$ROOT/select-generated.py"
for input in "$TASK/source/selected-fixed-syscalls/"*.c; do
 storage_check
 name=$(basename "$input" .c)
 python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/generated-fixed-$name.d" -c "$input" -o "$TASK/objects/guest/generated-fixed-$name.o" > "$TASK/logs/generated-fixed-$name.log" 2>&1
done
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/fixed-signatures.d" -c "$ROOT/signatures.c" -o "$TASK/objects/fixed-signatures.o" > "$TASK/logs/fixed-signatures.log" 2>&1
storage_check
