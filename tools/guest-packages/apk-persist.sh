#!/bin/busybox sh
# REJECTED PROTOTYPE. Retained only as failure evidence; never execute a
# persistence transaction with the guest shell's unsupported failure semantics.
printf '%s\n' 'Rejected shell prototype: use the reviewed native apk-persist candidate.' >&2
exit 64

# Explicit durable package generations. Native apk remains the ordinary manager.
# Only signed package payloads + exact desired world persist; edits outside /home do not.
set -eu
PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PATH
BB=/bin/busybox
APK=/sbin/apk
STATE=/home/.linuxonweb-packages
BASE=/etc/linuxonweb-packages
LOCK=/run/linuxonweb-apk-persist.lock
stage=
locked=0
fail() { echo "apk-persist: $*" >&2; exit 1; }
log() { echo "apk-persist: $*" >&2; }
cleanup() {
  rc=$?
  if [ "$locked" = 1 ]; then "$BB" rmdir "$LOCK" 2>/dev/null || true; fi
  if [ "$rc" != 0 ] && [ -n "$stage" ]; then
    log "NOT COMMITTED; current RAM package changes are not saved. Previous active generation is intact. Retained staging evidence: $stage"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[ "$("$BB" id -u)" = 0 ] || fail 'run as root: sudo apk-persist ...'
[ -d "$BASE" ] && [ -r "$BASE/compatibility" ] && [ -r "$BASE/installed" ] || fail 'image has no supported package-persistence metadata'
"$BB" awk '$2 == "/home" && $3 == "virtiofs" { found=1 } END { exit !found }' /proc/mounts || fail 'persistent /home is not mounted; refusing an ephemeral save'
if [ ! -e "$STATE" ]; then "$BB" mkdir -m 700 "$STATE"; fi
[ -d "$STATE" ] && [ ! -L "$STATE" ] || fail 'state path is not a real directory'
[ "$("$BB" stat -c '%u:%g:%a' "$STATE")" = 0:0:700 ] || fail 'state must be root-owned mode 0700'
"$BB" mkdir "$LOCK" 2>/dev/null || fail 'another persistence operation owns the session lock'
locked=1
inventory() {
  "$BB" awk -F: '/^P:/ { p=$2 } /^V:/ { v=$2 } /^C:/ { c=$2 } /^$/ { if(p!="") print p " " v " " c; p="";v="";c="" } END { if(p!="") print p " " v " " c }' /lib/apk/db/installed | "$BB" sort
}
verify_trust() {
  (cd / && "$BB" sha256sum etc/apk/keys/*) > /run/linuxonweb-apk-trust
  "$BB" cmp -s /run/linuxonweb-apk-trust "$BASE/trust.sha256" || fail 'image signing trust changed'
}
check_base() {
  inventory > "$1"
  while read -r name version checksum; do
    "$BB" grep -qxF "$name $version $checksum" "$1" || fail "base package changed or missing: $name; this persistence schema does not replace base packages"
  done < "$BASE/installed"
  verify_trust
}
check_tokens() {
  for token in "$@"; do
    case "$token" in ''|-*|*[!a-zA-Z0-9._+@=~\<\>!:-]*) fail "unsupported package token: $token";; esac
  done
}
read_pointer() {
  pointer=$1
  [ -f "$pointer" ] && [ ! -L "$pointer" ] || fail 'generation pointer is not a regular file'
  [ "$("$BB" wc -l < "$pointer")" = 1 ] || fail 'invalid generation pointer length'
  read -r generation manifest_hash extra < "$pointer"
  case "$generation" in g-[a-zA-Z0-9_-]*) ;; *) fail 'invalid generation name';; esac
  case "$generation" in *[!a-zA-Z0-9_-]*) fail 'invalid generation name characters';; esac
  [ -z "${extra:-}" ] || fail 'invalid generation pointer fields'
  [ "${#manifest_hash}" = 64 ] || fail 'invalid generation manifest hash'
  case "$manifest_hash" in *[!a-f0-9]*) fail 'invalid generation manifest hash';; esac
  selected=$STATE/$generation
  [ -d "$selected" ] && [ ! -L "$selected" ] || fail 'selected generation directory missing'
}
verify_selected() {
  [ "$("$BB" sha256sum "$selected/checksums" | "$BB" cut -d ' ' -f1)" = "$manifest_hash" ] || fail 'generation manifest hash mismatch; active generation preserved'
  # Manifest names are generated locally, but reject any unexpected path before checksum access.
  "$BB" awk 'NF != 2 || $1 !~ /^[0-9a-f]+$/ || length($1) != 64 || ($2 != "world" && $2 != "installed" && $2 != "compatibility" && $2 !~ /^packages\/[a-zA-Z0-9._+-]+\.apk$/) { bad=1 } END { exit bad }' "$selected/checksums" || fail 'unsafe checksum manifest'
  (cd "$selected" && "$BB" sha256sum -c checksums) >/dev/null || fail 'generation content checksum mismatch; active generation preserved'
  "$BB" cmp -s "$BASE/compatibility" "$selected/compatibility" || fail 'generation belongs to an incompatible base/ABI/trust; use explicit base recovery, never auto-migrate'
  verify_trust
  [ -d "$selected/packages" ] && [ ! -L "$selected/packages" ] || fail 'package cache is not a real directory'
  "$BB" awk '{ if(seen[$2]++) bad=1; if($2=="world" || $2=="installed" || $2=="compatibility") required++ } END { exit bad || required!=3 }' "$selected/checksums" || fail 'missing or duplicate manifest entry'
  count=0
  for file in "$selected"/packages/*.apk; do
    [ -e "$file" ] || continue
    [ -f "$file" ] && [ ! -L "$file" ] || fail 'package cache contains a nonregular archive'
    relative=packages/${file##*/}
    "$BB" awk -v wanted="$relative" '$2==wanted {found++} END {exit found!=1}' "$selected/checksums" || fail 'unlisted archive in generation'
    "$APK" verify "$file" >/dev/null || fail 'signed package verification failed; no replay started' 
    count=$((count+1))
    [ "$count" -le 128 ] || fail 'generation exceeds package count limit'
  done
  [ "$("$BB" wc -l < "$selected/checksums")" -eq $((count+3)) ] || fail 'generation archive set differs from manifest' 
}
commit_pointer() {
  pointer_tmp=$STATE/.active.$$
  "$BB" printf '%s %s\n' "$generation" "$manifest_hash" > "$pointer_tmp"
  "$BB" chmod 600 "$pointer_tmp"
  "$BB" sync
  if [ -f "$STATE/active" ]; then
    "$BB" cp "$STATE/active" "$STATE/.previous.$$"
    "$BB" sync
    "$BB" mv -f "$STATE/.previous.$$" "$STATE/previous"
  fi
  "$BB" mv -f "$pointer_tmp" "$STATE/active"
  "$BB" sync
}
save_generation() {
  # Share apk's flock so a concurrent ordinary apk command cannot mutate the DB
  # while inventory/world/archives are captured. Read-only fetch/verify need no lock.
  exec 9>/lib/apk/db/lock
  "$BB" flock -n -x 9 || fail 'native apk database is busy'
  stage=$("$BB" mktemp -d "$STATE/.stage.XXXXXXXX")
  "$BB" chmod 700 "$stage"
  "$BB" mkdir -m 700 "$stage/packages"
  check_base "$stage/installed"
  "$BB" cp /etc/apk/world "$stage/world"
  "$BB" cp "$BASE/compatibility" "$stage/compatibility"
  previous_cache=
  if [ -f "$STATE/active" ]; then
    read_pointer "$STATE/active"
    verify_selected
    previous_cache=$selected/packages
  fi
  count=0
  while read -r name version checksum; do
    check_tokens "$name" "$version"
    if "$BB" grep -qxF "$name $version $checksum" "$BASE/installed"; then continue; fi
    filename=$name-$version.apk
    if [ -n "$previous_cache" ] && [ -f "$previous_cache/$filename" ]; then
      "$BB" cp "$previous_cache/$filename" "$stage/packages/$filename"
    else
      # Fetch the native repository-selected package, then require the exact
      # installed filename. A newer index cannot silently change this snapshot.
      "$APK" fetch --output "$stage/packages" "$name" || fail "could not fetch signed archive for $name"
      [ -f "$stage/packages/$filename" ] || fail "exact installed version unavailable: $name=$version; previous generation retained"
    fi
    "$APK" verify "$stage/packages/$filename" >/dev/null || fail "untrusted package $filename"
    count=$((count+1))
    [ "$count" -le 128 ] || fail 'package count exceeds supported generation limit'
  done < "$stage/installed"
  # An authenticated same-version rebuild is still a different payload. Ask
  # native apk to calculate its package C: identity, then require exact identity
  # with the installed database before acknowledging the generation.
  "$BB" grep -vxF -f "$BASE/installed" "$stage/installed" > /run/linuxonweb-apk-optional || [ "$?" = 1 ]
  if [ "$count" -gt 0 ]; then
    "$APK" index -o /run/linuxonweb-apk-snapshot-index.tar.gz "$stage"/packages/*.apk >/dev/null || fail 'could not index cached package identities'
    "$BB" tar -xOzf /run/linuxonweb-apk-snapshot-index.tar.gz APKINDEX | "$BB" awk -F: '/^P:/ {p=$2} /^V:/ {v=$2} /^C:/ {c=$2} /^$/ {if(p!="") print p " " v " " c; p="";v="";c=""} END {if(p!="") print p " " v " " c}' | "$BB" sort > /run/linuxonweb-apk-cached
  else
    : > /run/linuxonweb-apk-cached
  fi
  "$BB" cmp -s /run/linuxonweb-apk-optional /run/linuxonweb-apk-cached || fail 'cached signed package payload differs from exact installed package C: identity'
  bytes=$("$BB" du -sk "$stage" | "$BB" awk '{print $1}')
  [ "$bytes" -le 262144 ] || fail 'generation exceeds 256 MiB storage bound'
  (
    cd "$stage"
    "$BB" sha256sum world installed compatibility
    for file in packages/*.apk; do [ ! -f "$file" ] || "$BB" sha256sum "$file"; done
  ) > "$stage/checksums"
  "$BB" sync
  generation=g-$("$BB" date +%s)-$$-${stage##*.}
  manifest_hash=$("$BB" sha256sum "$stage/checksums" | "$BB" cut -d ' ' -f1)
  "$BB" mv "$stage" "$STATE/$generation"
  stage=
  "$BB" sync
  commit_pointer
  "$BB" flock -u 9
  exec 9>&-
  log "PACKAGE_PERSIST_COMMIT generation=$generation optionalPackages=$count storageKiB=$bytes; signed payloads and world saved"
}
restore_generation() {
  restore_start=$("$BB" cut -d ' ' -f1 /proc/uptime)
  if [ ! -f "$STATE/active" ]; then
    if [ -f "$STATE/disabled" ]; then log 'explicit base-only recovery is active; saved generations retained'; else log 'no saved packages; base image ready'; fi
    return 0
  fi
  read_pointer "$STATE/active"
  verify_selected
  inventory > /run/linuxonweb-apk-before
  "$BB" cmp -s /run/linuxonweb-apk-before "$BASE/installed" || fail 'replay requires a pristine base database; restart first'
  # Preflight all signatures and solver constraints before mutating this RAM rootfs.
  set -- "$selected"/packages/*.apk
  if [ -f "$1" ]; then
    "$APK" --no-network --repositories-file /dev/null --simulate add "$@" || fail 'offline restore solver failed; no packages replayed'
    "$APK" --no-network --repositories-file /dev/null add "$@" || fail 'offline replay failed; desktop must remain stopped until explicit base recovery'
  fi
  inventory > /run/linuxonweb-apk-after
  "$BB" cmp -s /run/linuxonweb-apk-after "$selected/installed" || fail 'restored database inventory mismatch; desktop must remain stopped'
  "$BB" cp "$selected/world" /etc/apk/world
  "$BB" sync
  restore_end=$("$BB" cut -d ' ' -f1 /proc/uptime)
  restore_seconds=$("$BB" awk -v start="$restore_start" -v end="$restore_end" 'BEGIN {printf "%.2f", end-start}')
  log "PACKAGE_PERSIST_RESTORE generation=$generation optionalPackages=$count elapsedSeconds=$restore_seconds; files/database/world coherent; offline signed replay complete"
}
command=${1:-help}
[ "$#" = 0 ] || shift
case "$command" in
  add|del)
    [ "$#" -gt 0 ] || fail 'specify one or more optional package names'
    check_tokens "$@"
    for token in "$@"; do
      name=${token%%[=\<\>~@]*}
      if "$BB" grep -q "^$name " "$BASE/installed"; then fail "base package cannot be changed with persistence: $name"; fi
    done
    log 'native package operation begins; persistence succeeds only after PACKAGE_PERSIST_COMMIT'
    "$APK" "$command" "$@" || fail 'native package operation failed; nothing new committed'
    save_generation
    ;;
  save) [ "$#" = 0 ] || fail 'save takes no arguments'; save_generation;;
  restore) [ "$#" = 0 ] || fail 'restore takes no arguments'; restore_generation;;
  status)
    if [ -f "$STATE/active" ]; then read_pointer "$STATE/active"; verify_selected; log "active=$generation optionalPackages=$count";
    elif [ -f "$STATE/disabled" ]; then log 'base-only recovery enabled; generations retained'; else log 'base image only; no persistent generation'; fi
    ;;
  disable)
    [ "$#" = 0 ] || fail 'disable takes no arguments'
    if [ -f "$STATE/active" ]; then "$BB" mv -f "$STATE/active" "$STATE/disabled"; "$BB" sync; fi
    log 'explicit base-only recovery recorded. Stop and Start for a pristine base; all generations retained.'
    ;;
  enable|previous)
    [ "$#" = 0 ] || fail "$command takes no arguments"
    if [ "$command" = enable ]; then read_pointer "$STATE/disabled"; else read_pointer "$STATE/previous"; fi
    verify_selected
    commit_pointer
    log 'selected saved generation. Stop and Start to replay it into a pristine base.'
    ;;
  help|--help)
    echo 'Usage: sudo apk-persist add|del PACKAGE... | save | status | disable | enable | previous'
    echo 'Persistent signed optional packages replay before desktop on the next Start.'
    echo 'Native apk alone is session-only. Manual /etc or /usr edits are not saved.'
    echo 'On corrupt/incompatible restore: apk-persist disable, then Stop and Start.'
    ;;
  *) fail "unknown operation: $command";;
esac
