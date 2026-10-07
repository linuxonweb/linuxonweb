#!/bin/bash
# glmark2 (x11-gl-egl flavor) for the wasm32 guest: Mesa EGL/Zink (kopper on X11)
# archives from the glgears X11 link, the current guest Vulkan ICD, static Xlib/XCB.
# usage: build.sh OUT_NAME   (output: out/OUT_NAME/glmark2.wasm)
set -euo pipefail
ROOT=/mnt/p6/build/glmark2-wasm-20261006
OUT=$ROOT/out/$1; [ -e "$OUT" ] && { echo "output exists: $OUT" >&2; exit 1; }
mkdir -p "$OUT/obj"
# PREV=OUT_NAME reuses that output's app objects (the ICD and shims are always rebuilt).
[ -n "${PREV:-}" ] && cp -p $ROOT/out/$PREV/obj/*.o $OUT/obj/ && rm -f $OUT/obj/{icd,transport,static-gl,unwind-wasm}.o
export TMPDIR=$ROOT/tmp TMP=$ROOT/tmp TEMP=$ROOT/tmp
W=/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin
GL=${GL_LINK:-/mnt/p6/build/glgears-kopper-20261006/link/w12}
T=/mnt/p6/build/glgears-kopper-20261006
MESA=$T/mesa-26.2.3
ICD=${ICD_SRC:-/mnt/p6/project/linux/linuxonweb/web/linux/tests}
SRC=/mnt/p6/build/bench-src/glmark2/src
XCB=/nix/store/wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0
X11I="-I$GL/x11/x11-include -I$GL/x11/proto-include -I$XCB/include"
COMMON="-O2 -g0 -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections"
S=/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot
CXXFLAGS="$COMMON -std=c++17 -fwasm-exceptions -isystem $S/include/wasm32-linux-musl/c++/v1 -isystem $S/include/c++/v1 -I$SRC -I$SRC/libmatrix -I$SRC/scene-ideas -I$SRC/scene-terrain -I$SRC/glad/include -I$SRC/libpng -I$SRC/libjpeg-turbo -I$SRC/zlib $X11I
  -DUSE_EXCEPTIONS -DGLMARK2_USE_X11 -DGLMARK2_USE_GL -DGLMARK2_USE_EGL -DGLMARK2_EXECUTABLE=\"glmark2-egl\"
  -DGLMARK_VERSION=\"2023.01\" -DGLMARK_DATA_PATH=\"/usr/share/glmark2\" -Wno-deprecated-declarations"
CF="$COMMON -DZ_HAVE_UNISTD_H -I$SRC/zlib -I$SRC/libpng -I$SRC/libjpeg-turbo -I$SRC/glad/include $X11I -w"
srcs=$(sed -n "/^common_sources/,/^]/p" $SRC/meson.build | grep -o "'[^']*'" | tr -d "'")
srcs="$srcs main.cpp native-state-x11.cpp gl-state-egl.cpp"
csrcs="glad/src/gl.c glad/src/egl.c"
csrcs="$csrcs $(sed -n "/sources = \[/,/^]/p" $SRC/zlib/meson.build | grep -o "'[^']*\.c'" | tr -d "'" | sed 's|^|zlib/|')"
csrcs="$csrcs $(sed -n "/sources = \[/,/^]/p" $SRC/libpng/meson.build | grep -o "'[^']*\.c'" | tr -d "'" | sed 's|^|libpng/|')"
csrcs="$csrcs $(sed -n "/sources = \[/,/^]/p" $SRC/libjpeg-turbo/meson.build | grep -o "'[^']*\.c'" | tr -d "'" | sed 's|^|libjpeg-turbo/|')"
n=0
for s in $srcs $csrcs; do
  o=$OUT/obj/$(echo $s | tr / _).o; [ -e $o ] && continue
  case $s in *.c) cc="$W/wasm32-unknown-linux-musl-clang $CF";; *) cc="$W/wasm32-unknown-linux-musl-clang++ $CXXFLAGS";; esac
  ( $cc -c $SRC/$s -o $o > $o.log 2>&1 || { echo "FAIL $s"; grep -m5 error $o.log; } ) &
  n=$((n+1)); (( n % 6 == 0 )) && wait
done
wait
ICDF="-std=c11 $COMMON -I$T/icd/vk-headers-231 -DGUEST_VK_WSI -DVK_USE_PLATFORM_XLIB_KHR -DVK_USE_PLATFORM_XCB_KHR -Wno-unused-but-set-variable $X11I"
$W/wasm32-unknown-linux-musl-clang $ICDF -DGUEST_VK_ZINK=1 -c $ICD/guest-vulkan/icd.c -o $OUT/obj/icd.o
$W/wasm32-unknown-linux-musl-clang $ICDF -c $ICD/guest-gpu/guest-gpu.c -o $OUT/obj/transport.o
$W/wasm32-unknown-linux-musl-clang $COMMON -I$MESA/include $X11I -c $ROOT/shim/glmark2-static-gl.c -o $OUT/obj/static-gl.o
$W/wasm32-unknown-linux-musl-clang $COMMON -fwasm-exceptions -c /mnt/p6/build/vkmark-wasm-20261006/shim/unwind-wasm.c -o $OUT/obj/unwind-wasm.o
ls $OUT/obj/*.o | wc -l
# No -O at link: the clang driver would run wasm-opt implicitly.
$W/wasm32-unknown-linux-musl-clang++ -pthread -matomics -mbulk-memory -fwasm-exceptions -static -nostdlib++ $OUT/obj/*.o \
  $GL/obj/xshmfence-stub.o $GL/obj/present-guard.o $GL/obj/zink_static_vk.o $GL/obj/mmap-shim.o $GL/obj/ovr-builtin_functions.o \
  $GL/lib/libEGL_mesa.a $GL/lib/libEGL_extra.a $GL/lib/libgallium_s1.a \
  $GL/x11/libX11-xcb.a $GL/x11/libX11.a $GL/x11/libxcb-randr.a $GL/x11/libxcb-xfixes.a $GL/x11/libxcb-shm.a \
  $GL/x11/libxcb-present.a $GL/x11/libxcb-dri3.a $GL/x11/libxcb-sync.a $GL/x11/libxcb-render.a $GL/x11/libxcb.a $GL/x11/libXau.a \
  -lc++ -lc++abi -lm -Wl,--wrap=dlopen,--wrap=dlsym,--wrap=dlclose,--wrap=XNextEvent \
  -Wl,--wrap=xcb_present_select_input,--wrap=xcb_present_notify_msc,--wrap=xcb_wait_for_reply,--wrap=xcb_send_request,--wrap=xcb_send_request64,--wrap=xcb_send_request_with_fds,--wrap=xcb_send_request_with_fds64 \
  -Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--error-limit=0 \
  -Wl,--initial-memory=33554432,--max-memory=4294967296,-z,stack-size=1048576 -Wl,-Map=$OUT/link.map -o $OUT/glmark2.wasm > $OUT/link.log 2>&1 \
  || { grep -o 'undefined symbol: [^ ]*' $OUT/link.log | sort | uniq -c | sort -rn | head -30; grep -m10 error $OUT/link.log; exit 1; }
ls -la $OUT/glmark2.wasm
wasm-validate --enable-all $OUT/glmark2.wasm && echo valid
wasm-objdump -x -j Import $OUT/glmark2.wasm | grep "<-"
