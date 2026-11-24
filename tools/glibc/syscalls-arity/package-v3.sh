#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/arity-v3.wasm" "$TASK/logs/native-v3-tag-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$TASK/objects/arity-v3.wasm" -o "$TASK/objects/arity-v3-fpcast.wasm"
wasm-validate --enable-all "$TASK/objects/arity-v3-fpcast.wasm"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/arity-v3-fpcast.wasm" "$TASK/logs/fpcast-v3-tag-result.json"
python3 "$ROOT/package.py" "$TASK/objects/arity-v3.wasm" native-package3
python3 "$ROOT/package.py" "$TASK/objects/arity-v3-fpcast.wasm" fpcast-package3
storage_check
