#!/usr/bin/env python3
"""Write honest content identities for the production footer; never invent server start/build dates."""
import argparse,datetime,hashlib,json,pathlib,re,subprocess,tarfile
q=argparse.ArgumentParser();q.add_argument('--repository',type=pathlib.Path,required=True);a=q.parse_args()
root=pathlib.Path.cwd();index=root/'web/linux/index.html';original=index.read_text()
meta=re.compile(r'\s*<meta\s+name=["\']webapp-revision["\']\s+content=["\'][^"\']*["\']\s*/?>',re.I)
clean=meta.sub('',original)
files=subprocess.check_output(['git','ls-files','-z','web/linux'],text=True).split('\0')
h=hashlib.sha256();count=0
for name in sorted(x for x in files if x and x!='web/linux/server-build.json'):
 p=root/name
 if p.is_symlink() or not p.is_file():continue
 data=clean.encode() if p==index else p.read_bytes();h.update(name.encode()+b'\0'+hashlib.sha256(data).digest());count+=1
revision=h.hexdigest();server=hashlib.sha256((root/'web/desktop/serve.mjs').read_bytes()).hexdigest()
packages=[]
with tarfile.open(a.repository/'wasm32/APKINDEX.tar.gz','r:gz') as t:
 members=[m for m in t if m.name=='APKINDEX' and m.isfile()]
 if len(members)!=1:raise ValueError('Expected one APKINDEX member')
 for block in t.extractfile(members[0]).read().decode().strip().split('\n\n'):
  fields=dict(line.split(':',1) for line in block.splitlines() if ':' in line)
  if not fields.get('P') or not fields.get('V'):raise ValueError('Malformed APKINDEX package identity')
  packages.append({'name':fields['P'],'version':fields['V'],'buildDate':None})
manifest=json.loads((root/'web/desktop/latest-build/boot-manifest.json').read_text())
value={'schema':1,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'identityMethod':'SHA256 of sorted tracked regular web/linux file names and content digests; excludes metadata file and normalizes its own revision meta tag. Not a Git commit or server start timestamp.','webapp':{'version':revision,'buildDate':None,'trackedFileCount':count},'server':{'version':server,'buildDate':None,'started':None},'runtime':{'version':manifest['version'],'firefoxSha256':manifest['assets']['firefox']['sha256']},'packages':sorted(packages,key=lambda x:(x['name'],x['version']))}
updated=clean.replace('<head>','<head>\n<meta name="webapp-revision" content="'+revision+'">',1)
if updated==clean:raise ValueError('Expected unique head insertion anchor')
if updated.count('name="webapp-revision"')!=1:raise ValueError('Revision metadata is not unique')
index.write_text(updated);(root/'web/linux/server-build.json').write_text(json.dumps(value,indent=2)+'\n')
print(json.dumps({'pass':True,'revision':revision,'runtimeVersion':manifest['version'],'packages':len(packages),'serverStarted':None}))
