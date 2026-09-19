#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$root_dir/build.sh"

port="${PORT:-8765}"
python3 -m http.server "$port" --directory "$root_dir" >/tmp/linuxonweb-wasm-http.log 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

browser="${BROWSER:-$(command -v chromium || command -v google-chrome || true)}"
if [[ -z "$browser" ]]; then
  echo "No Chromium-compatible browser found; static wasm build passed." >&2
  exit 2
fi

dom="$($browser --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --dump-dom --virtual-time-budget=3000 "http://127.0.0.1:$port/" 2>/tmp/linuxonweb-wasm-chromium.log)"
printf '%s\n' "$dom"
grep -q 'data-result="pass"' <<<"$dom"
