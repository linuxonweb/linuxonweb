#!/bin/busybox sh
# Real GNU command behavior in the Linux guest; BusyBox sets up/asserts fixtures.
BB=/bin/busybox
TAR=${GNU_TAR:-/usr/bin/tar}
WGET=${GNU_WGET:-/usr/bin/wget}
TASK=$($BB mktemp -d /home/admin/.native-tools.XXXXXXXX) || exit 2
fail=0
checks=0
check() { label=$1; shift; checks=$((checks+1)); if "$@"; then echo "NATIVE_TOOLS_PASS $label"; else echo "NATIVE_TOOLS_FAIL $label"; fail=$((fail+1)); fi; }
finish() {
 rc=$1
 echo "NATIVE_TOOLS_DONE checks=$checks failures=$fail status=$rc"
 if [ "$rc" = 0 ] && [ "$fail" = 0 ]; then case "$TASK" in /home/admin/.native-tools.*) $BB rm -rf "$TASK";; esac
 else echo "NATIVE_TOOLS_EVIDENCE $TASK"; fi
}
$TAR --version > "$TASK/tar-version"
$WGET --version > "$TASK/wget-version"
check genuine-gnu-tar-version $BB grep -F 'tar (GNU tar) 1.35' "$TASK/tar-version"
check genuine-gnu-wget-version $BB grep -F 'GNU Wget 1.25.0' "$TASK/wget-version"
$BB mkdir -p "$TASK/source/sub" "$TASK/plain" "$TASK/compressed" "$TASK/safe"
$BB printf 'native GNU tar payload\n' > "$TASK/source/payload.txt"
$BB printf 'nested\000payload\377\n' > "$TASK/source/sub/binary"
$BB chmod 640 "$TASK/source/payload.txt"
$BB ln -s sub/binary "$TASK/source/link"
check tar-create-uncompressed "$TAR" -cf "$TASK/plain.tar" -C "$TASK/source" .
check tar-list-uncompressed "$TAR" -tf "$TASK/plain.tar"
check tar-extract-uncompressed "$TAR" -xf "$TASK/plain.tar" -C "$TASK/plain"
check tar-file-roundtrip $BB cmp "$TASK/source/payload.txt" "$TASK/plain/payload.txt"
check tar-binary-roundtrip $BB cmp "$TASK/source/sub/binary" "$TASK/plain/sub/binary"
check tar-mode-roundtrip $BB test "$($BB stat -c %a "$TASK/plain/payload.txt")" = 640
check tar-symlink-roundtrip $BB test "$($BB readlink "$TASK/plain/link")" = sub/binary
if [ "${EXPECT_TAR_SPAWN:-1}" = 1 ]; then
 check tar-create-native-gzip "$TAR" --use-compress-program=/usr/bin/gzip -cf "$TASK/gzip.tar.gz" -C "$TASK/source" .
 check tar-gzip-integrity /usr/bin/gzip -t "$TASK/gzip.tar.gz"
 check tar-list-native-gzip "$TAR" --use-compress-program=/usr/bin/gzip -tf "$TASK/gzip.tar.gz"
 check tar-extract-native-gzip "$TAR" --use-compress-program=/usr/bin/gzip -xf "$TASK/gzip.tar.gz" -C "$TASK/compressed"
 check tar-compressed-file-roundtrip $BB cmp "$TASK/source/payload.txt" "$TASK/compressed/payload.txt"
 check tar-compressed-binary-roundtrip $BB cmp "$TASK/source/sub/binary" "$TASK/compressed/sub/binary"
 "$TAR" -czf "$TASK/short-option.tar.gz" -C "$TASK/source" .
 check tar-short-option-z-create $BB test "$?" = 0
 "$TAR" -tzf "$TASK/short-option.tar.gz" > "$TASK/short-list"
 check tar-short-option-z-list $BB test "$?" = 0
 "$TAR" --use-compress-program=/usr/bin/gzip -cf - -C "$TASK/source" . > "$TASK/stdout.tar.gz"
 check tar-compressed-stdout $BB test "$?" = 0
 check tar-compressed-stdout-integrity /usr/bin/gzip -t "$TASK/stdout.tar.gz"
 ("$TAR" --use-compress-program=/usr/bin/gzip -cf - -C "$TASK/source" . 1>&-) 2> "$TASK/closed-stdout-log"
 check tar-closed-stdout-fails-without-aliasing $BB test "$?" -ne 0
 $BB cp "$TASK/gzip.tar.gz" "$TASK/corrupt.tar.gz"
 size=$($BB stat -c %s "$TASK/corrupt.tar.gz")
 $BB dd if="$TASK/corrupt.tar.gz" of="$TASK/truncated.tar.gz" bs=1 count=$((size-7)) 2>/dev/null
 "$TAR" --use-compress-program=/usr/bin/gzip -tf "$TASK/truncated.tar.gz" > "$TASK/truncated-log" 2>&1
 check tar-truncated-gzip-rejected $BB test "$?" -ne 0
 "$TAR" --use-compress-program="$TASK/no-compressor" -cf "$TASK/missing.tar.gz" -C "$TASK/source" . > "$TASK/missing-log" 2>&1
 check tar-missing-compressor-rejected $BB test "$?" -ne 0
 "$TAR" --use-compress-program='/bin/busybox sh -c "exit 7"' -cf "$TASK/failed.tar.gz" -C "$TASK/source" . > "$TASK/failed-log" 2>&1
 check tar-compressor-failure-propagated $BB test "$?" -ne 0
 "$TAR" --use-compress-program=/usr/bin/gzip -tf - < "$TASK/gzip.tar.gz" > "$TASK/stdin-log" 2>&1
 check tar-compressed-stdin-explicitly-unsupported $BB test "$?" -ne 0
