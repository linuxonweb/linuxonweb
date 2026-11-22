#!/bin/bash
# This is an honest GNU build boundary, not subset-build acceptance.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
[ ! -e "$TASK/logs/make-lib.log" ] || { echo 'Diagnosis already exists' >&2; exit 2; }
storage_check
set +e
timeout 90s make -C "$TASK/objects/configure-port" -j2 lib > "$TASK/logs/make-lib.log" 2>&1
status=$?
set -e
printf '%s\n' "$status" > "$TASK/logs/make-lib.exit"
tail -30 "$TASK/logs/make-lib.log"
storage_check
exit "$status"
