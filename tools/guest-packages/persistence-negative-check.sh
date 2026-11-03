#!/bin/busybox sh
BB=/bin/busybox
P=/usr/sbin/apk-persist
STATE=/home/.linuxonweb-packages
TASK=/home/.persistence-negative-fixture
fail=0
checks=0
check() { label=$1; shift; checks=$((checks+1)); if "$@"; then echo "PERSIST_NEGATIVE_PASS $label"; else echo "PERSIST_NEGATIVE_FAIL $label"; fail=$((fail+1)); fi; }
finish() { echo "PERSIST_NEGATIVE_DONE phase=$phase checks=$checks failures=$fail"; echo "PACKAGE_SMOKE_EXIT status=$fail"; }
rehash() {
 (cd "$STATE/$gen" && "$BB" sha256sum compatibility installed world packages/gzip-1.14-r0.apk) > "$TASK/new-manifest"
 rc=$?
 if [ "$rc" != 0 ]; then return 1; fi
 "$BB" cp "$TASK/new-manifest" "$STATE/$gen/manifest.sha256" || return 1
 hash=$("$BB" sha256sum "$STATE/$gen/manifest.sha256" | "$BB" cut -d ' ' -f 1)
 "$BB" printf '%s %s\n' "$gen" "$hash" > "$STATE/active"
}
restore_good() {
 "$BB" cp "$TASK/good-apk" "$STATE/$gen/packages/gzip-1.14-r0.apk" || return 1
 "$BB" cp "$TASK/good-compatibility" "$STATE/$gen/compatibility" || return 1
 "$BB" cp "$TASK/good-world" "$STATE/$gen/world" || return 1
 "$BB" cp "$TASK/good-manifest" "$STATE/$gen/manifest.sha256" || return 1
 "$BB" cp "$TASK/good-active" "$STATE/active"
}
$BB mkdir -p "$TASK"
phase=0
if [ -f "$TASK/phase" ]; then phase=$($BB cat "$TASK/phase"); fi
echo "PERSIST_NEGATIVE_PHASE $phase"
if [ "$phase" = 0 ]; then
 check signed-repository-update /sbin/apk update
 check signed-gzip-add "$P" add gzip
 check second-complete-generation "$P" save
 check previous-pointer-exists $BB test -f "$STATE/previous"
 gen=$($BB cut -d ' ' -f 1 "$STATE/active")
 check preserve-good-active $BB cp "$STATE/active" "$TASK/good-active"
 check preserve-good-manifest $BB cp "$STATE/$gen/manifest.sha256" "$TASK/good-manifest"
 check preserve-good-apk $BB cp "$STATE/$gen/packages/gzip-1.14-r0.apk" "$TASK/good-apk"
 check preserve-good-compatibility $BB cp "$STATE/$gen/compatibility" "$TASK/good-compatibility"
 check preserve-good-world $BB cp "$STATE/$gen/world" "$TASK/good-world"
 "$P" add persist-script-fail > "$TASK/script-fail.log" 2>&1
 check maintainer-script-failure-rejected $BB test "$?" -ne 0
 check native-failure-not-acknowledged $BB grep -F 'no persistence acknowledgement' "$TASK/script-fail.log"
 check failed-operation-keeps-active $BB cmp "$STATE/active" "$TASK/good-active"
 $BB printf '1\n' > "$TASK/phase"
elif [ "$phase" = 1 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 gen=$($BB cut -d ' ' -f 1 "$STATE/active")
 check trusted-same-version-signature /sbin/apk --no-network verify /tests/same-version.apk
 /sbin/apk --no-network verify /tests/bad-signature.apk > "$TASK/bad-native-signature.log" 2>&1
 check native-invalid-signature-rejected $BB test "$?" -ne 0
 check replace-signature-fixture $BB cp /tests/bad-signature.apk "$STATE/$gen/packages/gzip-1.14-r0.apk"
 check recompute-signature-manifest rehash
 "$P" restore > "$TASK/signature.log" 2>&1
 check recomputed-manifest-signature-rejected $BB test "$?" -ne 0
 check signature-verifier-was-reached $BB grep -F 'native /sbin/apk failed' "$TASK/signature.log"
 check no-files-before-signature $BB test ! -e /usr/bin/gzip
 check restore-valid-signature-fixture restore_good
 check replace-signed-same-version $BB cp /tests/same-version.apk "$STATE/$gen/packages/gzip-1.14-r0.apk"
 check recompute-same-version-manifest rehash
 "$P" restore > "$TASK/same-version.log" 2>&1
 check signed-same-version-identity-rejected $BB test "$?" -ne 0
 check exact-native-PVC-rejection $BB grep -F 'signed archive P/V/C identity differs from installed snapshot' "$TASK/same-version.log"
 check no-files-before-identity $BB test ! -e /usr/bin/gzip
 check restore-valid-identity-fixture restore_good
 "$BB" sed 's/"schema": 1/"schema": 2/' "$TASK/good-compatibility" > "$STATE/$gen/compatibility"
 check recompute-incompatible-generation rehash
 "$P" restore > "$TASK/compatibility.log" 2>&1
 check incompatible-generation-rejected $BB test "$?" -ne 0
 check compatibility-diagnostic $BB grep -F 'base image ABI/trust generation mismatch' "$TASK/compatibility.log"
 check restore-compatible-fixture restore_good
 check add-owned-extra-trust-key $BB cp /etc/apk/keys/linuxonweb-dev.rsa.pub /etc/apk/keys/fixture-extra.rsa.pub
 "$P" restore > "$TASK/trust.log" 2>&1
 check altered-trust-rejected $BB test "$?" -ne 0
 check exact-trust-set-diagnostic $BB grep -F 'unexpected signing key' "$TASK/trust.log"
 check remove-owned-extra-key $BB rm /etc/apk/keys/fixture-extra.rsa.pub
 "$BB" sed '/^curl$/d' "$TASK/good-world" > "$STATE/$gen/world"
 check recompute-broken-world-manifest rehash
 "$P" restore > "$TASK/world.log" 2>&1
 check protected-base-world-rejected $BB test "$?" -ne 0
 check base-world-diagnostic $BB grep -F 'base world constraint cannot be removed' "$TASK/world.log"
 check restore-complete-world restore_good
 check pristine-database-unmodified $BB cmp /etc/apk/world /etc/linuxonweb-packages/base-world
 check no-optional-payload-after-all-negatives $BB test ! -e /usr/bin/gzip
 "$BB" printf 'malformed-active-fixture\n' > "$STATE/active"
 "$P" restore > "$TASK/pointer.log" 2>&1
 check malformed-active-rejected $BB test "$?" -ne 0
 check malformed-active-disable "$P" disable
 check malformed-active-no-longer-selected $BB test ! -e "$STATE/active"
 check malformed-pointer-evidence-retained $BB grep -F 'malformed-active-fixture' "$STATE"/disabled-evidence-*
 check previous-generation-selected "$P" previous
 check previous-offline-restore "$P" restore
 check previous-native-gzip /usr/bin/gzip --version
 check previous-world-exact $BB cmp /etc/apk/world "$TASK/good-world"
 $BB printf '2\n' > "$TASK/phase"
elif [ "$phase" = 2 ]; then
 check physically-offline $BB test ! -d /sys/class/net/eth0
 check selected-previous-survives-restart "$P" restore
 check native-package-after-recovery /sbin/apk info --installed gzip
 check failed-script-package-not-replayed $BB test ! -e /usr/share/persist-script-fail
 check recovery-world-exact $BB cmp /etc/apk/world "$TASK/good-world"
else
 check bounded-phase $BB false
fi
finish
exit "$fail"
