#!/usr/bin/env python3
"""Compose an isolated real Linux/APK/native GNU command gate (not desktop acceptance)."""
import argparse,importlib.util,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
root=pathlib.Path.cwd();old=root/'out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103';here=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('smoke',here/'make-smoke.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
init=r'''#!/bin/busybox sh
export PATH=/usr/bin:/bin:/sbin:/usr/sbin
export HOME=/home/admin USER=root LOGNAME=root TERM=xterm-256color SHELL=/bin/sh
export SSL_CERT_FILE=/etc/ssl/cert.pem CURL_CA_BUNDLE=/etc/ssl/cert.pem SSL_CERT_DIR=/etc/ssl/certs
/bin/busybox mount -t devtmpfs devtmpfs /dev
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox mkdir -p /tmp /var/cache/apk /home/admin /dev/pts
/bin/busybox mount -t devpts devpts /dev/pts
/bin/busybox chmod 1777 /tmp
/bin/busybox --install -s /bin
/bin/busybox ifconfig lo 127.0.0.1 up
/bin/busybox ifconfig eth0 192.0.2.2 netmask 255.255.255.0 up
/bin/busybox route add default gw 192.0.2.1
/bin/busybox echo nameserver 192.0.2.1 > /etc/resolv.conf
fail=0
check() { if "$@"; then echo "PACKAGE_CHECK_PASS $*"; else echo "PACKAGE_CHECK_FAIL $*"; fail=$((fail+1)); fi; }
check /sbin/apk --initdb add
check /sbin/apk update
check /sbin/apk add gzip tar wget findutils ca-certificates
check /sbin/apk info --installed gzip tar wget findutils ca-certificates
HTTP_FIXTURE_BASE=http://packages.test HTTPS_FIXTURE_BASE=https://a3cf34ce40307517.5x7aqstuceku.opentunnel.xyz EXPECT_TAR_SPAWN=1 /bin/busybox sh /tests/native-tools-check.sh
check /bin/busybox test "$?" = 0
/bin/busybox sh /tests/findutils-spawn-check.sh
check /bin/busybox test "$?" = 0
check /sbin/apk del gzip tar wget findutils
for name in gzip tar wget find xargs; do check /bin/busybox test ! -e /usr/bin/$name; done
echo PACKAGE_SMOKE_EXIT status=$fail
exec /bin/busybox poweroff -f
'''
(a.out/'init').write_text(init);(a.out/'repositories').write_text('http://packages.test/repo\n')
files={'sbin/apk':old/'build/apk7/apk-tools-v2.14.12/src/apk.static','usr/libexec/apk-script':old/'build/apk7/apk-script','etc/apk/keys/linuxonweb-dev.rsa.pub':old/'repo/linuxonweb-dev.rsa.pub','etc/apk/repositories':a.out/'repositories','tests/native-tools-check.sh':here/'native-tools-check.sh','tests/findutils-spawn-check.sh':here/'findutils-spawn-check.sh'}
m.build(old/'build/immutable-60847f.cpio.gz','60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa',a.out/'init',files,a.out/'native-ports.cpio')
(a.out/'config.json').write_text(json.dumps({'exportDatabase':False,'timeoutSeconds':165,'httpFixtures':True,'publicNetworkWithFixture':True},indent=2)+'\n')
print('Native signed package fixture prepared; runtime gate unperformed.')
