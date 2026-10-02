#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
module="$TASK/objects/checked-jump.wasm"
[ -f "$TASK/source/worker.js" ] && [ -f "$TASK/source/index.html" ]
node "$ROOT/../c-cleanup/test-tag.mjs" "$module" "$TASK/logs/native-tag-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$module" -o "$TASK/objects/checked-jump-fpcast.wasm"
wasm-validate --enable-all "$TASK/objects/checked-jump-fpcast.wasm"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/checked-jump-fpcast.wasm" "$TASK/logs/fpcast-tag-result.json"
python3 "$ROOT/package.py" "$module" native-package
python3 "$ROOT/package.py" "$TASK/objects/checked-jump-fpcast.wasm" fpcast-package
storage_check
