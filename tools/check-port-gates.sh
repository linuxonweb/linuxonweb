#!/usr/bin/env bash
set -u

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
linux="$root/sources/linux"
firefox="$root/sources/firefox"
xserver="$root/sources/xserver"
failed=0

report() { printf '[%-5s] %s\n' "$1" "$2"; }

if [[ -d "$linux/arch/wasm" ]]; then
  report PASS 'Linux has an arch/wasm tree'
else
  report BLOCK 'Linux upstream has no arch/wasm tree (boot/MMU/interrupt port is required)'
  failed=1
fi

if [[ -d "$xserver" ]] && rg -q 'wasm|WASM|WebAssembly' "$xserver" --glob '!*.po' --glob '!*.md'; then
  report PASS 'X server contains a wasm-specific implementation'
else
  report BLOCK 'X server has no wasm-specific display/input backend'
  failed=1
fi

if [[ -d "$firefox/.git" ]]; then
  init=$(git -C "$firefox" show HEAD:build/moz.configure/init.configure 2>/dev/null || true)
  if grep -q 'allow_wasi=(project == "js")' <<<"$init"; then
    report BLOCK 'Firefox enables WASI target parsing only for project=js, not desktop Firefox'
    failed=1
  else
    report PASS 'Firefox desktop configuration exposes a WASI target'
  fi
else
  report BLOCK 'Firefox source checkout is missing'
  failed=1
fi

if make -C "$root/web/wasm_smoke" smoke >/tmp/linux-on-web-smoke.log 2>&1; then
  report PASS 'freestanding wasm32 adapter instantiates in Chromium'
else
  report FAIL 'freestanding wasm32 adapter smoke test failed'
  failed=1
fi

if (( failed )); then
  printf '\nFull native Linux + Firefox gate is not yet satisfied.\n'
  exit 1
fi
printf '\nAll native port gates passed.\n'
