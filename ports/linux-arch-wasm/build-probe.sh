#!/usr/bin/env bash
set -euo pipefail

repo="${LINUX_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../sources/linux" && pwd)}"
patch_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/linux-arch-wasm.patch"
work="$(mktemp -d)"
src="$work/linux"
out="$work/build"

printf 'Linux revision: %s\n' "$(git -C "$repo" rev-parse HEAD)"
printf 'Temporary source: %s\n' "$src"

# A detached worktree keeps every edit outside the tracked upstream checkout.
git -C "$repo" worktree add --detach "$src" HEAD >/dev/null
trap 'git -C "$repo" worktree remove --force "$src" >/dev/null 2>&1 || true' EXIT
git -C "$src" apply "$patch_file"

# A partial upstream checkout can omit helper scripts even though they are in
# the pinned Git tree. Materialize only the files needed by Kbuild into the
# temporary worktree; never restore them into sources/linux.
required_files=(
    scripts/Kbuild.include
    scripts/pahole-version.sh
    scripts/kconfig/Makefile
    scripts/kconfig/conf.c
    scripts/kconfig/confdata.c
    scripts/kconfig/expr.c
    scripts/kconfig/expr.h
    scripts/kconfig/internal.h
    scripts/kconfig/lexer.l
    scripts/kconfig/lkc.h
    scripts/kconfig/lkc_proto.h
    scripts/kconfig/menu.c
    scripts/kconfig/parser.y
    scripts/kconfig/preprocess.c
    scripts/kconfig/preprocess.h
    scripts/kconfig/symbol.c
    scripts/kconfig/util.c
)
for required in "${required_files[@]}"; do
    if [[ ! -f "$src/$required" ]]; then
        mkdir -p "$src/${required%/*}"
        git -C "$repo" show "HEAD:$required" > "$src/$required"
        if [[ "$required" == scripts/pahole-version.sh ]]; then
            chmod +x "$src/$required"
        fi
    fi
done

printf '\n== kconfig recognition ==\n'
make -C "$src" O="$out" ARCH=wasm LLVM=1 olddefconfig
make -C "$src" O="$out" ARCH=wasm LLVM=1 syncconfig

printf '\n== compile probe (expected to expose next missing arch dependency) ==\n'
set +e
KCONFIG_NOSILENTUPDATE=1 make -C "$src" O="$out" ARCH=wasm LLVM=1 CROSS_COMPILE= \
  KCFLAGS='-Wno-error' -j1 vmlinux </dev/null 2>&1 | tee "$work/compile.log"
status=${PIPESTATUS[0]}
set -e
printf 'compile_exit=%s\n' "$status"
if [[ "$status" -eq 0 ]]; then
  echo 'unexpected: skeleton produced vmlinux' >&2
  exit 1
fi

printf '\n== standalone wasm compiler probe ==\n'
clang --target=wasm32-unknown-unknown -ffreestanding -fno-builtin \
  -nostdlib -Wl,--no-entry -Wl,--export=kernel_probe \
  -x c -o "$work/kernel-probe.wasm" - <<'EOF'
__attribute__((export_name("kernel_probe"))) int kernel_probe(void) { return 0; }
EOF
file "$work/kernel-probe.wasm"

echo 'kconfig recognized ARCH=wasm; compile stopped as expected at an unimplemented dependency.'
