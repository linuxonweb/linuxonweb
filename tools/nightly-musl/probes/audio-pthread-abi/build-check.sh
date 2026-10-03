#!/usr/bin/env bash
set -euo pipefail
packet=/mnt/p6/build/firefox-nightly-musl-recovery-20261002
cd "$packet"
source recipe/environment.sh
"$RUSTC" --crate-name audio_pthread_abi --crate-type staticlib --edition=2021 --target wasm32-unknown-linux-musl --extern libc=libc-abi-clean-target/liblibc.rlib -A warnings -C opt-level=2 audio-pthread-abi/probe.rs -o audio-pthread-abi/libprobe.a
"$CC" -c audio-pthread-abi/c-size.c -o audio-pthread-abi/c-size.o
"$CC" -nostdlib -Wl,--no-entry -Wl,--export=c_pthread_size -Wl,--export=c_pointer_size -Wl,--export=r_pthread_size -Wl,--export=r_pointer_size -Wl,--export=roundtrip -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=4294967296 audio-pthread-abi/c-size.o audio-pthread-abi/libprobe.a -o audio-pthread-abi/probe.wasm
node audio-pthread-abi/check.cjs
