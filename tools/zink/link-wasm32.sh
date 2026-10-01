#!/bin/bash
# Static wasm32 link of Mesa Zink + surfaceless EGL + GLES2 + the guest Vulkan ICD.
# usage: link-wasm32.sh TASKDIR BUILDNAME [OUTNAME]
#   TASKDIR/build/BUILDNAME : ninja tree from configure-wasm32.sh (objects compiled;
#                             the .so link steps fail by design, wasm-ld has no shared libs)
#   TASKDIR/icd/src         : snapshot of web/linux/tests/{guest-vulkan,guest-gpu}
#   TASKDIR/icd/vk-headers-231 : Vulkan-Headers v1.3.231 include dir used by the ICD
#   TASKDIR/probe/eglprobe.c   : probe (tools/zink/probe/eglprobe.c)
# Outputs in TASKDIR/link/OUTNAME: static archives, eglprobe.wasm, logs, sha256.
set -u -o pipefail
T=$1; NAME=$2; OUTNAME=${3:-$2}
export TMPDIR=$T/tmp TMP=$T/tmp TEMP=$T/tmp XDG_CACHE_HOME=$T/cache
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
B=$T/build/$NAME; O=$T/link/$OUTNAME
WRAP=/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin
CC=$WRAP/wasm32-unknown-linux-musl-clang; CXX=$WRAP/wasm32-unknown-linux-musl-clang++
AR=llvm-ar
SHIMS=$ROOT/web/linux/firefox-shims
rm -rf "$O"; mkdir -p "$O/obj" "$O/lib" "$T/tmp"
log() { echo "== $*" | tee -a "$O/steps.log"; }
run() { local n=$1; shift; printf '%q ' "$@" > "$O/$n.command.txt"; echo >> "$O/$n.command.txt"
        "$@" > "$O/$n.log" 2>&1; local rc=$?; log "$n rc=$rc"; return $rc; }
CFLAGS=(-O2 -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections)

# 1. adapters / shims
run cc-zink-static-vk "$CC" "${CFLAGS[@]}" -std=c11 -Wall -Wextra -Werror -c "$HERE/shims/zink_static_vk.c" -o "$O/obj/zink_static_vk.o" || exit 1
run cc-mmap-shim "$CC" "${CFLAGS[@]}" -I"$SHIMS" -c "$SHIMS/mmap-shim.c" -o "$O/obj/mmap-shim.o" || exit 1
run cc-unwind-stubs "$CC" "${CFLAGS[@]}" -c "$SHIMS/unwind-stubs.c" -o "$O/obj/unwind-stubs.o" || exit 1
# 2. guest Vulkan ICD + vsock transport (same flags as guest-vulkan-graphics/build.py, no WSI)
ICDF=(-DGUEST_VK_ZINK=1 -std=c11 -O2 -Wall -Wextra -Werror -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections -I"$T/icd/vk-headers-231")
run cc-icd "$CC" "${ICDF[@]}" -c "$T/icd/src/guest-vulkan/icd.c" -o "$O/obj/icd.o" || exit 1
run cc-transport "$CC" "${ICDF[@]}" -c "$T/icd/src/guest-gpu/guest-gpu.c" -o "$O/obj/transport.o" || exit 1
# 3. probe
run cc-eglprobe "$CC" "${CFLAGS[@]}" -std=c11 -I"$T/mesa-26.2.3/include" -c "$T/probe/eglprobe.c" -o "$O/obj/eglprobe.o" || exit 1
# 3b. Mesa override objects (tools/zink/patches, see mesa-overrides.sh)
. "$HERE/mesa-overrides.sh"; mesa_overrides "$T/mesa-26.2.3" "$B" "$O" || exit 1

