#!/usr/bin/env bash
set -euo pipefail

# Build the only privileged program placed in the guest image. The target
# toolchain/sysroot is explicit: host libc output is unusable in the guest.
target=${SUDO_TARGET:-wasm32-unknown-linux-musl}
cc=${CC:-clang}
sysroot=${SUDO_SYSROOT:-}
out=${1:-tools/guest-rootfs/sudo.bin}

command -v "$cc" >/dev/null 2>&1 || {
  echo "sudo helper: compiler not found: $cc" >&2
  exit 2
}
[[ -n "$sysroot" && -d "$sysroot" ]] || {
  echo "sudo helper: SUDO_SYSROOT must name the wasm32-musl sysroot" >&2
  exit 2
}

mkdir -p "$(dirname "$out")"
"$cc" --target="$target" --sysroot="$sysroot" \
  -std=c11 -O2 -ffunction-sections -fdata-sections -fno-stack-protector \
  -static -Wl,--gc-sections -Wl,--build-id=none \
  -o "$out" tools/guest-rootfs/sudo.c
chmod 04755 "$out"
echo "wrote root-owned setuid helper candidate: $out"
