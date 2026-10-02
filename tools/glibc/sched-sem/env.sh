#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
: "${GLIBC_C_CLEANUP_PACKET:?Set the immutable accepted C cleanup packet}"
: "${GLIBC_FENV_PACKET:?Set the immutable accepted fixed-rounding packet}"
: "${GLIBC_FIXED_PACKET:?Set the immutable accepted 36-wrapper packet}"
: "${GLIBC_NEXT26_PACKET:?Set immutable accepted191-object runtime}"
