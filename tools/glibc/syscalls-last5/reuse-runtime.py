#!/usr/bin/env python3
"""Verify immutable selected runtime inputs before copying the 232-object gate."""
import hashlib,json,os,pathlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);B=pathlib.Path(os.environ['GLIBC_CHECKED_RUNTIME_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(B/'manifest.json')['sha256']=='12fbdae877de5e2f639df6152106c00c08536a0b2046dbc8d29edf50ab331c0d'
m=json.loads((B/'manifest.json').read_text())['files']
assert digest(B/'acceptance.json')==m[str(B/'acceptance.json')]
a=json.loads((B/'acceptance.json').read_text());assert a['pass'] and a['linkObjects']==232
p=B/'logs/final-runtime-inputs.json';assert digest(p)==m[str(p)]
f=json.loads(p.read_text());assert f['linkObjects']==232
rows=[]
for name,h in f['inputs'].items():
 p=pathlib.Path(name);q=pathlib.Path(h['snapshot']);d={k:h[k] for k in ['sha256','bytes']}
 assert digest(p)==digest(q)==d==m[str(p.resolve())]==m[str(q.resolve())]
 rows.append({'source':str(p),'snapshot':str(q),'verified':d})
O=T/'objects/guest';O.mkdir(exist_ok=True);copies=[]
for row in a['objects']:
 p=pathlib.Path(row['path']);d={k:row[k] for k in ['sha256','bytes']};assert digest(p)==d==m[str(p.resolve())]
 q=O/p.name
 if q.exists():assert digest(q)==d
 else:shutil.copy2(p,q)
 assert digest(q)==d
 magic=q.read_bytes()[:8]
 assert magic==b'\0asm\1\0\0\0' or magic[:4]==b'BC\xc0\xde'
 copies.append({'original':str(p),'copy':str(q),'format':row['format'],**d})
assert len(copies)==232 and len({r['copy'] for r in copies})==232
for name in ['startup.c','worker.js','index.html']:
 p=B/'source'/name;assert digest(p)==m[str(p.resolve())];q=T/'source'/name
 if q.exists() and q.read_bytes()!=p.read_bytes():
  old=T/'source-snapshots'/('pre-reuse-'+digest(q)['sha256']+'-'+name)
  if old.exists():assert old.read_bytes()==q.read_bytes()
  else:shutil.copy2(q,old)
 shutil.copy2(p,q)
 rows.append({'source':str(p),'snapshot':str(q),'verified':digest(p)})
(T/'logs/reuse-runtime.json').write_text(json.dumps({'pass':True,'manifest':str(B/'manifest.json'),'manifestHash':digest(B/'manifest.json'),'inputs':rows,'objects':copies},indent=2)+'\n')
print('Immutable232-object runtime and all original/snapshot pairs PASS')
