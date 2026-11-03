#!/bin/busybox sh
export PATH=/usr/bin:/bin:/sbin
export LC_ALL=C
C=/usr/bin/coreutils
fail=0
check() { if "$@"; then /bin/busybox echo "GNU_CHECK_PASS $*"; else /bin/busybox echo "GNU_CHECK_FAIL $*"; fail=$((fail+1)); fi; }
check "$C" --version
"$C" --coreutils-prog=printf 'gamma\nalpha\nalpha\n' > /tmp/gnu-input
check /bin/busybox test "$($C --coreutils-prog=wc -l < /tmp/gnu-input)" = 3
check "$C" --coreutils-prog=mkdir -p /tmp/gnu-dir/sub
check "$C" --coreutils-prog=cp --reflink=never /tmp/gnu-input /tmp/gnu-dir/sub/copy
check "$C" --coreutils-prog=mv /tmp/gnu-dir/sub/copy /tmp/gnu-dir/sub/moved
check "$C" --coreutils-prog=ln -s sub/moved /tmp/gnu-dir/link
check /bin/busybox test "$($C --coreutils-prog=readlink /tmp/gnu-dir/link)" = sub/moved
check /bin/busybox test "$($C --coreutils-prog=stat -c %s /tmp/gnu-dir/sub/moved)" = 18
"$C" --coreutils-prog=sort /tmp/gnu-input > /tmp/gnu-sorted
"$C" --coreutils-prog=uniq /tmp/gnu-sorted > /tmp/gnu-unique
check /bin/busybox test "$($C --coreutils-prog=cat /tmp/gnu-unique)" = "$(/bin/busybox printf 'alpha\ngamma')"
"$C" --coreutils-prog=sha256sum /tmp/gnu-input > /tmp/gnu-sha
check /bin/busybox grep -F 03ccd01e91fa886b17f96aec70b3e14e26b93657185880ae67c8d2993603f517 /tmp/gnu-sha
check "$C" --coreutils-prog=ls -l /tmp/gnu-dir
check "$C" --coreutils-prog=cp -R --reflink=never /tmp/gnu-dir /tmp/gnu-dir2
check /bin/busybox cmp /tmp/gnu-dir/sub/moved /tmp/gnu-dir2/sub/moved
check "$C" --coreutils-prog=touch /tmp/gnu-touched
check "$C" --coreutils-prog=test -f /tmp/gnu-touched
check "$C" --coreutils-prog=head -n 1 /tmp/gnu-input
check "$C" --coreutils-prog=tail -n 1 /tmp/gnu-input
check "$C" --coreutils-prog=seq 1 3
check "$C" --coreutils-prog=id -u
check "$C" --coreutils-prog=date -u +%s
check "$C" --coreutils-prog=rm -rf /tmp/gnu-dir /tmp/gnu-dir2 /tmp/gnu-touched
check "$C" --coreutils-prog=test ! -e /tmp/gnu-dir
/bin/busybox echo "GNU_COREUTILS_TEST_EXIT status=$fail"
exit "$fail"
