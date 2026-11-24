#!/usr/bin/env python3
"""Reuse the accepted 53-wrapper runtime with exact original/snapshot checks."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);F=pathlib.Path(os.environ['GLIBC_NEXT26_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(F/'manifest.json')['sha256']=='8a7fd6467b2e0f4811d855472845bd55ffad61e15aaebf02475c871c30be5766'
assert digest(F/'acceptance.json')['sha256']=='a12316a740cf22f5f60b5941cf65a4c4e2894c16f94a5a254c15d6d060b6922a'
manifest=json.loads((F/'manifest.json').read_text())['files']
assert digest(F/'logs/final-runtime-inputs.json')==manifest[str((F/'logs/final-runtime-inputs.json').resolve())]
sourceRows=[]
for name,row in manifest.items():
 if '/source/' in name or '/source-snapshots/' in name:
  p=pathlib.Path(name);assert digest(p)==row;sourceRows.append({'path':name,**row})
(T/'logs/inherited-source-verification.json').write_text(json.dumps({'pass':True,'rows':sourceRows},indent=2)+'\n')
j=json.loads((F/'logs/final-runtime-inputs.json').read_text());rows=[];objects=0
for name,row in j['inputs'].items():
 p=pathlib.Path(name);d=digest(p);assert d==manifest[str(p.resolve())]
 assert d['sha256']==row['sha256'] and d['bytes']==row['bytes'] and digest(pathlib.Path(row['snapshot']))==d
 rows.append({'path':str(p),'snapshot':row['snapshot'],**d})
 if row.get('format') in ['Wasm-v1','LLVM-bitcode']:
  q=T/'objects/guest'/p.name;q.parent.mkdir(exist_ok=True);shutil.copy2(p,q);assert digest(q)==d;objects+=1
 elif p==F/'source/startup.c':shutil.copy2(p,T/'source/startup.c')
assert objects==191
(T/'logs/reuse-next26-runtime.json').write_text(json.dumps({'pass':True,'objects':objects,'manifest':str(F/'manifest.json'),'rows':rows},indent=2)+'\n')
