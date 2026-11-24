#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
make -C "$TASK/objects/configure-port" -j1 "$TASK/objects/configure-port/abi-versions.h" "$TASK/objects/configure-port/libc-modules.h" "$TASK/objects/configure-port/dl-tunable-list.h" "$TASK/objects/configure-port/libc-abis.h"
# arch-syscall.h is already in the patch; regenerate against pinned guest UAPI.
make -C "$TASK/objects/configure-port" -j1 update-syscall-lists
