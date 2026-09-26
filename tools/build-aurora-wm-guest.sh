#!/usr/bin/env bash
# Build Aurora WM for the Linux Wasm guest. Never modifies a rootfs.
# ABI adaptations follow woiceatus/aurora-wm-wasm c2cd4a69d565cdb14d9f4b33d6cb6fdc419f6398.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
source_dir=${AURORA_WM_SOURCE:-$repo/vendor/aurorawm}
fonts_dir=${AURORA_WM_FONTS:-/home/a/project/aurorawm/fonts}
build_dir=${AURORA_WM_BUILD_DIR:-$repo/../.cache/aurora-wm-guest}
mkdir -p "$build_dir"
build_dir=$(cd "$build_dir" && pwd)
output=${1:-$build_dir/aurora-wm}
export RUSTC=${AURORA_GUEST_RUSTC:-/nix/store/inawdy1i2n35ns90cy5664q952wmqz02-rustc/bin/rustc}
cargo=${AURORA_GUEST_CARGO:-/nix/store/m1lr4f6ghlmi7qls1x6x3gig8cxahjjl-rust-nightly-complete-with-components-2026-07-22/bin/cargo}
cc=${AURORA_GUEST_CC:-/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang}
for executable in "$RUSTC" "$cargo" "$cc"; do
  [[ -x "$executable" ]] || { echo "Missing guest toolchain executable: $executable" >&2; exit 2; }
done
[[ -f "$source_dir/Cargo.lock" ]] || { echo "Missing Aurora source: $source_dir" >&2; exit 2; }
# The tracked snapshot intentionally omits fonts. Compile a scratch overlay.
mkdir -p "$build_dir/source/fonts"
cp "$source_dir/Cargo.toml" "$source_dir/Cargo.lock" "$build_dir/source/"
cp -a "$source_dir/src" "$build_dir/source/"
for font in NotoSans-Regular.ttf NotoSans-Bold.ttf NotoSansMono-Regular.ttf NotoSansMono-Bold.ttf; do
  [[ -f "$fonts_dir/$font" ]] || { echo "Missing font: $fonts_dir/$font (set AURORA_WM_FONTS)" >&2; exit 2; }
  cp "$fonts_dir/$font" "$build_dir/source/fonts/"
done
cp -a "${AURORA_WM_WALLPAPER:-/home/a/project/aurorawm/wallpaper}" "$build_dir/source/"
# Preserve the deployed NOMMU shell/PTY adaptation in a scratch overlay.
python3 "$repo/tools/guest-rootfs/adapt-wm-guest.py" "$build_dir/source/src/files.rs"
export CARGO_HOME="$build_dir/cargo-home"
export CARGO_TARGET_DIR="$build_dir/target"
mkdir -p "$CARGO_HOME" "$build_dir/crates"

# These two crates need the port's wasm32 Linux configuration. Verify downloads
# against Cargo.lock before extracting, and keep overrides out of the source tree.
python3 - "$source_dir/Cargo.lock" "$build_dir/crates" "$CARGO_HOME/config.toml" <<'PY'
import hashlib, pathlib, sys, tarfile, tomllib, urllib.request
lock, dest, config = map(pathlib.Path, sys.argv[1:])
packages = {p['name']: p for p in tomllib.loads(lock.read_text())['package']}
paths = []
for name, version in [('linux-raw-sys', '0.12.1'), ('rustix', '1.1.4')]:
    package = packages[name]
    if package['version'] != version:
        raise SystemExit(f'{name} changed version; review Wasm patches before building')
    folder = dest / f'{name}-{version}'
    marker = folder / '.aurora-guest-patched-v2'
    if not marker.exists():
        archive = dest / f'{name}-{version}.crate'
        if not archive.exists():
            with urllib.request.urlopen(f'https://static.crates.io/crates/{name}/{name}-{version}.crate') as response:
                archive.write_bytes(response.read())
        if hashlib.sha256(archive.read_bytes()).hexdigest() != package['checksum']:
            raise SystemExit(f'Checksum mismatch: {archive}')
        with tarfile.open(archive) as tar:
            tar.extractall(dest, filter='data')
        def replace(relative, old, new):
            path = folder / relative
            text = path.read_text()
            if old not in text:
                raise SystemExit(f'Patch context absent: {path}')
            path.write_text(text.replace(old, new))
        if name == 'linux-raw-sys':
            replace('src/lib.rs', 'target_arch = "arm"', 'any(target_arch = "arm", target_arch = "wasm32")')
        else:
            replace('src/ioctl/linux.rs', 'target_arch = "csky"', 'target_arch = "csky",\n    target_arch = "wasm32"')
            replace('src/backend/libc/fs/syscalls.rs', '#[cfg(target_env = "musl")]', '#[cfg(all(linux_raw_dep, target_env = "musl"))]')
            # Keep linux_raw_dep: musl's libc crate lacks STATX constants.
            # The absent wasm32 inline-asm backend already selects libc calls.
        marker.touch()
    paths.append(str(folder))
import json
config.write_text('paths = ' + json.dumps(paths) + '\n')
PY

# Rust std still references fork although this guest implements PTYs with spawn.
cat > "$build_dir/fork-stub.c" <<'C'
#include <errno.h>
#include <sys/types.h>
pid_t fork(void) { errno = ENOSYS; return -1; }
C
"$cc" -c "$build_dir/fork-stub.c" -o "$build_dir/fork-stub.o"
export RUSTFLAGS="-C link-arg=$build_dir/fork-stub.o"
# Match the guest port: its target std is built without cross-crate LTO.
export CARGO_PROFILE_RELEASE_LTO=false
"$cargo" build --locked --release --bin aurora-wm \
  --manifest-path "$build_dir/source/Cargo.toml" --target wasm32-unknown-linux-musl
artifact="$CARGO_TARGET_DIR/wasm32-unknown-linux-musl/release/aurora-wm"
wasm-validate --enable-all "$artifact"
node --input-type=module - "$artifact" <<'JS'
import fs from 'node:fs';
const module = new WebAssembly.Module(fs.readFileSync(process.argv[2]));
const imports = WebAssembly.Module.imports(module);
if (!imports.some(i => i.module === 'linux' && i.name === 'syscall') ||
    imports.some(i => i.module === 'wasi_snapshot_preview1')) {
  throw new Error('Artifact does not have the Linux guest ABI');
}
if (!WebAssembly.Module.exports(module).some(e => e.name === '_start')) {
  throw new Error('Guest entrypoint _start is missing');
}
console.log('Validated Linux guest Wasm imports and entrypoint');
JS
mkdir -p "$(dirname "$output")"
cp "$artifact" "$output"
sha256sum "$output"
echo "Candidate only: $output"
