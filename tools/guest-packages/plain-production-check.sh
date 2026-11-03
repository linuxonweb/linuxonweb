#!/bin/busybox sh
# Run only in an owned test HomeFS clone through the real native desktop terminal.
# Explicit statuses; no unsupported set -u or EXIT-trap assumptions.
checks=0
failures=0
phase=${1:-invalid}
proof=/home/admin/.plain-package-proof
if /bin/busybox test "$phase" = paths; then
 exec > "$proof/paths.log" 2>&1
else
 exec > /dev/console 2>&1
fi
ok() {
 label=$1
 shift
 checks=$((checks+1))
 if "$@"; then echo "PLAIN_PACKAGE_PASS $label"; else failures=$((failures+1)); echo "PLAIN_PACKAGE_FAIL $label"; fi
}
resolve() {
 name=$1
 expected=$2
 got=$(/bin/busybox which "$name")
 echo "PLAIN_COMMAND name=$name selected=$got expected=$expected"
 /bin/busybox test "$got" = "$expected"
}
brand() {
 name=$1
 pattern=$2
 text=$("$name" --version 2>&1)
 status=$?
 echo "$text"
 /bin/busybox test "$status" = 0 || return 1
 echo "$text" | /bin/busybox grep -F "$pattern" >/dev/null
}
commands() {
 got=$(/bin/busybox which apk)
 echo "PLAIN_COMMAND name=apk selected=$got"
 case "$got" in /bin/apk|/sbin/apk) ok apk-native-path /bin/busybox test -x /sbin/apk ;; *) ok apk-native-path /bin/busybox false ;; esac
 link=$(/bin/busybox readlink /bin/apk)
 ok apk-alias /bin/busybox test "$link" = ../sbin/apk
 for name in tar wget find xargs ls gzip grep sed; do ok "path-$name" resolve "$name" "/usr/bin/$name"; done
 ok tar-brand brand tar 'GNU tar'
 ok wget-brand brand wget 'GNU Wget'
 ok find-brand brand find 'GNU findutils'
 ok xargs-brand brand xargs 'GNU findutils'
 ok ls-brand brand ls 'GNU coreutils'
 ok gzip-brand brand gzip 'gzip 1.14'
 ok grep-brand brand grep 'GNU grep'
 ok sed-brand brand sed 'GNU sed'
}
echo "PLAIN_PACKAGE_BEGIN phase=$phase PATH=$PATH"
if /bin/busybox test "$phase" = install; then
 /sbin/apk update
 status=$?
 if /bin/busybox test "$status" != 0; then echo "PLAIN_PACKAGE_FATAL update-status=$status"; exit 2; fi
 /sbin/apk add python3 coreutils tar wget findutils gzip grep sed
 status=$?
 if /bin/busybox test "$status" != 0; then echo "PLAIN_PACKAGE_FATAL no-force-install-status=$status"; exit 2; fi
 for package in python3 coreutils tar wget findutils gzip grep sed; do ok "installed-$package" /sbin/apk info -e "$package"; done
 if /bin/busybox test "$failures" != 0; then echo "PLAIN_PACKAGE_DONE phase=$phase checks=$checks failures=$failures generationNotSaved=1"; exit 2; fi
 /bin/busybox mkdir -p "$proof" || exit 2
 /bin/busybox chown 1000:1000 "$proof" || exit 2
 /bin/busybox chmod 0755 "$proof" || exit 2
 echo "PLAIN_PACKAGE_INSTALLED checks=$checks failures=$failures generationNotSaved=1"
elif /bin/busybox test "$phase" = paths; then
 # This phase MUST be invoked without sudo from the actual user terminal.
 # sudo intentionally supplies a different protected PATH and is not evidence here.
 uid=$(/bin/busybox id -u)
 ok actual-admin-user /bin/busybox test "$uid" = 1000
 commands
 echo "PLAIN_PACKAGE_PATHS_DONE checks=$checks failures=$failures uid=$uid PATH=$PATH"
 if /bin/busybox test "$failures" = 0; then
  echo 'PLAIN_USER_PATHS_PASSED' > "$proof/paths-passed" || exit 2
 else
  /bin/busybox rm -f "$proof/paths-passed"
 fi
 # Relay already-collected nonroot evidence through the controlled native sudo path.
 /usr/bin/sudo /bin/busybox sh -c '/bin/busybox cat /home/admin/.plain-package-proof/paths.log > /dev/console'
 relay=$?
 if /bin/busybox test "$relay" != 0 || /bin/busybox test "$failures" != 0; then exit 2; fi
elif /bin/busybox test "$phase" = save; then
 ok explicit-user-path-audit /bin/busybox grep -qx PLAIN_USER_PATHS_PASSED "$proof/paths-passed"
 for package in python3 coreutils tar wget findutils gzip grep sed; do ok "installed-$package" /sbin/apk info -e "$package"; done
 if /bin/busybox test "$failures" != 0; then echo "PLAIN_PACKAGE_DONE phase=$phase checks=$checks failures=$failures generationNotSaved=1"; exit 2; fi
 /bin/busybox cp /etc/apk/world "$proof/world" || exit 2
 /bin/busybox sha256sum /usr/bin/python3 /usr/lib/python314.zip /usr/bin/coreutils /usr/bin/tar /usr/bin/wget /usr/bin/find /usr/bin/xargs /usr/bin/gzip /usr/bin/grep /usr/bin/sed > "$proof/payload.sha256" || exit 2
 /usr/sbin/apk-persist save || exit 2
 /bin/busybox cp /home/.linuxonweb-packages/active "$proof/active" || exit 2
 echo "PLAIN_PACKAGE_SAVED checks=$checks failures=$failures"
elif /bin/busybox test "$phase" = verify; then
 ok same-generation /bin/busybox cmp /home/.linuxonweb-packages/active "$proof/active"
 ok exact-world /bin/busybox cmp /etc/apk/world "$proof/world"
 ok exact-payload /bin/busybox sha256sum -c "$proof/payload.sha256"
 ok signed-generation /usr/sbin/apk-persist status
 for package in python3 coreutils tar wget findutils gzip grep sed; do ok "restored-$package" /sbin/apk info -e "$package"; done
 ok python-imports /usr/bin/python3 -c 'import json,zlib,hashlib,ssl; assert json.loads(json.dumps([1,2]))==[1,2]; assert zlib.decompress(zlib.compress(b"plain"))==b"plain"; assert ssl.create_default_context().cert_store_stats()["x509_ca"]>0; print("PLAIN_PYTHON_IMPORTS_OK")'
 if /bin/busybox test "$failures" != 0; then echo "PLAIN_PACKAGE_DONE phase=$phase checks=$checks failures=$failures"; exit 2; fi
 echo "PLAIN_PACKAGE_VERIFIED checks=$checks failures=$failures"
else
 echo 'PLAIN_PACKAGE_FATAL invalid-phase'
 exit 2
fi
exit 0
