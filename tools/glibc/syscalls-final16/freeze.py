#!/usr/bin/env python3
"""Freeze only owned final16 packet after root review authorizes it."""
import pathlib,os,json,hashlib,shutil
assert os.environ.get('GLIBC_FINAL16_FREEZE_AUTHORIZED')=='1','Root authorization required'
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert not (T/'manifest.json').exists() and not(T/'acceptance.json').exists()
a=json.loads((T/'prepared-acceptance.json').read_text());assert a['pass'];terminal=json.loads((T/'external-terminal-proof.json').read_text());assert terminal['pass'];files={}
def pin(p):
 p=pathlib.Path(p).resolve();assert p.is_file();files[str(p)]=digest(p)
for row in a['objects']:
 p=pathlib.Path(row['path']);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};pin(p)
for name,d in a['headers'].items():assert digest(pathlib.Path(name))==d;pin(name)
for row in a['reuse']['rows']:
 for key in ['path','snapshot']:
  p=pathlib.Path(row[key]);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};pin(p)
for predecessor in ['GLIBC_STAT_RUNTIME_PACKET','GLIBC_SCHED_PACKET']:
 F=pathlib.Path(os.environ[predecessor]);m=json.loads((F/'manifest.json').read_text())
 for name,row in m['files'].items():
  assert digest(pathlib.Path(name))==row;pin(name)
 pin(F/'manifest.json')
for row in json.loads((T/'logs/selected-final16-syscalls.json').read_text())['wrappers']:
 assert pathlib.Path(row['stream']).read_bytes()==pathlib.Path(row['historicalSourceSnapshot']).read_bytes();pin(row['historicalSourceSnapshot'])
D=T/'source-snapshots/final-runtime';D.mkdir();inputs={}
for p in [*[pathlib.Path(r['path'])for r in a['objects']],T/'source/startup.c',R/'fixture.c',R/'signatures.c',R/'types.json',T/'objects/final16-run2.wasm',T/'objects/final16-run2-fpcast.wasm']:
 q=D/(str(len(inputs))+'-'+p.name);shutil.copy2(p,q);assert digest(q)==digest(p);row={**digest(p),'snapshot':str(q)}
 if any(r['path']==str(p)for r in a['objects']):row['format']=next(r['format']for r in a['objects']if r['path']==str(p))
 inputs[str(p)]=row
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':231,'formats':a['formats'],'inputs':inputs},indent=2)+'\n')
a['phase']='frozen after root review';a['rootFreezeAuthorization']=True;(T/'acceptance.json').write_text(json.dumps(a,indent=2)+'\n')
repoFiles=[p for p in R.rglob('*')if p.is_file()]+[repo/'docs/glibc-syscalls-final16-20261002.md'];assert len(repoFiles)==36,len(repoFiles)
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p)for p in repoFiles},indent=2)+'\n')
for p in repoFiles:pin(p)
for p in T.rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(T);parts=rel.parts
 if parts[0]in ['tmp','cache']or any(x in ['profile','cache','xdg']for x in parts):continue
 pin(p)
manifest={'scope':'owned GNU16 exact generated syscall wrappers; coherent stat+scheduler runtime, full sources and executed input versions','files':dict(sorted(files.items())),'excluded':['owned temporary/compiler cache/browser profiles and caches','manifest self'],'repository':str(repo),'task':str(T),'pass':True}
(T/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name,row in files.items():assert digest(pathlib.Path(name))==row
(T/'manifest-verification.json').write_text(json.dumps({'pass':True,'files':len(files),'manifest':digest(T/'manifest.json')},indent=2)+'\n');print(json.dumps({'pass':True,'repositoryPaths':len(repoFiles),'files':len(files),'manifest':digest(T/'manifest.json'),'acceptance':digest(T/'acceptance.json'),'freezer':digest(pathlib.Path(__file__))}))
