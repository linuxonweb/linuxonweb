#!/usr/bin/env python3
"""Reuse the accepted 53-wrapper runtime with exact original/snapshot checks."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);F=pathlib.Path(os.environ['GLIBC_FIXED_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(F/'manifest.json')['sha256']=='b17e5f7744e2f4eae6714db5f4544b7e953a18b89a0bf419f89ead66ad2e784f'
manifest=json.loads((F/'manifest.json').read_text())['files']
assert digest(F/'logs/final-runtime-inputs.json')==manifest[str((F/'logs/final-runtime-inputs.json').resolve())]
j=json.loads((F/'logs/final-runtime-inputs.json').read_text());rows=[];objects=0
for name,row in j['inputs'].items():
 p=pathlib.Path(name);d=digest(p);assert d==manifest[str(p.resolve())]
 assert d['sha256']==row['sha256'] and d['bytes']==row['bytes'] and digest(pathlib.Path(row['snapshot']))==d
 rows.append({'path':str(p),'snapshot':row['snapshot'],**d})
 if row.get('format') in ['Wasm-v1','LLVM-bitcode']:
  q=T/'objects/guest'/p.name;q.parent.mkdir(exist_ok=True);shutil.copy2(p,q);assert digest(q)==d;objects+=1
 elif p==F/'source/startup.c':shutil.copy2(p,T/'source/startup.c')
assert objects==161
(T/'logs/reuse-fixed-runtime.json').write_text(json.dumps({'pass':True,'objects':objects,'manifest':str(F/'manifest.json'),'rows':rows},indent=2)+'\n')
