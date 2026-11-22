#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
: "${GLIBC_C_CLEANUP_PACKET:?Set the immutable accepted C cleanup packet}"
: "${GLIBC_FENV_PACKET:?Set the immutable accepted fixed-rounding packet}"
