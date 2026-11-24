#!/usr/bin/env python3
"""Audit GNU stat implementations, actual dependencies and accepted guest closure."""
import hashlib,json,os,pathlib,re,shlex,shutil,subprocess,argparse
parser=argparse.ArgumentParser();parser.add_argument("--label",required=True);parser.add_argument("--run",required=True);args=parser.parse_args();assert re.fullmatch(r"[a-zA-Z0-9_-]+",args.label) and re.fullmatch(r"[a-zA-Z0-9_-]+",args.run)
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent;S=T/'source/glibc-2.44';L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
P=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent/'source/glibc-2.44'
if args.label=='initial':
 fixture=T/'objects/guest/stat-fixture.o';linkInputs=T/'logs/stat-link-inputs.txt';module=T/'objects/stat-runtime.wasm'
else:
 fixture=T/('objects/recompile-'+args.label)/'stat-fixture.o';linkInputs=fixture.parent/'inputs.txt';module=fixture.parent/'module.wasm'
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
def members(group):
 result=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   f=p.read_text().rsplit(')',1)[1].split()
   if int(f[2])==group and f[0]!='Z':result.append(int(p.parent.name))
  except (OSError,ValueError):pass
 return result
D=T/('source-snapshots/final-runtime-'+args.label);assert not D.exists();D.mkdir();inputs={};dependencies={};attemptProof=[]
def pin(p):
 p=p.resolve()
 if str(p) in inputs:return inputs[str(p)]
 q=D/(str(len(inputs))+'-'+p.name);shutil.copy2(p,q);d=digest(p);assert digest(q)==d;inputs[str(p)]={**d,'snapshot':str(q)};return inputs[str(p)]
attempts=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json')]
def audit_attempt(output):
 rows=[(p,j) for p,j in attempts if j.get('pass') and j['output']==str(output) and j['objectSha256']==digest(output)['sha256']];assert len(rows)==1,str(output)
 p,j=rows[0];assert pathlib.Path(j['source']).read_bytes()==pathlib.Path(j['sourceSnapshot']).read_bytes();assert all(s['exit']==0 for s in j['stages'])
 assert digest(pathlib.Path(j['driverSnapshot']))['sha256']==j['driverSha256']
 for q in [p,pathlib.Path(j['source']),pathlib.Path(j['sourceSnapshot']),pathlib.Path(j['driverSnapshot'])]:dependencies[str(q.resolve())]=digest(q)
 args=j['originalArgs'];dep=pathlib.Path(args[args.index('-MF')+1]);assert dep.is_file();dependencies[str(dep)]=digest(dep)
 for word in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):
  if word.endswith(':'):continue
  q=pathlib.Path(word)
  if not q.is_absolute():q=pathlib.Path(j['cwd'])/q
  assert q.is_file();dependencies[str(q.resolve())]=digest(q)
 for q in p.parent.iterdir():
  if q.is_file():dependencies[str(q.resolve())]=digest(q)
 attemptProof.append({'object':str(output),'attempt':str(p),'source':j['source'],'driverSha256':j['driverSha256'],'cwd':j['cwd'],'stages':j['stages']})
 return (p.parent/'front.ll').read_text()
build=json.loads((T/'logs/stat-build/result.json').read_text());assert build['pass'] and build['actualMakeTargets']==10
assert all(j['exit']==0 for j in build['commands']);units=[]
for row in build['objects']:
 p=T/'objects/fullmake'/row['unit'];assert digest(p)=={k:row[k] for k in ['sha256','bytes']};front=audit_attempt(p);g=pathlib.Path(row['genuineSource']);assert g.read_bytes()==(P/g.relative_to(S)).read_bytes();pin(g)
 calls=[s.strip() for s in front.splitlines() if re.search(r'call i32 @__wasm_linux_syscall\(',s)]
 assert bool(calls)==(p.stem in ['fstatat64','xstat64','lxstat64','fxstat64','fxstatat64']);assert all('(i32 noundef 291,' in s for s in calls)
 units.append({'unit':row['unit'],'sha256':row['sha256'],'genuineSource':str(g),'rawStatxCalls':calls})
