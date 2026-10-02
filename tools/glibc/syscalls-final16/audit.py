#!/usr/bin/env python3
import os,pathlib,json,hashlib,re,subprocess,shlex
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent
D=lambda p:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
load=lambda p:json.loads(p.read_text())
reuse=load(T/'logs/reuse-coherent-runtime.json');assert reuse['pass'] and reuse['objects']==213 and reuse['commonMatchingObjects']==190
for row in reuse['rows']:
 assert D(pathlib.Path(row['path']))['sha256']==row['sha256']==D(pathlib.Path(row['snapshot']))['sha256']
for row in reuse['copiedObjects'] if 'copiedObjects' in reuse else []:pass
attempts=[];headers={}
for p in (T/'logs/c-attempts').glob('*/attempt.json'):
 j=load(p);assert D(pathlib.Path(j['sourceSnapshot']))['sha256']==j['sourceSha256'];assert D(pathlib.Path(j['driverSnapshot']))['sha256']==j['driverSha256'];attempts.append({'path':str(p),**j})
for p in (T/'objects').glob('*.d'):
 for word in shlex.split(p.read_text().replace('\\\n',' ').split(':',1)[1]):
  h=pathlib.Path(word)
  if h.is_file():headers[str(h.resolve())]=D(h)
objects=[];formats={}
for name in (T/'logs/final16-run2-link-inputs.txt').read_text().splitlines():
 p=pathlib.Path(name);b=p.read_bytes();f='Wasm-v1' if b[:8]==b'\0asm\1\0\0\0' else 'LLVM-bitcode' if b[:4]==b'BC\xc0\xde' else None;assert f;formats[f]=formats.get(f,0)+1;objects.append({'path':str(p),'format':f,**D(p)})
assert len(objects)==231 and formats=={'Wasm-v1':210,'LLVM-bitcode':21}
make=load(T/'logs/make-final16-result.json');assert make['pass'] and make['targetCount']==16
makeobjs=[]
for row in make['records']:
 for name in row['argv'][5:]:
  p=pathlib.Path(name);a=[x for x in attempts if x['output']==str(p) and x['pass']];assert a;assert a[-1]['objectSha256']==D(p)['sha256'];makeobjs.append({'path':str(p),**D(p),'attempt':a[-1]['path']})
assert len(makeobjs)==16
abi=(T/'logs/final16-run2-abi.log').read_text();imports=re.findall(r'^ - func\[\d+\].*? <- (.+)$',abi,re.M);assert sorted(imports)==['linux.copy_siginfo','linux.get_thread_area','linux.syscall']
functions=re.findall(r'^ - func\[\d+\] sig=\d+ <([^>]+)>',abi,re.M);assert not set(['__wrap_abort','__internal_syscall_cancel','__new_sem_wait','sem_wait'])&set(functions)
wrappers=load(T/'logs/wrapper-audit/result.json');assert wrappers['pass'] and len(wrappers['wrappers'])==16
layout=load(T/'logs/layout.json');assert layout['pass']
fixture=next(x for x in attempts if x['output']==str(T/'objects/guest/final16-fixture.o') and x['pass']);irpath=pathlib.Path(fixture['path']).parent/'front.ll';ir=irpath.read_text();names=[x['public']for x in load(R/'types.json')['entries']]
assert all(re.search(r'@p_'+n+r' = .*global ptr @'+n+r', align 4',ir)for n in names)
assert len(re.findall(r'load volatile ptr, ptr @p_',ir))>=16
(T/'logs/public-fixture-ir-audit.json').write_text(json.dumps({'pass':True,'volatilePublicFunctions':names,'attempt':fixture['path'],'rawIR':str(irpath),'sourceSha256':fixture['sourceSha256']},indent=2)+'\n')

selected=load(T/'logs/selected-final16-syscalls.json')['wrappers'];arities={str(x['planRow']['syscallNumber']):len(x['arguments']) for x in selected}
unsupported=[str(x['planRow']['syscallNumber']) for x in selected if x['kernel'] not in ['uname','sysinfo','epoll_ctl']]
runs={};traces={}
for mode in ['native','fpcast']:
 p=T/(mode+'-run2');base=load(p/'result.json');gate=load(p/'final16-result.json');assert base['pass'] and gate['pass'] and base['jit']['failures']==0 and base['serverClosed'] and base['browserExit']['code']==0;assert not pathlib.Path('/proc/'+str(base['browserPid'])).exists()
 rows=[json.loads(x['text'].split('GNU_FINAL16_TRACE ',1)[1]) for x in base['consoleMessages'] if 'GNU_FINAL16_TRACE ' in x['text']];assert rows
 parents=[r for r in rows if all(n in r for n in arities)];assert len(parents)==1,(mode,len(parents))
 for r in parents:
  for nr,n in arities.items():
   assert r[nr]['count']>=1
   for sample in r[nr]['samples']:assert all(v==0 for v in sample['args'][n:]),(nr,n,sample)
  for nr in unsupported:assert r[nr]['count']==(3 if nr=='289' else 2) and all(s['ret']==-38 for s in r[nr]['samples'])
  for nr in ['160','179']:assert {s['ret'] for s in r[nr]['samples']}=={0,-14}
  assert {s['ret']for s in r['21']['samples']}=={0,-17,-14,-2,-9,-22}
 traces[mode]=rows;runs[mode]={'passes':base['jit']['passes'],'failures':0,'gate':gate,'browserPid':base['browserPid'],'browserExit':base['browserExit'],'serverClosed':base['serverClosed'],'allocatorLocks':base['allocatorLocks'],'transportParents':len(parents)}
(T/'logs/transport-audit.json').write_text(json.dumps(traces,indent=2)+'\n')
supervision={}
for p in (T/'logs/supervision').glob('*.json'):
 j=load(p);assert not j['terminalMembers'];assert j['exit']==(1 if p.stem=='native1' else 0),(p,j);supervision[p.stem]=j
initial=load(T/'native-run1/result.json');assert not initial['pass'] and initial['guest']['exitStatus']==134 and initial['serverClosed'] and initial['browserExit']['code']==0;assert not pathlib.Path('/proc/'+str(initial['browserPid'])).exists()
result={'pass':True,'phase':'prepared for root freeze review','runs':runs,'linkObjects':len(objects),'formats':formats,'objects':objects,'actualMakeTargets':makeobjs,'headers':headers,'driverAttempts':attempts,'layout':layout,'imports':imports,'reuse':reuse,'selectedGNUWrapperAudit':str(T/'logs/wrapper-audit/result.json'),'supervision':supervision,'retainedFailure':{'native-run1':'FAIL134: new fixture payload allocation before provider/malloc initialization; corrected startup placement, original module/source/package retained'},'taskKiB':int(subprocess.check_output(['du','-sk',str(T)]).split()[0]),'limits':['13 genuine ENOSYS capabilities; no memory/pkey/quota/file-handle support','mprotect/madvise provider collisions deferred','no full libc/sysroot/Nightly/JIT/GPU','no default NPTL/cancellation/forced unwind/C++','single-arena manually reserved startup policy inherited','raw epoll_pwait readiness observer with NULL signal mask; no public cancellation wait acceptance']}
(T/'prepared-acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'pass':True,'runs':runs,'objects':231,'makeTargets':16,'taskKiB':result['taskKiB']}))
