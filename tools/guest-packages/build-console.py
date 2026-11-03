#!/usr/bin/env python3
"""Build a small real Linux console from verified APKs and an actual base database."""
import argparse,base64,gzip,hashlib,importlib.util,io,json,os,pathlib,subprocess,tarfile,zlib
q=argparse.ArgumentParser();q.add_argument('--repo',type=pathlib.Path,required=True);q.add_argument('--database',type=pathlib.Path,required=True);q.add_argument('--repository-url',required=True);q.add_argument('--host-apk',type=pathlib.Path,required=True);q.add_argument('--out',type=pathlib.Path,required=True);a=q.parse_args();a.out.mkdir(parents=True,exist_ok=False);here=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('cpio',here/'make-smoke.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base={'apk-tools','busybox','ca-certificates','curl'};records={}
for block in (a.database/'installed').read_text().strip().split('\n\n'):
 fields=dict(x.split(':',1) for x in block.splitlines() if x[:2] in ('P:','V:','C:'));records[fields.get('P')]=fields
if set(records)!=base or set((a.database/'world').read_text().split())!=base:raise ValueError('unexpected base database')
if not a.repository_url.startswith('https://') or any(x in a.repository_url for x in ('\n','\r','@')):raise ValueError('public HTTPS repository required')
key=a.repo/'linuxonweb-dev.rsa.pub';host=a.host_apk.resolve();env={**os.environ,'LD_LIBRARY_PATH':str(host.parent)};files={};packages=[]
for receipt in sorted((a.repo/'wasm32').glob('*.json')):
 r=json.loads(receipt.read_text())
 if r.get('name') not in base:continue
 p=receipt.with_suffix('.apk');raw=p.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=r['sha256'] or records[r['name']]['V']!=r['version']:raise ValueError('package/database identity mismatch')
 subprocess.run([str(host),'--keys-dir',str(key.resolve().parent),'verify',str(p.resolve())],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 remaining=raw;segments=[]
 while remaining:
  d=zlib.decompressobj(31);d.decompress(remaining);d.flush();used=len(remaining)-len(d.unused_data);segments.append(remaining[:used]);remaining=d.unused_data
 if len(segments)!=3 or records[r['name']]['C']!='Q1'+base64.b64encode(hashlib.sha1(segments[1]).digest()).decode():raise ValueError('stale base package checksum')
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress(raw))) as t:
  for item in t:
   n=item.name.rstrip('/')
   if n.startswith('.') or item.isdir():continue
   if not n or n.startswith('/') or any(x in ('','..') for x in n.split('/')):raise ValueError('unsafe package path')
   if item.isfile():value=(t.extractfile(item).read(),0o100000|item.mode)
   elif item.issym():value=(item.linkname.encode(),0o120777)
   else:raise ValueError('unsupported package file type')
   if n in files and files[n]!=value:raise ValueError('conflicting package member')
   files[n]=value
 packages.append({'name':r['name'],'version':r['version'],'sha256':r['sha256']})
if {p['name'] for p in packages}!=base:raise ValueError('missing base APK')
init=b'''#!/bin/busybox sh
export PATH=/usr/bin:/bin:/sbin:/usr/sbin
export HOME=/home/admin USER=root LOGNAME=root TERM=xterm-256color SHELL=/bin/sh
export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt SSL_CERT_DIR=/etc/ssl/certs
/bin/busybox mount -t devtmpfs devtmpfs /dev
/bin/busybox mkdir -p /dev/pts /tmp /run /home /var/cache/apk
/bin/busybox mount -t devpts devpts /dev/pts
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
if ! /bin/busybox mount -t virtiofs -o rw,sync,dirsync home /home; then
 /bin/busybox echo 'Persistent home mount failed; stopping instead of writing to a temporary replacement.'
 exec /bin/busybox poweroff -f
fi
/bin/busybox mkdir -p /home/admin
/bin/busybox chmod 1777 /tmp
/bin/busybox ifconfig lo 127.0.0.1 up
/bin/busybox ifconfig eth0 192.0.2.2 netmask 255.255.255.0 up
/bin/busybox route add default gw 192.0.2.1
/bin/busybox echo nameserver 192.0.2.1 > /etc/resolv.conf
cd /home/admin
/bin/busybox echo 'Linux package console: real wasm32 Linux; /home persists, package installs reset on restart.'
export PS1='linux:/home/admin # '
exec /bin/busybox setsid /bin/busybox cttyhack /bin/busybox sh
'''
files.update({'init':(init,0o100755),'etc/passwd':(b'root:x:0:0:root:/home/admin:/bin/sh\n',0o100644),'etc/group':(b'root:x:0:\n',0o100644),'etc/apk/world':((a.database/'world').read_bytes(),0o100644),'etc/apk/repositories':((a.repository_url.rstrip('/')+'\n').encode(),0o100644),'etc/apk/keys/'+key.name:(key.read_bytes(),0o100644)})
for n in ('installed','scripts.tar','triggers'):files['lib/apk/db/'+n]=((a.database/n).read_bytes(),0o100644)
# These are explicitly BusyBox applet links, never advertised as separate GNU packages.
for n in 'cat chmod chown cp cut date df dirname du echo env false find grep head hostname id ln ls mkdir mv od printf ps pwd readlink realpath rm rmdir sed sh sleep sort stat sync tail tar tee test touch tr true uname uniq wc wget which whoami xargs yes'.split():files.setdefault('bin/'+n,(b'busybox',0o120777))
for n in ('poweroff','reboot','mount','umount','ifconfig','route'):files.setdefault('sbin/'+n,(b'../bin/busybox',0o120777))
dirs={'dev','dev/pts','proc','sys','tmp','run','home','var/cache/apk'}
for name in files:
 parent=pathlib.PurePosixPath(name).parent
 while str(parent)!='.':dirs.add(str(parent));parent=parent.parent
entries=[];ino=1
for n in sorted(dirs,key=lambda x:(x.count('/'),x)):entries.append(m.entry(n,mode=0o040755,ino=ino));ino+=1
for n,dev in [('dev/console',(5,1)),('dev/null',(1,3)),('dev/zero',(1,5)),('dev/urandom',(1,9)),('dev/tty',(5,0))]:entries.append(m.entry(n,mode=0o020666,ino=ino,rdev=dev));ino+=1
for n,(data,mode) in sorted(files.items()):entries.append(m.entry(n,data,mode,ino));ino+=1
entries.append(m.entry('TRAILER!!!',mode=0,ino=ino));raw=b''.join(entries);raw+=b'\0'*((-len(raw))%512);image=a.out/'package-console.cpio.gz'
with image.open('wb') as f:
 with gzip.GzipFile(fileobj=f,mode='wb',filename='',mtime=0,compresslevel=6) as z:z.write(raw)
manifest={'schema':1,'image':{'url':'./package-console.cpio.gz','bytes':image.stat().st_size,'sha256':m.digest(image)},'guestMemoryBytes':536870912,'rootfsPayloadBytes':len(raw),'packages':packages,'persistence':'home only; installed files and APK database reset together','normalDesktop':False,'androidAccepted':False,'iosAccepted':False};(a.out/'console-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(a.out/'members.json').write_text(json.dumps({n:{'bytes':len(d),'mode':oct(mode),'sha256':hashlib.sha256(d).hexdigest()} for n,(d,mode) in files.items()},indent=2)+'\n');print(json.dumps(manifest))
