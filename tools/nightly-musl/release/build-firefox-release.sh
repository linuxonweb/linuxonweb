#!/bin/bash
# Release build of guest Firefox (Nightly 159, wasm32 musl) with the PBL JIT
# (PBLIC wasm IC stubs + PBLBC method compiler), then the boot package.
#
# usage: build-firefox-release.sh OUT_DIR
#
# Steps (each output stays under OUT_DIR, which must be on a persistent disk,
# not /tmp or tmpfs):
#   1. PortableBaselineInterpret.o from upstream + ../pbl-jit (compile-ic.sh)
#   2. libjs_static.a = the Nightly build's archive with that member replaced
#   3. glremote.o (web/linux/tests/guest-glremote/build.sh)
#   4. wasm-ld with firefox-link.args (no debug info)
#   5. original optimizer: wasm-opt -O2, then the --fpcast-emu ABI pass
#   6. package-firefox-native-gpu.py + slim-firefox-package.py -> OUT_DIR/package
# Publish to the dev server afterwards with
#   node web/desktop/publish-build.mjs OUT_DIR/package
set -euo pipefail
OUT=$(realpath -m "${1:?usage: build-firefox-release.sh OUT_DIR}")
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
NIGHTLY=/mnt/p6/build/firefox-nightly-musl-jit-full-20261002
TOOLS=/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8/bin
mkdir -p "$OUT"/{pbl/src,pbl/obj,lib,obj,t}
export TMPDIR=$OUT/t TMP=$OUT/t TEMP=$OUT/t BINARYEN_CORES=${BINARYEN_CORES:-4}
step() { echo "== $1 $(date +%T)"; }

step "1 JIT object"
cp "$NIGHTLY/source/firefox-159.0a1/js/src/vm/PortableBaselineInterpret.cpp" "$OUT/pbl/src/"
patch -s "$OUT/pbl/src/PortableBaselineInterpret.cpp" < "$REPO/tools/nightly-musl/pbl-jit/PortableBaselineInterpret.patch"
cp "$REPO"/tools/nightly-musl/pbl-jit/{PblIc.inc,PblIcOps.h,PblMethod.inc} "$OUT/pbl/src/"
(source "$REPO/tools/nightly-musl/recipe/environment.sh"; cd "$OUT/t"
 PBL_BUILD=$OUT/pbl timeout 1200 bash "$REPO/tools/nightly-musl/pbl-jit/compile-ic.sh")

step "2 libjs_static.a"
cp "$NIGHTLY/obj-nightly/js/src/build/libjs_static.a" "$OUT/lib/libjs_static.a"
(cd "$OUT/pbl/obj" && "$TOOLS/llvm-ar" r "$OUT/lib/libjs_static.a" PortableBaselineInterpret.o)

step "3 glremote.o"
bash "$REPO/web/linux/tests/guest-glremote/build.sh" "$OUT/glremote" > "$OUT/glremote.log"
cp "$OUT/glremote/obj/glremote.o" "$OUT/obj/glremote.o"

step "4 link"
sed -e "s|@RELEASE@|$HERE|g" -e "s|@OUT@|$OUT|g" "$HERE/firefox-link.args" > "$OUT/link.args"
(cd "$NIGHTLY/obj-nightly/browser/app" &&
 timeout 900 prlimit --as=17179869184 -- "$TOOLS/wasm-ld" @"$OUT/link.args")
wasm-validate --enable-all "$OUT/obj/firefox.preoptimizer.wasm"

step "5 optimize"
timeout 5400 prlimit --as=25769803776 -- wasm-opt "$OUT/obj/firefox.preoptimizer.wasm" -O2 -o "$OUT/obj/firefox.optimized.wasm"
timeout 1800 prlimit --as=17179869184 -- wasm-opt --all-features --disable-compact-imports \
  --pass-arg=max-func-params@23 --fpcast-emu "$OUT/obj/firefox.optimized.wasm" -o "$OUT/obj/firefox.fpcast.wasm"
wasm-validate --enable-all "$OUT/obj/firefox.fpcast.wasm"

step "6 package"
python3 "$HERE/release-report.py" "$OUT"
(cd "$REPO" && timeout 1200 python3 tools/guest-rootfs/package-firefox-native-gpu.py \
  --source /mnt/p6/build/browser-bugs-20261005/startup-tab-candidate-1/initramfs-firefox.cpio.gz \
  --manifest /mnt/p3/codex-build/gpu-service-root-oct06/current159-boot-manifest.json \
  --build "$OUT/report.json" --output "$OUT/package-full" \
  --gfxtest-test-wasm /mnt/p3/codex-build/opus-ffgpu/a38/gfxtest.fpcast.wasm \
  --pref gfx.webrender.all=true --pref gfx.webrender.software=false \
  --pref gfx.x11-egl.force-enabled=true --pref gfx.egl.prefer-gles.enabled=true \
  --pref layers.acceleration.force-enabled=true --no-publish &&
 timeout 900 python3 tools/guest-rootfs/slim-firefox-package.py "$OUT/package-full" "$OUT/package" \
  --pref browser.sessionstore.resume_from_crash=false --pref browser.shell.checkDefaultBrowser=false)
step done
echo "publish: node web/desktop/publish-build.mjs $OUT/package"
