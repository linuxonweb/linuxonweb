#!/usr/bin/env python3
"""Verify immutable final16 originals/snapshots before bounded runtime copying."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);B=pathlib.Path(os.environ['GLIBC_CHECKED_JUMP_RUNTIME_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(B/'manifest.json')['sha256']=='12fbdae877de5e2f639df6152106c00c08536a0b2046dbc8d29edf50ab331c0d'
assert digest(B/'acceptance.json')['sha256']=='86596253adf090b7dcd7badca630914cf5a56da53397d07cf793a6c9b48882d6'
m=json.loads((B/'manifest.json').read_text());a=json.loads((B/'acceptance.json').read_text());assert m['pass']and a['pass']and a['phase']=='frozen after root review'and a['linkObjects']==232
for name,row in m['files'].items():assert digest(pathlib.Path(name))==row,name
f=a['baseInputs']['originalAndSnapshotInputs']
for name,row in f['inputs'].items():
 d={k:row[k]for k in ['sha256','bytes']};assert digest(pathlib.Path(name))==d==digest(pathlib.Path(row['snapshot'])),name
O=T/'objects/guest';O.mkdir(parents=True);(T/'source').mkdir(exist_ok=True);rows=[]
for row in a['objects']:
 p=pathlib.Path(row['path']);q=O/p.name;shutil.copy2(p,q);assert digest(q)=={k:row[k]for k in ['sha256','bytes']};rows.append({'original':str(p),'copy':str(q),**digest(q),'format':row['format']})
assert len(rows)==232 and len({r['copy']for r in rows})==232
for name in ['worker.js','index.html','startup.c']:
 p=B/'source'/name;assert digest(p)==m['files'][str(p.resolve())];q=T/'source'/name;shutil.copy2(p,q);assert digest(q)==digest(p)
(T/'logs/base-inputs.json').write_text(json.dumps({'pass':True,'manifestSha256':digest(B/'manifest.json')['sha256'],'acceptanceSha256':digest(B/'acceptance.json')['sha256'],'verifiedManifestFiles':len(m['files']),'objects':rows,'originalAndSnapshotInputs':f,'baseManifest':str(B/'manifest.json'),'baseAcceptance':str(B/'acceptance.json')},indent=2)+'\n')
print('Frozen final16 base, originals/snapshots and232 objects PASS')
