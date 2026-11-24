#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
: "${GLIBC_STAT_RUNTIME_PACKET:?Set frozen stat runtime}"
: "${GLIBC_CUMULATIVE_PACKET:?Set original frozen cumulative inventory}"
: "${GLIBC_C_CLEANUP_PACKET:?Set accepted private compiler packet}"
: "${GNU_RELEASE_ARCHIVE:?Set signed GNU release archive}"
