#!/usr/bin/env python3
"""Link immutable actual GNU units and compile a narrow synthetic-transport probe."""
import hashlib,json,os,pathlib,shutil,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK'])
S=pathlib.Path('/mnt/p6/build/glibc-stat-20261002')
G=pathlib.Path('/mnt/p6/build/glibc-stat-runtime-20261002')
R=pathlib.Path(__file__).resolve().parent
L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(S/'manifest.json')['sha256']=='e6efcd1c146eb5d559ab782aa5013908cb83f8d487c8005860c727fc19119a1a'
m=json.loads((S/'manifest.json').read_text())['files']
a=json.loads((S/'compile-acceptance.json').read_text());assert a['pass']
rows=[]
def copy(p):
 p=pathlib.Path(p);h=digest(p);assert h==m[str(p.resolve())]
 q=T/'objects'/p.name;assert not q.exists();shutil.copy2(p,q)
 rows.append({'source':str(p),'copy':str(q),**h});return q
objects=[copy(S/'objects/fullmake'/u['unit']) for u in a['units']]
objects.append(copy(S/'objects/stat-signatures.o'))
for name in ['csu-errno.o','csu-errno-loc.o','string-memset.o']:objects.append(copy(S/'objects/guest'/name))
makedev=G/'objects/fullmake/misc/makedev.o'
assert digest(makedev)['sha256']=='2c2f53bed401ecbd17d39b5363995fdd03410188f267d2ca627949eb77d09a55'
proof=json.loads((G/'logs/stat-build/result.json').read_text())
unit=next(u for u in proof['objects'] if u['unit']=='misc/makedev.o')
assert digest(makedev)=={k:unit[k] for k in ['sha256','bytes']}
assert digest(pathlib.Path(unit['genuineSource']))['sha256']=='baf696545066fb6ce6fe14ce5db939aa80b6a5a41bf6a533fc5f91dfbb79aa53'
source=pathlib.Path(unit['genuineSource'])
assert source.read_bytes()==pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44/misc/makedev.c').read_bytes()
for p in [makedev,source,G/'logs/stat-build/result.json']:
 q=T/'source-snapshots/makedev'/p.name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
 rows.append({'source':str(p),'snapshot':str(q),**digest(p)})
q=T/'objects/makedev.o';shutil.copy2(makedev,q);objects.append(q)
attempts=[(p,json.loads(p.read_text())) for p in (G/'logs/c-attempts').glob('*/attempt.json')]
mak=next((p,j) for p,j in attempts if j.get('pass') and j['output']==str(makedev))
assert all(s['exit']==0 for s in mak[1]['stages'])
for p in mak[0].parent.iterdir():
 if p.is_file():
  q=T/'source-snapshots/makedev-attempt'/p.name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
  rows.append({'source':str(p),'snapshot':str(q),**digest(p)})
attempt=json.loads(next(pathlib.Path(u['attempt']) for u in a['units'] if u['unit']=='io/fstatat64.o').read_text())
args=attempt['originalArgs'].copy();args[[i for i,v in enumerate(args) if v.endswith('.c')][0]]=str(R/'probe.c')
out=T/'objects/probe.o';args[args.index('-o')+1]=str(out)
for flag,v in [('-MF',str(out)+'.dt'),('-MT',str(out))]:args[args.index(flag)+1]=v
assert '-c' not in args;args.append('-c')
argv=['python3',str(R.parent/'syscalls-next26/compiler.py'),*args]
(T/'logs/compile-command.json').write_text(json.dumps({'argv':argv,'cwd':attempt['cwd']},indent=2)+'\n')
with (T/'logs/compile.stdout').open('wb') as o,(T/'logs/compile.stderr').open('wb') as e:
 p=subprocess.run(argv,cwd=attempt['cwd'],stdout=o,stderr=e)
(T/'logs/compile-result.json').write_text(json.dumps({'exit':p.returncode})+'\n');assert p.returncode==0
objects.append(out)
module=T/'objects/native.wasm'
argv=[str(L/'wasm-ld'),'--no-entry','--shared-memory','--export-memory','--initial-memory=2097152','--max-memory=16777216','--export-table','-z','stack-size=65536','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__heap_base','--export=run','--export=payload','--export=layout','--export=error',*[str(p) for p in objects],'-o',str(module)]
(T/'logs/link-command.json').write_text(json.dumps(argv,indent=2)+'\n')
with (T/'logs/link.stdout').open('wb') as o,(T/'logs/link.stderr').open('wb') as e:p=subprocess.run(argv,stdout=o,stderr=e)
(T/'logs/link-result.json').write_text(json.dumps({'exit':p.returncode})+'\n');assert p.returncode==0
subprocess.run(['wasm-validate','--enable-all',str(module)],check=True)
fp=T/'objects/fpcast.wasm'
argv=['wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23','--fpcast-emu',str(module),'-o',str(fp)]
(T/'logs/fpcast-command.json').write_text(json.dumps(argv,indent=2)+'\n')
subprocess.run(argv,check=True,env={**os.environ,'BINARYEN_CORES':'2'})
subprocess.run(['wasm-validate','--enable-all',str(fp)],check=True)
(T/'logs/reused-inputs.json').write_text(json.dumps({'pass':True,'rows':rows},indent=2)+'\n')
print(json.dumps({'pass':True,'objects':len(objects),'native':digest(module),'fpcast':digest(fp),'scope':'genuine GNU public stat with synthetic Linux transport; guest acceptance separate'}))
