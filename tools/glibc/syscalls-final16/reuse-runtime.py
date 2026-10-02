#!/usr/bin/env python3
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);F=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']);G=pathlib.Path(os.environ['GLIBC_SCHED_PACKET'])
def d(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
packets=[(F,'4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042','41071efa5034d429d7af866116092bf7e74d33d01f94fb9de55d6a47b61250f9'),(G,'7add20192700d9c544a3fadd192255f3491277d64896ddb1e1b6a3e29432af9a','0201556db7845bd4dbfd52c855dcfcfa71a895a649ea28454e6edc7556affd36')]
rows=[];sources={};sets=[]
for P,mh,ah in packets:
 assert d(P/'manifest.json')['sha256']==mh and d(P/'acceptance.json')['sha256']==ah
 m=json.loads((P/'manifest.json').read_text())['files']
 for name,h in m.items():
  if '/source/' in name or '/source-snapshots/' in name:
   q=pathlib.Path(name);assert d(q)==h;sources[name]=h
 p=P/'logs/final-runtime-inputs.json';assert d(p)==m[str(p)];j=json.loads(p.read_text());objects={}
 for name,r in j['inputs'].items():
  q=pathlib.Path(name);h=d(q);assert h==m[str(q.resolve())] and h['sha256']==r['sha256']and h['bytes']==r['bytes'];assert d(pathlib.Path(r['snapshot']))==h;rows.append({'path':name,'snapshot':r['snapshot'],**h})
  if r.get('format')in ['Wasm-v1','LLVM-bitcode']:assert q.name not in objects;objects[q.name]=(q,r)
 sets.append(objects)
common=set(sets[0])&set(sets[1]);assert len(common)==191
for name in common-{'startup.o'}:assert d(sets[0][name][0])==d(sets[1][name][0]),name
assert len(sets[0])==203 and len(sets[1])==201 and len(set(sets[1])-common)==10
D=T/'objects/guest';D.mkdir(exist_ok=True)
for name,(p,r) in {**sets[0],**{n:r for n,r in sets[1].items()if n not in common}}.items():
 q=D/name;assert not q.exists();shutil.copy2(p,q);assert d(q)==d(p)
shutil.copy2(F/'source/startup.c',T/'source/startup.c')
assert d(T/'source/startup.c')==d(F/'source/startup.c')
(T/'logs/reuse-coherent-runtime.json').write_text(json.dumps({'pass':True,'objects':213,'commonMatchingObjects':190,'startupLineage':'exact frozen stat203 source; subsequent owned explicit scheduler overlay','rows':rows,'sourcesAndSnapshots':sources},indent=2)+'\n');print('Coherent verified runtime213/common190 PASS')
