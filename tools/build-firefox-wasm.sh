#!/usr/bin/env bash
set -euo pipefail

# Materialize and verify the native Firefox Wasm payload staged in the guest
# archive.  This is deliberately not a source compiler: upstream Firefox's
# desktop configure rejects wasm32-wasi (only the JS shell accepts it).  The
# script therefore fails closed unless the staged executable is a valid Wasm
# module with the browser guest ABI.  It also runs a tiny freestanding link
# with the installed Arch LLVM tools so toolchain drift is visible.

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
input=${FIREFOX_INITRAMFS:-$root/web/linux/initramfs-firefox.cpio.gz}
output=${FIREFOX_WASM_OUT:-}

usage() {
  printf 'usage: %s OUTPUT_WASM [INPUT_CPIO[.gz]]\n' "$0" >&2
  printf '       FIREFOX_WASM_OUT=... FIREFOX_INITRAMFS=... %s\n' "$0" >&2
  exit 2
}

if [[ $# -gt 2 ]]; then usage; fi
if [[ $# -ge 1 ]]; then output=$1; fi
if [[ $# -ge 2 ]]; then input=$2; fi
[[ -n $output ]] || usage

for tool in clang wasm-ld wasm-objdump wasm-validate cpio gzip; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'firefox-wasm: required Arch tool missing: %s\n' "$tool" >&2
    exit 2
  }
done
[[ -f $input ]] || { printf 'firefox-wasm: archive not found: %s\n' "$input" >&2; exit 2; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/firefox-wasm-build.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

# Confirm the selected compiler/linker can produce a native wasm32 module.  A
# successful probe does not imply that Firefox itself is source-buildable.
cat >"$tmp/probe.c" <<'EOF'
int firefox_wasm_toolchain_probe(void) { return 42; }
EOF
clang --target=wasm32-unknown-unknown -ffreestanding -nostdlib \
  -c "$tmp/probe.c" -o "$tmp/probe.o"
wasm-ld --no-entry --export=firefox_wasm_toolchain_probe \
  "$tmp/probe.o" -o "$tmp/probe.wasm"
wasm-validate "$tmp/probe.wasm"

if [[ $(head -c 2 "$input" | od -An -tx1 | tr -d ' \n') == 1f8b ]]; then
  gzip -dc "$input" | (cd "$tmp" && cpio -idmu --quiet opt/firefox/firefox)
else
  (cd "$tmp" && cpio -idmu --quiet <"$input" opt/firefox/firefox)
fi
module=$tmp/opt/firefox/firefox
[[ -f $module ]] || { printf 'firefox-wasm: archive lacks opt/firefox/firefox\n' >&2; exit 1; }

[[ $(head -c 4 "$module" | od -An -tx1 | tr -d ' \n') == 0061736d ]] || {
  printf 'firefox-wasm: extracted executable is not a Wasm module\n' >&2
  file "$module" >&2 || true
  exit 1
}

# This module intentionally uses threads, exception handling, and other
# post-MVP features.  Enable all WABT feature gates while still performing
# full structural validation.
wasm-validate --enable-all "$module"
metadata=$(wasm-objdump -x "$module")
for required in \
  'func\[[0-9]+\].*<- linux\.syscall' \
  'func\[[0-9]+\].*<- linux\.get_thread_area' \
  'func\[[0-9]+\].*<- linux\.copy_siginfo' \
  'memory\[0\].*shared.*<- env.memory' \
  'func\[[0-9]+\].*-> "_start"'; do
  grep -Eq -- "$required" <<<"$metadata" || {
    printf 'firefox-wasm: required ABI record missing: %s\n' "$required" >&2
    exit 1
  }
done
grep -q '^Custom:$' <<<"$metadata" || {
  printf 'firefox-wasm: build_id custom section missing\n' >&2
  exit 1
}
grep -q 'name: "build_id"' <<<"$metadata" || {
  printf 'firefox-wasm: build_id custom section missing\n' >&2
  exit 1
}

mkdir -p "$(dirname -- "$output")"
cp "$module" "$output"
printf 'Firefox Wasm payload: %s\n' "$output"
printf 'SHA-256: '
sha256sum "$output" | cut -d' ' -f1
printf 'Source build status: staged native module verified; desktop Firefox source build remains unsupported by upstream configure.\n'
