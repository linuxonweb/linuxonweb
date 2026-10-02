#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/memory-v4.wasm" "$TASK/logs/native-v4-tag-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$TASK/objects/memory-v4.wasm" -o "$TASK/objects/memory-v4-fpcast.wasm"
wasm-validate --enable-all "$TASK/objects/memory-v4-fpcast.wasm"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/memory-v4-fpcast.wasm" "$TASK/logs/fpcast-v4-tag-result.json"
python3 "$ROOT/package.py" "$TASK/objects/memory-v4.wasm" native-package4
python3 "$ROOT/package.py" "$TASK/objects/memory-v4-fpcast.wasm" fpcast-package4
storage_check
