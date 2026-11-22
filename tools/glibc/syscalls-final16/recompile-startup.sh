#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
label=${1:?unique label};[[ "$label" =~ ^[a-zA-Z0-9_-]+$ ]]
[ ! -e "$TASK/objects/final16-$label.wasm" ]
python3 "$ROOT/compiler.py" "${flags[@]}" -c "$TASK/source/startup.c" -o "$TASK/objects/startup-$label.o" > "$TASK/logs/startup-$label.log" 2>&1
inputs=( "$TASK/objects/guest/"*.o );selected=();for x in "${inputs[@]}";do [[ "$x" == */startup.o ]] || selected+=( "$x" );done
selected+=( "$TASK/objects/startup-$label.o" )
printf '%s\n' "${selected[@]}" > "$TASK/logs/final16-$label-link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-$label" -Map "$TASK/logs/final16-$label-link-map.txt" "${selected[@]}" -o "$TASK/objects/final16-$label.wasm" > "$TASK/logs/final16-$label-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/final16-$label.wasm"
wasm-objdump -x "$TASK/objects/final16-$label.wasm" > "$TASK/logs/final16-$label-abi.log"
