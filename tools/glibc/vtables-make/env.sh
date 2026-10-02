#!/bin/bash
set -euo pipefail
: "${GLIBC_CUMULATIVE_PACKET:?Set the terminal cumulative discovery packet}"
: "${GLIBC_ALIAS_PACKET:?Set the immutable data-alias packet}"
source "$(dirname "${BASH_SOURCE[0]}")/../cumulative-make/env.sh"
