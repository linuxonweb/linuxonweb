#!/usr/bin/env python3
"""Link fresh GNU converter/support units with an explicitly synthetic fixture."""
import hashlib,json,os,pathlib,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent;L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
report=T/'logs/host-build.json';assert not report.exists();rows=[]
def command(stage,argv,cwd):
 row={'stage':stage,'argv':argv,'cwd':str(cwd)};rows.append(row);report.write_text(json.dumps(rows,indent=2)+'\n')
 with (T/'logs'/('host-'+stage+'.log')).open('wb') as f:p=subprocess.run(argv,cwd=cwd,stdout=f,stderr=subprocess.STDOUT)
 row['exit']=p.returncode;report.write_text(json.dumps(rows,indent=2)+'\n')
 if p.returncode:raise SystemExit(p.returncode)
attempts=[]
for p in (T/'logs/c-attempts').glob('*/attempt.json'):
 j=json.loads(p.read_text())
 if j['source'].endswith('/wasm32/xstatconv.c'):attempts.append(j)
assert len(attempts)==1;j=attempts[0];assert j['pass']
fixture=T/'source-snapshots/fixture.c';assert not fixture.exists();fixture.write_bytes((R/'fixture.c').read_bytes())
obj=T/'objects/fixture.o';args=j['originalArgs'].copy()
for i,s in enumerate(args):
 if s.endswith('.c'):args[i]=str(fixture)
for flag,value in [('-o',str(obj)),('-MF',str(T/'objects/fixture.o.dt')),('-MT',str(obj))]:args[args.index(flag)+1]=value
command('fixture',['python3',str(R/'compiler.py'),*args],j['cwd'])
objects=[T/'objects/fullmake'/name for name in ['io/xstatconv.o','csu/errno.o','csu/errno-loc.o','string/memcpy.o','string/memset.o','string/wordcopy.o']]+[obj]
module=T/'objects/native.wasm';assert not module.exists()
argv=[str(L/'wasm-ld'),'--no-entry','--shared-memory','--export-memory','--initial-memory=2097152','--max-memory=16777216','--export-table','-z','stack-size=65536','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__heap_base',*[('--export='+name) for name in ['run_tests','pass_count','fail_count','layout']],*[str(p) for p in objects],'-Map='+str(T/'logs/host-link.map'),'-o',str(module)]
command('link',argv,R.parents[2])
command('validate-native',['wasm-validate','--enable-all',str(module)],R.parents[2])
fp=T/'objects/fpcast.wasm';assert not fp.exists()
command('fpcast',['wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23','--fpcast-emu',str(module),'-o',str(fp)],R.parents[2])
command('validate-fpcast',['wasm-validate','--enable-all',str(fp)],R.parents[2])
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
(T/'logs/host-link-inputs.json').write_text(json.dumps({'scope':'synthetic conversion test, no kernel transport','inputs':{str(p):digest(p) for p in objects},'modules':{str(p):digest(p) for p in [module,fp]}},indent=2)+'\n')
