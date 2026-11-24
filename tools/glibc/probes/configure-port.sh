#!/bin/bash
set -u
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
mkdir -p "$TASK/objects/configure-port"
cd "$TASK/objects/configure-port"
"$SRC/configure" --prefix="$TASK/sysroot" --build=x86_64-pc-linux-gnu --host=wasm32-unknown-linux-gnu --disable-shared --disable-werror --disable-multi-arch --disable-default-pie --disable-profile --with-headers="$KHEADERS" CC="$TOOLCHAIN/bin/clang --target=wasm32-unknown-linux-gnu -nostdlib -nostdinc -isystem $TOOLCHAIN/lib/clang/22/include" AR="$TOOLCHAIN/bin/llvm-ar" RANLIB="$TOOLCHAIN/bin/llvm-ranlib" LD="$TOOLCHAIN/bin/wasm-ld" READELF="$TOOLCHAIN/bin/llvm-readelf" CXX="$TOOLCHAIN/bin/clang++ --target=wasm32-unknown-linux-gnu -nostdlib -nostdinc -isystem $TOOLCHAIN/lib/clang/22/include" LDFLAGS='-Wl,--no-entry' CFLAGS='-O2 -matomics -mbulk-memory' > "$TASK/logs/configure-port.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$TASK/logs/configure-port.exit"
tail -40 "$TASK/logs/configure-port.log"
exit "$rc"
