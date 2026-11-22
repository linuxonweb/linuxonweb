#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
python3 "$ROOT/provider-select.py"
printf '%s\n' "$TASK/objects/guest/"*.o > "$TASK/logs/link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto" -Map "$TASK/logs/link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/checked-jump.wasm" > "$TASK/logs/link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/checked-jump.wasm"
wasm-objdump -x "$TASK/objects/checked-jump.wasm" > "$TASK/logs/abi.log"
storage_check
