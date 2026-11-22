#!/usr/bin/env python3
import pathlib,os,subprocess,json,hashlib,sys
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parents[3];L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
h=lambda p:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
label=sys.argv[1] if len(sys.argv)>1 else 'run1'
records=[]
for subdir,name in [('setjmp','__longjmp'),('debug','____longjmp_chk')]:
 target=T/'objects/fullmake'/subdir/(name+'.o')
 argv=['make','-C',str(T/'source/glibc-2.44'/subdir),'objdir='+str(T/'objects/fullmake'),'-j1',str(target)];log=T/'logs'/('checked-make-'+label+'-'+subdir+'.log')
 with log.open('wb') as f:q=subprocess.run(argv,stdout=f,stderr=subprocess.STDOUT)
 row={'argv':argv,'exit':q.returncode,'log':str(log),'target':str(target)};records.append(row)
 (T/'logs'/('checked-make-'+label+'.json')).write_text(json.dumps({'pass':all(x['exit']==0 for x in records),'records':records},indent=2)+'\n')
 assert q.returncode==0,str(log)
 assert target.read_bytes()[:8]==b'\0asm\1\0\0\0';subprocess.run(['wasm-validate','--enable-all',str(target)],check=True)
 attempts=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json')];matches=[(p,j) for p,j in attempts if j['output']==str(target) and j['pass']];assert matches;p,j=max(matches,key=lambda row:row[0].stat().st_mtime_ns)
 expected=T/'source/glibc-2.44'/('sysdeps/wasm32/__longjmp.c' if subdir=='setjmp' else 'sysdeps/unix/sysv/linux/wasm32/____longjmp_chk.c');assert j['source']==str(expected) and expected.read_bytes()==pathlib.Path(j['sourceSnapshot']).read_bytes()
 nm=subprocess.check_output([str(L/'llvm-nm'),'--defined-only',str(target)],text=True);(T/'logs'/(name+'-symbols.txt')).write_text(nm);defs={line.split()[-1] for line in nm.splitlines() if len(line.split())==3}
 assert ('____longjmp_chk' in defs)==(subdir=='debug');assert ('__longjmp' in defs)==(subdir=='setjmp')
 row.update(**h(target),attempt=str(p),definitions=sorted(defs),selectedSource=str(expected))
(T/'logs'/('checked-make-'+label+'.json')).write_text(json.dumps({'pass':True,'records':records,'scope':'two genuine GNU make targets with distinct native providers; runtime gate separate'},indent=2)+'\n');print(json.dumps({'pass':True,'genuineTargets':2,'scope':'native checked jump source selection/compile'}))
