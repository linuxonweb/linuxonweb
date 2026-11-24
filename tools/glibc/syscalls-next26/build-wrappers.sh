#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
python3 "$ROOT/overlay.py"
python3 "$ROOT/select-generated.py"
for input in "$TASK/source/selected-next26-syscalls/"*.c; do
 storage_check
 name=$(basename "$input" .c)
 python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/generated-next26-$name.d" -c "$input" -o "$TASK/objects/guest/generated-next26-$name.o" > "$TASK/logs/generated-next26-$name.log" 2>&1
done
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/next26-signatures.d" -c "$ROOT/signatures.c" -o "$TASK/objects/next26-signatures.o" > "$TASK/logs/next26-signatures.log" 2>&1
storage_check