ref=audit_attempt(T/'objects/stat-signatures.o')
names=['stat','stat64','lstat','lstat64','fstat','fstat64','fstatat','fstatat64']
for n in names:assert any(s.startswith('@GNU_STAT_REF_'+n+' = ') and 'global ptr @'+n+',' in s for s in ref.splitlines()),n
front=audit_attempt(fixture)
for n in names:assert any(s.startswith('@stat_reference_'+n+' = ') and 'global ptr @'+n+',' in s for s in front.splitlines()),n
assert 'load volatile ptr' in front and re.search(r'call i32 %[0-9]+\(',front)
audit_attempt(T/'objects/guest/startup.o')
objects=[pathlib.Path(s) for s in linkInputs.read_text().splitlines()];assert len(objects)==203 and len(set(objects))==203
formats={};providers={}
for p in objects:
 b=p.read_bytes();kind='Wasm-v1' if b[:8]==b'\0asm\1\0\0\0' else 'LLVM-bitcode' if b[:4]==b'BC\xc0\xde' else None;assert kind and len(b)>8
 pin(p)['format']=kind;formats[kind]=formats.get(kind,0)+1
 symbols=subprocess.check_output([str(L/'llvm-nm'),'--defined-only',str(p)],text=True)
 for line in symbols.splitlines():
  w=line.split()
  if len(w)==3:providers.setdefault(w[-1],[]).append({'object':str(p),'binding':w[1],'address':w[0]})
assert formats=={'Wasm-v1':182,'LLVM-bitcode':21}
for n in names:
 row=providers[n];assert len(row)==1 and row[0]['binding']=='W' and row[0]['object'].endswith('/stat-'+(n if n.endswith('64') else n+'64')+'.o')
 body=providers['__'+n];assert len(body)==1 and body[0]['binding']=='T' and body[0]['object']==row[0]['object'] and body[0]['address']==row[0]['address']
assert len(providers['__gnu_dev_makedev'])==1
for p in [R/'fixture.c',R/'signatures.c',T/'source/startup.c',module,T/('objects/stat-'+args.label+'-fpcast.wasm'),*(S/'sysdeps/unix/sysv/linux/wasm32'/n for n in ['kernel_stat.h','statx_cp.c','kernel-features.h'])]:pin(p)
groups={};historicalFailures={'prepare':1,'native1':1}
for p in (T/'logs/supervision').glob('*.json'):
 j=json.loads(p.read_text())
 if j.get('exit') is None and j['pgid']==os.getpgrp():continue
 assert j['exit']==historicalFailures.get(p.stem,0) and not j['terminalMembers'] and not members(j['pgid']);groups[str(j['pgid'])]={'proof':str(p),'exit':j['exit'],'terminalMembers':[]}
gates={}
for mode in ['native','fpcast']:
 d=T/('guest-'+mode+'-'+args.run);base=json.loads((d/'result.json').read_text());gate=json.loads((d/'stat-result.json').read_text());assert base['pass'] and gate['pass'] and base['browserExit']=={'code':0,'signal':None} and base['serverClosed']
 for p,h in base['inputs'].items():assert digest(pathlib.Path(p))['sha256']==h
 for pid in [base['runnerPid'],base['browserPid']]:assert not members(pid);groups[str(pid)]={'proof':str(d/'result.json'),'terminalMembers':[]}
 gates[mode]={'checks':base['jit'],'stat':gate,'browserExit':base['browserExit'],'serverClosed':base['serverClosed'],'result':str(d/'result.json')}
for p,row in dependencies.items():assert digest(pathlib.Path(p))==row
(T/'logs/dependency-audit.json').write_text(json.dumps({'pass':True,'inputs':dependencies,'attempts':attemptProof,'GNUUnits':units,'publicRefs':names},indent=2)+'\n')
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':203,'formats':formats,'inputs':inputs},indent=2)+'\n')
(T/'logs/terminal-group-proof.json').write_text(json.dumps({'pass':True,'groups':groups,'historicalFailures':historicalFailures},indent=2)+'\n')
a={'pass':True,'GNUObjects':10,'publicFunctions':8,'linkObjects':203,'formats':formats,'gates':gates,'rawTime64Input':{'syscall':412,'seconds':[2208988801,2208988802],'nanoseconds':[123456789,987654321]},'kernelLegacyStatBytes':104,'GNUStatBytes':128,'kernelStatxBytes':256,'beyond4GiBGuestFile':False,'historicalKernelLayoutAPI':False,'fullSysroot':False,'NPTLCancellation':False,'NightlyBrowser':False}
assert not (T/'acceptance.json').exists();(T/'acceptance.json').write_text(json.dumps(a,indent=2)+'\n');print(json.dumps(a))
