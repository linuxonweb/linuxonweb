#!/bin/bash
# Preserve actual GNU public mask helpers needed by the callback fixture.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
make -C "$SRC/signal" "objdir=$TASK/objects/fullmake" -j2 "$TASK/objects/fullmake/signal/sigempty.o" "$TASK/objects/fullmake/signal/sigaddset.o" > "$TASK/logs/make-public-signal.log" 2>&1
cp "$TASK/objects/fullmake/signal/sigempty.o" "$TASK/objects/guest/next26-sigempty.o"
cp "$TASK/objects/fullmake/signal/sigaddset.o" "$TASK/objects/guest/next26-sigaddset.o"
storage_check
