#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
label=${1:?unique task-local attempt label}
[[ "$label" =~ ^[a-zA-Z0-9_-]+$ ]]
D="$TASK/objects/recompile-$label"
[ ! -e "$D" ] && [ ! -e "$TASK/logs/recompile-$label.log" ]
mkdir "$D"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$D/fixture.d" -c "$ROOT/fixture.c" -o "$D/stat-fixture.o" > "$D/compile.log" 2>&1
python3 - "$D" <<'PY'
import pathlib,sys,os,json
T=pathlib.Path(os.environ['GLIBC_TASK']);D=pathlib.Path(sys.argv[1]);objects=sorted((T/'objects/guest').glob('*.o'))
assert sum(p.name=='stat-fixture.o' for p in objects)==1
objects=[D/'stat-fixture.o' if p.name=='stat-fixture.o' else p for p in objects]
(D/'inputs.json').write_text(json.dumps([str(p) for p in objects],indent=2)+'\n')
(D/'inputs.txt').write_text('\n'.join(str(p) for p in objects)+'\n')
PY
mapfile -t inputs < "$D/inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-stat-$label" -Map "$D/link-map.txt" "${inputs[@]}" -o "$D/module.wasm" > "$D/link.log" 2>&1
wasm-validate --enable-all "$D/module.wasm"
storage_check
