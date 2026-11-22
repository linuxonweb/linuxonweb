#!/usr/bin/env python3
"""Rebuild precisely the 50 retained genuine GNU C cleanup attempts in a fresh tree."""
import os,pathlib,json,subprocess,concurrent.futures,hashlib,sys
T=pathlib.Path(os.environ['GLIBC_TASK']);P=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET']);R=pathlib.Path(__file__).resolve().parent
inventory=json.loads((P/'logs/primary-failures.json').read_text());units=[x for x in inventory['failedUnits'] if x['primaryClass']=='C cleanup DWARF/native Wasm EH mismatch'];assert len(units)==50
D=T/'logs/gnu-cleanup-units';D.mkdir(exist_ok=True);rows=[]
previous=None
if (D/'result.json').exists():
 data=(D/'result.json').read_bytes();n=1
 while (D/f'result-prior-{n:04d}.json').exists():n+=1
 with (D/f'result-prior-{n:04d}.json').open('xb') as f:f.write(data)
if '--retry-failed' in sys.argv:
 previous=json.loads((D/'result.json').read_text()); failed={x['unit'] for x in previous['rows'] if x['exit']};units=[x for x in units if x['unit'] in failed]
def compile(x):
 # Original frontend argv carries exact GNU compile flags; replace only owned paths and output mode.
 args=[a.replace(str(P),str(T)) for a in x['commands'][0][1:]]
 for flag in ['-S','-emit-llvm']:
  args.remove(flag)
 i=args.index('-Xclang');assert args[i+1]=='-disable-llvm-passes';del args[i:i+2]
 output=T/'objects/fullmake'/x['unit'];output.parent.mkdir(parents=True,exist_ok=True);args[args.index('-o')+1]=str(output);args+=['-c']
 source=pathlib.Path(x['source'].replace(str(P),str(T)));assert hashlib.sha256(source.read_bytes()).hexdigest()==hashlib.sha256(pathlib.Path(x['sourceSnapshot']).read_bytes()).hexdigest()
 cwd=T/'source/glibc-2.44'/pathlib.Path(x['unit']).parent;command=['python3',str(R/'compiler.py'),*args]
 log=D/(x['unit'].replace('/','-')+('.retry.log' if previous else '.log'))
 with log.open('wb') as f:p=subprocess.run(command,cwd=cwd,stdout=f,stderr=subprocess.STDOUT)
 row={'unit':x['unit'],'argv':command,'cwd':str(cwd),'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'exit':p.returncode}
 if p.returncode==0:
  b=output.read_bytes();assert len(b)>8 and b[:8]==b'\0asm\1\0\0\0';row.update(objectBytes=len(b),objectSha256=hashlib.sha256(b).hexdigest())
 return row
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 for row in pool.map(compile,units):rows.append(row);print(row['unit'],row['exit'],flush=True)
if previous:
 replacements={x['unit']:x for x in rows};rows=[replacements.get(x['unit'],x) for x in previous['rows']]
results=[]
for f in (T/'logs/c-attempts').glob('*/attempt.json'):
 j=json.loads(f.read_text())
 if '/objects/fullmake/' in j['output']:
  raw=(f.parent/'front.ll').read_text() if (f.parent/'front.ll').exists() else ''
  j['rawScopedPads']='cleanuppad' in raw and 'landingpad' not in raw
  if j.get('pass',False):results.append({'proof':str(f),'rawScopedPads':j['rawScopedPads'],'pass':True})
passed=all(x['exit']==0 for x in rows) and len(results)==50 and all(x['rawScopedPads'] for x in results)
(D/'result.json').write_text(json.dumps({'pass':passed,'unitCount':50,'passedUnits':sum(x['exit']==0 for x in rows),'rows':rows,'rawIRProof':results,'scope':'compile/raw native C EH acceptance; no archive/runtime/cancellation acceptance'},indent=2)+'\n');assert passed