else
 "$TAR" -czf "$TASK/unsupported.tar.gz" -C "$TASK/source" . > "$TASK/unsupported-log" 2>&1
 check tar-old-fork-mode-fails-truthfully $BB test "$?" -ne 0
fi
check tar-create-parent-path-test "$TAR" -cf "$TASK/parent.tar" -C "$TASK/source" '--transform=s|^payload.txt$|../escaped|' payload.txt
"$TAR" -xf "$TASK/parent.tar" -C "$TASK/safe" > "$TASK/parent-log" 2>&1
check tar-parent-traversal-rejected $BB test "$?" -ne 0
check tar-parent-path-no-write $BB test ! -e "$TASK/escaped"
if [ -n "${HTTP_FIXTURE_BASE:-}" ]; then
 check wget-http-output "$WGET" --tries=1 --timeout=10 -q -O "$TASK/key" "$HTTP_FIXTURE_BASE/repo/linuxonweb-dev.rsa.pub"
 check wget-http-exact-bytes $BB cmp "$TASK/key" /etc/apk/keys/linuxonweb-dev.rsa.pub
 check wget-http-redirect "$WGET" --tries=1 --timeout=10 -q -O "$TASK/redirect" "$HTTP_FIXTURE_BASE/fixture/redirect"
 check wget-http-redirect-bytes $BB cmp "$TASK/redirect" /etc/apk/keys/linuxonweb-dev.rsa.pub
 "$WGET" --tries=1 --timeout=10 -q -O "$TASK/missing-http" "$HTTP_FIXTURE_BASE/not-found" > "$TASK/http-error" 2>&1
 check wget-http-404-exit-eight $BB test "$?" = 8
fi
if [ -n "${HTTPS_FIXTURE_BASE:-}" ]; then
 check wget-https-verified-ca "$WGET" --tries=1 --timeout=15 -q -O "$TASK/health" "$HTTPS_FIXTURE_BASE/health"
 check wget-https-response $BB grep -F '"ok":true' "$TASK/health"
 # Verify default CA discovery too: the native environment is demonstrably unset.
 (unset SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE
  [ "${SSL_CERT_FILE-unset}" = unset ] && [ "${SSL_CERT_DIR-unset}" = unset ] && [ "${CURL_CA_BUNDLE-unset}" = unset ] || exit 90
  "$WGET" --tries=1 --timeout=10 -O "$TASK/default-ca" "$HTTPS_FIXTURE_BASE/health") > "$TASK/default-ca-log" 2>&1
 default_ca_status=$?
 check wget-default-ca-without-ssl-environment $BB test "$default_ca_status" = 0
 check wget-default-ca-exact-response $BB grep -F '"ok":true' "$TASK/default-ca"
 if [ "$default_ca_status" != 0 ]; then $BB sed -n '1,24p' "$TASK/default-ca-log"; fi
 "$WGET" --tries=1 --timeout=15 -q -O "$TASK/missing-https" "$HTTPS_FIXTURE_BASE/not-found" > "$TASK/https-error" 2>&1
 check wget-https-404-exit-eight $BB test "$?" = 8
 "$WGET" --tries=1 --timeout=15 -O "$TASK/untrusted" https://self-signed.badssl.com/ > "$TASK/untrusted-log" 2>&1
 check wget-untrusted-certificate-exit-five $BB test "$?" = 5
 check wget-untrusted-certificate-diagnostic $BB grep -i certificate "$TASK/untrusted-log"
 $BB sed -n '1,16p' "$TASK/untrusted-log"
fi
finish "$fail"
exit "$fail"
