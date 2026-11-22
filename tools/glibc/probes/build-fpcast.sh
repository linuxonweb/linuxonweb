#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
[ ! -e "$TASK/objects/allocator-fpcast.wasm" ] || { echo "FPCAST destination exists; refusing replacement" >&2; exit 2; }
wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$TASK/objects/allocator.wasm" -o "$TASK/objects/allocator-fpcast.wasm"
wasm-validate --enable-all "$TASK/objects/allocator-fpcast.wasm"
wasm-objdump -x "$TASK/objects/allocator-fpcast.wasm" > "$TASK/logs/abi-fpcast.log"
wasm-objdump -d "$TASK/objects/allocator-fpcast.wasm" > "$TASK/logs/disassembly-fpcast.log"
