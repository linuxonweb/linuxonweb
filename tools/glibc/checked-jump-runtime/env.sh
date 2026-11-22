#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
: "${GLIBC_FINAL16_PACKET:?Set immutable accepted final16 runtime}"
: "${GLIBC_CHECKED_JUMP_PACKET:?Set selected GNUmake checked-jump packet}"
