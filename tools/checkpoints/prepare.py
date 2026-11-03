#!/usr/bin/env python3
"""Prepare a reviewed source export and encrypted, restorable Git/image checkpoint."""
import argparse,datetime,gzip,hashlib,io,json,os,pathlib,re,shutil,subprocess,tarfile
PREFIX='linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103'
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def run(cmd,**kw):
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,**kw)
 if r.returncode:raise RuntimeError(str(cmd[0])+' failed: '+r.stdout.decode(errors='replace')[-1200:])
 return r.stdout
q=argparse.ArgumentParser();q.add_argument('--out',type=pathlib.Path,required=True);q.add_argument('--source-commit',required=True);q.add_argument('--source-only',action='store_true');q.add_argument('--recipient',type=pathlib.Path);q.add_argument('--distribution',type=pathlib.Path);a=q.parse_args();repo=pathlib.Path.cwd();a.out.mkdir(parents=True,exist_ok=False);out=a.out.resolve();out.chmod(0o700);work=out/'private-work';work.mkdir(mode=0o700);pub=out/'publish';pub.mkdir();source_commit=run(['git','rev-parse',a.source_commit]).decode().strip();head=run(['git','rev-parse','HEAD']).decode().strip();started=datetime.datetime.now(datetime.timezone.utc).isoformat();print(json.dumps({'phase':'start','sourceCommit':source_commit,'capturedHead':head}),flush=True)
# Export only reviewed source text and project art, never runtime profiles, credentials or generated binaries.
allowed={'.js','.mjs','.cjs','.ts','.tsx','.jsx','.css','.html','.md','.txt','.json','.jsonc','.yaml','.yml','.toml','.lock','.rs','.c','.h','.cpp','.hpp','.py','.sh','.nix','.patch','.diff','.svg','.png','.jpg','.jpeg','.webp','.ico','.gitignore','.gitattributes','.editorconfig'}
plain_names={'Makefile','Dockerfile','LICENSE','COPYING','NOTICE','AUTHORS','flake.lock','Cargo.lock'}
rows=run(['git','ls-tree','-rz','-l',source_commit]).split(b'\0');selected=[];omitted=[]
for row in rows:
 if not row:continue
 meta,name=row.split(b'\t',1);mode,kind,oid,size=meta.split();name=os.fsdecode(name);path=pathlib.PurePosixPath(name);reason=None
 if kind!=b'blob':reason='non-blob'
 elif mode==b'120000':reason='symlink excluded from public export'
 elif any(x in ('out','node_modules','.git','private','profile','profiles','evidence','latest-build') for x in path.parts):reason='generated, private, runtime or browser evidence directory'
 elif path.name.startswith('.env') or re.search(r'(?:id_rsa|id_ed25519|private[-_]?key|credential|cookie)',path.name,re.I):reason='potential private material'
 elif path.suffix.lower() not in allowed and path.name not in plain_names:reason='binary or non-source extension'
 elif int(size)>6000000:reason='large generated artifact'
 if reason:omitted.append({'path':name,'reason':reason});continue
 selected.append((name,mode,oid.decode(),int(size)))
