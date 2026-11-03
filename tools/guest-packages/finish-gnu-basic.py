#!/usr/bin/env python3
"""Finite task owner: verify target stack direction, build grep, test signed GNU APKs."""
import hashlib,importlib.util,json,pathlib,subprocess,sys
from bounded import run
root=pathlib.Path.cwd();B=pathlib.Path('out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103');O=pathlib.Path(next((x.split('=',1)[1] for x in sys.argv if x.startswith('--out=')), 'out/pm-gnu-basic3'));O.mkdir(exist_ok='--resume-after-probe' in sys.argv)
def stage(command,name,seconds=180):
 r=run(command,root,O/name,seconds)
 if not r['pass']:raise RuntimeError('stage failed: '+name)
 return r
s=importlib.util.spec_from_file_location('smoke','tools/guest-packages/make-smoke.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
flags=['-O2','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576']
if '--resume-after-probe' not in sys.argv:
 stage([cc,*flags,'tools/guest-packages/stack-direction-probe.c','-o',str(O/'stack-probe')],'stack-compile',30)
 (O/'probe-init').write_text('#!/bin/busybox sh\n/bin/busybox mount -t proc proc /proc\n/input/stack-probe\ns=$?\n/bin/busybox echo PACKAGE_SMOKE_EXIT status=$s\nexec /bin/busybox poweroff -f\n')
 m.build(B/'build/immutable-60847f.cpio.gz','60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa',O/'probe-init',{'input/stack-probe':O/'stack-probe'},O/'probe.cpio')
 (O/'probe-config.json').write_text(json.dumps({'exportDatabase':False,'timeoutSeconds':60}))
 stage(['node','tools/guest-packages/run-smoke.mjs',str(O/'probe.cpio'),str(O/'probe-runtime'),'-',str(O/'probe-config.json')],'probe-owner',75)
probe=pathlib.Path(next((x.split('=',1)[1] for x in sys.argv if x.startswith('--probe-dir=')),str(O)));r=json.loads((probe/'probe-runtime/result.json').read_text());assert r['pass'] and 'GNU_STACK_DIRECTION=-1' in r['guest']['lines']
pathlib.Path('tools/guest-packages/evidence/stack-direction-runtime-20261103.json').write_text(json.dumps({'pass':True,'durationSeconds':r['durationSeconds'],'cpus':r['cpus'],'browserExit':r['browserExit'],'errors':r['errors'],'guestLines':r['guest']['lines'],'probeSha256':hashlib.sha256((probe/'stack-probe').read_bytes()).hexdigest(),'acceptedDirection':-1},indent=2)+'\n')
# These cache answers are grounded by the just-completed actual guest probe.
p=pathlib.Path('tools/guest-packages/build-gnu.py');text=p.read_text();marker="'ac_cv_func_fork':'no'"
if "'ac_cv_c_stack_direction'" not in text:
 assert marker in text;text=text.replace(marker,"'ac_cv_c_stack_direction':'-1','sv_cv_stack_direction':'-1','sv_cv_stack_direction_msg':'grows down (actual guest probe)',"+marker);p.write_text(text)
p=pathlib.Path('out/pm-gnu-grep1/build/config.h');text=p.read_text();assert '#define STACK_DIRECTION 0' in text or '#define STACK_DIRECTION -1' in text;p.write_text(text.replace('#define STACK_DIRECTION 0','#define STACK_DIRECTION -1'))
stage(['python3','tools/guest-packages/build-gnu.py','--manifest',str(B/'sources/gnu/gnu-sources.json'),'--name','grep','--out','out/pm-gnu-grep1','--resume','--jobs','2'],'grep-owner2',180)
for name in ['gzip','grep','sed']:
 stage(['python3','tools/guest-packages/package-gnu.py','--name',name,'--build','out/pm-gnu-'+name+'1','--manifest',str(B/'sources/gnu/gnu-sources.json'),'--repo',str(B/'repo'),'--private-key',str(B/'private-signing/linuxonweb-dev.rsa'),'--work',str(B/'build/gnu-packages')],'package-'+name,30)
stage(['python3','tools/guest-packages/build-index.py','--apk',str(B/'build/apk-host/apk-tools-v2.14.12/src/apk'),'--repo',str(B/'repo/wasm32'),'--key',str(B/'private-signing/linuxonweb-dev.rsa'),'--public-key',str(B/'repo/linuxonweb-dev.rsa.pub')],'index',30)
init='''#!/bin/busybox sh
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox mkdir -p /tmp /var/cache/apk
/bin/busybox chmod 1777 /tmp
/bin/busybox ifconfig lo 127.0.0.1 up
/bin/busybox ifconfig eth0 192.0.2.2 netmask 255.255.255.0 up
/bin/busybox route add default gw 192.0.2.1
/bin/busybox echo nameserver 192.0.2.1 > /etc/resolv.conf
fail=0
check() { if "$@"; then /bin/busybox echo "PACKAGE_CHECK_PASS $*"; else /bin/busybox echo "PACKAGE_CHECK_FAIL $*"; fail=$((fail+1)); fi; }
check /sbin/apk --initdb add
check /sbin/apk update
check /sbin/apk add gzip grep sed
check /bin/busybox sh /tests/gnu-tools-check.sh
check /sbin/apk del gzip grep sed
check /bin/busybox test ! -e /usr/bin/gzip
check /bin/busybox test ! -e /usr/bin/grep
check /bin/busybox test ! -e /usr/bin/sed
/bin/busybox echo PACKAGE_SMOKE_EXIT status=$fail
exec /bin/busybox poweroff -f
'''
(O/'init').write_text(init);(O/'repositories').write_text('http://packages.test/repo\n')
files={'sbin/apk':B/'build/apk7/apk-tools-v2.14.12/src/apk.static','usr/libexec/apk-script':B/'build/apk7/apk-script','etc/apk/keys/linuxonweb-dev.rsa.pub':B/'repo/linuxonweb-dev.rsa.pub','etc/apk/repositories':O/'repositories','tests/gnu-tools-check.sh':pathlib.Path('tools/guest-packages/gnu-tools-check.sh')}
m.build(B/'build/immutable-60847f.cpio.gz','60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa',O/'init',files,O/'gnu.cpio');(O/'config.json').write_text(json.dumps({'exportDatabase':False,'timeoutSeconds':100}))
stage(['node','tools/guest-packages/run-smoke.mjs',str(O/'gnu.cpio'),str(O/'runtime'),str(B/'repo'),str(O/'config.json')],'runtime-owner',115)
r=json.loads((O/'runtime/result.json').read_text());assert r['pass'];e={k:r[k]for k in ['pass','startedAt','durationSeconds','cpus','browserHardwareConcurrency','browserExit','errors']};e.update(guestLines=r['guest']['lines'],guestErrors=r['guest']['errors'],packageReceipts=[json.loads(next((B/'repo/wasm32').glob(name+'-*.json')).read_text())for name in ['gzip','grep','sed']],accepted='actual signed package fetch/install, native commands and removal; no browser JS replacements')
pathlib.Path('tools/guest-packages/evidence/gnu-basic-runtime-20261103.json').write_text(json.dumps(e,indent=2)+'\n')
print(json.dumps({'pass':True,'packages':['gzip','grep','sed'],'runtimeSeconds':r['durationSeconds']}))
