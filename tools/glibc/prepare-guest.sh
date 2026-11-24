#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REPO=${GLIBC_REPO:-$(realpath "$PORT_ROOT/../..")}
[ ! -e "$TASK/source/worker.js" ] || { echo 'Guest worker exists; refusing replacement' >&2; exit 2; }
cp "$REPO/web/linux/dist/worker.js" "$TASK/source/worker.js"
patch --batch --fuzz=0 -d "$TASK/source" -p1 < "$PORT_ROOT/source/test-worker.patch" > "$TASK/logs/guest-worker-patch.log"
cp "$PORT_ROOT/source/index.html" "$TASK/source/index.html"
storage_check
