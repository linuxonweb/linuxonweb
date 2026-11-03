#!/bin/busybox sh
BB=/bin/busybox
failures=0
check() { label="$1"; shift; if "$@" >/dev/console 2>&1; then echo "PACKAGE_BASE_CHECK $label PASS" >/dev/console; else echo "PACKAGE_BASE_CHECK $label FAIL" >/dev/console; failures=$((failures+1)); fi; }
check helper-status /usr/sbin/apk-persist status
check optional-gzip-absent "$BB" test ! -e /usr/bin/gzip
check optional-tar-absent "$BB" test ! -e /usr/bin/tar
check protected-native-database /sbin/apk info --installed apk-tools busybox ca-certificates curl
check protected-world "$BB" cmp /etc/apk/world /etc/linuxonweb-packages/base-world
check user-marker "$BB" grep -qx package-production-20261103 /home/admin/.package-persistence-production
check corruption-evidence "$BB" test -s /home/admin/.package-recovery-original.apk
if "$BB" test "$failures" = 0; then echo PACKAGE_BASE_RECOVERY_VERIFIED >/dev/console; else echo "PACKAGE_BASE_RECOVERY_FAILED failures=$failures" >/dev/console; fi
exit "$failures"
