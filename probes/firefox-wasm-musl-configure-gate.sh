#!/usr/bin/env bash
set -euo pipefail

# Probe Firefox's target parser with a project-local overlay.  The pinned
# checkout is never modified and this command does not compile browser code.
# The overlay only adds wasm32-linux-musl to the target parser; subsequent
# configure failures are reported as the next port boundary.

repo="${FIREFOX_SRC:-$(cd "$(dirname -- "${BASH_SOURCE[0]}")/../sources/firefox" && pwd)}"
target=wasm32-unknown-linux-musl
project=browser
timeout_seconds="${FIREFOX_CONFIGURE_TIMEOUT:-30}"
expected_revision='b16f852ba66d190cacd42d0d43ac4d38bd07c4bd'
revision="$(git -C "$repo" rev-parse HEAD)"

[[ "$revision" == "$expected_revision" ]] || {
  printf 'Probe error: Firefox checkout is not pinned to %s (got %s).\n' \
    "$expected_revision" "$revision" >&2
  exit 2
}
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  printf 'Probe error: FIREFOX_CONFIGURE_TIMEOUT must be a positive integer.\n' >&2
  exit 2
}

tmp="$(mktemp -d "${TMPDIR:-/tmp}/firefox-wasm-musl.XXXXXX")"
keep="${FIREFOX_PROBE_KEEP:-0}"
cleanup() {
  if [[ "$keep" == 1 ]]; then
    printf 'Temporary probe tree retained: %s\n' "$tmp" >&2
  else
    rm -rf "$tmp"
  fi
}
trap cleanup EXIT

paths=(
  configure configure.py moz.configure moz.build Makefile.in CLOBBER
  config build python/mach python/mozboot python/mozbuild
  testing/mozbase/mozfile testing/mozbase/mozshellutil
  third_party/python/packaging third_party/python/filelock
  third_party/python/blessed third_party/python/wcwidth
  third_party/python/looseversion third_party/python/sentry_sdk
  third_party/python/urllib3 third_party/python/certifi third_party/python/six
  third_party/python/requirements.txt
  browser/config browser/moz.configure toolkit/moz.configure
  js/moz.configure js/src/configure
)
for path in "${paths[@]}"; do
  git -C "$repo" cat-file -e "$revision:$path" || {
    printf 'Probe error: archive path missing: %s\n' "$path" >&2
    exit 2
  }
done

mkdir -p "$tmp/src" "$tmp/obj"
timeout "$timeout_seconds" git -C "$repo" archive "$revision" -- "${paths[@]}" |
  timeout "$timeout_seconds" tar -xf - -C "$tmp/src"

# This is the complete local experiment.  The upstream expression permits
# wasm32 only for project=js; recognize this one Linux/musl target in the
# browser overlay so the real target parser can expose its next diagnostic.
python3 - "$tmp/src/build/moz.configure/init.configure" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = 'allow_wasi=(project == "js")'
new = 'allow_wasi=(project == "js" or (project == "browser" and target.startswith("wasm32-unknown-linux-musl")))'
if text.count(old) != 1:
    raise SystemExit("expected one Firefox WASI target gate")
path.write_text(text.replace(old, new))
PY

timeout "$timeout_seconds" python3 -m venv --system-site-packages "$tmp/venv"
timeout "$timeout_seconds" "$tmp/venv/bin/python" - "$tmp/venv" <<'PY'
import json
import sys
from pathlib import Path

prefix = Path(sys.argv[1])
prefix.joinpath("moz_virtualenv_metadata.json").write_text(
    json.dumps({
        "hex_version": sys.hexversion,
        "virtualenv_name": "build",
        "mach_site_packages_source": "NONE",
        "original_python_executable": sys.executable,
        "is_finalized": True,
    })
)
PY

log="$tmp/configure.log"
set +e
(cd "$tmp/obj" && timeout "$timeout_seconds" env \
  MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none MACH_NO_UV=1 \
  "$tmp/venv/bin/python" "$tmp/src/configure.py" \
  "--enable-project=$project" "--target=$target" \
  --disable-compile-environment --disable-tests) >"$log" 2>&1
status=$?
set -e
cat "$log"

if grep -Fq 'checking for target system type... wasm32-unknown-linux-musl' "$log"; then
  printf 'Target parser result: reached wasm32-unknown-linux-musl in a local overlay.\n'
else
  printf 'Target parser result: target was not accepted by the local overlay.\n' >&2
fi
printf 'Configure status: %s (no browser artifact was built).\n' "$status"
exit "$status"
