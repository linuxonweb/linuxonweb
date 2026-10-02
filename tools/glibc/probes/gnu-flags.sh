#!/bin/bash
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
OBJ="$TASK/objects/configure-port"
flags=(--target=wasm32-unknown-linux-gnu -nostdlib -nostdinc -isystem "$TOOLCHAIN/lib/clang/22/include" -std=gnu11 -fgnu89-inline -O2 -matomics -mbulk-memory -ffreestanding -fno-builtin -fno-stack-protector -I "$SRC/include" -I "$OBJ" -I "$SRC/sysdeps/unix/sysv/linux/wasm32" -I "$SRC/sysdeps/unix/sysv/linux/include" -I "$SRC/sysdeps/unix/sysv/linux" -I "$SRC/sysdeps/nptl" -I "$SRC/sysdeps/pthread" -I "$SRC/sysdeps/gnu" -I "$SRC/sysdeps/unix/inet" -I "$SRC/sysdeps/unix/sysv" -I "$SRC/sysdeps/unix" -I "$SRC/sysdeps/posix" -I "$SRC/sysdeps/wasm32" -I "$SRC/sysdeps/wordsize-32" -I "$SRC/sysdeps/ieee754/ldbl-128" -I "$SRC/sysdeps/ieee754/dbl-64" -I "$SRC/sysdeps/ieee754/flt-32" -I "$SRC/sysdeps/ieee754" -I "$SRC/sysdeps/generic" -I "$SRC" -I "$SRC/libio" -isystem "$KHEADERS" -D_LIBC_REENTRANT -include "$OBJ/libc-modules.h" -DMODULE_NAME=libc -include "$SRC/include/libc-symbols.h")

flags+=(-I "$SRC/setjmp" -I "$SRC/signal" -I "$SRC/elf" -I "$SRC/nptl" -fwasm-exceptions -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh)
