#!/bin/bash
# vkmark for the wasm32 guest: static assimp, statically linked XCB window
# system, Khronos static loader + guest ICD (GUEST_VK_WSI) + hostcall transport.
# usage: build.sh OUT_NAME   (output: out/OUT_NAME/vkmark.wasm)
set -euo pipefail
ROOT=/mnt/p6/build/vkmark-wasm-20261006
OUT=$ROOT/out/$1; [ -e "$OUT" ] && { echo "output exists: $OUT" >&2; exit 1; }
mkdir -p "$OUT/obj"
export TMPDIR=$ROOT/tmp TMP=$ROOT/tmp TEMP=$ROOT/tmp
W=/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin
S=/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot
VK=/mnt/p6/build/vk-webgpu-hc-20261001/perf-build-a12-r6
ICD=${ICD_SRC:-/mnt/p6/project/linux/linuxonweb/web/linux/tests}
SRC=/mnt/p6/build/bench-src/vkmark/src
X11I="-I$VK/x11-inputs/x11/include -I$VK/x11-inputs/proto/include -I$VK/x11-inputs/xcb/include"
COMMON="-O2 -g0 -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections"
CXXFLAGS="$COMMON -std=c++17 -fwasm-exceptions -isystem $S/include/wasm32-linux-musl/c++/v1 -isystem $S/include/c++/v1
  -I$SRC -I$ROOT/gen -isystem $ROOT/src/vulkan-headers-231/include -isystem $ROOT/sysinc
  -isystem ${ASSIMP_SRC:-$ROOT/src/assimp}/include -isystem ${ASSIMP_BUILD:-$ROOT/assimp-build}/include -isystem $ROOT/shim/include $X11I
  -DVKMARK_WINDOW_SYSTEM_DIR=\"/usr/lib/vkmark\" -DVKMARK_DATA_DIR=\"/usr/share/vkmark\" -DVKMARK_VERSION_STR=\"2025.01\"
  -Wno-deprecated-declarations"
srcs=(benchmark benchmark_collection default_benchmarks device_uuid log main_loop mesh model options scene
  scene_collection util vulkan_state window_system_loader main
  vkutil/buffer_builder vkutil/copy_buffer vkutil/descriptor_set_builder vkutil/find_matching_memory_type
  vkutil/framebuffer_builder vkutil/image_builder vkutil/image_view_builder vkutil/map_memory
  vkutil/one_time_command_buffer vkutil/pipeline_builder vkutil/render_pass_builder vkutil/semaphore_builder
  vkutil/texture_builder vkutil/transition_image_layout
  scenes/clear_scene scenes/cube_scene scenes/default_options_scene scenes/desktop_scene scenes/effect2d_scene
  scenes/shading_scene scenes/texture_scene scenes/vertex_scene
  ws/xcb_window_system_plugin ws/xcb_native_system ws/swapchain_window_system)
pids=()
for s in "${srcs[@]}"; do
  o=$OUT/obj/${s//\//_}.o
  ( $W/wasm32-unknown-linux-musl-clang++ $CXXFLAGS -c $SRC/$s.cpp -o $o > $o.log 2>&1 || { echo "FAIL $s"; cat $o.log | grep -m5 error; } ) &
  pids+=($!)
  if (( ${#pids[@]} >= 4 )); then wait ${pids[0]}; pids=("${pids[@]:1}"); fi
done
wait
CFLAGS="-std=c11 $COMMON -I$VK/headers-source/include -DGUEST_VK_WSI ${ICD_DEFS:-} -DVK_USE_PLATFORM_XLIB_KHR -DVK_USE_PLATFORM_XCB_KHR $X11I -Wno-unused-but-set-variable"
$W/wasm32-unknown-linux-musl-clang $CFLAGS -c $ICD/guest-vulkan/icd.c -o $OUT/obj/icd.o
$W/wasm32-unknown-linux-musl-clang -std=c11 $COMMON -I$VK/headers-source/include -c $ICD/guest-gpu/guest-gpu.c -o $OUT/obj/transport.o
$W/wasm32-unknown-linux-musl-clang $COMMON -c $ROOT/shim/vkmark-static-ws.c -o $OUT/obj/static-ws.o
$W/wasm32-unknown-linux-musl-clang $COMMON -fwasm-exceptions -c $ROOT/shim/unwind-wasm.c -o $OUT/obj/unwind-wasm.o
ls $OUT/obj/*.o | wc -l
# No -O at link: the clang driver would run wasm-opt implicitly.
$W/wasm32-unknown-linux-musl-clang++ -pthread -fwasm-exceptions -static -nostdlib++ $OUT/obj/*.o \
  ${ASSIMP_BUILD:-$ROOT/assimp-build}/lib/libassimp.a ${ASSIMP_BUILD:-$ROOT/assimp-build}/contrib/zlib/libzlibstatic.a \
  $VK/libvulkan-guest-static.a $VK/x11-inputs/libX11.a $VK/x11-inputs/libxcb.a $VK/x11-inputs/libXau.a \
  -lc++ -lc++abi -lm -Wl,--wrap=dlopen,--wrap=dlsym,--wrap=dlclose \
  -Wl,--gc-sections,--import-memory,--export-table,--shared-memory \
  -Wl,--initial-memory=${INIT_MEM:-4194304},--max-memory=4294967296,-z,stack-size=1048576 -o $OUT/vkmark.wasm > $OUT/link.log 2>&1 \
  || { grep -m20 "error" $OUT/link.log; exit 1; }
ls -la $OUT/vkmark.wasm
wasm-objdump -x -j Import $OUT/vkmark.wasm | grep "<-"
