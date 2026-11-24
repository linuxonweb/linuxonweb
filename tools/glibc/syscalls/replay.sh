#!/bin/bash
# Fresh-tree replay; signed GNU archive is supplied by the caller.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../env.sh"
: "${GNU_RELEASE_ARCHIVE:?Set the signed pinned GNU glibc 2.44 archive}"
[ ! -e "$TASK/source" ] || { echo 'fresh owned task required' >&2; exit 2; }
bash "$ROOT/../replay-source.sh" "$GNU_RELEASE_ARCHIVE"
bash "$ROOT/../probes/configure-port.sh"
bash "$ROOT/../probes/generate-metadata.sh"
python3 "$ROOT/../jumps/prepare.py"
bash "$ROOT/../build.sh" guest
bash "$ROOT/../jumps/build.sh"
python3 "$ROOT/../jumps/fullmake-overlay.py"
python3 "$ROOT/prepare.py"
bash "$ROOT/configure-fullmake.sh"
make -C "$TASK/objects/fullmake" -j2 "$TASK/objects/fullmake/sysd-syscalls" > "$TASK/logs/generated-rules.log" 2>&1
bash "$ROOT/build.sh"
bash "$ROOT/../prepare-guest.sh"
