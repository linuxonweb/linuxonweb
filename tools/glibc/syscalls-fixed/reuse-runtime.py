#!/usr/bin/env python3
"""Reuse the accepted rounding runtime with exact original/snapshot checks."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);F=pathlib.Path(os.environ['GLIBC_FENV_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(F/'manifest.json')['sha256']=='c575dc6867d292bb6ca120831ffa7c13e48a7732671d6a190009937f86c17cd1'
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
assert objects==123
(T/'logs/reuse-fenv-runtime.json').write_text(json.dumps({'pass':True,'objects':objects,'manifest':str(F/'manifest.json'),'rows':rows},indent=2)+'\n')
