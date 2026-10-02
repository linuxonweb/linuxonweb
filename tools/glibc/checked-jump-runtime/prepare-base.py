#!/usr/bin/env python3
"""Verify immutable final16 originals/snapshots before bounded runtime copying."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);B=pathlib.Path(os.environ['GLIBC_FINAL16_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(B/'manifest.json')['sha256']=='888d4947e801e9c3ecc5c58c194751964be069c8ed993284c846da4c4c105266'
assert digest(B/'acceptance.json')['sha256']=='3b1c085163fc39d250bbe7b8176b8bf989397c26e7899b3a8eb4a1e0b1d6985d'
m=json.loads((B/'manifest.json').read_text());a=json.loads((B/'acceptance.json').read_text());assert m['pass']and a['pass']and a['phase']=='frozen after root review'and a['linkObjects']==231
for name,row in m['files'].items():assert digest(pathlib.Path(name))==row,name
f=json.loads((B/'logs/final-runtime-inputs.json').read_text());assert f['linkObjects']==231
for name,row in f['inputs'].items():
 d={k:row[k]for k in ['sha256','bytes']};assert digest(pathlib.Path(name))==d==digest(pathlib.Path(row['snapshot'])),name
O=T/'objects/base';O.mkdir(parents=True);(T/'source').mkdir(exist_ok=True);rows=[]
for row in a['objects']:
 p=pathlib.Path(row['path']);q=O/p.name;shutil.copy2(p,q);assert digest(q)=={k:row[k]for k in ['sha256','bytes']};rows.append({'original':str(p),'copy':str(q),**digest(q),'format':row['format']})
assert len(rows)==231 and len({r['copy']for r in rows})==231
for name in ['worker.js','index.html','startup.c']:
 p=B/'source'/name;assert digest(p)==m['files'][str(p.resolve())];q=T/'source'/name;shutil.copy2(p,q);assert digest(q)==digest(p)
(T/'logs/base-inputs.json').write_text(json.dumps({'pass':True,'manifestSha256':digest(B/'manifest.json')['sha256'],'acceptanceSha256':digest(B/'acceptance.json')['sha256'],'verifiedManifestFiles':len(m['files']),'objects':rows,'originalAndSnapshotInputs':f,'baseManifest':str(B/'manifest.json'),'baseAcceptance':str(B/'acceptance.json')},indent=2)+'\n')
print('Frozen final16 base, originals/snapshots and231 objects PASS')
