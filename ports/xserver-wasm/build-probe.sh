#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
src="$root/sources/xserver"
out=$(mktemp -d "${TMPDIR:-/tmp}/xserver-wasm.XXXXXX")
trap 'rm -rf "$out"' EXIT
echo "xserver source pin: $(git -C "$src" rev-parse HEAD)"
echo "wasm toolchain: ${CLANG:-clang} / ${WASM_LD:-wasm-ld}"
cat >"$out/wasm.cross" <<EOF
[binaries]
c = '${CLANG:-clang}'

[host_machine]
system = 'emscripten'
cpu_family = 'wasm'
cpu = 'wasm32'
endian = 'little'
EOF
set +e
meson setup "$out/build" "$src" --cross-file "$out/wasm.cross" \
  -Ddocs=false -Dxorg=false -Dxwayland=false -Dxephyr=false \
  -Dxvfb=false -Dxnest=false -Dglamor=false \
  -Dudev=false -Dsystemd_logind=false -Ddri1=false -Ddri2=false -Ddri3=false \
  >"$out/meson.log" 2>&1
rc=$?
set -e
if [ "$rc" -eq 0 ]; then echo 'UNEXPECTED: upstream Xserver configured for wasm'; exit 1; fi
echo 'EXPECTED BLOCKER: upstream Xserver has no wasm display/OS target'
sed -n '1,16p' "$out/meson.log"
