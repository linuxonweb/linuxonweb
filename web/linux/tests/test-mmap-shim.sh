#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_build=$(mktemp -d "${TMPDIR:?set TMPDIR to disk-backed scratch}/lowland-mmap-test.XXXXXX")
trap 'rm -rf "$test_build"' EXIT HUP INT TERM
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -g \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  "$test_dir/mmap-shim.test.c" -o "$test_build/mmap-shim.test"
ASAN_OPTIONS=detect_leaks=1 "$test_build/mmap-shim.test"
