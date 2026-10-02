#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../probes/gnu-flags.sh"
label=${1:?unique label required}
[[ "$label" =~ ^[A-Za-z0-9_-]+$ ]]
mkdir "$TASK/objects/host-$label"
OUT="$TASK/objects/host-$label"
"$TOOLCHAIN/bin/clang" "${flags[@]}" -D_ISOMAC -MMD -MF "$OUT/fixture.d" -c "$ROOT/fixture.c" -o "$OUT/fixture.o" > "$TASK/logs/host-$label-compile.log" 2>&1
objects=("$TASK/objects/fullmake/misc/"{brk,sbrk,mmap64,munmap,mremap,mprotect,madvise,wasm-memory-authority}.o "$TASK/objects/fullmake/csu/"{errno,errno-loc}.o "$TASK/objects/fullmake/string/"{memcpy,memset,wordcopy}.o "$OUT/fixture.o")
exports=(--export-memory --export=__tls_size --export=__tls_align --export=__heap_base --export=__wasm_init_tls --export=fixture_init --export=fixture_errno --export=fixture_set_errno --export=fixture_heap --export=fixture_typed --export=brk --export=sbrk --export=mmap --export=mmap64 --export=munmap --export=mremap --export=mprotect --export=madvise --export=__wasm_memory_cursor)
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 -z stack-size=65536 --error-limit=0 "${exports[@]}" -Map "$TASK/logs/host-$label-map.txt" "${objects[@]}" -o "$OUT/memory.wasm" > "$TASK/logs/host-$label-link.log" 2>&1
wasm-validate --enable-all "$OUT/memory.wasm"
wasm-objdump -x "$OUT/memory.wasm" > "$TASK/logs/host-$label-abi.log"
node "$ROOT/test.cjs" "$OUT/memory.wasm" "$TASK/logs/host-$label-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$OUT/memory.wasm" -o "$OUT/memory-fpcast.wasm"
wasm-validate --enable-all "$OUT/memory-fpcast.wasm"
node "$ROOT/test.cjs" "$OUT/memory-fpcast.wasm" "$TASK/logs/host-$label-fpcast-result.json"
storage_check
