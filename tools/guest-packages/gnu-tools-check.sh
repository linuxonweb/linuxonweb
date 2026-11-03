#!/bin/busybox sh
# Executes installed genuine GNU programs; BusyBox supplies only assertions/setup.
fail=0
check() { label=$1; shift; if "$@"; then /bin/busybox echo "GNU_PACKAGE_PASS $label"; else /bin/busybox echo "GNU_PACKAGE_FAIL $label"; fail=$((fail+1)); fi; }
/bin/busybox printf 'alpha 12\nbeta 34\nalpha 56\n' > /tmp/gnu-text
check gzip-version /usr/bin/gzip --version
if /usr/bin/gzip -n -c /tmp/gnu-text > /tmp/gnu-text.gz; then check gzip-crc /usr/bin/gzip -t /tmp/gnu-text.gz; else fail=$((fail+1)); fi
if /usr/bin/gzip -dc /tmp/gnu-text.gz > /tmp/gnu-roundtrip; then check gzip-roundtrip /bin/busybox cmp /tmp/gnu-text /tmp/gnu-roundtrip; else fail=$((fail+1)); fi
if /usr/bin/zcat /tmp/gnu-text.gz > /tmp/gnu-zcat; then check gzip-zcat-alias /bin/busybox cmp /tmp/gnu-text /tmp/gnu-zcat; else fail=$((fail+1)); fi
/bin/busybox cp /tmp/gnu-text.gz /tmp/gnu-bad.gz
/bin/busybox printf '\377' | /bin/busybox dd of=/tmp/gnu-bad.gz bs=1 seek=10 conv=notrunc 2>/dev/null
if /usr/bin/gzip -t /tmp/gnu-bad.gz >/dev/null 2>&1; then /bin/busybox echo GNU_PACKAGE_FAIL gzip-corruption; fail=$((fail+1)); else /bin/busybox echo GNU_PACKAGE_PASS gzip-corruption-rejected; fi
check sed-version /usr/bin/sed --version
/usr/bin/sed 's/alpha/ALPHA/g' /tmp/gnu-text > /tmp/gnu-sed
/bin/busybox printf 'ALPHA 12\nbeta 34\nALPHA 56\n' > /tmp/gnu-sed-expected
check sed-substitution /bin/busybox cmp /tmp/gnu-sed /tmp/gnu-sed-expected
/usr/bin/sed -E 's/^([a-z]+) ([0-9]+)/\2:\1/' /tmp/gnu-text > /tmp/gnu-sed-extended
/bin/busybox printf '12:alpha\n34:beta\n56:alpha\n' > /tmp/gnu-sed-extended-expected
check sed-extended-regex /bin/busybox cmp /tmp/gnu-sed-extended /tmp/gnu-sed-extended-expected
/bin/busybox cp /tmp/gnu-text /tmp/gnu-inplace
check sed-inplace /usr/bin/sed -i.bak 's/beta/BETA/' /tmp/gnu-inplace
check sed-backup /bin/busybox cmp /tmp/gnu-text /tmp/gnu-inplace.bak
check sed-inplace-content /bin/busybox grep -q 'BETA 34' /tmp/gnu-inplace
if /usr/bin/sed '[' /tmp/gnu-text >/dev/null 2>&1; then fail=$((fail+1)); else /bin/busybox echo GNU_PACKAGE_PASS sed-invalid-script-rejected; fi
check grep-version /usr/bin/grep --version
check grep-fixed-count /bin/busybox test "$(/usr/bin/grep -Fc alpha /tmp/gnu-text)" = 2
check grep-extended-count /bin/busybox test "$(/usr/bin/grep -Ec '^[a-z]+ [0-9]+$' /tmp/gnu-text)" = 3
/usr/bin/grep -Eo '[0-9]+' /tmp/gnu-text > /tmp/gnu-grep-numbers
/bin/busybox printf '12\n34\n56\n' > /tmp/gnu-grep-expected
check grep-only-matching /bin/busybox cmp /tmp/gnu-grep-numbers /tmp/gnu-grep-expected
/bin/busybox mkdir -p /tmp/gnu-grep-dir/sub
/bin/busybox cp /tmp/gnu-text /tmp/gnu-grep-dir/sub/input
check grep-recursive /usr/bin/grep -rq 'beta 34' /tmp/gnu-grep-dir
/usr/bin/grep absent /tmp/gnu-text >/dev/null 2>&1
check grep-no-match-exit /bin/busybox test "$?" = 1
/usr/bin/grep '[' /tmp/gnu-text >/dev/null 2>&1
check grep-invalid-regex-exit /bin/busybox test "$?" = 2
/bin/busybox echo GNU_TOOLS_TEST_EXIT status=$fail
exit "$fail"
