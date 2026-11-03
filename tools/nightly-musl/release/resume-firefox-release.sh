#!/bin/bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PREVIOUS=$(realpath "${1:?usage: resume-firefox-release.sh PREVIOUS_BUILD NEW_OUT --stage optimize|package|compat-package [--cpus N]}")
OUT=$(realpath -m "${2:?fresh output directory required}")
[[ ! -e "$OUT" && ! -L "$OUT" ]] || { echo 'Use a fresh output directory.' >&2; exit 2; }
PARENT=$OUT
while [[ ! -d "$PARENT" ]]; do PARENT=$(dirname "$PARENT"); done
FS=$(findmnt -n -o FSTYPE --target "$PARENT")
DEVICE=$(findmnt -n -o SOURCE --target "$PARENT")
[[ "$FS" != tmpfs && "$FS" != ramfs && "$DEVICE" == /dev/* ]] || { echo 'Disk-backed output is required.' >&2; exit 2; }
mkdir -m 700 -p "$OUT/t/cache" "$OUT/t/modules"
export TMPDIR="$OUT/t" TMP="$OUT/t" TEMP="$OUT/t" XDG_CACHE_HOME="$OUT/t/cache"
export CLANG_MODULE_CACHE_PATH="$OUT/t/modules" CCACHE_DISABLE=1 SCCACHE_DISABLE=1 PYTHONDONTWRITEBYTECODE=1
shift 2
OPTIMIZER_STAGE=
OPTIMIZER_PROFILE=default
OPTIMIZER_EXPECT_STAGE=0
for option in "$@"; do
  if [[ $OPTIMIZER_EXPECT_STAGE == 1 ]]; then
    OPTIMIZER_STAGE=$option
    OPTIMIZER_EXPECT_STAGE=0
    continue
  fi
  case "$option" in
    --stage) OPTIMIZER_EXPECT_STAGE=1 ;;
    --stage=*) OPTIMIZER_STAGE=${option#--stage=} ;;
    --short-optimizer) OPTIMIZER_PROFILE=short ;;
    --extended-optimizer) OPTIMIZER_PROFILE=extended ;;
  esac
done
OPTIMIZER_OUTER_SECONDS=590
if [[ $OPTIMIZER_STAGE == optimize && $OPTIMIZER_PROFILE != short ]]; then
  OPTIMIZER_OUTER_SECONDS=1890
fi
exec timeout --signal=TERM --kill-after=10 "$OPTIMIZER_OUTER_SECONDS" python3 -B "$HERE/resume-release.py" "$PREVIOUS" "$OUT" "$@"
