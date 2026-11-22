#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../syscalls-fixed/env.sh"
# Reuse the frozen compiler and source replay; all new outputs stay task-local.
bash "$ROOT/../syscalls-fixed/prepare.sh"
python3 "$ROOT/overlay.py"
storage_check
