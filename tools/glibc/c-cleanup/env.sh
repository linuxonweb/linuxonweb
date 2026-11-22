#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
# This packet has explicit parent authorization for a 3 GiB task cap.
export GLIBC_TASK_LIMIT_BYTES=3221225472
storage_check() {
 [ "$(df --output=avail -B1 "$TASK" | tail -1)" -gt 5368709120 ] || return 98
 [ "$(du -sk "$TASK" | cut -f1)" -lt 3145728 ] || return 98
}
