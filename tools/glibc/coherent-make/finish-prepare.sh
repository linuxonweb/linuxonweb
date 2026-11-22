#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
[ "${GLIBC_COHERENT_OVERLAY_APPROVED:-0}" = 1 ] || exit 2
case "${1:-}" in
 "") python3 "$ROOT/overlay.py" ;;
 --resume-configure)
  python3 - <<'PY'
import hashlib,json,os,pathlib
t=pathlib.Path(os.environ['GLIBC_TASK']);j=json.loads((t/'logs/coherent-final-overlay.json').read_text());assert j['pass']
for n,h in j['architectureFiles'].items():
 p=pathlib.Path(n);assert {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}==h, 'selected architecture changed after failed configure'
assert not (t/'objects/fullmake').exists(), 'retain failed tree before a fresh configure'
PY
 ;;
 *) exit 2 ;;
esac
bash "$ROOT/configure.sh"
make -C "$TASK/objects/fullmake" -j1 "$TASK/objects/fullmake/abi-versions.h" "$TASK/objects/fullmake/libc-modules.h" "$TASK/objects/fullmake/dl-tunable-list.h" "$TASK/objects/fullmake/libc-abis.h" > "$TASK/logs/final-metadata.log" 2>&1
source "$ROOT/../probes/gnu-flags.sh"
# The shared probe flag helper defaults to the initial configure tree.  This
# generation must consume the final GNU metadata selected after all overlays.
initial_obj="$OBJ"
OBJ="$TASK/objects/fullmake"
for index in "${!flags[@]}"; do
 if [[ "${flags[$index]}" == "$initial_obj" || "${flags[$index]}" == "$initial_obj/"* ]]; then
  flags[$index]="$OBJ${flags[$index]#"$initial_obj"}"
 fi
done
printf -v generator_cc '%q ' "$TASK/objects/compiler/clang" -no-canonical-prefixes "${flags[@]}"
python3 - "$TASK/logs/sem-align-generator-command.json" "$SRC/scripts/gen-as-const.py" --cc "$generator_cc" "$SRC/csu/sem_t-align.sym" <<'PY'
import json,pathlib,sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'argv':['python3',*sys.argv[2:]],'cwd':str(pathlib.Path.cwd()),'scope':'actual GNU generator with final configure metadata'},indent=2)+'\n')
PY
python3 "$SRC/scripts/gen-as-const.py" --cc "$generator_cc" "$SRC/csu/sem_t-align.sym" > "$OBJ/sem_t-align.h" 2> "$TASK/logs/sem-align-generator.log"
storage_check
