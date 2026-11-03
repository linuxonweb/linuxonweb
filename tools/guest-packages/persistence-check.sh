#!/bin/busybox sh
# Test assertions only: no errexit/nounset/EXIT-trap semantics are assumed.
BB=/bin/busybox
P=/usr/sbin/apk-persist
STATE=/home/.linuxonweb-packages
TASK=/home/.persistence-fixture
fail=0
checks=0
check() { label=$1; shift; checks=$((checks+1)); if "$@"; then echo "PERSIST_CHECK_PASS $label"; else echo "PERSIST_CHECK_FAIL $label"; fail=$((fail+1)); fi; }
finish() { echo "PERSIST_CHECK_DONE phase=$phase checks=$checks failures=$fail"; echo "PACKAGE_SMOKE_EXIT status=$fail"; }
$BB mkdir -p "$TASK"
phase=0
if [ -f "$TASK/phase" ]; then phase=$($BB cat "$TASK/phase"); fi
echo "PERSIST_CHECK_PHASE $phase"
if [ "$phase" = 0 ]; then
 check pristine-base "$P" status
 check signed-repository-update /sbin/apk update
 check signed-add-and-save "$P" add gzip tar
 check installed-native-packages /sbin/apk info --installed gzip tar
 check genuine-tar /usr/bin/tar --version
 check generation-verification "$P" status
 check save-exact-world-reference $BB cp /etc/apk/world "$TASK/world-both"
 $BB printf 'persistent signed generation payload\n' > "$TASK/payload"
 /usr/bin/gzip -c "$TASK/payload" > "$TASK/payload.gz"
 check native-gzip-data $BB test "$?" = 0
 $BB printf '1\n' > "$TASK/phase"
elif [ "$phase" = 1 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 check offline-restore "$P" restore
 check exact-world-restored $BB cmp /etc/apk/world "$TASK/world-both"
 check installed-after-reboot /sbin/apk info --installed gzip tar
 check genuine-tar-after-reboot /usr/bin/tar --version
 check native-gzip-after-reboot /usr/bin/gzip -t "$TASK/payload.gz"
 check offline-delete-and-save "$P" del tar
 check deleted-file $BB test ! -e /usr/bin/tar
 check preserved-native-gzip /usr/bin/gzip -t "$TASK/payload.gz"
 check save-removal-world $BB cp /etc/apk/world "$TASK/world-gzip"
 $BB printf '2\n' > "$TASK/phase"
elif [ "$phase" = 2 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 check offline-restore-removal "$P" restore
 check removal-world-exact $BB cmp /etc/apk/world "$TASK/world-gzip"
 check deleted-package-stays-deleted $BB test ! -e /usr/bin/tar
 check native-gzip-stays-installed /usr/bin/gzip -t "$TASK/payload.gz"
 check generation-verification "$P" status
 gen=$($BB cut -d ' ' -f 1 "$STATE/active")
 check owned-generation-present $BB test -d "$STATE/$gen"
 # Corrupt only this test profile's immutable payload, retaining the original
 # manifest/pointer as evidence. Next boot must fail before package replay.
 $BB printf 'corrupt-fixture' >> "$STATE/$gen/packages/gzip-1.14-r0.apk"
 $BB printf '3\n' > "$TASK/phase"
elif [ "$phase" = 3 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 "$P" restore > "$TASK/corrupt-restore.log" 2>&1
 check corrupt-generation-rejected $BB test "$?" -ne 0
 check corruption-diagnostic $BB grep -F 'saved file checksum mismatch' "$TASK/corrupt-restore.log"
 check no-payload-replayed-before-validation $BB test ! -e /usr/bin/gzip
 check pristine-world-retained $BB cmp /etc/apk/world /etc/linuxonweb-packages/base-world
 check explicit-disable "$P" disable
 check active-pointer-removed $BB test ! -e "$STATE/active"
 check previous-generation-retained $BB test -f "$STATE/previous"
 $BB printf '4\n' > "$TASK/phase"
elif [ "$phase" = 4 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 check disabled-base-boot "$P" restore
 check optional-payload-absent $BB test ! -e /usr/bin/gzip
 check base-database /sbin/apk info --installed apk-tools busybox ca-certificates curl
 check base-world $BB cmp /etc/apk/world /etc/linuxonweb-packages/base-world
 check saved-user-data $BB grep -F 'persistent signed generation payload' "$TASK/payload"
else
 check bounded-phase $BB false
fi
finish
exit "$fail"
