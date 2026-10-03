#!/usr/bin/env bash
set -euo pipefail
packet=/mnt/p6/build/firefox-nightly-musl-recovery-20261002
source "$packet/recipe/environment.sh"
RUSTC="$packet/recipe/rustc"
"$RUSTC" --crate-name libc --cfg musl_v1_2_3 --cfg musl32_time64 --cfg linux_time_bits64 --crate-type rlib --edition=2021 --target wasm32-unknown-linux-musl -A warnings "$packet/source/firefox-159.0a1/third_party/rust/libc/src/lib.rs" -o "$packet/libc-abi-clean-target/liblibc.rlib"
"$CC" -std=c11 -c "$packet/libc-abi-clean-target/c-layout.c" -o "$packet/libc-abi-clean-target/c-layout.o"
"$RUSTC" --crate-name native_libc_abi --crate-type lib --emit=obj --edition=2021 --target wasm32-unknown-linux-musl --extern libc="$packet/libc-abi-clean-target/liblibc.rlib" -A warnings "$packet/libc-abi-clean-target/rust-layout.rs" -o "$packet/libc-abi-clean-target/rust-layout.o"
"$CC" -nostdlib -Wl,--no-entry -Wl,--export-all -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=4294967296 "$packet/libc-abi-clean-target/c-layout.o" "$packet/libc-abi-clean-target/rust-layout.o" -o "$packet/libc-abi-clean-target/layout.wasm"
node "$packet/libc-abi-clean-target/check-layout.cjs"
