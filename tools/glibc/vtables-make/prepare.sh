#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
python3 "$ROOT/verify.py"
bash "$ROOT/../cumulative-make/prepare.sh"
