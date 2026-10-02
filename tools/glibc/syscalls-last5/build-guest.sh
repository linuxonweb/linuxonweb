#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
module=${1:-$TASK/objects/last5.wasm}
label=${2:-run1}
[[ "$label" =~ ^[A-Za-z0-9_-]+$ ]]
[[ "$module" == "$TASK/"* ]]
for output in "$TASK/objects/last5-fpcast-$label.wasm" "$TASK/logs/native-tag-$label-result.json" "$TASK/logs/fpcast-tag-$label-result.json" "$TASK/native-$label-package" "$TASK/fpcast-$label-package"; do
 [ ! -e "$output" ] || { echo "existing destination: $output" >&2; exit 2; }
done
[ -f "$TASK/source/worker.js" ] && [ -f "$TASK/source/index.html" ]
node "$ROOT/../c-cleanup/test-tag.mjs" "$module" "$TASK/logs/native-tag-$label-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$module" -o "$TASK/objects/last5-fpcast-$label.wasm"
wasm-validate --enable-all "$TASK/objects/last5-fpcast-$label.wasm"
node "$ROOT/../c-cleanup/test-tag.mjs" "$TASK/objects/last5-fpcast-$label.wasm" "$TASK/logs/fpcast-tag-$label-result.json"
python3 "$ROOT/package.py" "$module" "native-$label-package"
python3 "$ROOT/package.py" "$TASK/objects/last5-fpcast-$label.wasm" "fpcast-$label-package"
storage_check
