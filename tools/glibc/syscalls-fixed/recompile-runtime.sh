#!/bin/bash
# Recompile one selected owned input without overwriting previous link inputs.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
label=${1:?Provide a unique task-local label}
unit=${2:?Select fixture or startup}
[[ "$label" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
case "$unit" in
 fixture) input="$ROOT/fixture.c"; original="$TASK/objects/guest/fixed-fixture.o" ;;
 startup) input="$TASK/source/startup.c"; original="$TASK/objects/guest/startup.o" ;;
 *) echo 'Select fixture or startup' >&2; exit 2 ;;
esac
out="$TASK/objects/recompile-$label"
log="$TASK/logs/recompile-$label"
cache="$TASK/cache/lto-recompile-$label"
[ ! -e "$out" ] && [ ! -e "$log" ] && [ ! -e "$cache" ]
storage_check
mkdir "$out" "$log" "$cache"
cp "$input" "$log/input.c"
sha256sum "$input" "$original" > "$log/input-hashes.txt"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$out/$unit.d" -c "$input" -o "$out/$unit.o" > "$log/compile.log" 2>&1
objects=()
for object in "$TASK/objects/guest/"*.o; do
 if [ "$object" = "$original" ]; then objects+=("$out/$unit.o"); else objects+=("$object"); fi
done
printf '%s\n' "${objects[@]}" > "$log/link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$cache" -Map "$log/link-map.txt" "${objects[@]}" -o "$out/module.wasm" > "$log/link.log" 2>&1
wasm-validate --enable-all "$out/module.wasm"
storage_check
