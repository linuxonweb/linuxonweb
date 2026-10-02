#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
: "${GLIBC_ARITY_PACKET:?}"
: "${GLIBC_MEMORY_MAKE_PACKET:?}"
