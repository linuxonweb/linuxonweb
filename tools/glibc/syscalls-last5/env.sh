#!/bin/bash
set -euo pipefail
: "${GLIBC_CUMULATIVE_PACKET:?Set the frozen cumulative replay packet}"
: "${GLIBC_CHECKED_RUNTIME_PACKET:?Set the frozen accepted checked-jump runtime}"
source "$(dirname "${BASH_SOURCE[0]}")/../cumulative-make/env.sh"
