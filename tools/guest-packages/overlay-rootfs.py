#!/usr/bin/env python3
"""Append verified native APK files and an actual installed database to a pinned rootfs.
The original decoded CPIO is preserved byte-for-byte and followed by a small
newc overlay. A single gzip member supports browser DecompressionStream.
"""
import argparse,base64,copy,gzip,hashlib,importlib.util,io,json,os,pathlib,shutil,subprocess,tarfile,zlib
q=argparse.ArgumentParser();q.add_argument('--base',type=pathlib.Path,required=True);q.add_argument('--manifest',type=pathlib.Path,required=True);q.add_argument('--repo',type=pathlib.Path,required=True);q.add_argument('--database',type=pathlib.Path,required=True);q.add_argument('--repository-url',required=True);q.add_argument('--fallback-url');q.add_argument('--host-apk',type=pathlib.Path,required=True);q.add_argument('--out',type=pathlib.Path,required=True);q.add_argument('--sudo',type=pathlib.Path);a=q.parse_args();here=pathlib.Path(__file__).resolve().parent
BASE_SHA='60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa';base_names={'apk-tools','busybox','ca-certificates','curl'}
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def digest(b):return hashlib.sha256(b).hexdigest()
if sha(a.base)!=BASE_SHA:raise ValueError('base distribution hash mismatch')
manifest=json.loads(a.manifest.read_text())
if manifest['assets']['firefox']['sha256']!=BASE_SHA:raise ValueError('manifest/base mismatch')
for url in [a.repository_url]+([a.fallback_url] if a.fallback_url else []):
 if not url.startswith('https://') or any(x in url for x in ('\n','\r','@','?','#')):raise ValueError('repository must be a public HTTPS URL without credentials')
repositories=a.repository_url.rstrip('/')+'\n'
if a.fallback_url:repositories+='@snapshot '+a.fallback_url.rstrip('/')+'\n'
world=(a.database/'world').read_text();installed=(a.database/'installed').read_text()
if set(world.split())!=base_names or {x[2:] for x in installed.splitlines() if x.startswith('P:')}!=base_names:raise ValueError('database must be the actual four-package base install')
installed_records={}
for block in installed.strip().split('\n\n'):
 fields=dict(line.split(':',1) for line in block.splitlines() if line[:2] in ('P:','V:','C:'))
 if fields.get('P') in installed_records:raise ValueError('duplicate installed package')
 installed_records[fields.get('P')]=fields
spec=importlib.util.spec_from_file_location('smoke',here/'make-smoke.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
files={};packages=[];key=a.repo/'linuxonweb-dev.rsa.pub';host=a.host_apk.resolve();env={**os.environ,'LD_LIBRARY_PATH':str(host.parent)}
for receipt in sorted((a.repo/'wasm32').glob('*.json')):
 r=json.loads(receipt.read_text())
 if r.get('name') not in base_names:continue
 p=receipt.with_suffix('.apk')
 if sha(p)!=r['sha256']:raise ValueError('package receipt mismatch')
 if installed_records[r['name']].get('V')!=r['version']:raise ValueError('stale installed package version')
 raw=p.read_bytes();segments=[]
 while raw:
  decoder=zlib.decompressobj(31);decoder.decompress(raw);decoder.flush();used=len(raw)-len(decoder.unused_data)
  if used<=0:raise ValueError('invalid gzip package segment')
  segments.append(raw[:used]);raw=decoder.unused_data
 if len(segments)!=3:raise ValueError('expected signed APK v2 streams')
 checksum='Q1'+base64.b64encode(hashlib.sha1(segments[1]).digest()).decode()
 if installed_records[r['name']].get('C')!=checksum:raise ValueError('stale installed package archive checksum')
 subprocess.run([str(host),'--keys-dir',str(key.resolve().parent),'verify',str(p.resolve())],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress(p.read_bytes())),mode='r:') as t:
  for member in t:
   n=member.name.rstrip('/')
   if n.startswith('.'):continue
   if not n or n.startswith('/') or '..' in n.split('/') or '\\' in n or '\0' in n:raise ValueError('unsafe APK member')
   if member.isdir():continue
   if member.isfile():data=t.extractfile(member).read();mode=0o100000|member.mode
   elif member.issym():data=member.linkname.encode();mode=0o120777
   else:raise ValueError('unsupported package member type')
   if n in files and files[n]!=(data,mode):raise ValueError('package ownership conflict '+n)
   files[n]=(data,mode)
 packages.append({'name':r['name'],'version':r['version'],'sha256':r['sha256']})
if {r['name'] for r in packages}!=base_names:raise ValueError('missing base APK')
files.update({'etc/apk/keys/'+key.name:(key.read_bytes(),0o100644),'etc/apk/repositories':(repositories.encode(),0o100644),'etc/apk/world':(world.encode(),0o100644),'usr/share/doc/linuxonweb-packages/README.txt':(b'Packages use the wasm32 Linux ABI. Install as root: apk update; apk add python3. Files in /usr, /etc and /lib and the APK database reset together on reboot. /home persists independently. Never install ordinary x86/ARM Alpine packages. The live repository receives signed package updates. The @snapshot repository is an explicit immutable fallback; use apk add python3@snapshot when required. GNU tools may be available in the live index; Node.js remains unsupported.\n',0o100644)})
if a.sudo:
 data=a.sudo.read_bytes()
 if not data.startswith(b'\0asm\x01\0\0\0'):raise ValueError('sudo must be native guest Wasm')
 files['usr/bin/sudo']=(data,0o104755)
