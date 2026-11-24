#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
R=$(cd "$(dirname "$0")" && pwd)
python3 "$R/verify.py"
bash "$R/../cumulative-make/prepare.sh"
python3 "$R/overlay.py"
storage_check
