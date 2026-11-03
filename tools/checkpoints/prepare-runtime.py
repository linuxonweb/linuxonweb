#!/usr/bin/env python3
"""Prepare exact accepted runtime recovery; exclude private state and signing keys."""
import argparse,datetime,gzip,hashlib,json,pathlib,shutil,subprocess,tarfile
q=argparse.ArgumentParser();q.add_argument('--out',type=pathlib.Path,required=True);q.add_argument('--repository',type=pathlib.Path,required=True);a=q.parse_args();a.out.mkdir(parents=True,exist_ok=False);pub=a.out/'publish';pub.mkdir();prefix='linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103';head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
def sha(p):
 with p.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def record(p):return {'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}
def audit_cpio(p):
 count=0;homes=[];susp=[]
 with p.open('rb')as f:
  while True:
   h=f.read(110)
   if not h or not h.strip(b'\0'):break
   if h[:6] not in [b'070701',b'070702']:raise ValueError('unsupported CPIO format')
   n=int(h[94:102],16);size=int(h[54:62],16);mode=int(h[14:22],16);name=f.read(n).rstrip(b'\0').decode();f.read((-110-n)%4)
   if name=='TRAILER!!!':break
   clean=name.lstrip('./');count+=1
   if clean.startswith('home/') and size:homes.append(clean)
   if size and any(x in clean.lower() for x in ['cookies.sqlite','logins.json','id_rsa','.xauthority','.env','private-preview','private-signing']):susp.append(clean)
   f.seek(size+(-size)%4,1)
 assert not homes and not susp, {'homeFiles':homes,'suspiciousNames':susp}
 return {'members':count,'homePayloadFiles':0,'suspiciousNames':0,'contentScope':'Existing distribution assets, no captured user home. Filename inventory plus accepted original/overlay privacy provenance; not a claim of arbitrary forensic secret scanning.'}
manifest=json.loads(pathlib.Path('web/desktop/latest-build/boot-manifest.json').read_text());assert manifest['version']=='d258203daee8'
image=pathlib.Path('web/desktop/latest-build/initramfs-firefox.cpio.gz');assert sha(image)==manifest['assets']['firefox']['sha256'];parts=[]
with image.open('rb')as f:
 for i in range(1,4):
  block=f.read(96_000_000)
  if not block:break
  p=pub/(prefix+'_apk4.cpio.gz.part'+str(i).zfill(3));p.write_bytes(block);parts.append(record(p))
basefiles=['web/linux/vmlinux.wasm','web/linux/initramfs.cpio','web/linux/desktop-extras.cpio','web/linux/desktop-extras.cpio.json','web/desktop/latest-build/boot-manifest.json','web/desktop/latest-build/latest-build.json'];audits={p:audit_cpio(pathlib.Path(p))for p in ['web/linux/initramfs.cpio','web/linux/desktop-extras.cpio']};assets=[]
base=pub/(prefix+'_boot-assets.tar.gz')
with tarfile.open(base,'w:gz',compresslevel=1)as t:
 for name in basefiles:
  p=pathlib.Path(name);r=record(p);r['restorePath']=name;assets.append(r);t.add(p,arcname=name,recursive=False)
for name,key in [('web/linux/vmlinux.wasm','kernel'),('web/linux/initramfs.cpio','plain')]:assert sha(pathlib.Path(name))==manifest['assets'][key]['sha256']
repo=pub/(prefix+'_signed-repository.tar.gz');repofiles=[]
with tarfile.open(repo,'w:gz',compresslevel=1)as t:
 for p in sorted(a.repository.rglob('*')):
  if p.is_dir():continue
  rel=p.relative_to(a.repository);assert not p.is_symlink();assert p.name=='linuxonweb-dev.rsa.pub' or p.suffix in ['.apk','.json','.gz'];r=record(p);r['path']=rel.as_posix();repofiles.append(r);t.add(p,arcname='signed-repository/'+rel.as_posix(),recursive=False)
r={'schema':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommitAtRuntimeCapture':head,'runtimeVersion':manifest['version'],'firefoxImage':{'bytes':image.stat().st_size,'sha256':sha(image),'parts':parts,'restorePath':'web/desktop/latest-build/initramfs-firefox.cpio.gz'},'bootAssetArchive':record(base),'bootAssets':assets,'repositoryArchive':record(repo),'repositoryFiles':repofiles,'privacy':audits,'acceptedImagePrivacy':'Original608 /home only empty directories and NSS private table0; whitelisted APK system overlay preserves /home and native Firefox. Signing private key excluded.','limitations':['Full native Firefox rebuild requires currently inaccessible external p6 objects/archives.','Installed package files and DB reset together at reboot; home persists.','Node.js not ported. Wget,tar,findutils not accepted native packages.','This runtime capture does not claim experimental Omni or full phone Firefox acceptance.']};(pub/'RUNTIME-MANIFEST.json').write_text(json.dumps(r,indent=2)+'\n')
restore='''#!/usr/bin/env python3
import hashlib,json,pathlib,tarfile
root=pathlib.Path(__file__).resolve().parent;m=json.loads((root/'RUNTIME-MANIFEST.json').read_text());out=root/'restored-runtime';out.mkdir(exist_ok=True)
def verify(p,r):
 with p.open('rb')as f:assert hashlib.file_digest(f,'sha256').hexdigest()==r['sha256'],p
 assert p.stat().st_size==r['bytes'],p
image=out/m['firefoxImage']['restorePath'];image.parent.mkdir(parents=True,exist_ok=True)
with image.open('wb')as dst:
 for r in m['firefoxImage']['parts']:
  p=root/r['name'];verify(p,r)
  with p.open('rb')as f:
   while b:=f.read(1048576):dst.write(b)
verify(image,m['firefoxImage'])
for key in ['bootAssetArchive','repositoryArchive']:
 r=m[key];p=root/r['name'];verify(p,r)
 with tarfile.open(p,'r:gz')as t:t.extractall(out,filter='data')
for r in m['bootAssets']:verify(out/r['restorePath'],r)
for r in m['repositoryFiles']:verify(out/'signed-repository'/r['path'],r)
print('Verified exact runtime restored at',out)
''';(pub/'restore-runtime.py').write_text(restore)
(pub/'README.md').write_text('# Accepted Linuxonweb runtime recovery\n\nDownload every file named by RUNTIME-MANIFEST.json plus restore-runtime.py into one folder, then run Python3.12+ restore-runtime.py. It verifies every part, concatenated image, boot asset and signed repository file before use. Copy restored-runtime/web over the recovered source tree; configure the read-only repository service against restored-runtime/signed-repository using tools/guest-packages/install-repository.sh. The already configured public live repository is https://a3cf34ce40307517.5x7aqstuceku.opentunnel.xyz and lasts only while the owner service/tunnel run. This immutable snapshot remains a separate fallback.\n\nRecover source/history from the encrypted cumulative increment plus original80a52d1 base; the current source export is separate. Keep the package signing recovery key private. Runtime binaries here contain no signing private key or preview grant. Sources contain reproducible package recipes; full native Firefox rebuild is incomplete because historical external build inputs are inaccessible.\n')
(pub/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Linuxonweb accepted runtime recovery</title><h1>Linuxonweb accepted runtime recovery</h1><p>GPT-6 Astra Pro · built-in agents · rubywebterm · 2026-11-03</p><p>Exact accepted APK4 distribution, boot assets and signed repository. This is a recovery download, not a static deployment of the Linux runtime.</p><ul>'+''.join('<li><a href="'+p.name+'">'+p.name+'</a> ('+str(p.stat().st_size)+' bytes)</li>'for p in sorted(pub.iterdir())if p.is_file())+'</ul>')
print(json.dumps({'pass':True,'files':len(list(pub.iterdir())),'bytes':sum(p.stat().st_size for p in pub.iterdir()),'output':str(pub),'runtimeVersion':manifest['version'],'privacy':audits}))
