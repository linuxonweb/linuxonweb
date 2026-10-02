#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
bash "$ROOT/../prepare-guest.sh"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/fenv.wasm" "$TASK/logs/native-tag-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$TASK/objects/fenv.wasm" -o "$TASK/objects/fenv-fpcast.wasm"
wasm-validate --enable-all "$TASK/objects/fenv-fpcast.wasm"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/fenv-fpcast.wasm" "$TASK/logs/fpcast-tag-result.json"
python3 "$ROOT/../c-cleanup/package.py" "$TASK/objects/fenv.wasm" native-package
python3 "$ROOT/../c-cleanup/package.py" "$TASK/objects/fenv-fpcast.wasm" fpcast-package
storage_check
