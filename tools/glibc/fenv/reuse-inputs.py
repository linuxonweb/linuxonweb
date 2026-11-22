#!/usr/bin/env python3
"""Verify and reuse accepted compiler/runtime bytes without predecessor mutation."""
import os,pathlib,json,hashlib,shutil,sys
T=pathlib.Path(os.environ['GLIBC_TASK']);P=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET'])
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
assert digest(P/'manifest.json')['sha256']=='15bcb2d693cb08ced4f962c197a934232c7ff6d29b8c4806459f0a51f5db8e17'
manifest=json.loads((P/'manifest.json').read_text())['files'];report=[]
def verify(p):
 p=pathlib.Path(p);d=digest(p);assert d==manifest[str(p.resolve())]
 report.append({'input':str(p),'verified':d});return d
if sys.argv[1]=='compiler':
 j=json.loads((P/'logs/compiler/result.json').read_text());verify(P/'logs/compiler/result.json')
 for p in j['linkArchives']:verify(p)
 for name in ['compiler/clang','lower','warnings']:
  p=P/'objects'/name;verify(p);q=T/'objects'/name;q.parent.mkdir(exist_ok=True);q.symlink_to(p)
else:
 assert sys.argv[1]=='runtime'
 j=json.loads((P/'logs/runtime-inputs.json').read_text());verify(P/'logs/runtime-inputs.json')
 objects=0
 for name,row in j['inputs'].items():
  p=pathlib.Path(name);d=verify(p);assert d['sha256']==row['sha256'] and d['bytes']==row['bytes'];assert digest(pathlib.Path(row['snapshot']))==d
  if row.get('format') in ['Wasm-v1','LLVM-bitcode']:
   q=T/'objects/guest'/p.name;q.parent.mkdir(exist_ok=True);shutil.copy2(p,q);assert digest(q)==d;objects+=1
  elif p==P/'source/startup.c':
   q=T/'source/startup.c';shutil.copy2(p,q);assert digest(q)==d
 assert objects==120
(T/'logs'/('reuse-'+sys.argv[1]+'.json')).write_text(json.dumps({'pass':True,'originalManifest':str(P/'manifest.json'),'rows':report},indent=2)+'\n')
