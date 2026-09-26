#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/firefox/media/libcubeb" >&2
  exit 2
fi
test_dir=$(cd -- "$(dirname -- "$0")" && pwd)
cubeb_source=$(realpath -- "$1")
test_tmp=$(mktemp -d "${TMPDIR:-/tmp}/cubeb-wasm-test.XXXXXX")
trap 'rm -rf -- "$test_tmp"' EXIT
# Gecko's assert wrapper needs its C++ build; map only that wrapper to libc assert.
"${CC:-clang}" -DCUBEB_ASSERT -include assert.h -DXASSERT=assert -D_POSIX_C_SOURCE=200809L -std=c11 -pthread -Wall -Wextra -Werror \
  -Wno-unknown-attributes -I"$cubeb_source/src" -I"$cubeb_source/include" \
  "$test_dir/cubeb-wasm.test.c" -lm -o "$test_tmp/cubeb-wasm-test"
"$test_tmp/cubeb-wasm-test"
