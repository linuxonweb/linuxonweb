#!/usr/bin/env python3
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);B=pathlib.Path(os.environ['GLIBC_ARITY_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(B/'manifest.json')['sha256']=='e9002b3d9ef9d00a8df62566e2eabe05cb8f4c391b90343c90f3d75081167095'
assert digest(B/'acceptance.json')['sha256']=='5d7563000f7057f1e38636de9eacdd44867e3489f64f92ebc144eb01787f06f5'
m=json.loads((B/'manifest.json').read_text());a=json.loads((B/'acceptance.json').read_text());assert m['pass'] and a['pass'] and a['linkObjects']==238
for name,pin in m['files'].items():assert digest(pathlib.Path(name))==pin,name
O=T/'objects/guest';O.mkdir(parents=True,exist_ok=True);rows=[]
for row in a['objects']:
 p=pathlib.Path(row['path']);pin={k:row[k]for k in ['sha256','bytes']};assert digest(p)==pin
 q=O/p.name
 if not q.exists():shutil.copy2(p,q)
 assert digest(q)==pin;rows.append({'original':str(p),'copy':str(q),**pin,'format':row['format']})
assert len(rows)==238 and len({r['copy']for r in rows})==238
for name in ['worker.js','index.html','startup.c']:
 p=B/'source'/name;assert digest(p)==m['files'][str(p.resolve())];q=T/'source'/name
 if q.exists() and digest(q)!=digest(p):
  snapshot=T/'source-snapshots'/('replayed-before-arity-'+name);assert not snapshot.exists();snapshot.write_bytes(q.read_bytes())
 shutil.copy2(p,q);assert digest(q)==digest(p)
(T/'logs/base-inputs.json').write_text(json.dumps({'pass':True,'manifestSha256':digest(B/'manifest.json')['sha256'],'acceptanceSha256':digest(B/'acceptance.json')['sha256'],'verifiedManifestFiles':len(m['files']),'objects':rows,'baseManifest':str(B/'manifest.json'),'baseAcceptance':str(B/'acceptance.json'),'retainedAcceptance':a},indent=2)+'\n')
print('Frozen arity238 manifest and objects PASS')
