#!/usr/bin/env python3
import pathlib,os,json,hashlib,shutil
assert os.environ.get('GLIBC_CHECKED_JUMP_FREEZE_AUTHORIZED')=='1','Root review required'
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert not(T/'manifest.json').exists() and not(T/'acceptance.json').exists()
a=json.loads((T/'prepared-acceptance.json').read_text());assert a['pass'];assert json.loads((T/'external-terminal-proof.json').read_text())['pass'];files={}
def pin(p):
 p=pathlib.Path(p).resolve();assert p.is_file();files[str(p)]=digest(p)
for row in a['objects']:
 p=pathlib.Path(row['path']);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};pin(p)
for predecessor in ['GLIBC_FINAL16_PACKET','GLIBC_CHECKED_JUMP_PACKET']:
 P=pathlib.Path(os.environ[predecessor]);m=json.loads((P/'manifest.json').read_text())
 for name,row in m['files'].items():assert digest(pathlib.Path(name))==row;pin(name)
 pin(P/'manifest.json')
D=T/'source-snapshots/final-runtime';D.mkdir();inputs={}
for p in [*[pathlib.Path(r['path'])for r in a['objects']],T/'source/startup.c',T/'source/worker.js',T/'source/index.html',T/'objects/checked-jump.wasm',T/'objects/checked-jump-fpcast.wasm']:
 q=D/(str(len(inputs))+'-'+p.name);shutil.copy2(p,q);assert digest(q)==digest(p);row={**digest(p),'snapshot':str(q)}
 if any(r['path']==str(p)for r in a['objects']):row['format']=next(r['format']for r in a['objects']if r['path']==str(p))
 inputs[str(p)]=row
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':232,'formats':a['formats'],'inputs':inputs},indent=2)+'\n')
a['phase']='frozen after root review';a['rootFreezeAuthorization']=True;(T/'acceptance.json').write_text(json.dumps(a,indent=2)+'\n')
repoFiles=[p for p in R.rglob('*')if p.is_file()]+[repo/'docs/glibc-checked-jump-runtime-20261002.md'];assert len(repoFiles)==13,len(repoFiles)
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p)for p in repoFiles},indent=2)+'\n')
for p in repoFiles:pin(p)
for p in T.rglob('*'):
 if not p.is_file():continue
 parts=p.relative_to(T).parts
 if parts[0]in ['tmp','cache']or any(x in ['profile','cache','xdg']for x in parts):continue
 pin(p)
m={'pass':True,'scope':'bounded GNUmake-selected owned native checked-jump architecture providers with complete final16 regression runtime','files':dict(sorted(files.items())),'repository':str(repo),'task':str(T),'excluded':['tmp/cache/browser profiles','manifest self']};(T/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
for name,row in files.items():assert digest(pathlib.Path(name))==row
(T/'manifest-verification.json').write_text(json.dumps({'pass':True,'files':len(files),'manifest':digest(T/'manifest.json')},indent=2)+'\n');print(json.dumps({'pass':True,'repositoryPaths':len(repoFiles),'files':len(files),'manifest':digest(T/'manifest.json'),'acceptance':digest(T/'acceptance.json'),'freezer':digest(pathlib.Path(__file__))}))
