#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
python3 "$ROOT/../fenv/reuse-inputs.py" compiler
bash "$ROOT/../replay-source.sh" "$GNU_RELEASE_ARCHIVE"
bash "$ROOT/../probes/configure-port.sh"
bash "$ROOT/../probes/generate-metadata.sh"
python3 "$ROOT/../jumps/prepare.py"
python3 "$ROOT/../jumps/fullmake-overlay.py"
python3 "$ROOT/../fullmake/prepare.py"
python3 - <<'PY'
import os,pathlib
S=pathlib.Path(os.environ['SRC']);s=(S/'bits/fenv.h').read_text()
old='   We define no macro which signals no rounding mode is selectable.  */'
assert s.count(old)==1
s=s.replace(old,'   Native Wasm has fixed round-to-nearest, ties-to-even arithmetic.  */\n\n#define FE_TONEAREST 0')
p=S/'sysdeps/wasm32/bits/fenv.h';assert not p.exists();p.write_text(s)
PY
python3 "$ROOT/header-adapter.py"
python3 "$ROOT/stat-overlay.py"
bash "$ROOT/configure.sh"
make -C "$TASK/objects/fullmake" -j1 "$TASK/objects/fullmake/abi-versions.h" "$TASK/objects/fullmake/libc-modules.h" "$TASK/objects/fullmake/dl-tunable-list.h" "$TASK/objects/fullmake/libc-abis.h" > "$TASK/logs/fullmake-metadata.log" 2>&1
source "$ROOT/../probes/gnu-flags.sh"
printf -v generator_cc '%q ' "$TOOLCHAIN/bin/clang" "${flags[@]}"
python3 "$SRC/scripts/gen-as-const.py" --cc "$generator_cc" "$SRC/csu/sem_t-align.sym" > "$TASK/objects/fullmake/sem_t-align.h"
python3 "$ROOT/reuse-runtime.py"
storage_check
