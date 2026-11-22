#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
python3 "$ROOT/package.py" "$TASK/objects/arity.wasm" native-package2
python3 "$ROOT/package.py" "$TASK/objects/arity-fpcast.wasm" fpcast-package2
storage_check
