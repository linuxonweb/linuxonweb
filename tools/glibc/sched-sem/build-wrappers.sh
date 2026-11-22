#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
python3 "$ROOT/overlay.py"
python3 "$ROOT/select-generated.py"
for input in "$TASK/source/selected-sched-sem-syscalls/"*.c; do
 storage_check
 name=$(basename "$input" .c)
 python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/generated-sched-sem-$name.d" -c "$input" -o "$TASK/objects/guest/generated-sched-sem-$name.o" > "$TASK/logs/generated-sched-sem-$name.log" 2>&1
done
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/sched-sem-signatures.d" -c "$ROOT/signatures.c" -o "$TASK/objects/sched-sem-signatures.o" > "$TASK/logs/sched-sem-signatures.log" 2>&1
storage_check
