#!/usr/bin/env python3
"""Capture the exact published runtime plus explicitly accepted extra assets.

No candidate is inferred from a directory name. Callers pin the approved manifest
and Firefox identity. Source/history encryption remains a separate artifact.
"""
import argparse,datetime,gzip,hashlib,json,pathlib,stat,subprocess,tarfile
q=argparse.ArgumentParser(description=__doc__)
q.add_argument('--out',type=pathlib.Path,required=True)
q.add_argument('--repository',type=pathlib.Path,required=True)
q.add_argument('--expected-version',required=True)
q.add_argument('--expected-firefox-sha',required=True)
q.add_argument('--extra-manifest',type=pathlib.Path)
a=q.parse_args();root=pathlib.Path.cwd().resolve();latest=root/'web/desktop/latest-build';web=root/'web/linux'
if a.out.exists():raise ValueError('fresh capture directory required')
a.out.mkdir(parents=True,mode=0o700);pub=a.out/'publish';pub.mkdir()
prefix='linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_1322'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def record(p):return {'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}
def verify(p,r):
 if not p.is_file() or p.is_symlink() or p.stat().st_size!=r['bytes'] or sha(p)!=r['sha256']:raise ValueError('published asset identity differs: '+str(p))
def relative(p):
 r=p.resolve().relative_to(root).as_posix()
 if not r.startswith('web/') or any(x in ('','..','.') for x in pathlib.PurePosixPath(r).parts):raise ValueError('runtime source outside public web tree')
 return r
manifest_path=latest/'boot-manifest.json';manifest=json.loads(manifest_path.read_text());stamp_path=latest/'latest-build.json';stamp=json.loads(stamp_path.read_text())
if manifest.get('schema')!=1 or manifest['version']!=a.expected_version or manifest['assets']['firefox']['sha256']!=a.expected_firefox_sha:raise ValueError('approved runtime pins differ')
if set(manifest['assets'])!={'kernel','plain','firefox'} or stamp.get('id')!=manifest['version']:raise ValueError('published manifest/stamp contract differs')
files=stamp.get('files');
if not isinstance(files,list) or any(not isinstance(n,str) or pathlib.PurePosixPath(n).name!=n or n in ('.','..') for n in files):raise ValueError('invalid published file inventory')
selected={};boot=[];audits={}
def select_asset(key):
 asset=manifest['assets'][key];url=asset['url']
 if not isinstance(url,str) or not url.startswith('./') or pathlib.PurePosixPath(url[2:]).name!=url[2:] or any(c in url for c in ('?','#','\\')):raise ValueError('invalid asset URL')
 name=url[2:];p=(latest if name in files else web)/name;verify(p,asset);return p
for key in ('kernel','plain','firefox'):selected[key]=select_asset(key)
def add_boot(p):
 r=record(p);r['restorePath']=relative(p)
 if any(x['restorePath']==r['restorePath'] for x in boot):return
 boot.append(r)
for p in (manifest_path,stamp_path,selected['kernel'],selected['plain']):add_boot(p)
extras_dir=latest if stamp.get('desktopExtras') else web
extras_manifest=extras_dir/'desktop-extras.cpio.json';extras=json.loads(extras_manifest.read_text());verify(extras_dir/'desktop-extras.cpio',extras)
for p in (extras_manifest,extras_dir/'desktop-extras.cpio'):add_boot(p)
if extras.get('gzip'):
 verify(extras_dir/'desktop-extras.cpio.gz',extras['gzip']);add_boot(extras_dir/'desktop-extras.cpio.gz')
if stamp.get('desktopExtras'):
 for name,r in stamp['desktopExtras']['files'].items():verify(extras_dir/name,r)
def cpio_privacy(p,compressed=False):
 count=0;trailer=0;home=[];suspicious=[];opener=gzip.open if compressed else open
 with opener(p,'rb') as f:
  def exact(n):
   b=f.read(n)
   if len(b)!=n:raise ValueError('truncated CPIO')
   return b
  while True:
   first=f.read(1)
   while first==b'\0':first=f.read(1)
   if not first:break
   h=first+exact(109)
   if h[:6] not in (b'070701',b'070702'):raise ValueError('invalid CPIO header')
   fields=[int(h[i:i+8],16) for i in range(6,110,8)];size,n=fields[6],fields[11]
   if not 1<=n<=4096:raise ValueError('invalid CPIO name bound')
   raw=exact(n)
   if raw[-1:]!=b'\0' or b'\0' in raw[:-1]:raise ValueError('invalid CPIO name')
   name=raw[:-1].decode().removeprefix('./')
   if name!='.' and (name.startswith('/') or any(x in ('','.','..') for x in name.split('/'))):raise ValueError('unsafe CPIO path')
   exact(-(110+n)%4)
   remaining=size
   while remaining:
    block=exact(min(remaining,1024*1024));remaining-=len(block)
   exact(-size%4)
   if name=='TRAILER!!!':
    if size:raise ValueError('nonempty CPIO trailer')
    trailer+=1;continue
   count+=1
   if name.startswith('home/') and size and not stat.S_ISDIR(fields[1]):home.append(name)
   if size and any(x in name.lower() for x in ('cookies.sqlite','logins.json','id_rsa','.xauthority','.env','private-preview','private-signing','.bash_history','authorized_keys')):suspicious.append(name)
 if not trailer or home or suspicious:raise ValueError('runtime privacy inventory failed: '+json.dumps({'home':home,'suspicious':suspicious}))
 return {'membersAcrossAllArchives':count,'trailers':trailer,'homePayloadFiles':0,'suspiciousNames':0,'scope':'All decoded CPIO members checked; filename and empty-home inventory plus accepted distribution provenance, not arbitrary forensic secret scanning'}
for key in ('plain','firefox'):audits[key]=cpio_privacy(selected[key],selected[key].name.endswith('.gz'))
audits['desktopExtras']=cpio_privacy(extras_dir/'desktop-extras.cpio')
image=selected['firefox'];parts=[]
with image.open('rb') as f:
 index=1
 while block:=f.read(96_000_000):
  p=pub/(prefix+'_firefox.cpio.gz.part'+str(index).zfill(3));p.write_bytes(block);parts.append(record(p));index+=1
base=pub/(prefix+'_boot-assets.tar.gz')
with tarfile.open(base,'w:gz',compresslevel=1) as t:
 for r in boot:t.add(root/r['restorePath'],arcname=r['restorePath'],recursive=False)
repo=pub/(prefix+'_signed-repository.tar.gz');repofiles=[]
with tarfile.open(repo,'w:gz',compresslevel=1) as t:
 for p in sorted(a.repository.rglob('*')):
  if p.is_dir():continue
  rel=p.relative_to(a.repository).as_posix()
  if p.is_symlink() or not (p.name=='linuxonweb-dev.rsa.pub' or p.suffix in ('.apk','.json','.gz')):raise ValueError('unexpected repository member')
  r=record(p);r['path']=rel;repofiles.append(r);t.add(p,arcname='signed-repository/'+rel,recursive=False)
extra_files=[];extra_archive=None
if a.extra_manifest:
 extra=json.loads(a.extra_manifest.read_text())
 if extra.get('accepted') is not True or not isinstance(extra.get('files'),list):raise ValueError('extra asset manifest must explicitly report acceptance')
 seen={r['restorePath'] for r in boot}|{relative(image)}
 for row in extra['files']:
  p=(root/row['sourcePath']).resolve();verify(p,row);relative(p);dest=row['restorePath'];parts_dest=pathlib.PurePosixPath(dest)
  if not isinstance(dest,str) or not dest.startswith('web/') or chr(92) in dest or ':' in dest or parts_dest.is_absolute() or any(x in ('','.','..') for x in dest.split('/')) or dest in seen:raise ValueError('unsafe/duplicate extra restore path')
  seen.add(dest);extra_files.append({**record(p),'restorePath':dest,'sourcePath':relative(p)})
  if row.get('role')=='console-image':audits['consoleImage']=cpio_privacy(p,p.name.endswith('.gz'))
 p=pub/(prefix+'_accepted-extra-assets.tar.gz')
 with tarfile.open(p,'w:gz',compresslevel=1) as t:
  for row in extra_files:t.add(root/row['sourcePath'],arcname=row['restorePath'],recursive=False)
 extra_archive=record(p)
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
r={'schema':2,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommitAtRuntimeCapture':head,'runtimeVersion':manifest['version'],'bootManifestSha256':sha(manifest_path),'firefoxImage':{'bytes':image.stat().st_size,'sha256':sha(image),'parts':parts,'restorePath':relative(image)},'bootAssetArchive':record(base),'bootAssets':boot,'repositoryArchive':record(repo),'repositoryFiles':repofiles,'extraAssetArchive':extra_archive,'extraAssets':extra_files,'privacy':audits,'limitations':['This exact runtime snapshot does not imply all project target gates passed; consult the final acceptance report.','Full native Firefox rebuild still requires inaccessible protected historical build dependencies.','Private signing/recovery keys and preview grants are not in these public runtime archives.','Recover source/history from the original encrypted base and final cumulative increment with the original private recipient key.']}
(pub/'RUNTIME-MANIFEST.json').write_text(json.dumps(r,indent=2)+'\n')
restore=r'''#!/usr/bin/env python3
import hashlib,json,pathlib,tarfile
root=pathlib.Path(__file__).resolve().parent
m=json.loads((root/'RUNTIME-MANIFEST.json').read_text())
def safe(name,prefix=None,leaf=False):
 if not isinstance(name,str) or not name or '\\' in name or ':' in name or name.startswith('/') or any(x in ('','.','..') for x in name.split('/')):raise ValueError('Unsafe artifact path')
 if leaf and '/' in name:raise ValueError('Artifact name must be a leaf')
 if prefix and not name.startswith(prefix):raise ValueError('Unexpected restore namespace')
 return pathlib.Path(name)
def check_record(r):
 if not isinstance(r.get('bytes'),int) or isinstance(r['bytes'],bool) or r['bytes']<0 or not isinstance(r.get('sha256'),str) or len(r['sha256'])!=64 or any(c not in '0123456789abcdef' for c in r['sha256']):raise ValueError('Invalid artifact identity')
def verify(p,r):
 check_record(r)
 if p.is_symlink() or not p.is_file() or p.stat().st_size!=r['bytes']:raise ValueError('Artifact size/type mismatch: '+str(p))
 with p.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
 if digest!=r['sha256']:raise ValueError('Artifact SHA256 mismatch: '+str(p))
if m.get('schema')!=2:raise ValueError('Unsupported runtime manifest')
image_path=safe(m['firefoxImage']['restorePath'],'web/');check_record(m['firefoxImage'])
seen={image_path.as_posix()}
for row in m['bootAssets']+m.get('extraAssets',[]):
 dest=safe(row['restorePath'],'web/').as_posix();check_record(row)
 if dest in seen:raise ValueError('Duplicate or colliding restore path')
 seen.add(dest)
for row in m['repositoryFiles']:
 dest='signed-repository/'+safe(row['path']).as_posix();check_record(row)
 if dest in seen:raise ValueError('Duplicate repository path')
 seen.add(dest)
part_names=set()
for row in m['firefoxImage']['parts']:
 name=safe(row['name'],leaf=True).as_posix()
 if name in part_names:raise ValueError('Duplicate image part')
 part_names.add(name);verify(root/name,row)
archive_specs=[('bootAssetArchive',m['bootAssets']),('repositoryArchive',[{**r,'restorePath':'signed-repository/'+r['path']} for r in m['repositoryFiles']]),('extraAssetArchive',m.get('extraAssets',[]))]
for key,rows in archive_specs:
 row=m.get(key)
 if row:verify(root/safe(row['name'],leaf=True),row)
 elif rows:raise ValueError('Missing declared archive')
out=root/'restored-runtime';out.mkdir(exist_ok=False)
def destination(name):
 rel=safe(name);p=out/rel
 for parent in [p,*p.parents]:
  if parent==out.parent:break
  if parent.is_symlink():raise ValueError('Symlink in destination')
 if not p.resolve().is_relative_to(out.resolve()):raise ValueError('Destination escapes restore root')
 return p
image=destination(image_path.as_posix());image.parent.mkdir(parents=True,exist_ok=True)
with image.open('xb') as dst:
 for row in m['firefoxImage']['parts']:
  with (root/row['name']).open('rb') as src:
   while block:=src.read(1048576):dst.write(block)
verify(image,m['firefoxImage'])
for key,rows in archive_specs:
 row=m.get(key)
 if not row:continue
 expected={r['restorePath']:r for r in rows}
 with tarfile.open(root/row['name'],'r:gz') as t:
  members=t.getmembers();names=[safe(member.name).as_posix() for member in members]
  if len(names)!=len(set(names)) or set(names)!=set(expected):raise ValueError('Archive inventory differs from manifest')
  for member,name in zip(members,names):
   if not member.isfile() or member.size!=expected[name]['bytes']:raise ValueError('Archive member type/size differs')
   destination(name)
  t.extractall(out,members=members,filter='data')
 for name,r in expected.items():verify(destination(name),r)
# No later archive may silently replace an already reconstructed image.
verify(image,m['firefoxImage'])
for row in m['bootAssets']+m.get('extraAssets',[]):verify(destination(row['restorePath']),row)
for row in m['repositoryFiles']:verify(destination('signed-repository/'+row['path']),row)
print('Verified exact runtime restored at',out)
'''
(pub/'restore-runtime.py').write_text(restore)
(pub/'README.md').write_text('# Exact runtime recovery\n\nDownload every artifact named in RUNTIME-MANIFEST.json plus restore-runtime.py into one fresh folder. Run Python3.12+ restore-runtime.py. It verifies every part, complete Firefox image, boot asset, declared accepted extra asset and signed repository member. The output is restored-runtime. Overlay its web directory onto the separately recovered source checkout, and serve the declared published latest-build route; do not substitute the legacy raw web/linux manifest. Configure the signed repository using the documented read-only repository service.\n\nRestore Git/history with the original80a52d1 encrypted base and the final cumulative increment, using the original private recipient key. Public runtime artifacts contain no signing key, preview grant, cookie or phone selector. Full Firefox source rebuild and project target acceptance remain limited as documented in the final report.\n')
(pub/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>LinuxOnWeb exact runtime recovery</title><h1>LinuxOnWeb exact runtime recovery</h1><p>Manifest-pinned published runtime and signed packages. Acceptance limitations are in the final report.</p><ul>'+''.join('<li><a href="'+p.name+'">'+p.name+'</a> ('+str(p.stat().st_size)+' bytes)</li>' for p in sorted(pub.iterdir()) if p.is_file())+'</ul>')
print(json.dumps({'pass':True,'runtimeVersion':manifest['version'],'sourceCommit':head,'files':len(list(pub.iterdir())),'bytes':sum(p.stat().st_size for p in pub.iterdir()),'output':str(pub),'privacy':audits}))
