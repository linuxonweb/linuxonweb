#!/bin/bash
# Source after supplying GLIBC_TASK, GLIBC_TOOLCHAIN and GLIBC_KERNEL_HEADERS.
set -euo pipefail
PORT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
: "${GLIBC_TASK:?Set an owned persistent task directory}"
: "${GLIBC_TOOLCHAIN:?Set the raw LLVM toolchain root}"
: "${GLIBC_KERNEL_HEADERS:?Set retained Linux/Wasm UAPI include directory}"
mkdir -p "$GLIBC_TASK"
TASK=$(realpath "$GLIBC_TASK")
TOOLCHAIN=$(realpath "$GLIBC_TOOLCHAIN")
KHEADERS=$(realpath "$GLIBC_KERNEL_HEADERS")
SRC="$TASK/source/glibc-2.44"
# Reject RAM-backed storage and require the 8 GiB launch reserve.
[ "$(stat -f -c %T "$TASK")" = ext2/ext3 ] || { echo 'ext4 disk-backed task storage required' >&2; return 99; }
[ "$(df --output=avail -B1 "$TASK" | tail -1)" -gt 8589934592 ] || { echo '8 GiB free launch reserve required' >&2; return 98; }
mkdir -p "$TASK"/{tmp,cache,logs,objects}
export GLIBC_TASK="$TASK" TMPDIR="$TASK/tmp" TMP="$TASK/tmp" TEMP="$TASK/tmp" XDG_CACHE_HOME="$TASK/cache"
export PYTHONDONTWRITEBYTECODE=1
unset LD_LIBRARY_PATH LD_PRELOAD NIX_CFLAGS_COMPILE NIX_CFLAGS_LINK NIX_LDFLAGS NIX_CC NIX_BINTOOLS CFLAGS CXXFLAGS CPPFLAGS LDFLAGS CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH LIBRARY_PATH
export PATH=/usr/bin:/bin
storage_check() {
 local available
 available=$(df --output=avail -B1 "$TASK" | tail -1)
 [ "$available" -gt 5368709120 ] || { echo '5 GiB hard stop reached' >&2; return 98; }
 [ "$(du -sk "$TASK" | cut -f1)" -lt 2097152 ] || { echo '2 GiB task budget reached' >&2; return 98; }
}
export PORT_ROOT TASK TOOLCHAIN KHEADERS SRC
