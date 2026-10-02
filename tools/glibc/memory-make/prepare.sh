#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../cumulative-make/env.sh"
bash "$ROOT/../cumulative-make/prepare.sh"
python3 "$ROOT/overlay.py"
