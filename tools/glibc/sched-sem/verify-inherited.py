import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);F=pathlib.Path(os.environ['GLIBC_NEXT26_PACKET'])
def d(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert d(F/'manifest.json')['sha256']=='8a7fd6467b2e0f4811d855472845bd55ffad61e15aaebf02475c871c30be5766'
m=json.loads((F/'manifest.json').read_text())['files'];rows=[]
for name,row in m.items():
 if '/source/' in name or '/source-snapshots/' in name:
  assert d(pathlib.Path(name))==row;rows.append({'path':name,**row})
D=T/'objects/verified-input191';D.mkdir();n=0
for name,row in json.loads((F/'logs/final-runtime-inputs.json').read_text())['inputs'].items():
 p=pathlib.Path(name);assert d(p)==m[str(p.resolve())];assert d(pathlib.Path(row['snapshot']))==d(p)
 if row.get('format') in ['Wasm-v1','LLVM-bitcode']:
  q=D/p.name;shutil.copy2(p,q);assert d(q)==d(p);n+=1
assert n==191
(T/'logs/inherited-source-verification.json').write_text(json.dumps({'pass':True,'rows':rows,'sourcesAndSnapshots':len(rows),'verifiedObjectsCopiedAfterSourceRecheck':n,'initialReuseScope':'original runtime input records verified before initial copy; complete inherited-source/snapshot recheck and additional verified copy performed before final acceptance'},indent=2)+'\n')
print('Inherited sources/snapshots',len(rows),'objects',n,'PASS')
