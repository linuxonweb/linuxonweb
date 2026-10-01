#!/bin/bash
# Configure a headless (EGL surfaceless) Mesa Zink cross build for wasm32 musl.
# usage: configure-wasm32.sh TASKDIR NAME [extra meson args...]
#   TASKDIR must contain mesa-26.2.3/ (a copy, never the B0/B1 tree) and
#   cross/wasm32-musl.ini. Build dir: TASKDIR/build/NAME, log: TASKDIR/logs/configure-NAME.log
set -u
T=$1; name=$2; shift 2
export TMPDIR=$T/tmp TMP=$T/tmp TEMP=$T/tmp XDG_CACHE_HOME=$T/cache PIP_CACHE_DIR=$T/cache/pip CCACHE_DIR=$T/cache/ccache
export PATH=/mnt/p6/build/zink-gap-20260928/venv/bin:$PATH
mkdir -p $T/build $T/logs $T/tmp $T/cache
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
gen() { sed -e "s#@TASKDIR@#$T#g" -e "s#@ROOT@#$ROOT#g" "$1" > "$2"; }
# Generate the cross file / configure-only pkg-config stubs from the tracked templates (never overwrite).
if [ ! -f "$T/cross/wasm32-musl.ini" ]; then mkdir -p "$T/cross"; gen "$HERE/cross/wasm32-musl.ini.in" "$T/cross/wasm32-musl.ini"; fi
for n in xshmfence xxf86vm; do
  [ -f "$T/stubs/pkgconfig/$n.pc" ] || { mkdir -p "$T/stubs/pkgconfig"; gen "$HERE/stubs/pkgconfig/$n.pc.in" "$T/stubs/pkgconfig/$n.pc"; }
done
rm -rf "$T/build/$name"
meson setup "$T/build/$name" "$T/mesa-26.2.3" --cross-file "$T/cross/wasm32-musl.ini" \
  --wrap-mode=nodownload -Dbuildtype=release -Db_ndebug=true \
  -Dgallium-drivers=zink -Dvulkan-drivers= -Dllvm=disabled -Dgallium-rusticl=false \
  -Dopengl=true -Dgles1=disabled -Dgles2=enabled -Degl=enabled -Dglx=disabled -Dplatforms= \
  -Dgbm=disabled -Dbuild-tests=false -Dvalgrind=disabled -Dlibunwind=disabled -Dzstd=disabled \
  -Dshader-cache=disabled -Dzlib=disabled -Dxmlconfig=disabled -Dexpat=disabled -Dallow-fallback-for=libdrm \
  -Dlibdrm:tests=false -Dlibdrm:install-test-programs=false \
  "$@" > "$T/logs/configure-$name.log" 2>&1
rc=$?
echo "rc=$rc" >> "$T/logs/configure-$name.log"
echo "rc=$rc"; tail -40 "$T/logs/configure-$name.log"
