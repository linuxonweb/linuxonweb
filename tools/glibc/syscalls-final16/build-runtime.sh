#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
python3 "$ROOT/scheduler-overlay.py"
python3 "$ROOT/startup-overlay.py"
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/final16-fixture.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/final16-fixture.o" > "$TASK/logs/final16-fixture.log" 2>&1
cp "$TASK/objects/final16-signatures.o" "$TASK/objects/guest/final16-signatures.o"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/final16-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/final16-startup.log" 2>&1
printf '%s\n' "$TASK/objects/guest/"*.o > "$TASK/logs/final16-link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-final16" -Map "$TASK/logs/final16-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/final16.wasm" > "$TASK/logs/final16-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/final16.wasm"
wasm-objdump -x "$TASK/objects/final16.wasm" > "$TASK/logs/final16-abi.log"
storage_check
