#!/bin/bash
# usage: mrun.sh RUN BUILD SECS [glmark2 args...]  -- pack glmark2 out/BUILD and run it on Zink in the guest
set -e
A=/mnt/p3/codex-build/opus-ffgpu/a14; run=$1; build=$2; secs=$3; shift 3
export TMPDIR=/mnt/p3/codex-build/opus-ffgpu/t TMP=/mnt/p3/codex-build/opus-ffgpu/t TEMP=/mnt/p3/codex-build/opus-ffgpu/t PYTHONDONTWRITEBYTECODE=1
D=/mnt/p6/build/bench-src/glmark2/data
cd $A; python3 pack-files.py $run.cpio /mnt/p6/build/glmark2-wasm-20261006/out/$build/glmark2.wasm:/bin/glmark2 $D/models:/usr/share/glmark2/models \
  $D/shaders:/usr/share/glmark2/shaders $D/textures:/usr/share/glmark2/textures -- \
  "/bin/busybox env MESA_LOADER_DRIVER_OVERRIDE=zink LIBGL_ALWAYS_SOFTWARE=1 GUEST_VK_DEVICE_TYPE=cpu GALLIUM_THREAD=0 ${GLENV:-} /bin/glmark2 -s 500x500 --swap-mode immediate $* 2>&1" > /dev/null
TAIL=1 bash iter.sh $run gputest-vkgears.cpio $run.cpio "gputest=1&gputestapp=vkgears" $secs > /dev/null
grep -an "FPS\|MESA\|^\[\|GPU status\|GUEST_VK\|Score\|rror" $run/guest.log | grep -v "HELLO\|^[0-9]*:\[ *[0-9.]*\] \|^[0-9]*:\[host\]" | awk '{k=$0;sub(/^[0-9]*:/,"",k)} !seen[k]++' | head -${LINES_OUT:-40}
