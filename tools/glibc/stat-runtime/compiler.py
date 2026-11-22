#!/usr/bin/env python3
"""Bounded GNU C native-EH driver; retain actual source/cwd/stage outcomes."""
import os,pathlib,subprocess,sys,tempfile,json,hashlib,resource
T=pathlib.Path(os.environ['GLIBC_TASK']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin';clang=T/'objects/compiler/clang';args=sys.argv[1:];cwd=pathlib.Path.cwd()
driverData=pathlib.Path(__file__).read_bytes();driverSha256=hashlib.sha256(driverData).hexdigest()
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
if '-c' not in args or not any(x.endswith('.c') for x in args):
 parent=T/'logs/compiler-queries';parent.mkdir(parents=True,exist_ok=True)
 work=pathlib.Path(tempfile.mkdtemp(prefix='attempt-',dir=parent))
 (work/'driver.py').write_bytes(driverData)
 sources=[]
 for arg in args:
  p=pathlib.Path(arg)
  if arg.endswith(('.c','.S','.s')) and p.is_file():
   data=p.read_bytes();q=work/p.name;q.write_bytes(data)
   sources.append({'source':str(p.resolve()),'snapshot':str(q),'sha256':hashlib.sha256(data).hexdigest()})
 command=[str(clang),'--target=wasm32-unknown-linux-gnu',*args]
 report={'driverSha256':driverSha256,'driverSnapshot':str(work/'driver.py'),'scope':'configure query/non-C invocation passthrough; no all-flags production acceptance','argv':command,'cwd':str(cwd),'sources':sources}
 (work/'command.json').write_text(json.dumps(report,indent=2)+'\n')
 p=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 (work/'stdout').write_bytes(p.stdout);(work/'stderr').write_bytes(p.stderr)
 report['exit']=p.returncode;(work/'command.json').write_text(json.dumps(report,indent=2)+'\n')
 sys.stdout.buffer.write(p.stdout);sys.stderr.buffer.write(p.stderr);sys.exit(p.returncode)
if '-o' not in args:args+=['-o',pathlib.Path(next(x for x in args if x.endswith('.c'))).stem+'.o']
source=pathlib.Path(next(x for x in args if x.endswith('.c'))).resolve();output=pathlib.Path(args[args.index('-o')+1]).resolve()
parent=T/'logs/c-attempts';parent.mkdir(parents=True,exist_ok=True);work=pathlib.Path(tempfile.mkdtemp(prefix='attempt-',dir=parent));data=source.read_bytes();(work/source.name).write_bytes(data)
(work/'driver.py').write_bytes(driverData)
report={'driverSha256':driverSha256,'driverSnapshot':str(work/'driver.py'),'cwd':str(cwd),'source':str(source),'sourceSnapshot':str(work/source.name),'sourceSha256':hashlib.sha256(data).hexdigest(),'originalArgs':args.copy(),'output':str(output),'stages':[]}
pos=args.index('-o')+1;args[pos]=str(work/'front.ll');args.remove('-c')
stages=[('frontend',[str(clang),'--target=wasm32-unknown-linux-gnu',*args,'-fwasm-exceptions','-Xclang','-disable-llvm-passes','-S','-emit-llvm']),('metadata',[str(T/'objects/warnings'),str(work/'front.ll'),str(work/'warnings.bc')]),('jumps',[str(T/'objects/lower'),str(work/'warnings.bc'),str(work/'lower.bc')]),('optimizer',[str(L/'opt'),'-passes=default<O2>',str(work/'lower.bc'),'-o',str(work/'opt.bc')]),('backend',[str(L/'llc'),'-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-use-legacy-eh','-filetype=obj',str(work/'opt.bc'),'-o',str(output)])]
for name,command in stages:
 row={'stage':name,'argv':command,'cwd':str(cwd)};report['stages'].append(row);(work/'attempt.json').write_text(json.dumps(report,indent=2)+'\n')
 with (work/(name+'.log')).open('wb') as f:p=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
 row['exit']=p.returncode
 if p.returncode:
  report['pass']=False;(work/'attempt.json').write_text(json.dumps(report,indent=2)+'\n');print('retained C cleanup failure '+str(work)+' stage '+name,file=sys.stderr);sys.exit(p.returncode)
report.update(**{'pass':True,'objectBytes':output.stat().st_size,'objectSha256':hashlib.sha256(output.read_bytes()).hexdigest()});(work/'attempt.json').write_text(json.dumps(report,indent=2)+'\n')
