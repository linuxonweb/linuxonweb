#!/usr/bin/env python3
"""Prepare reviewable runtime/build/provenance evidence before packet freeze."""
import os,pathlib,json,hashlib,subprocess,shlex,re,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;S=T/'source/glibc-2.44';P=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parents[1]/'source/glibc-2.44';L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
attempts=[(p,json.loads(p.read_text()))for p in (T/'logs/c-attempts').glob('*/attempt.json')]
headers={};drivers=[]
for p,j in attempts:
 assert digest(pathlib.Path(j['driverSnapshot']))['sha256']==j['driverSha256'];assert digest(pathlib.Path(j['sourceSnapshot']))['sha256']==j['sourceSha256']
 drivers.append({'attempt':str(p),'pass':j['pass'],'sourceSnapshot':j['sourceSnapshot'],'driverSnapshot':j['driverSnapshot'],'stages':j['stages']})
 for depname in [*pathlib.Path(j['output']).parent.glob(pathlib.Path(j['output']).name+'.dt')]:
  for word in shlex.split(depname.read_text().replace('\\\n',' ').split(':',1)[1]):
   if word.endswith(':'):continue
   q=pathlib.Path(word);q=q if q.is_absolute() else pathlib.Path(j['cwd'])/q
   if q.is_file():headers[str(q.resolve())]=digest(q)
for dep in (T/'objects').glob('*.d'):
 for word in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):
  q=pathlib.Path(word)
  if q.is_file():headers[str(q.resolve())]=digest(q)
newUnits=[];symbols={}
for name in ['sem_init','sem_post','sem_getvalue','sem_wait','sem_destroy']:
 src=S/'nptl'/(name+'.c');assert src.read_bytes()==(P/'nptl'/(name+'.c')).read_bytes()
 obj=T/'objects/guest'/('gnu-'+name+'.o');matches=[(p,j)for p,j in attempts if j['output']==str(obj)and j['pass']];assert len(matches)==1;p,j=matches[0]
 assert digest(src)['sha256']==j['sourceSha256'] and digest(obj)['sha256']==j['objectSha256'];assert all(x['exit']==0 for x in j['stages'])
 nm=subprocess.check_output([str(L/'llvm-nm'),'--defined-only',str(obj)],text=True);symbols[name]=nm
 public='sem_trywait' if name=='sem_wait' else name;impl='__new_'+public;nmrows={x.split()[-1]:x.split() for x in nm.splitlines()if len(x.split())==3}
 assert public in nmrows and impl in nmrows and nmrows[public][0]==nmrows[impl][0]
 ir=(p.parent/'front.ll').read_text()
 if name=='sem_post':assert re.search(r'cmpxchg .* i32 .* release monotonic',ir)
 if name=='sem_wait':assert re.search(r'cmpxchg .* i32 .* acquire monotonic',ir)
 dis=subprocess.check_output(['wasm-objdump','-d',str(obj)],text=True)
 if name in ['sem_post','sem_wait']:assert 'i32.atomic.rmw.cmpxchg' in dis
 newUnits.append({'source':str(src),**digest(src),'object':str(obj),'objectHash':digest(obj),'attempt':str(p),'publicAlias':public,'implementation':impl,'GNUPristineEqual':True,'rawIR':str(p.parent/'front.ll'),'disassemblySha256':hashlib.sha256(dis.encode()).hexdigest()})
 sig=T/'objects/sched-sem-signatures.o'
D=T/'logs/semaphore-audit';D.mkdir(exist_ok=True)
for n,b in symbols.items():(D/(n+'-symbols.txt')).write_text(b)
sm=[(p,j)for p,j in attempts if j['output']==str(sig)and j['pass']];assert len(sm)==1;p,j=sm[0];ir=(p.parent/'front.ll').read_text()
layout=re.search(r'@sched_sem_layout = .*?\[11 x i32\] \[(.*?)\]',ir).group(1);values=[int(x)for x in re.findall(r'i32 (\d+)',layout)];assert values==[4,4,0,16,4,16,4,0,32,1184,32]
for name in ['sched_getparam','sched_setparam','sched_setscheduler','sem_init','sem_post','sem_trywait','sem_getvalue','sem_destroy']:
 assert re.search(r'^@public_reference_'+name+r' = .*global ptr @'+name+r', align 4$',ir,re.M)
