#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
python3 "$ROOT/overlay.py"
python3 "$ROOT/build-make.py"
bash "$ROOT/rebuild-fixture.sh"
