#!/usr/bin/env python3
"""Freeze this owned packet only after root review and external terminal proof."""
import pathlib,os,json,hashlib,shutil
assert os.environ.get('GLIBC_MEMORY_RUNTIME_FREEZE_AUTHORIZED')=='1','Root review required'
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
def digest(p):
 p=pathlib.Path(p);return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert not(T/'manifest.json').exists()and not(T/'repository-freeze.json').exists()
a=json.loads((T/'acceptance.json').read_text());assert a['pass']and a['linkObjects']==246 and a['unchangedBaseObjects']==236
assert json.loads((T/'external-terminal-proof.json').read_text())['pass'];files={}
def pin(p):
 p=pathlib.Path(p).resolve();assert p.is_file();files[str(p)]=digest(p)
for row in a['objects']:assert digest(row['path'])=={k:row[k]for k in ['sha256','bytes']};pin(row['path'])
proofSelections=[]
for variable,expected in [('GLIBC_ARITY_PACKET','e9002b3d9ef9d00a8df62566e2eabe05cb8f4c391b90343c90f3d75081167095'),('GLIBC_MEMORY_MAKE_PACKET','cb26cde7b2306b44409d43e4568fe380be897e02c35de252755bc12edb70dd86')]:
 P=pathlib.Path(os.environ[variable]);assert digest(P/'manifest.json')['sha256']==expected
 manifest=json.loads((P/'manifest.json').read_text());assert manifest['pass']
 for name,row in manifest['files'].items():assert digest(name)==row;pin(name)
 acceptance=P/'acceptance.json';assert digest(acceptance)==manifest['files'][str(acceptance)] and json.loads(acceptance.read_text())['pass'];pin(acceptance);pin(P/'manifest.json')
 selection={'packet':str(P),'manifest':digest(P/'manifest.json'),'manifestFilesRehashed':len(manifest['files']),'acceptance':digest(acceptance),'source':'full frozen manifest and every pinned file plus manifest-pinned passing acceptance'}
 if variable=='GLIBC_ARITY_PACKET':
  pin(P/'manifest-verification.json');selection['additionalActualProof']=str(P/'manifest-verification.json')
 else:
  assert not(P/'manifest-verification.json').exists();selection['additionalActualProof']=None;selection['absentArtifactNotClaimed']='memory-make did not produce manifest-verification.json'
 proofSelections.append(selection)
for name,row in a['inputs'].items():assert digest(name)=={k:row[k]for k in ['sha256','bytes']};pin(name)
(T/'logs/freeze-predecessor-proof-selection.json').write_text(json.dumps(proofSelections,indent=2)+'\n')
D=T/'source-snapshots/final-runtime';D.mkdir();inputs={}
for p in [*[pathlib.Path(r['path'])for r in a['objects']],T/'source/startup.c',T/'source/worker.js',T/'source/index.html',T/'objects/memory-v4.wasm',T/'objects/memory-v4-fpcast.wasm']:
 q=D/(str(len(inputs))+'-'+p.name);shutil.copy2(p,q);assert digest(q)==digest(p);row={**digest(p),'snapshot':str(q)}
 if any(r['path']==str(p)for r in a['objects']):row['format']=next(r['format']for r in a['objects']if r['path']==str(p))
 inputs[str(p)]=row
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':246,'formats':a['formats'],'inputs':inputs},indent=2)+'\n')
shutil.copy2(T/'acceptance.json',T/'prepared-acceptance.json');a['phase']='frozen after root review';a['rootFreezeAuthorization']=True;(T/'acceptance.json').write_text(json.dumps(a,indent=2)+'\n')
repoFiles=sorted(p for p in R.rglob('*')if p.is_file())+[repo/'docs/glibc-memory-runtime-20261002.md'];assert len(repoFiles)==25,len(repoFiles)
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p)for p in repoFiles},indent=2)+'\n')
for p in repoFiles:pin(p)
for p in T.rglob('*'):
 if not p.is_file():continue
 parts=p.relative_to(T).parts
 if parts[0]in ['tmp','cache']or any(x in ['profile','cache','xdg']for x in parts):continue
 pin(p)
m={'pass':True,'scope':'eight genuine GNUmake memory providers replacing one authority, two explicit provider derivatives and coherent arity238 runtime regressions','files':dict(sorted(files.items())),'repository':str(repo),'task':str(T),'excluded':['tmp/cache/browser profiles','manifest self']};(T/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
for name,row in files.items():assert digest(name)==row
(T/'manifest-verification.json').write_text(json.dumps({'pass':True,'files':len(files),'manifest':digest(T/'manifest.json')},indent=2)+'\n');print(json.dumps({'pass':True,'repositoryPaths':len(repoFiles),'files':len(files),'manifest':digest(T/'manifest.json'),'acceptance':digest(T/'acceptance.json'),'repositoryFreeze':digest(T/'repository-freeze.json'),'freezer':digest(pathlib.Path(__file__))}))
