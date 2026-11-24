#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
[ ! -e "$TASK/source" ] || { echo 'fresh source destination required' >&2; exit 2; }
python3 "$ROOT/verify.py"
bash "$ROOT/../replay-source.sh" "$GNU_RELEASE_ARCHIVE"
bash "$ROOT/../probes/configure-port.sh"
bash "$ROOT/../probes/generate-metadata.sh"
storage_check
echo 'Signed source and initial GNU metadata ready; final overlays/memory input/make await review'
