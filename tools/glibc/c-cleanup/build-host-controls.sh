#!/bin/bash
# Freestanding host ABI controls. These objects never join the GNU guest payload.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
"$TOOLCHAIN/bin/clang" --target=wasm32-unknown-linux-gnu -mexception-handling -c "$ROOT/probes/catch-control.S" -o "$TASK/objects/catch-control.o"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --export=catch_control "$TASK/objects/catch-control.o" -o "$TASK/objects/catch-control.wasm"
python3 "$ROOT/compiler.py" "${flags[@]}" -fexceptions -c "$ROOT/probes/host-c-cleanup.c" -o "$TASK/objects/host-c-cleanup.o"
"$TOOLCHAIN/bin/clang" --target=wasm32-unknown-linux-gnu -c "$ROOT/probes/host-abort-import.S" -o "$TASK/objects/host-abort-import.o"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --export=c_entry "$TASK/objects/host-c-cleanup.o" "$TASK/objects/host-abort-import.o" -o "$TASK/objects/host-c-cleanup.wasm"
storage_check
