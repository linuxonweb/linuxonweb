#!/bin/bash
set -euo pipefail
: "${GLIBC_CUMULATIVE_PACKET:?Set the frozen cumulative discovery packet}"
source "$(dirname "${BASH_SOURCE[0]}")/../cumulative-make/env.sh"
