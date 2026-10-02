#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
python3 "$ROOT/startup-overlay.py"
for unit in sem_init sem_post sem_getvalue sem_wait sem_destroy; do
 python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/gnu-$unit.d" -c "$SRC/nptl/$unit.c" -o "$TASK/objects/guest/gnu-$unit.o" > "$TASK/logs/gnu-$unit.log" 2>&1
done
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/sched-sem-fixture.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/sched-sem-fixture.o" > "$TASK/logs/sched-sem-fixture.log" 2>&1
cp "$TASK/objects/sched-sem-signatures.o" "$TASK/objects/guest/sched-sem-signatures.o"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/sched-sem-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/sched-sem-startup.log" 2>&1
printf '%s\n' "$TASK/objects/guest/"*.o > "$TASK/logs/sched-sem-link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-sched-sem" -Map "$TASK/logs/sched-sem-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/sched-sem.wasm" > "$TASK/logs/sched-sem-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/sched-sem.wasm"
wasm-objdump -x "$TASK/objects/sched-sem.wasm" > "$TASK/logs/sched-sem-abi.log"
storage_check
