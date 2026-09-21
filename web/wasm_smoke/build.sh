#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out_dir="$root_dir/build"
mkdir -p "$out_dir"

# Emscripten is intentionally not required. A freestanding wasm32 object
# and wasm-ld are enough for this adapter boundary and are available in the
# Arch Linux toolchain used by this project.
clang_bin="${CLANG:-clang}"
wasm_ld_bin="${WASM_LD:-wasm-ld}"

"$clang_bin" --target=wasm32-unknown-unknown \
  -ffreestanding -fno-builtin -nostdlib -I"$root_dir/../../adapter" \
  -c "$root_dir/probe.c" \
  -o "$out_dir/probe.o"

"$wasm_ld_bin" --no-entry --allow-undefined --export=runtime_probe --export=runtime_start \
  --export=runtime_frame --export=runtime_poll --export=runtime_event_byte \
  --export-memory --global-base=131072 --strip-debug \
  "$out_dir/probe.o" -o "$out_dir/probe.wasm"

printf 'built %s (%s bytes)\n' "$out_dir/probe.wasm" "$(wc -c < "$out_dir/probe.wasm")"
