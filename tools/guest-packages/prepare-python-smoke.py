#!/usr/bin/env python3
import argparse,pathlib,zipfile,subprocess,importlib.util,json,hashlib
q=argparse.ArgumentParser();q.add_argument('--source',type=pathlib.Path,required=True);q.add_argument('--build',type=pathlib.Path,required=True);q.add_argument('--out',type=pathlib.Path,required=True);a=q.parse_args();a.out.mkdir(parents=True,exist_ok=True)
zip_path=a.out/'python314.zip';count=0
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted((a.source/'Lib').rglob('*')):
  if not p.is_file():continue
  relative=p.relative_to(a.source/'Lib')
  if any(x in ('test','tests','__pycache__','ensurepip','idlelib','tkinter') for x in relative.parts):continue
  if p.suffix not in ('.py','.txt','.pickle','.pem','.json'):continue
  info=zipfile.ZipInfo(relative.as_posix(),(2026,11,3,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,p.read_bytes());count+=1
 for p in sorted(a.build.glob('build/lib*/_sysconfigdata*.py')):z.write(p,p.name)
s=importlib.util.spec_from_file_location('smoke',pathlib.Path(__file__).with_name('make-smoke.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path('web/desktop/latest-build/initramfs-firefox.cpio.gz');cert=None
for name in ['etc/ssl/cert.pem','etc/ssl/certs/ca-certificates.crt','etc/pki/tls/certs/ca-bundle.crt']:
 try:cert=m.member(base,name);break
 except (KeyError,ValueError):pass
if cert is None:raise RuntimeError('no trusted CA bundle found in reviewed distribution')
(a.out/'ca-certificates.crt').write_bytes(cert);(a.out/'hosts').write_text('127.0.0.1 localhost\n::1 localhost\n')
init='''#!/bin/busybox sh
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox ifconfig lo 127.0.0.1 up
/bin/busybox mkdir -p /tmp
export PYTHONHOME=/usr
export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
/bin/busybox echo PACKAGE_SMOKE_BEGIN
/usr/bin/python3 /python-check.py
status=$?
/bin/busybox echo PACKAGE_SMOKE_EXIT status=$status
exec /bin/busybox poweroff -f
''';(a.out/'init').write_text(init)
files={'usr/bin/python3':a.build/'python','usr/lib/python314.zip':zip_path,'python-check.py':pathlib.Path(__file__).with_name('python-check.py'),'etc/ssl/certs/ca-certificates.crt':a.out/'ca-certificates.crt','etc/hosts':a.out/'hosts'}
cmd=['python3',str(pathlib.Path(__file__).with_name('make-smoke.py')),'--base',str(base),'--base-sha256','60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa','--init',str(a.out/'init'),'--output',str(a.out/'python.cpio')]
for guest,host in files.items():cmd+=['--file',guest+'='+str(host)]
r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,text=True)
print(json.dumps({'stdlibFiles':count,'stdlibZipBytes':zip_path.stat().st_size,'pythonBytes':(a.build/'python').stat().st_size,'image':json.loads(r.stdout)}))
