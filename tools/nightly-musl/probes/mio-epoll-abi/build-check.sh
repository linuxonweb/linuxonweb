#!/usr/bin/env bash
set -euo pipefail
packet=/mnt/p6/build/firefox-nightly-musl-recovery-20261002
cd "$packet"
source recipe/environment.sh
"$CC" -c mio-epoll-abi/c-layout.c -o mio-epoll-abi/c-layout.o
"$RUSTC" --crate-name mio_epoll_abi --crate-type lib --emit=obj --edition=2021 --target wasm32-unknown-linux-musl --extern libc=libc-abi-clean-target/liblibc.rlib -A warnings -C opt-level=2 mio-epoll-abi/r-layout.rs -o mio-epoll-abi/r-layout.o
"$CC" -nostdlib -Wl,--no-entry -Wl,--export-all -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=4294967296 mio-epoll-abi/c-layout.o mio-epoll-abi/r-layout.o -o mio-epoll-abi/probe.wasm
node mio-epoll-abi/check.cjs
