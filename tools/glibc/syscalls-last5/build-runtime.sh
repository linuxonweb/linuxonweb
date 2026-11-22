#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
for destination in "$TASK/objects/last5.wasm" "$TASK/objects/guest/last5-fixture.o" "$TASK/source-snapshots/inherited-startup-run2.o"; do
 [ ! -e "$destination" ] || { echo "existing runtime destination: $destination" >&2; exit 2; }
done
source "$ROOT/../probes/gnu-flags.sh"
flags+=( -I"$TASK/objects/fullmake" )
python3 - <<'PY'
import pathlib,os,json,shutil
T=pathlib.Path(os.environ['GLIBC_TASK'])
j=json.loads((T/'logs/selected-last5-syscalls.json').read_text())
for r in j['wrappers']:
 p=T/'objects/fullmake/misc'/(r['call']+'.o');q=T/'objects/guest'/('GNU-make-last5-'+r['call']+'.o');assert p.read_bytes()[:8]==b'\0asm\1\0\0\0';assert not q.exists();shutil.copy2(p,q)
PY
python3 "$ROOT/startup-overlay.py"
# Replace the selected inherited startup provider, retaining its exact bytes.
mv "$TASK/objects/guest/startup-run2.o" "$TASK/source-snapshots/inherited-startup-run2.o"
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/last5-signatures.d" -c "$ROOT/signatures.c" -o "$TASK/objects/guest/last5-signatures.o" > "$TASK/logs/last5-signatures.log" 2>&1
python3 "$ROOT/compiler.py" "${public_flags[@]}" -MMD -MF "$TASK/objects/last5-fixture.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/last5-fixture.o" > "$TASK/logs/last5-fixture.log" 2>&1

python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/last5-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/last5-startup.log" 2>&1
printf '%s\n' "$TASK/objects/guest/"*.o > "$TASK/logs/last5-link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-last5" -Map "$TASK/logs/last5-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/last5.wasm" > "$TASK/logs/last5-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/last5.wasm"
wasm-objdump -x "$TASK/objects/last5.wasm" > "$TASK/logs/last5-abi.log"
storage_check
