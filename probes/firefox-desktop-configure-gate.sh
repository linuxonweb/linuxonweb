#!/usr/bin/env bash
set -euo pipefail

# Run Firefox's real top-level configure for the desktop browser project without
# materializing or changing the sparse sources/firefox checkout. The source
# overlay contains the configure frontend, moz.configure files, and vendored
# Python modules needed to reach target parsing. This is intentionally a
# bounded target/toolchain gate; it does not build Firefox.

repo="${FIREFOX_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../sources/firefox" && pwd)}"
target="${FIREFOX_WASM_TARGET:-wasm32-wasi}"
project="${FIREFOX_CONFIGURE_PROJECT:-browser}"
timeout_seconds="${FIREFOX_CONFIGURE_TIMEOUT:-30}"
expected_revision='b16f852ba66d190cacd42d0d43ac4d38bd07c4bd'
expected_error='ERROR: Unknown OS: wasi'
revision="$(git -C "$repo" rev-parse HEAD)"

if [[ "$project" != browser && "$project" != js ]]; then
  printf 'Probe error: project must be browser or js (got %s).\n' "$project" >&2
  exit 2
fi
if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Probe error: FIREFOX_CONFIGURE_TIMEOUT must be a positive integer (got %s).\n' "$timeout_seconds" >&2
  exit 2
fi
if [[ "$revision" != "$expected_revision" ]]; then
  printf 'Probe error: Firefox checkout is not pinned to %s (got %s).\n' \
    "$expected_revision" "$revision" >&2
  exit 2
fi

tmp="$(mktemp -d /tmp/firefox-desktop-configure.XXXXXX)"
keep="${FIREFOX_PROBE_KEEP:-0}"

cleanup() {
  if [[ "$keep" == 1 ]]; then
    printf 'Temporary probe tree retained: %s\n' "$tmp" >&2
  else
    rm -rf "$tmp"
  fi
}
trap cleanup EXIT

printf 'Firefox revision: %s\n' "$revision"
printf 'Firefox configure gate: project=%s target=%s\n' "$project" "$target"

mkdir -p "$tmp/src" "$tmp/obj"

# These paths are the bounded configure dependency closure. In particular,
# build/ and config/ include the moz.configure frontend and config.sub used by
# the authoritative target parser; no browser engine sources are needed.
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

# git archive exits successfully when a requested path is absent, so check
# every member first. This keeps a sparse or incomplete overlay from silently
# turning into a different configure input set.
for path in "${paths[@]}"; do
  if ! git -C "$repo" cat-file -e "$revision:$path"; then
    printf 'Probe error: Firefox archive path is missing at %s:%s.\n' \
      "$revision" "$path" >&2
    exit 2
  fi
done

# Bound archive extraction as well as configure. A partial clone or a stalled
# tar consumer must not leave this gate running indefinitely.
set +e
timeout "${timeout_seconds}s" git -C "$repo" archive "$revision" -- "${paths[@]}" |
  timeout "${timeout_seconds}s" tar -xf - -C "$tmp/src"
archive_status=("${PIPESTATUS[@]}")
set -e
if (( archive_status[0] != 0 || archive_status[1] != 0 )); then
  if (( archive_status[0] == 124 || archive_status[1] == 124 )); then
    printf 'Probe error: Firefox archive setup exceeded %ss.\n' \
      "$timeout_seconds" >&2
  else
    printf 'Probe error: Firefox archive setup failed (git=%s tar=%s).\n' \
      "${archive_status[0]}" "${archive_status[1]}" >&2
  fi
  exit 1
fi

# configure.py normally creates/activates Mach's build virtualenv, which can
# invoke package resolution. A finalized metadata marker makes the isolated
# system-site-packages venv look like an already-active build site, keeping
# this probe offline and bounded while using Firefox's own configure code.
set +e
timeout "${timeout_seconds}s" python3 -m venv --system-site-packages "$tmp/venv"
venv_status=$?
set -e
if (( venv_status != 0 )); then
  if (( venv_status == 124 )); then
    printf 'Probe error: Firefox virtualenv setup exceeded %ss.\n' \
      "$timeout_seconds" >&2
  else
    printf 'Probe error: Firefox virtualenv setup failed (status=%s).\n' \
      "$venv_status" >&2
  fi
  exit 1
fi

set +e
timeout "${timeout_seconds}s" "$tmp/venv/bin/python" - "$tmp/venv" <<'PY'
import json
import sys
from pathlib import Path

prefix = Path(sys.argv[1])
prefix.joinpath("moz_virtualenv_metadata.json").write_text(
    json.dumps(
        {
            "hex_version": sys.hexversion,
            "virtualenv_name": "build",
            "mach_site_packages_source": "NONE",
            "original_python_executable": sys.executable,
            "is_finalized": True,
        }
    )
)
PY
metadata_status=$?
set -e
if (( metadata_status != 0 )); then
  if (( metadata_status == 124 )); then
    printf 'Probe error: Firefox virtualenv metadata setup exceeded %ss.\n' \
      "$timeout_seconds" >&2
  else
    printf 'Probe error: Firefox virtualenv metadata setup failed (status=%s).\n' \
      "$metadata_status" >&2
  fi
  exit 1
fi

log="$tmp/configure.log"
set +e
(cd "$tmp/obj" && timeout "${timeout_seconds}s" env \
  MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none MACH_NO_UV=1 \
  "$tmp/venv/bin/python" "$tmp/src/configure.py" \
  "--enable-project=$project" "--target=$target" \
  --disable-compile-environment --disable-tests) >"$log" 2>&1
status=$?
set -e
# Keep the complete configure transcript byte-for-byte visible to callers. In
# particular, do not paraphrase or rewrite the upstream diagnostic below.
cat "$log"

if [[ "$project" == browser && "$target" == wasm32-wasi ]] &&
   grep -Fqx -- "$expected_error" "$log"; then
  printf 'Desktop browser target decision: REJECTED by upstream configure (expected).\n'
  printf 'Upstream rule: build/moz.configure/init.configure uses allow_wasi=(project == "js").\n'
  printf 'Probe result: authoritative desktop rejection reached (configure status=%s; no browser artifact was built).\n' "$status"
  printf 'Probe status: NOT PASS (the desktop browser target was rejected; no Firefox browser result exists).\n' >&2
  exit 1
fi

if [[ "$status" -eq 124 ]]; then
  printf 'Probe error: configure exceeded %ss; no target decision was accepted.\n' "$timeout_seconds" >&2
elif [[ "$project" == js && "$target" == wasm32-wasi ]] &&
     grep -Fq 'checking for target system type... wasm32-unknown-wasi' "$log"; then
  printf 'Probe result: JS-only WASI target parsing was reached, but this is not a desktop browser result.\n' >&2
  printf 'Probe error: refusing to declare the JS-shell path a browser port.\n' >&2
else
  printf 'Probe error: expected desktop rejection was not observed (status=%s).\n' "$status" >&2
fi
exit 1
