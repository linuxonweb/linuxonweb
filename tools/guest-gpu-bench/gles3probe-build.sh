#!/bin/bash
# gles3probe for the wasm32 guest: same Mesa EGL/Zink archives and current
# guest Vulkan ICD as glmark2-build.sh. usage: gles3probe-build.sh OUT_DIR
set -euo pipefail
OUT=$1; [ -e "$OUT" ] && { echo "output exists: $OUT" >&2; exit 1; }
mkdir -p "$OUT/obj"
export TMPDIR=$(dirname "$OUT")/t TMP=$(dirname "$OUT")/t TEMP=$(dirname "$OUT")/t; mkdir -p "$TMPDIR"
W=/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin
GL=${GL_LINK:-/mnt/p6/build/glgears-kopper-20261006/link/w12}
T=/mnt/p6/build/glgears-kopper-20261006
MESA=$T/mesa-26.2.3
HERE=$(cd "$(dirname "$0")" && pwd); ICD=$HERE/../../web/linux/tests
XCB=/nix/store/wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0
X11I="-I$GL/x11/x11-include -I$GL/x11/proto-include -I$XCB/include"
COMMON="-O2 -g0 -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections"
ICDF="-std=c11 $COMMON -I$T/icd/vk-headers-231 -DGUEST_VK_WSI -DVK_USE_PLATFORM_XLIB_KHR -DVK_USE_PLATFORM_XCB_KHR -Wno-unused-but-set-variable $X11I"
$W/wasm32-unknown-linux-musl-clang $ICDF -DGUEST_VK_ZINK=1 -c $ICD/guest-vulkan/icd.c -o $OUT/obj/icd.o
$W/wasm32-unknown-linux-musl-clang $ICDF -c $ICD/guest-gpu/guest-gpu.c -o $OUT/obj/transport.o
$W/wasm32-unknown-linux-musl-clang $COMMON -Wall -I$MESA/include -c $HERE/gles3probe.c -o $OUT/obj/gles3probe.o
$W/wasm32-unknown-linux-musl-clang $COMMON -fwasm-exceptions -c /mnt/p6/build/vkmark-wasm-20261006/shim/unwind-wasm.c -o $OUT/obj/unwind-wasm.o
# No -O at link: the clang driver would run wasm-opt implicitly.
$W/wasm32-unknown-linux-musl-clang++ -pthread -matomics -mbulk-memory -fwasm-exceptions -static -nostdlib++ $OUT/obj/*.o \
  $GL/obj/xshmfence-stub.o $GL/obj/present-guard.o $GL/obj/zink_static_vk.o $GL/obj/mmap-shim.o $GL/obj/ovr-builtin_functions.o \
  $GL/lib/libEGL_mesa.a $GL/lib/libEGL_extra.a $GL/lib/libgallium_s1.a \
  $GL/x11/libX11-xcb.a $GL/x11/libX11.a $GL/x11/libxcb-randr.a $GL/x11/libxcb-xfixes.a $GL/x11/libxcb-shm.a \
  $GL/x11/libxcb-present.a $GL/x11/libxcb-dri3.a $GL/x11/libxcb-sync.a $GL/x11/libxcb-render.a $GL/x11/libxcb.a $GL/x11/libXau.a \
  -lc++ -lc++abi -lm -Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--error-limit=0 \
  -Wl,--initial-memory=33554432,--max-memory=4294967296,-z,stack-size=1048576 -o $OUT/gles3probe.wasm > $OUT/link.log 2>&1 \
  || { grep -o 'undefined symbol: [^ ]*' $OUT/link.log | sort | uniq -c | sort -rn | head -30; grep -m10 error $OUT/link.log; exit 1; }
ls -la $OUT/gles3probe.wasm
