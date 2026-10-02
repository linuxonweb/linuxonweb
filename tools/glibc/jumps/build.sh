#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../probes/gnu-flags.sh"
"${GLIBC_HOST_CXX:-/usr/bin/g++}" "$ROOT/lower.cpp" $("$TOOLCHAIN/bin/llvm-config" --cxxflags --ldflags --libs core irreader bitwriter support --system-libs) -o "$TASK/objects/lower" > "$TASK/logs/lower-build.log" 2>&1
compile(){
 local name=$1 input=$2
 storage_check
 "$TOOLCHAIN/bin/clang" "${flags[@]}" -O2 -Xclang -disable-llvm-passes -emit-llvm -c -MMD -MF "$TASK/objects/$name.d" "$input" -o "$TASK/objects/$name.front.bc" > "$TASK/logs/$name-frontend.log" 2>&1
 "$TASK/objects/lower" "$TASK/objects/$name.front.bc" "$TASK/objects/$name.lower.bc" > "$TASK/logs/$name-lower.log" 2>&1
 "$TOOLCHAIN/bin/opt" '-passes=default<O2>' "$TASK/objects/$name.lower.bc" -o "$TASK/objects/$name.opt.bc"
 "$TOOLCHAIN/bin/llc" -mattr=+atomics,+bulk-memory,+exception-handling -exception-model=wasm -wasm-enable-eh -wasm-enable-sjlj -wasm-use-legacy-eh -filetype=obj "$TASK/objects/$name.opt.bc" -o "$TASK/objects/guest/$name.o" > "$TASK/logs/$name-backend.log" 2>&1
 "$TOOLCHAIN/bin/llvm-dis" "$TASK/objects/$name.opt.bc" -o "$TASK/objects/$name.ll"
}
compile jump-helpers "$ROOT/helpers.c"
compile jump-sigjmp "$SRC/setjmp/sigjmp.c"
compile jump-longjmp "$SRC/setjmp/longjmp.c"
compile jump-longjmp-chk "$SRC/debug/longjmp_chk.c"
compile jump-fortify-fail "$SRC/debug/fortify_fail.c"
compile jump-unwind "$SRC/sysdeps/nptl/jmp-unwind.c"
compile jump-cleanup "$SRC/nptl/pthread_cleanup_upto.c"
compile startup "$TASK/source/startup.c"
"$TOOLCHAIN/bin/clang" "${flags[@]}" -c "$ROOT/eh-tag.S" -o "$TASK/objects/guest/jump-tag.o"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --thinlto-cache-dir="$TASK/cache/lto-jumps" -Map "$TASK/logs/jump-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/jumps.wasm" > "$TASK/logs/jump-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/jumps.wasm"
wasm-objdump -x "$TASK/objects/jumps.wasm" > "$TASK/logs/jump-abi.log"
