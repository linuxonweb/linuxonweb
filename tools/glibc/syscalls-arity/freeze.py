#!/usr/bin/env python3
"""Freeze this owned packet only after root review and external terminal proof."""
import pathlib,os,json,hashlib,shutil
assert os.environ.get('GLIBC_ARITY_FREEZE_AUTHORIZED')=='1','Root review required'
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
def digest(p):
 p=pathlib.Path(p);return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert not(T/'manifest.json').exists()and not(T/'acceptance.json').exists()
a=json.loads((T/'prepared-acceptance.json').read_text());assert a['pass']and a['linkObjects']==238 and a['unchangedBaseObjects']==231
assert json.loads((T/'external-terminal-proof.json').read_text())['pass'];files={}
def pin(p):
 p=pathlib.Path(p).resolve();assert p.is_file();files[str(p)]=digest(p)
for row in a['objects']:assert digest(row['path'])=={k:row[k]for k in ['sha256','bytes']};pin(row['path'])
P=pathlib.Path(os.environ['GLIBC_CHECKED_JUMP_RUNTIME_PACKET']);assert digest(P/'manifest.json')['sha256']=='12fbdae877de5e2f639df6152106c00c08536a0b2046dbc8d29edf50ab331c0d'
for name,row in json.loads((P/'manifest.json').read_text())['files'].items():assert digest(name)==row;pin(name)
pin(P/'manifest.json');pin(P/'manifest-verification.json')
for name,row in a['inputs'].items():assert digest(name)=={k:row[k]for k in ['sha256','bytes']}==digest(row['snapshot']);pin(name);pin(row['snapshot'])
D=T/'source-snapshots/final-runtime';D.mkdir();inputs={}
for p in [*[pathlib.Path(r['path'])for r in a['objects']],T/'source/startup.c',T/'source/worker.js',T/'source/index.html',T/'objects/arity-v3.wasm',T/'objects/arity-v3-fpcast.wasm']:
 q=D/(str(len(inputs))+'-'+p.name);shutil.copy2(p,q);assert digest(q)==digest(p);row={**digest(p),'snapshot':str(q)}
 if any(r['path']==str(p)for r in a['objects']):row['format']=next(r['format']for r in a['objects']if r['path']==str(p))
 inputs[str(p)]=row
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':238,'formats':a['formats'],'inputs':inputs},indent=2)+'\n')
a['phase']='frozen after root review';a['rootFreezeAuthorization']=True;(T/'acceptance.json').write_text(json.dumps(a,indent=2)+'\n')
repoFiles=sorted(p for p in R.rglob('*')if p.is_file())+[repo/'docs/glibc-syscalls-arity-20261002.md'];assert len(repoFiles)==34,len(repoFiles)
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p)for p in repoFiles},indent=2)+'\n')
for p in repoFiles:pin(p)
for p in T.rglob('*'):
 if not p.is_file():continue
 parts=p.relative_to(T).parts
 if parts[0]in ['tmp','cache']or any(x in ['profile','cache','xdg']for x in parts):continue
 pin(p)
m={'pass':True,'scope':'five GNUmake-selected owned wasm32 architecture syscall arity implementations, bounded prctl and complete checked232 runtime regression','files':dict(sorted(files.items())),'repository':str(repo),'task':str(T),'excluded':['tmp/cache/browser profiles','manifest self']};(T/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
for name,row in files.items():assert digest(name)==row
(T/'manifest-verification.json').write_text(json.dumps({'pass':True,'files':len(files),'manifest':digest(T/'manifest.json')},indent=2)+'\n');print(json.dumps({'pass':True,'repositoryPaths':len(repoFiles),'files':len(files),'manifest':digest(T/'manifest.json'),'acceptance':digest(T/'acceptance.json'),'freezer':digest(pathlib.Path(__file__))}))
