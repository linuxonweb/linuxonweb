#!/bin/busybox sh
BB=/bin/busybox
P=/usr/sbin/apk-persist
STATE=/home/.linuxonweb-packages
TASK=/home/.persistence-interrupt-fixture
fail=0
checks=0
check() { label=$1; shift; checks=$((checks+1)); if "$@"; then echo "PERSIST_BOUNDARY_PASS $label"; else echo "PERSIST_BOUNDARY_FAIL $label"; fail=$((fail+1)); fi; }
$BB mkdir -p "$TASK"
phase=0
if [ -f "$TASK/phase" ]; then phase=$($BB cat "$TASK/phase"); fi
echo "PERSIST_BOUNDARY_PHASE $phase instrumentedHelper=1"
if [ "$phase" = 0 ]; then
 check repository-update /sbin/apk update
 check acknowledged-gzip-generation "$P" add gzip
 check preserve-acknowledged-pointer $BB cp "$STATE/active" "$TASK/acknowledged-active"
 check unacknowledged-tar-session-install /sbin/apk add tar
 check kill-before-activation /tests/persistence-interrupt before-activate
 check prior-pointer-identical $BB cmp "$STATE/active" "$TASK/acknowledged-active"
 check prior-generation-valid "$P" status
 $BB printf 'owned-user-marker\n' > "$TASK/user-marker"
 $BB printf '1\n' > "$TASK/phase"
elif [ "$phase" = 1 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 check restore-prior-after-kill "$P" restore
 check acknowledged-gzip-retained /sbin/apk info --installed gzip
 check unacknowledged-tar-absent $BB test ! -e /usr/bin/tar
 check removal-session-only /sbin/apk del gzip
 check kill-after-active-rename /tests/persistence-interrupt after-active-rename
 $BB cmp "$STATE/active" "$TASK/acknowledged-active" >/dev/null 2>&1
 check new-complete-pointer-selected $BB test "$?" -ne 0
 check previous-pointer-retained $BB cmp "$STATE/previous" "$TASK/acknowledged-active"
 check new-generation-valid "$P" status
 $BB printf '2\n' > "$TASK/phase"
elif [ "$phase" = 2 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 check new-generation-replays-after-kill "$P" restore
 check removed-gzip-absent $BB test ! -e /usr/bin/gzip
 check abandoned-tar-absent $BB test ! -e /usr/bin/tar
 check base-world-coherent $BB cmp /etc/apk/world /etc/linuxonweb-packages/base-world
 check user-data-preserved $BB grep -F 'owned-user-marker' "$TASK/user-marker"
else
 check bounded-phase $BB false
fi
echo "PERSIST_BOUNDARY_DONE phase=$phase checks=$checks failures=$fail"
echo "PACKAGE_SMOKE_EXIT status=$fail"
exit "$fail"
