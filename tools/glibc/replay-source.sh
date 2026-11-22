#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
ARCHIVE=${1:?Supply pinned GNU glibc-2.44.tar.xz archive}
[ ! -e "$SRC" ] || { echo 'Source destination exists; refusing overwrite' >&2; exit 2; }
echo '37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667  '"$ARCHIVE" | sha256sum -c -
echo 'c0238052c8c42006cb724a9363c73f7e5d34bf86d79faa015a922971528ef14f  '"$PORT_ROOT/port/glibc-2.44-wasm32-abort-signal-cumulative.patch" | sha256sum -c -
storage_check
mkdir -p "$TASK/source"
tar -xJf "$ARCHIVE" -C "$TASK/source"
python3 "$PORT_ROOT/verify-gnu-units.py"
patch --batch --fuzz=0 -d "$SRC" -p1 < "$PORT_ROOT/port/glibc-2.44-wasm32-abort-signal-cumulative.patch" > "$TASK/logs/replay-patch.log"
# Unified diffs cannot create this deliberate zero-byte architecture marker.
touch "$SRC/sysdeps/unix/sysv/linux/wasm32/Implies"
python3 "$PORT_ROOT/verify-gnu-units.py"
storage_check
