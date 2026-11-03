#!/bin/bash
# Bounded source-to-package JIT build. See README.md for the retained base inputs.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  exec python3 -B "$HERE/build-release.py" --help
fi
OUT=$(realpath -m "${1:?usage: build-firefox-release.sh OUT_DIR [options]}")
[[ ! -e "$OUT" && ! -L "$OUT" ]] || { echo 'Use a fresh output directory.' >&2; exit 2; }
PARENT=$OUT
while [[ ! -d "$PARENT" ]]; do PARENT=$(dirname "$PARENT"); done
FS=$(findmnt -n -o FSTYPE --target "$PARENT")
DEVICE=$(findmnt -n -o SOURCE --target "$PARENT")
[[ "$FS" != tmpfs && "$FS" != ramfs && "$DEVICE" == /dev/* ]] || { echo 'A disk-backed output directory is required.' >&2; exit 2; }
mkdir -m 700 -p "$OUT/t/cache" "$OUT/t/modules"
export TMPDIR="$OUT/t" TMP="$OUT/t" TEMP="$OUT/t" XDG_CACHE_HOME="$OUT/t/cache"
export CLANG_MODULE_CACHE_PATH="$OUT/t/modules" CCACHE_DISABLE=1 SCCACHE_DISABLE=1
export PYTHONDONTWRITEBYTECODE=1
shift
# The Python owner stops work at 560s, leaving time for exact child cleanup.
# This independent cap includes the owner and caps the whole invocation at 600s.
exec timeout --signal=TERM --kill-after=10 590 python3 -B "$HERE/build-release.py" "$OUT" "$@"
