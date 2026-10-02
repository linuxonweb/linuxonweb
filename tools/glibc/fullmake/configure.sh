#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../env.sh"
storage_check
mkdir "$TASK/objects/fullmake"
cd "$TASK/objects/fullmake"
"$SRC/configure" --prefix="$TASK/sysroot" --build=x86_64-pc-linux-gnu --host=wasm32-unknown-linux-gnu --disable-shared --disable-werror --disable-multi-arch --disable-default-pie --disable-profile --with-headers="$KHEADERS" CC="$ROOT/compiler.py -nostdlib -nostdinc -isystem $TOOLCHAIN/lib/clang/22/include" AR="$TOOLCHAIN/bin/llvm-ar" RANLIB="$TOOLCHAIN/bin/llvm-ranlib" LD="$TOOLCHAIN/bin/wasm-ld" READELF="$TOOLCHAIN/bin/llvm-readelf" OBJDUMP="$TOOLCHAIN/bin/llvm-objdump" CXX="$TOOLCHAIN/bin/clang++ --target=wasm32-unknown-linux-gnu -nostdlib -nostdinc -isystem $TOOLCHAIN/lib/clang/22/include" LDFLAGS='-Wl,--no-entry' CFLAGS='-O2 -matomics -mbulk-memory' > "$TASK/logs/fullmake-configure.log" 2>&1
