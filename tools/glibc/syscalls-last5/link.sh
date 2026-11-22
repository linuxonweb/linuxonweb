#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
label=${1:?Unique link label}
[[ "$label" =~ ^[a-zA-Z0-9_-]+$ ]]
[[ ! -e "$TASK/objects/last5-$label.wasm" && ! -e "$TASK/logs/last5-$label-link.log" ]]
printf '%s\n' "$TASK/objects/guest/"*.o > "$TASK/logs/last5-$label-link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-$label" -Map "$TASK/logs/last5-$label-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/last5-$label.wasm" > "$TASK/logs/last5-$label-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/last5-$label.wasm"
wasm-objdump -x "$TASK/objects/last5-$label.wasm" > "$TASK/logs/last5-$label-abi.log"
storage_check
