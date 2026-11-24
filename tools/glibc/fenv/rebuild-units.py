#!/usr/bin/env python3
"""Replay exactly the eight genuine GNU fixed-rounding inventory failures."""
import os,pathlib,json,subprocess,concurrent.futures,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);P=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET']);R=pathlib.Path(__file__).resolve().parent
units=[x for x in json.loads((P/'logs/primary-failures.json').read_text())['failedUnits'] if x['primaryClass']=='floating point environment architecture'];assert len(units)==8
D=T/'logs/fenv-units';D.mkdir();rows=[]
def compile(x):
 args=[a.replace(str(P),str(T)) for a in x['commands'][0][1:]]
 for flag in ['-S','-emit-llvm']:args.remove(flag)
 i=args.index('-Xclang');assert args[i+1]=='-disable-llvm-passes';del args[i:i+2]
 output=T/'objects/fullmake'/x['unit'];output.parent.mkdir(parents=True,exist_ok=True);args[args.index('-o')+1]=str(output);args+=['-c']
 source=pathlib.Path(x['source'].replace(str(P),str(T)));h=hashlib.sha256(source.read_bytes()).hexdigest();assert h==hashlib.sha256(pathlib.Path(x['sourceSnapshot']).read_bytes()).hexdigest()
 cwd=T/'source/glibc-2.44'/pathlib.Path(x['unit']).parent;command=['python3',str(R/'compiler.py'),*args]
 with (D/(x['unit'].replace('/','-')+'.log')).open('wb') as f:p=subprocess.run(command,cwd=cwd,stdout=f,stderr=subprocess.STDOUT)
 row={'unit':x['unit'],'argv':command,'cwd':str(cwd),'source':str(source),'sourceSha256':h,'exit':p.returncode}
 if not p.returncode:
  b=output.read_bytes();assert b[:8]==b'\0asm\1\0\0\0' and len(b)>8;row.update(objectBytes=len(b),objectSha256=hashlib.sha256(b).hexdigest())
 return row
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 for row in pool.map(compile,units):rows.append(row);print(row['unit'],row['exit'],flush=True)
passed=all(x['exit']==0 for x in rows)
(D/'result.json').write_text(json.dumps({'pass':passed,'unitCount':8,'passedUnits':sum(x['exit']==0 for x in rows),'rows':rows,'scope':'eight GNU object builds; conversion/formatting runtime and full archive not accepted'},indent=2)+'\n');assert passed