export=work/'source';export.mkdir();cat=subprocess.Popen(['git','cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE);files=[]
for name,mode,oid,size in selected:
 cat.stdin.write((oid+'\n').encode());cat.stdin.flush();header=cat.stdout.readline().split();actual=int(header[-1]);data=cat.stdout.read(actual);assert cat.stdout.read(1)==b'\n' and actual==size
 if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{80,}-----END',data) or re.search(rb'(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{20,}',data):raise RuntimeError('secret-shaped content needs review: '+name)
 p=export/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o755 if mode==b'100755' else 0o644);files.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':size})
cat.stdin.close();assert cat.wait()==0
source_manifest={'originalCommit':source_commit,'exportIsFiltered':True,'files':files,'omitted':omitted,'history':'Full original history is preserved separately in encrypted checkpoint. This export has a clean one-commit Git repository.'};(export/'SOURCE_CHECKPOINT.json').write_text(json.dumps(source_manifest,indent=2)+'\n')
template=work/'empty-git-template';template.mkdir();run(['git','init','--quiet','--template='+str(template),'--initial-branch=source-snapshot',str(export)]);run(['git','-C',str(export),'config','gc.auto','0']);run(['git','-C',str(export),'config','maintenance.auto','false']);run(['git','-C',str(export),'config','gc.autoDetach','false']);run(['git','-C',str(export),'add','--all']);stamp=run(['git','show','-s','--format=%cI',source_commit]).decode().strip();env={**os.environ,'GIT_AUTHOR_DATE':stamp,'GIT_COMMITTER_DATE':stamp};run(['git','-C',str(export),'-c','user.name=GPT-6 Astra Pro builtin agents','-c','user.email=checkpoint@linuxonweb.invalid','commit','--quiet','-m','Reviewed source export of '+source_commit],env=env);snapshot_commit=run(['git','-C',str(export),'rev-parse','HEAD']).decode().strip()
source_tar=pub/(PREFIX+'_src.tar.gz')
with source_tar.open('wb') as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz,tarfile.open(fileobj=gz,mode='w|',format=tarfile.PAX_FORMAT) as tar:
 for p in sorted(export.rglob('*')):
  if not p.is_file():continue
  info=tar.gettarinfo(str(p),arcname=PREFIX+'/'+p.relative_to(export).as_posix());info.uid=info.gid=0;info.uname=info.gname='root';info.mtime=0
  with p.open('rb') as f:tar.addfile(info,f)
print(json.dumps({'phase':'source-ready','files':len(files),'bytes':source_tar.stat().st_size,'snapshotCommit':snapshot_commit}),flush=True)
if a.source_only:
 (pub/'SOURCE-MANIFEST.json').write_text(json.dumps({'sourceCommit':source_commit,'publicSnapshotCommit':snapshot_commit,'files':len(files),'archive':source_tar.name,'bytes':source_tar.stat().st_size,'sha256':digest(source_tar),'filtered':True},indent=2)+'\n');raise SystemExit(0)
if a.recipient is None or a.distribution is None:raise SystemExit('encrypted backup requires --recipient and --distribution')
bundle=work/(PREFIX+'.bundle');run(['git','-c','pack.threads=1','bundle','create',str(bundle),'--all']);run(['git','bundle','verify',str(bundle)]);restore=work/'restore-check.git';run(['git','-c','index.threads=1','clone','--bare','--quiet',str(bundle),str(restore)]);run(['git','-C',str(restore),'fsck','--full','--strict']);assert run(['git','-C',str(restore),'cat-file','-t',source_commit]).strip()==b'commit';print(json.dumps({'phase':'git-restore-verified','bytes':bundle.stat().st_size}),flush=True)
distribution=a.distribution.resolve();distribution_sha=digest(distribution)
if distribution_sha!='60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa':raise RuntimeError('distribution changed; review new provenance before backup')
manifest={'formatVersion':1,'createdAt':started,'name':PREFIX,'sourceCommit':source_commit,'capturedHead':head,'publicSourceSnapshotCommit':snapshot_commit,'sourceArchive':{'name':source_tar.name,'bytes':source_tar.stat().st_size,'sha256':digest(source_tar)},'gitBundle':{'name':bundle.name,'bytes':bundle.stat().st_size,'sha256':digest(bundle),'bundleVerify':True,'bareCloneFsck':True},'distribution':{'name':'initramfs-firefox-60847fb85339.cpio.gz','bytes':distribution.stat().st_size,'sha256':distribution_sha,'runtimeAccepted':False,'privacyReview':'/home contains only empty directories; bundled NSS seed nssPrivate row count 0, reviewed by startup_io 2026-11-03'},'encryption':{'format':'OpenSSL CMS AuthenticatedEnvelopedData','cipher':'AES-256-GCM','recipient':'RSA-3072 public certificate; private key saved separately to user file','recipientCertificateSha256':digest(a.recipient),'smallStreamEncryptDecryptRoundtrip':True,'fullCiphertextDecryptVerified':False},'rebuildLimitations':['Current Firefox159 linker inputs and seven external static libraries on /mnt/p6 are unreadable under current permissions. Source/history plus shipped distribution are preserved; full Firefox rebuild is not claimed.'],'privateStateExcluded':['Untracked home/profile data','Preview session grants, owner keys and cookie key','APK repository signing private keys','FileHarbor transfer tokens'],'restoration':'Reassemble encrypted parts and verify SHA256; decrypt with the separately retained recovery PEM; extract tar, git clone bundle, then git fsck --full --strict.'}
(work/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n');plain=work/'checkpoint.tar'
with tarfile.open(plain,'w',format=tarfile.PAX_FORMAT) as tar:
 for p,name in [(bundle,bundle.name),(distribution,manifest['distribution']['name']),(work/'MANIFEST.json','MANIFEST.json')]:tar.add(p,arcname=name,recursive=False)
cipher=work/(PREFIX+'.tar.cms');run(['openssl','cms','-encrypt','-stream','-binary','-aes-256-gcm','-in',str(plain),'-outform','DER','-out',str(cipher),str(a.recipient.resolve())]);parts=[];full=hashlib.sha256()
with cipher.open('rb') as src:
 for index in range(100):
  data=src.read(96000000)
  if not data:break
  name=cipher.name+f'.part{index:03d}';(pub/name).write_bytes(data);full.update(data);parts.append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 else:raise RuntimeError('too many chunks')
manifest['ciphertext']={'name':cipher.name,'bytes':cipher.stat().st_size,'sha256':full.hexdigest(),'parts':parts};manifest['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(pub/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n');shutil.copyfile(a.recipient,pub/'recipient-public.crt')
(pub/'RESTORE.md').write_text('''# Linux on Web checkpoint\n\nThe public source export contains a filtered source tree and its own clean Git snapshot. Full original Git history and the current Firefox distribution are inside the encrypted checkpoint. The private recovery PEM is provided separately; never publish it.\n\n1. Download all files listed in `MANIFEST.json`.\n2. Run `python3 restore-checkpoint.py` to verify and join every ciphertext part.\n3. Decrypt with `openssl cms -decrypt -binary -inform DER -in '''+cipher.name+''' -recip recovery.pem -inkey recovery.pem -out checkpoint.tar`.\n4. Extract `checkpoint.tar`, then `git clone '''+bundle.name+''' linuxonweb` and `git -C linuxonweb fsck --full --strict`.\n\nThe original bundle was independently cloned and checked before encryption. Cloud transfer checks each SHA256. A tiny streamed CMS encryption/decryption test passed using this recipient. Full ciphertext decryption has not been performed across environments because the private key remains on the primary executor. No Firefox startup or hardware performance target is implied by this backup. External unreadable build dependencies are listed in the manifest.\n''')
(pub/'restore-checkpoint.py').write_text('''#!/usr/bin/env python3\nimport hashlib,json,pathlib\np=pathlib.Path(__file__).resolve().parent;m=json.loads((p/'MANIFEST.json').read_text());c=m['ciphertext'];h=hashlib.sha256()\nwith (p/c['name']).open('xb') as out:\n for part in c['parts']:\n  data=(p/part['name']).read_bytes();assert len(data)==part['bytes'] and hashlib.sha256(data).hexdigest()==part['sha256'],part['name'];out.write(data);h.update(data)\nassert h.hexdigest()==c['sha256'],'ciphertext SHA256 mismatch'\nprint('All ciphertext parts and complete SHA256 verified. Decrypt using your separately retained recovery PEM.')\n''')
print(json.dumps({'phase':'checkpoint-ready','publishDirectory':str(pub),'sourceBytes':source_tar.stat().st_size,'ciphertextBytes':cipher.stat().st_size,'parts':len(parts),'manifest':str(pub/'MANIFEST.json')}),flush=True)
