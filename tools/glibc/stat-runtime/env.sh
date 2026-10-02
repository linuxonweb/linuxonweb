#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
: "${GLIBC_C_CLEANUP_PACKET:?Set the immutable accepted C cleanup packet}"
: "${GLIBC_FENV_PACKET:?Set the immutable accepted fixed-rounding packet}"
: "${GLIBC_FIXED_PACKET:?Set the immutable accepted 36-wrapper packet}"

: "${GLIBC_NEXT26_PACKET:?Set the immutable accepted next26 runtime packet}"
: "${GLIBC_STAT_PACKET:?Set the immutable selected GNU stat compile packet}"
