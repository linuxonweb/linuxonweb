#!/usr/bin/env python3
"""Freeze only the owned packet after root has authorized final review."""
import pathlib,os,json,hashlib,shutil,subprocess
assert os.environ.get('GLIBC_SCHED_SEM_FREEZE_AUTHORIZED')=='1','Root review/authorization required for this assigned packet'
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2];F=pathlib.Path(os.environ['GLIBC_NEXT26_PACKET']).resolve()
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert not (T/'manifest.json').exists() and not(T/'acceptance.json').exists()
a=json.loads((T/'prepared-acceptance.json').read_text());assert a['pass'];files={}
def pin(p):
 p=pathlib.Path(p).resolve();assert p.is_file();files[str(p)]=digest(p)
for row in a['objects']:
 p=pathlib.Path(row['path']);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};pin(p)
for name,d in a['headers'].items():assert digest(pathlib.Path(name))==d;pin(name)
for row in a['GNUUnits']:
 p=pathlib.Path(row['source']);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};pin(p)
for row in json.loads((T/'logs/inherited-source-verification.json').read_text())['rows']:
 p=pathlib.Path(row['path']);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};pin(p)
for row in json.loads((T/'logs/reuse-next26-runtime.json').read_text())['rows']:
 for key in ['path','snapshot']:
  p=pathlib.Path(row[key]);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};pin(p)
for row in json.loads((T/'logs/reuse-compiler.json').read_text())['rows']:
 p=pathlib.Path(row['input']);assert digest(p)==row['verified'];pin(p)
for name in ['manifest.json','acceptance.json','logs/final-runtime-inputs.json']:pin(F/name)
for row in json.loads((T/'logs/selected-sched-sem-syscalls.json').read_text())['wrappers']:
 assert pathlib.Path(row['stream']).read_bytes()==pathlib.Path(row['historicalSourceSnapshot']).read_bytes();pin(row['historicalSourceSnapshot'])
for mode in ['native','fpcast']:
 b=json.loads((T/(mode+'-run1')/'result.json').read_text());assert b['pass']and b['serverClosed']and b['browserExit']['code']==0;assert not pathlib.Path('/proc/'+str(b['browserPid'])).exists()
for p in (T/'logs/supervision').glob('*.json'):assert not json.loads(p.read_text())['terminalMembers']
# Preserve final runtime snapshots for future bounded independent packets.
D=T/'source-snapshots/final-runtime';D.mkdir();inputs={}
for p in [*[pathlib.Path(r['path'])for r in a['objects']],T/'source/startup.c',R/'fixture.c',R/'signatures.c',R/'types.json',T/'objects/sched-sem.wasm',T/'objects/sched-sem-initial-fpcast.wasm']:
 q=D/(str(len(inputs))+'-'+p.name);shutil.copy2(p,q);assert digest(q)==digest(p);row={**digest(p),'snapshot':str(q)}
 if any(r['path']==str(p)for r in a['objects']):row['format']=next(r['format']for r in a['objects']if r['path']==str(p))
 inputs[str(p)] = row
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':201,'formats':a['formats'],'inputs':inputs},indent=2)+'\n')
a['phase']='frozen after root review';a['rootFreezeAuthorization']=True;(T/'acceptance.json').write_text(json.dumps(a,indent=2)+'\n')
repoFiles=[p for p in R.rglob('*')if p.is_file()]+[repo/'docs/glibc-sched-sem-20261002.md'];(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p)for p in repoFiles},indent=2)+'\n')
for p in repoFiles:pin(p)
for p in T.rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(T);parts=rel.parts
 if parts[0]in ['tmp','cache']or any(x in ['profile','cache','xdg']for x in parts):continue
 pin(p)
manifest={'scope':'owned GNU scheduler/nonblocking semaphore packet; full sources, executed input versions and immutable predecessor provenance','files':dict(sorted(files.items())),'excluded':['owned temporary/compiler cache/browser profiles and caches','manifest self'],'repository':str(repo),'task':str(T),'pass':True}
(T/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name,row in files.items():assert digest(pathlib.Path(name))==row
(T/'manifest-verification.json').write_text(json.dumps({'pass':True,'files':len(files),'manifest':digest(T/'manifest.json')},indent=2)+'\n');print(json.dumps({'pass':True,'files':len(files),'manifest':digest(T/'manifest.json'),'acceptance':digest(T/'acceptance.json')}))
