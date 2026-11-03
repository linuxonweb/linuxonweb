#!/usr/bin/env python3
"""Real native APK/base/home fixture; excludes Firefox and makes no desktop claim."""
import argparse,base64,gzip,hashlib,importlib.util,io,json,pathlib,tarfile,zlib
p=argparse.ArgumentParser()
for name in ['base','manifest','kernel','helper','repo','out']:p.add_argument('--'+name,type=pathlib.Path,required=True)
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
here=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('overlay',here/'overlay-persistence.py');overlay=importlib.util.module_from_spec(s);s.loader.exec_module(overlay)
manifest=json.loads(a.manifest.read_text())
if overlay.sha(a.base)!=manifest['assets']['firefox']['sha256'] or overlay.sha(a.kernel)!=manifest['assets']['kernel']['sha256']:raise ValueError('pinned image/kernel mismatch')
original,_=overlay.scan(a.base);metadata=overlay.metadata_files(original,manifest)
records={}
for block in original['lib/apk/db/installed'][1].decode().strip().split('\n\n'):
 d=dict(line.split(':',1) for line in block.splitlines() if line[:2] in ['P:','V:','C:']);records[d['P']]=d
files={};packages=[]
for name,identity in sorted(records.items()):
 path=a.repo/'wasm32'/f"{name}-{identity['V']}.apk";receipt=json.loads(path.with_suffix('.json').read_text());blob=path.read_bytes()
 if hashlib.sha256(blob).hexdigest()!=receipt['sha256']:raise ValueError('base package receipt mismatch')
 raw=blob;segments=[]
 while raw:
  decoder=zlib.decompressobj(31);decoder.decompress(raw);decoder.flush();used=len(raw)-len(decoder.unused_data)
  if used<=0:raise ValueError('bad APK gzip stream')
  segments.append(raw[:used]);raw=decoder.unused_data
 if len(segments)!=3 or 'Q1'+base64.b64encode(hashlib.sha1(segments[1]).digest()).decode()!=identity['C']:raise ValueError('base package P/V/C mismatch')
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress(blob)),mode='r:') as archive:
  for item in archive:
   n=item.name.rstrip('/')
   if n.startswith('.') or item.isdir():continue
   if not n or n.startswith('/') or '..' in n.split('/') or '\\' in n or '\0' in n:raise ValueError('unsafe base package member')
   if item.isfile():value=(0o100000|item.mode,archive.extractfile(item).read())
   elif item.issym():value=(0o120777,item.linkname.encode())
   else:raise ValueError('unsupported base package member')
   if n in files and files[n]!=value:raise ValueError('conflicting base package ownership')
   files[n]=value
 packages.append({'name':name,'version':identity['V'],'sha256':receipt['sha256']})
for name in ['bin/busybox','sbin/apk']:
 if files[name][1]!=original[name][1]:raise ValueError('native base binary differs from production')
for name,(mode,data) in original.items():
 if name.startswith('lib/apk/db/') or name.startswith('etc/apk/keys/') or name=='etc/apk/world':files[name]=(mode,data)
files.update(metadata)
helper=a.helper.read_bytes()
if helper[:8]!=b'\0asm\x01\0\0\0':raise ValueError('native helper required')
init='''#!/bin/busybox sh
export PATH=/usr/bin:/bin:/sbin:/usr/sbin
export HOME=/home/admin USER=root LOGNAME=root TERM=xterm-256color SHELL=/bin/sh
export SSL_CERT_FILE=/etc/ssl/cert.pem CURL_CA_BUNDLE=/etc/ssl/cert.pem SSL_CERT_DIR=/etc/ssl/certs
/bin/busybox mount -t devtmpfs devtmpfs /dev
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox mkdir -p /tmp /var/cache/apk /home /run /dev/pts
/bin/busybox mount -t devpts devpts /dev/pts
/bin/busybox mount -t virtiofs home /home
/bin/busybox mkdir -p /home/admin
/bin/busybox --install -s /bin
if [ -d /sys/class/net/eth0 ]; then
 /bin/busybox ifconfig lo 127.0.0.1 up
 /bin/busybox ifconfig eth0 192.0.2.2 netmask 255.255.255.0 up
 /bin/busybox route add default gw 192.0.2.1
 /bin/busybox echo nameserver 192.0.2.1 > /etc/resolv.conf
fi
/bin/busybox sh /tests/persistence-check.sh
exec /bin/busybox poweroff -f
'''
files.update({'init':(0o100755,init.encode()),'bin/sh':(0o120777,b'busybox'),'usr/sbin/apk-persist':(0o100755,helper),'tests/persistence-check.sh':(0o100755,(here/'persistence-check.sh').read_bytes()),'etc/apk/repositories':(0o100644,b'http://packages.test/repo\n'),'etc/apk/arch':(0o100644,b'wasm32\n'),'etc/passwd':(0o100644,b'root:x:0:0:root:/:/bin/sh\n'),'etc/group':(0o100644,b'root:x:0:\n')})
dirs={'bin','dev','proc','sys','tmp','etc','usr','usr/bin','usr/libexec','var','var/cache','lib','run','home'}
for name in files:
 parent=pathlib.PurePosixPath(name).parent
 while str(parent)!='.':dirs.add(str(parent));parent=parent.parent
# Files may include directory records from the base APK database scan.
for name in list(files):
 if files[name][0]&0o170000==0o040000:dirs.add(name);del files[name]
chunks=[overlay.cpio.entry(n,mode=0o040755,ino=i+1) for i,n in enumerate(sorted(dirs,key=lambda n:(n.count('/'),n)))]
chunks.extend(overlay.cpio.entry(n,mode=0o020666,ino=500+i,rdev=d) for i,(n,d) in enumerate([('dev/console',(5,1)),('dev/null',(1,3)),('dev/zero',(1,5)),('dev/urandom',(1,9)),('dev/tty',(5,0))]))
chunks.extend(overlay.cpio.entry(n,data,mode,1000+i) for i,(n,(mode,data)) in enumerate(sorted(files.items())))
chunks.append(overlay.cpio.entry('TRAILER!!!',mode=0));image=b''.join(chunks);image+=b'\0'*(-len(image)%512)
(a.out/'persistence.cpio').write_bytes(image)
report={'testOnly':True,'productionAccepted':False,'pinnedImageVersion':manifest['version'],'pinnedImageSha256':overlay.sha(a.base),'archiveSha256':hashlib.sha256(image).hexdigest(),'archiveBytes':len(image),'nativeHelperSha256':hashlib.sha256(helper).hexdigest(),'basePackages':packages,'baseInstalledDbSha256':hashlib.sha256(original['lib/apk/db/installed'][1]).hexdigest(),'scriptSha256':hashlib.sha256(files['tests/persistence-check.sh'][1]).hexdigest()}
(a.out/'fixture.json').write_text(json.dumps(report,indent=2)+'\n')
(a.out/'config.json').write_text(json.dumps({'persistHome':True,'exportDatabase':False,'timeoutSeconds':150,'restartConfigs':[{'network':False} for _ in range(4)]},indent=2)+'\n')
print(json.dumps(report,indent=2))
