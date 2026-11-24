#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
module=${1:-"$TASK/objects/final16.wasm"}
label=${2:-initial}
[[ "$label" =~ ^[a-zA-Z0-9_-]+$ ]]
fpcast="$TASK/objects/final16-$label-fpcast.wasm"
[ ! -e "$fpcast" ] && [ ! -e "$TASK/native-package-$label" ] && [ ! -e "$TASK/fpcast-package-$label" ]
[ ! -e "$TASK/logs/native-tag-$label-result.json" ] && [ ! -e "$TASK/logs/fpcast-tag-$label-result.json" ]
if [ ! -e "$TASK/source/worker.js" ]; then bash "$ROOT/../prepare-guest.sh"; python3 "$ROOT/prepare-worker.py"; fi
node "$ROOT/../c-cleanup/test-tag.mjs" "$module" "$TASK/logs/native-tag-$label-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$module" -o "$fpcast"
wasm-validate --enable-all "$fpcast"
node "$ROOT/../c-cleanup/test-tag.mjs" "$fpcast" "$TASK/logs/fpcast-tag-$label-result.json"
python3 "$ROOT/package.py" "$module" "native-package-$label"
python3 "$ROOT/package.py" "$fpcast" "fpcast-package-$label"
storage_check
