#!/usr/bin/env python3
"""Copy immutable accepted GNU runtime after original and snapshot verification."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);F=pathlib.Path(os.environ['GLIBC_NEXT26_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(F/'manifest.json')['sha256']=='8a7fd6467b2e0f4811d855472845bd55ffad61e15aaebf02475c871c30be5766'
m=json.loads((F/'manifest.json').read_text())['files']
f=F/'logs/final-runtime-inputs.json';assert digest(f)==m[str(f.resolve())]
j=json.loads(f.read_text());rows=[];objects=0;destinations=set()
for name,row in j['inputs'].items():
 p=pathlib.Path(name);d=digest(p);assert d==m[str(p.resolve())]
 assert d['sha256']==row['sha256'] and d['bytes']==row['bytes'] and digest(pathlib.Path(row['snapshot']))==d
 rows.append({'path':str(p),'snapshot':row['snapshot'],**d})
 if row.get('format') in ['Wasm-v1','LLVM-bitcode']:
  q=T/'objects/guest'/p.name;assert q not in destinations;destinations.add(q)
  q.parent.mkdir(exist_ok=True)
  if q.exists():assert digest(q)==d
  else:shutil.copy2(p,q)
  assert digest(q)==d;objects+=1
 elif p==F/'source/startup.c':
  q=T/'source/startup.c'
  if q.exists():
   before=T/'source-snapshots/startup-before-reuse.c'
   if not before.exists():shutil.copy2(q,before)
  shutil.copy2(p,q);assert digest(q)==d
assert objects==191 and (T/'source/startup.c').is_file()
(T/'logs/reuse-next26-runtime.json').write_text(json.dumps({'pass':True,'objects':objects,'manifest':str(F/'manifest.json'),'rows':rows},indent=2)+'\n')