# 4. static archives (P1). Inputs are exactly those of the failed .so link edges in build.ninja.
GALLIUM_ARCHIVES=(src/gallium/frontends/dri/libdri.a src/mesa/libmesa.a src/compiler/glsl/libglsl.a
  src/compiler/glsl/glcpp/libglcpp.a src/util/libmesa_util.a src/util/libmesa_util_simd.a src/util/blake3/libblake3.a
  src/c11/impl/libmesa_util_c11.a subprojects/libdrm-2.4.133/libdrm.a src/compiler/nir/libnir.a src/compiler/libcompiler.a
  src/compiler/spirv/libvtn.a src/gallium/auxiliary/libgalliumvl.a src/gallium/auxiliary/libgallium.a
  src/mesa/glapi/shared-glapi/libglapi.a src/gallium/auxiliary/pipe-loader/libpipe_loader_static.a src/loader/libloader.a
  src/util/libxmlconfig.a src/gallium/winsys/sw/null/libws_null.a src/gallium/winsys/sw/wrapper/libwsw.a
  src/gallium/winsys/sw/dri/libswdri.a src/gallium/winsys/sw/kms-dri/libswkmsdri.a src/gallium/winsys/kmsro/drm/libkmsrowinsys.a
  src/gallium/drivers/zink/libzink.a src/vulkan/util/libvulkan_util.a src/gallium/winsys/zink/drm/libzinkwinsys.a)
cd "$B" || exit 1
for a in "${GALLIUM_ARCHIVES[@]}"; do [ -f "$a" ] || { log "missing $a (run ninja first)"; exit 1; }; done
EGL_OBJS=(src/egl/libEGL.so.1.0.0.p/*.c.o)
# libgallium (Zink + DRI frontend + mesa state tracker + glapi + util): one flat archive
run ar-gallium "$AR" qcsL "$O/lib/libgallium_zink.a" src/gallium/targets/dri/libgallium-26.2.3.so.p/dri_target.c.o "${GALLIUM_ARCHIVES[@]}" || exit 1
run ar-egl "$AR" qcs "$O/lib/libEGL_mesa.a" "${EGL_OBJS[@]}" || exit 1
run ar-gles2 "$AR" qcs "$O/lib/libGLESv2_mesa.a" src/mesa/glapi/es2api/libGLESv2.so.2.0.0.p/libgles2_public.c.o || exit 1
run ar-glapi cp src/mesa/glapi/shared-glapi/libglapi.a "$O/lib/libglapi.a" || exit 1
run ar-icd "$AR" qcs "$O/lib/libguest_vk_icd.a" "$O/obj/icd.o" "$O/obj/transport.o" || exit 1
cd "$O" || exit 1

# 5. executable. wasm-ld resolves archives in any order (no --start-group needed).
#    zink_static_vk.o is an object, so libmesa_util.a's u_dl.c.o is never pulled.
LINKF=(-pthread -matomics -mbulk-memory -static -nostdlib++
  -Wl,--gc-sections,--import-memory,--export-table,--shared-memory
  -Wl,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576
  -Wl,--error-limit=0)
OBJS=("$O/obj/eglprobe.o" "$O/obj/zink_static_vk.o" "$O/obj/mmap-shim.o" "$O/obj/unwind-stubs.o" "${OVR[@]}")
LIBS=("$O/lib/libEGL_mesa.a" "$O/lib/libGLESv2_mesa.a" "$O/lib/libgallium_zink.a" "$O/lib/libguest_vk_icd.a" -lc++ -lc++abi -lm)
run link "$CXX" "${LINKF[@]}" "${OBJS[@]}" "${LIBS[@]}" -Wl,-Map="$O/link.map" -o "$O/eglprobe.wasm"
rc=$?
if [ $rc -ne 0 ]; then
  # --error-limit=0 makes link.log the precise list of what remains.
  grep -o 'undefined symbol: [^ ]*' "$O/link.log" | sort | uniq -c | sort -rn > "$O/undefined-symbols.txt"
  log "undefined symbols: $(wc -l < "$O/undefined-symbols.txt")"
fi
for f in lib/*.a eglprobe*.wasm; do [ -f "$f" ] && printf '%s %s\n' "$(stat -c %s "$f")" "$(sha256sum "$f")"; done > "$O/artifacts.txt"
cat "$O/artifacts.txt"
if [ -f eglprobe.wasm ]; then
  run validate wasm-validate --enable-all eglprobe.wasm
  run abi wasm-objdump -x -j Import eglprobe.wasm
  grep ' <- ' abi.log | sed 's/.* <- //' | sort -u > imports.txt; log "imports: $(tr '\n' ' ' < imports.txt)"
fi
exit $rc