abi=(T/'logs/sched-sem-abi.log').read_text();functions=re.findall(r'^ - func\[\d+\] sig=\d+ <([^>]+)>',abi,re.M);assert '__new_sem_post' in functions and '__new_sem_trywait' in functions
assert not any(n in functions for n in ['__new_sem_wait','sem_wait','__internal_syscall_cancel','__pthread_testcancel','__wrap_abort'])
imports=re.findall(r'^ - func\[\d+\].*? <- (.+)$',abi,re.M);assert sorted(imports)==['linux.copy_siginfo','linux.get_thread_area','linux.syscall']
objects=[pathlib.Path(x)for x in (T/'logs/sched-sem-link-inputs.txt').read_text().splitlines()];assert len(objects)==201 and len(set(objects))==201
formats={};objectRows=[]
for o in objects:
 b=o.read_bytes();f='Wasm-v1' if b[:8]==b'\0asm\1\0\0\0' else 'LLVM-bitcode' if b[:4]==b'BC\xc0\xde' else None;assert f
 formats[f]=formats.get(f,0)+1;objectRows.append({'path':str(o),'format':f,**digest(o)})
assert formats=={'Wasm-v1':180,'LLVM-bitcode':21}
make=json.loads((T/'logs/make-sched-sem-result.json').read_text());assert make['pass']and make['targetCount']==4
makeObjects=[]
for r in make['records']:
 for name in r['argv'][5:]:
  o=pathlib.Path(name);assert o.read_bytes()[:8]==b'\0asm\1\0\0\0';matches=[(p,j)for p,j in attempts if j['output']==str(o)and j['pass']];assert len(matches)==1;p,j=matches[0];assert digest(o)['sha256']==j['objectSha256'];makeObjects.append({'object':str(o),**digest(o),'attempt':str(p)})
assert len(makeObjects)==4
runs={};traces={}
for mode in ['native','fpcast']:
 d=T/(mode+'-run1');base=json.loads((d/'result.json').read_text());gate=json.loads((d/'sched-sem-result.json').read_text());assert base['pass']and gate['pass']and base['jit']['failures']==0 and base['serverClosed']and base['browserExit']['code']==0
 assert not pathlib.Path('/proc/'+str(base['browserPid'])).exists()
 rows=[json.loads(x['text'].split('GNU_SCHED_TRACE ',1)[1])for x in base['consoleMessages']if 'GNU_SCHED_TRACE' in x['text']];assert len(rows)==82
 for row in rows:
  assert row['nr']in [118,119,121];n=3 if row['nr']==119 else 2;assert all(x==0 for x in row['args'][n:])
 assert any(r['nr']==119 and r['args'][1]==3 and r['ret']==0 for r in rows)
 for nr in [118,121]:
  assert any(r['nr']==nr and r['ret']==0 for r in rows)
  for error in [-22,-3]:assert any(r['nr']==nr and r['ret']==error for r in rows)
 traces[mode]=rows;runs[mode]={'passes':base['jit']['passes'],'failures':0,'browserPid':base['browserPid'],'browserExit':base['browserExit'],'serverClosed':True,'schedulerTraces':len(rows),'gate':gate,'allocatorLocks':base['allocatorLocks']}
(D/'scheduler-transport.json').write_text(json.dumps(traces,indent=2)+'\n')
supervision={}
for p in (T/'logs/supervision').glob('*.json'):
 j=json.loads(p.read_text());expected=1 if p.stem in ['wrappers','wrappers2']else 0;assert j['exit']==expected and not j['terminalMembers'];supervision[p.stem]=j
inherited=json.loads((T/'logs/inherited-source-verification.json').read_text());assert inherited['pass']and inherited['verifiedObjectsCopiedAfterSourceRecheck']==191
result={'pass':True,'phase':'prepared for root freeze review','runs':runs,'linkObjects':201,'formats':formats,'objects':objectRows,'GNUUnits':newUnits,'actualMakeTargets':makeObjects,'selectedGNUWrapperAudit':str(T/'logs/wrapper-audit/result.json'),'headers':headers,'driverAttempts':drivers,'layout':{'GNU_sched_param':[4,4,0],'GNU_sem_t':[16,4],'GNU_new_sem':[16,4],'USE_64B_ATOMICS_ON_SEM_T':0,'GNU_pthread_attr':32,'GNU_pthread':[1184,32]},'imports':imports,'deadCodeScope':'actual GNU sem_wait.c compiled; only sem_trywait reachable. Blocking sem_wait/cancellation not accepted. No unresolved-symbol suppression or replacement cancel/abort providers.','inheritedSourcesAndSnapshots':inherited['sourcesAndSnapshots'],'supervision':supervision,'taskKiB':int(subprocess.check_output(['du','-sk',str(T)]).split()[0]),'limits':['no full libc/sysroot/Nightly','no default NPTL/create/join/cancellation/destructors','no blocking semaphore wait/wake acceptance','single-arena allocator policy retained','bad-address EFAULT path not covered']}
(T/'prepared-acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'pass':True,'runs':runs,'GNUUnits':5,'makeTargets':4,'objects':201,'headers':len(headers),'taskKiB':result['taskKiB']}))
