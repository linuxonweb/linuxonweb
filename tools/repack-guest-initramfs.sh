#!/usr/bin/env bash
set -euo pipefail

# The staged archives carry meaningful uid/gid metadata. Run under fakeroot
# when available so an unprivileged checkout can preserve it byte-for-byte at
# the archive boundary; real root builds simply use the normal path.
if [[ -z ${FAKEROOTKEY:-} ]] && command -v fakeroot >/dev/null 2>&1; then
  exec fakeroot -- "$0" "$@"
fi

# Rebuild a staged guest CPIO from source templates. The input archive is never
# modified; this is the reproducible path used to refresh web/linux payloads.
usage() {
  echo "usage: $0 [--gzip] INPUT_CPIO[.gz] OUTPUT_CPIO[.gz]" >&2
  exit 2
}

gzip_output=0
if [[ ${1:-} == --gzip ]]; then
  gzip_output=1
  shift
fi
[[ $# -eq 2 ]] || usage
input=$1
output=$2
input=$(readlink -f "$input")
output_dir=$(readlink -f "$(dirname "$output")")
output="$output_dir/$(basename "$output")"
[[ -f $input ]] || { echo "input archive not found: $input" >&2; exit 1; }
[[ $input != "$output" ]] || { echo "input and output must differ" >&2; exit 1; }

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
templates=$root_dir/tools/guest-rootfs
for template in init.sh passwd group shadow sudoers; do
  [[ -f $templates/$template ]] || { echo "missing template: $template" >&2; exit 1; }
done

# A shell script cannot elevate on this guest. Require an independently
# compiled wasm32-musl helper and fail closed when one is not supplied.
sudo_helper=${SUDO_HELPER:-}
[[ -n $sudo_helper && -f $sudo_helper ]] || {
  echo "SUDO_HELPER must point to a compiled wasm32-musl sudo helper" >&2
  exit 2
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/guest-initramfs.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/root"

if [[ $(head -c 2 "$input" | od -An -tx1 | tr -d ' \n') == 1f8b ]]; then
  gzip -dc "$input" | (cd "$tmp/root" && cpio -idmu --quiet)
else
  (cd "$tmp/root" && cpio -idmu --quiet < "$input")
fi

# Preserve the archive's existing init owner. Firefox's historical staged
# image was repacked with uid/gid 1000, while the GUI image is root-owned.
init_uid=$(stat -c '%u' "$tmp/root/init" 2>/dev/null || echo 0)
init_gid=$(stat -c '%g' "$tmp/root/init" 2>/dev/null || echo 0)

install -D -m 0755 "$templates/init.sh" "$tmp/root/init"
install -D -m 04755 "$sudo_helper" "$tmp/root/usr/bin/sudo"
install -D -m 0644 "$templates/passwd" "$tmp/root/etc/passwd"
install -D -m 0644 "$templates/group" "$tmp/root/etc/group"
install -D -m 0600 "$templates/shadow" "$tmp/root/etc/shadow"
install -D -m 0440 "$templates/sudoers" "$tmp/root/etc/sudoers"

mkdir -p "$tmp/root/home/admin/Desktop" \
  "$tmp/root/home/admin/Documents" \
  "$tmp/root/home/admin/Downloads" \
  "$tmp/root/home/firefox"
chown -R 1000:1000 "$tmp/root/home/admin" "$tmp/root/home/firefox"
chmod 0700 "$tmp/root/home/admin" "$tmp/root/home/firefox"
chown "$init_uid:$init_gid" "$tmp/root/init"
chown 0:0 "$tmp/root/usr/bin/sudo" "$tmp/root/etc/passwd" \
  "$tmp/root/etc/group" "$tmp/root/etc/shadow" "$tmp/root/etc/sudoers"

# New metadata is timestamped at the epoch. Existing payload timestamps are
# retained, so repeated runs produce identical output for the same input.
touch -d '@0' "$tmp/root/init" "$tmp/root/usr/bin/sudo" \
  "$tmp/root/etc/passwd" "$tmp/root/etc/group" "$tmp/root/etc/shadow" \
  "$tmp/root/etc/sudoers"
find "$tmp/root/home/admin" "$tmp/root/home/firefox" -exec touch -d '@0' {} +
# cpio creates extracted directories with the current clock time. Normalize
# every directory so a second rebuild from the generated archive is identical.
find "$tmp/root" -type d -exec touch -d '@0' {} +

mkdir -p "$(dirname "$output")"
if (( gzip_output )) || [[ $output == *.gz ]]; then
  (cd "$tmp/root" && find . -print0 | LC_ALL=C sort -z | \
    cpio --null --reproducible -H newc -o 2>/dev/null) | gzip -n -9 > "$output"
else
  (cd "$tmp/root" && find . -print0 | LC_ALL=C sort -z | \
    cpio --null --reproducible -H newc -o 2>/dev/null) > "$output"
fi

echo "wrote $output"
