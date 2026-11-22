#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../probes/gnu-flags.sh"
mkdir "$TASK/logs/full-dependencies-complete"
python3 - <<'PY' > "$TASK/logs/dependency-sources.txt"
import pathlib,os,shlex
t=pathlib.Path(os.environ['GLIBC_TASK']);sources=set()
for p in [*(t/'objects').glob('*.d'),*(t/'objects/guest').glob('*.d')]:
 data=p.read_text().replace('\\\n',' ')
 for word in shlex.split(data.split(':',1)[1]):
  path=pathlib.Path(word)
  if path.is_file() and path.suffix in ['.c','.S']:
   sources.add(path.resolve());break # Later .c entries are included fragments.
for p in sorted(sources):print(p)
PY
n=0
while IFS= read -r input; do
 storage_check
 extra=()
 if [[ "$input" = "$SRC/"* ]] && rg -Fqx "${input#"$SRC/"}" <(sed 's/$/.c/' "$ROOT/../port/gnu-source-list.txt"); then
  extra+=(-DTOP_NAMESPACE=glibc -I "$SRC/wcsmbs" -I "$SRC/iconv")
  [ "$input" != "$SRC/malloc/malloc.c" ] || extra+=(-DUSE_TCACHE=1 -DMORECORE_CLEARS=2)
 fi
 "$TOOLCHAIN/bin/clang" "${flags[@]}" "${extra[@]}" -M -MF "$TASK/logs/full-dependencies-complete/$n.d" "$input" > "$TASK/logs/full-dependencies-complete/$n.log" 2>&1
 n=$((n+1))
done < "$TASK/logs/dependency-sources.txt"
"${GLIBC_HOST_CXX:-/usr/bin/g++}" "$ROOT/../jumps/lower.cpp" $("$TOOLCHAIN/bin/llvm-config" --cxxflags) -M -MF "$TASK/logs/full-dependencies-complete/host-lower.d"
"$TOOLCHAIN/bin/llvm-config" --libfiles core irreader bitwriter support > "$TASK/logs/host-llvm-libfiles.txt"
ldd "$TASK/objects/lower" > "$TASK/logs/host-lower-ldd.txt"
