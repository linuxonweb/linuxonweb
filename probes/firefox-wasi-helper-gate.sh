#!/usr/bin/env bash
set -euo pipefail

# This gate reads files from the pinned Firefox checkout without restoring or
# modifying its sparse working tree. It checks the WASI/wasm32 configure rule
# and builds Firefox's tiny WASI helper crate, not the Firefox browser.

repo="${FIREFOX_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../sources/firefox" && pwd)}"
target="${FIREFOX_WASM_TARGET:-wasm32-unknown-unknown}"
revision="$(git -C "$repo" rev-parse HEAD)"
tmp="$(mktemp -d)"

printf 'Firefox revision: %s\n' "$revision"
printf 'Temporary extraction: %s\n' "$tmp"

init_cfg="$tmp/init.configure"
js_cfg="$tmp/js.moz.configure"
git -C "$repo" show HEAD:build/moz.configure/init.configure > "$init_cfg"
git -C "$repo" show HEAD:js/moz.configure > "$js_cfg"

grep -Fq 'allow_wasi=(project == "js")' "$init_cfg"
grep -Fq 'if build_project == "js"' "$js_cfg"
printf 'Configure gate: WASI triplets are accepted only for project=js.\n'

mkdir -p "$tmp/build/rust/wasi"
git -C "$repo" show HEAD:build/rust/wasi/Cargo.toml > "$tmp/build/rust/wasi/Cargo.toml"
git -C "$repo" show HEAD:build/rust/wasi/lib.rs > "$tmp/build/rust/wasi/lib.rs"

printf 'Cargo gate: checking build/rust/wasi for %s ...\n' "$target"
(cd "$tmp/build/rust/wasi" && cargo check --target "$target")
printf 'Cargo gate: PASS (WASI helper crate only; this is not a Firefox browser build).\n'