for n in ('installed','scripts.tar','triggers'):files['lib/apk/db/'+n]=((a.database/n).read_bytes(),0o100644)
original={};native=[];init_sha=None;count=0;maxino=0
with gzip.open(a.base,'rb') as f:
 while True:
  h=m.read_exact(f,110)
  if h[:6]!=b'070701':raise ValueError('invalid original newc')
  mode=int(h[14:22],16);size=int(h[54:62],16);ns=int(h[94:102],16);maxino=max(maxino,int(h[6:14],16));name=m.read_exact(f,ns).rstrip(b'\0').decode().removeprefix('./');m.read_exact(f,(-(110+ns))%4)
  if name=='TRAILER!!!':break
  wanted=name in files or name=='init' or ('firefox' in name.lower() and size>50000000);hasher=hashlib.sha256();first=b'';left=size
  while left:
   b=m.read_exact(f,min(left,1024*1024));left-=len(b)
   if wanted:hasher.update(b)
   if not first:first=b[:8]
  m.read_exact(f,(-size)%4);count+=1
  if name in files:original[name]={'sha256':hasher.hexdigest(),'mode':mode,'bytes':size}
  if name=='init':init_sha=hasher.hexdigest()
  if wanted and 'firefox' in name.lower() and first==b'\0asm\x01\0\0\0':native.append({'path':name,'bytes':size,'sha256':hasher.hexdigest()})
if not init_sha or not native:raise ValueError('original init/native Firefox not identified')
if any(n=='init' or 'firefox' in n.lower() or n.startswith('home/') for n in files):raise ValueError('overlay must preserve init, Firefox and home')
skipped=[]
for name in list(files):
 if name in original and original[name]['mode']==files[name][1] and original[name]['sha256']==digest(files[name][0]):skipped.append(name);del files[name]
dirs=set()
for name in files:
 p=pathlib.PurePosixPath(name).parent
 while str(p)!='.':dirs.add(str(p));p=p.parent
entries=[];ino=maxino+1
for name in sorted(dirs,key=lambda n:(n.count('/'),n)):
 entries.append(m.entry(name,mode=0o040755,ino=ino));ino+=1
for name,(data,mode) in sorted(files.items()):entries.append(m.entry(name,data,mode,ino));ino+=1
entries.append(m.entry('TRAILER!!!',mode=0,ino=ino));overlay=b''.join(entries);overlay+=b'\0'*((-len(overlay))%512)
a.out.mkdir(parents=True,exist_ok=False);out=a.out/'initramfs-firefox.cpio.gz';decoded_hash=hashlib.sha256();decoded_bytes=0
with gzip.open(a.base,'rb') as src,out.open('wb') as raw,gzip.GzipFile(fileobj=raw,mode='wb',mtime=0,filename='',compresslevel=6) as dst:
 while data:=src.read(1048576):decoded_hash.update(data);decoded_bytes+=len(data);dst.write(data)
 decoded_hash.update(overlay);decoded_bytes+=len(overlay);dst.write(overlay)
verify=hashlib.sha256()
with gzip.open(out,'rb') as f:
 while data:=f.read(1048576):verify.update(data)
if verify.hexdigest()!=decoded_hash.hexdigest():raise ValueError('decoded rootfs content changed during compression')
new=copy.deepcopy(manifest);new['assets']['firefox'].update(bytes=out.stat().st_size,sha256=sha(out),label='Firefox system with verified native APK base; package install files reset at reboot');new['version']=digest(json.dumps(new['assets'],sort_keys=True).encode())[:12]
(a.out/'boot-manifest.json').write_text(json.dumps(new,indent=2)+'\n')
report={'passPackage':True,'candidateOnly':True,'runtimeAccepted':False,'sourceSha256':BASE_SHA,'archiveSha256':new['assets']['firefox']['sha256'],'bytes':out.stat().st_size,'version':new['version'],'format':'one gzip member containing original newc plus newc overlay','gzipMembers':1,'decodedRootfsSha256':decoded_hash.hexdigest(),'decodedRootfsBytes':decoded_bytes,'originalGzipPrefixPreserved':False,'originalCpioPrefixPreserved':True,'initSha256':init_sha,'initUnchanged':True,'nativeFirefoxUnchanged':native,'homeUnchanged':True,'originalRecords':count,'packages':packages,'actualGuestDatabase':str(a.database),'databaseSha256':sha(a.database/'installed'),'worldSha256':sha(a.database/'world'),'repositoryUrl':a.repository_url.rstrip('/'),'repositoryFallback':({'tag':'snapshot','url':a.fallback_url.rstrip('/'),'automatic':False} if a.fallback_url else None),'overlayMembers':[{'path':n,'bytes':len(d),'mode':oct(mode),'sha256':digest(d),'replacesExisting':n in original} for n,(d,mode) in sorted(files.items())],'identicalExistingMembersReused':sorted(skipped),'overlayDirectories':sorted(dirs),'releaseGatesPending':['unchanged-init full-image package execution','fresh reboot resets package files and database consistently','normal desktop publication']}
(a.out/'package.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'version':new['version'],'archiveSha256':report['archiveSha256'],'bytes':report['bytes'],'overlayMembers':len(files),'nativeFirefoxUnchanged':native,'initUnchanged':True}))
