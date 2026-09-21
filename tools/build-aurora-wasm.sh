#!/usr/bin/env bash
set -euo pipefail
aurora_src="${AURORA_SRC:-/home/a/project/aurorawm}"
out_dir="${AURORA_OUT:-web/wasm_smoke/artifacts}"
webos_root="${WEBOS_ROOT:-/mnt/p6/project/linux/webos}"
[[ -f "$aurora_src/Cargo.toml" ]] || { echo "Aurora source checkout not found: $aurora_src" >&2; exit 2; }
command -v node >/dev/null || { echo "Node.js is required for the webos build scripts" >&2; exit 2; }
[[ -f "$webos_root/scripts/build-aurora.mjs" && -f "$webos_root/scripts/build-xvfb.mjs" ]] || {
  echo "webos source-build scripts not found under $webos_root" >&2; exit 2;
}
echo "Aurora source: $aurora_src"
echo "Building source payloads via $webos_root"
(cd "$webos_root" && node scripts/build-aurora.mjs)
(cd "$webos_root" && node scripts/build-xvfb.mjs)
mkdir -p "$out_dir/aurora" "$out_dir/xvfb"
cp "$webos_root/public/upstream/aurora/aurora-wm.js" "$out_dir/aurora/"
cp "$webos_root/public/upstream/aurora/aurora-wm.wasm" "$out_dir/aurora/"
cp "$webos_root/public/upstream/xvfb/Xvfb.js" "$out_dir/xvfb/"
cp "$webos_root/public/upstream/xvfb/Xvfb.wasm" "$out_dir/xvfb/"
(cd "$out_dir" && sha256sum aurora/* xvfb/* > SHA256SUMS)
echo "Wrote checksummed artifacts to $out_dir"
