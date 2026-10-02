#!/bin/bash
set -euo pipefail
: "${GLIBC_STAT_RUNTIME_PACKET:?Set the immutable stat-runtime packet}"
: "${GNU_RELEASE_ARCHIVE:?Set signed GNU release archive}"
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
