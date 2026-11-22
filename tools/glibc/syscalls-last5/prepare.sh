#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
bash "$ROOT/../cumulative-make/prepare.sh"
python3 "$ROOT/reuse-runtime.py"
storage_check
