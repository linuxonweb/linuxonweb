#!/usr/bin/env python3
"""Audit actual selected objects, compiler inputs and real guest evidence."""
import os,pathlib,json,hashlib,re,subprocess,shutil,tarfile
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(pathlib.Path(p).read_text())
def digest(p):
 p=pathlib.Path(p);return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
base=load(T/'logs/base-inputs.json');selection=load(T/'logs/selected-arity-objects.json');plan=load(T/'logs/arity-source-plan.json')
assert base['pass']and selection['pass']and selection['targets']==5
manifest=load(base['baseManifest'])
for name,row in manifest['files'].items():assert digest(name)==row,name
for name,row in base['originalAndSnapshotInputs']['inputs'].items():
 expected={k:row[k]for k in ['sha256','bytes']};assert digest(name)==expected==digest(row['snapshot']),name
paths=[pathlib.Path(x)for x in(T/'logs/link-inputs.txt').read_text().splitlines()];assert len(paths)==238 and len(set(paths))==238
objects=[];formats={}
for p in paths:
 magic=p.read_bytes()[:4];kind={b'\0asm':'Wasm-v1',b'BC\xc0\xde':'LLVM-bitcode'}[magic];formats[kind]=formats.get(kind,0)+1;objects.append({'path':str(p),'format':kind,**digest(p)})
assert formats=={'Wasm-v1':217,'LLVM-bitcode':21},formats
common=[]
for row in base['objects']:
 p=pathlib.Path(row['copy']);assert digest(row['original'])==digest(p)=={k:row[k]for k in ['sha256','bytes']}
 if p.name=='startup-run2.o':assert p not in paths
 else:assert p in paths;common.append(str(p))
assert len(common)==231 and not any(p.name=='jump-helpers.o'for p in paths)
inputs={};D=T/'source-snapshots/audit-inputs';D.mkdir(exist_ok=True)
def pin(p):
 p=pathlib.Path(p).resolve();assert p.is_file(),p
 if str(p)not in inputs:
  q=D/(digest(p)['sha256']+'-'+p.name)
  if not q.exists():shutil.copy2(p,q)
  assert digest(q)==digest(p);inputs[str(p)]={**digest(p),'snapshot':str(q)}
 return inputs[str(p)]
for row in selection['selected']:
 a=row['makeAttempt'];p=pathlib.Path(row['linkedObject']);assert p in paths and digest(p)['sha256']==a['objectSha256']==digest(a['output'])['sha256'];assert all(x['exit']==0 for x in a['stages'])and a['pass'];assert digest(a['source'])==digest(a['sourceSnapshot'])and digest(a['source'])['sha256']==row['overrideSha256']==a['sourceSha256'];assert digest(a['driverSnapshot'])['sha256']==a['driverSha256'];assert pathlib.Path(a['cwd']).name=='misc'
 for field in ['source','sourceSnapshot','driverSnapshot','output']:pin(a[field])
 assert pathlib.Path(row['originalStreamRetained']).read_bytes()==pathlib.Path(row['source']['path']).read_bytes()==pathlib.Path(row['sourceSnapshot']['path']).read_bytes()
 for field in ['source','sourceSnapshot','retainedCommands']:pin(row[field]['path'])
 pin(row['originalStreamRetained'])
 for field in ['originalArgs']:
  assert '-c'in a[field]and '../sysdeps/unix/sysv/linux/wasm32/'+p.name.replace('arity-','').replace('.o','.c')in a[field]
make=load(T/'logs/make-arity-result.json');assert make['exit']==0
attempts=[]
for name in ['arity-fixture.o','startup.o']:
 p=T/'objects/guest'/name;candidates=[]
 for q in(T/'logs/c-attempts').glob('*/attempt.json'):
  a=load(q)
  if a.get('pass')and a.get('output')==str(p)and a.get('objectSha256')==digest(p)['sha256']:candidates.append((q,a))
 assert candidates,name
 q,a=candidates[-1];assert digest(a['sourceSnapshot'])['sha256']==a['sourceSha256']==digest(a['source'])['sha256'];assert digest(a['driverSnapshot'])['sha256']==a['driverSha256'];assert all(x['exit']==0 for x in a['stages']);attempts.append(a)
 for field in ['source','sourceSnapshot','driverSnapshot']:pin(a[field])
 if name=='arity-fixture.o':fixtureIR=(q.parent/'front.ll').read_text();pin(q.parent/'front.ll')
for dep in [T/'objects/arity-fixture.d',T/'objects/arity-startup.d',*[T/'objects/fullmake/misc'/(pathlib.Path(x['unit']).name+'.dt')for x in selection['selected']]]:
 text=dep.read_text().replace('\\\n',' ');first=text.split('\n\n')[0];tokens=first.split(':',1)[1].split()
 for token in tokens:
  p=pathlib.Path(token);p=p if p.is_absolute()else T/'source/glibc-2.44/misc'/p
  if p.is_file():pin(p)
 pin(dep)
public=[]
with tarfile.open(os.environ['GNU_RELEASE_ARCHIVE'])as archive:
 for rel in ['posix/unistd.h','sysdeps/unix/sysv/linux/sys/prctl.h','sysdeps/unix/sysv/linux/Versions']:
  p=T/'source/glibc-2.44'/rel;assert p.read_bytes()==archive.extractfile('glibc-2.44/'+rel).read();public.append({'path':str(p),**pin(p)})
for variable,function in [('p_sync','sync'),('p_vhangup','vhangup'),('p_prctl','prctl'),('p_time64','__prctl_time64'),('p_init','init_module'),('p_delete','delete_module')]:
 assert re.search(r'@'+variable+r' = internal global ptr @'+function+r'\b',fixtureIR)and 'load volatile ptr, ptr @'+variable in fixtureIR
arity=set()
for line in fixtureIR.splitlines():
 if 'call i32 (i32, ...)'in line:arity.add(len(re.findall(r'\b(?:i32|ptr) noundef\b',line))-1)
assert set(range(5))<=arity,arity
pr=next(r for r in selection['selected']if r['unit']=='misc/prctl.o');prIR=(pathlib.Path(pr['makeAttempt']['sourceSnapshot']).parent/'front.ll').read_text()
dispatchIR=prIR.split('define internal i32 @argument_words',1)[1].split('\n}',1)[0]
assert len(re.findall(r'i32 \d+, label',dispatchIR))==79
for line in ['@prctl = weak hidden alias i32 (i32, ...), ptr @__prctl','@__prctl_time64 = weak hidden alias i32 (i32, ...), ptr @__prctl','define hidden i32 @__prctl(i32 noundef %0, ...)']:assert line in prIR
optionRows=load(R/'prctl-options.json')['options'];matrix={r['option']:r['argumentWords']for r in optionRows};assert len(matrix)==79
K=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/s6qc0any0wby0f4nnivpaanvqb9hl130-source')
generic=(K/'kernel/sys.c').read_text().split('SYSCALL_DEFINE5(prctl,',1)[1].split('SYSCALL_DEFINE',1)[0]
security=(K/'security/commoncap.c').read_text().split('int cap_task_prctl(',1)[1].split('\n}\n',1)[0]
cases=lambda s:set(re.findall(r'^\tcase (PR_[A-Z_]+):',s,re.M))
genericCases=cases(generic);securityCases=cases(security);assert len(genericCases)==72 and len(securityCases)==7 and genericCases|securityCases==set(matrix)
controlled=(R/'prctl.c').read_text().split('static unsigned argument_words',1)[1].split('int __prctl',1)[0];compiled={}
pending=[]
for line in controlled.splitlines():
 m=re.search(r'case (PR_[A-Z_]+):',line)
 if m:pending.append(m[1])
 m=re.search(r'return ([0-4]);',line)
 if m:
  for name in pending:compiled[name]=int(m[1])
  pending=[]
assert compiled==matrix
config=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/mzbhr58f5fk50b15xfrk68mwsdg4xs1c-source/.config');assert digest(config)['sha256']=='58a7183fed206cddffbc291c32ea0393d9c30f3dc6fa4b827873164a3737d485';assert '# CONFIG_SECURITY is not set'in config.read_text();pin(config)
for name,row in plan['kernelSources'].items():assert digest(name)==digest(row['snapshot'])=={k:row[k]for k in ['sha256','bytes']};pin(name);pin(row['snapshot'])
kernel=pathlib.Path(plan['kernel']['path']);assert digest(kernel)=={k:plan['kernel'][k]for k in ['sha256','bytes']};pin(kernel)
kernelBodies=load(T/'logs/kernel-bodies.json');assert kernelBodies['kernelSha256']==digest(kernel)['sha256'];assert all(x['functions']for x in kernelBodies['entries']);assert next(x for x in kernelBodies['entries']if x['call']=='cap_task_prctl')['functions'][0]['bodySize']==842
for entry in kernelBodies['entries']:
 for b in entry['functions']:assert hashlib.sha256(kernel.read_bytes()[b['bodyOffset']:b['bodyOffset']+b['bodySize']]).hexdigest()==b['bodySha256']
abi=(T/'logs/abi.log').read_text();imports=re.findall(r'^ - func\[\d+\].*? <- (.+)$',abi,re.M);assert sorted(imports)==['linux.copy_siginfo','linux.get_thread_area','linux.syscall'];assert 'env.memory'in abi
functions=re.findall(r'^ - func\[\d+\] sig=\d+ <([^>]+)>',abi,re.M);assert not set(['__wrap_abort','__internal_syscall_cancel','sem_wait','__new_sem_wait'])&set(functions)
runs={}
gates=['arity','final16','stat','next26','fixed','fenv','c-cleanup','warnings','syscalls','jumps']
for mode,directory,package,module in [('native','native-run3','native-package3','arity-v3.wasm'),('fpcast','fpcast-run2','fpcast-package3','arity-v3-fpcast.wasm')]:
 d=T/directory;b=load(d/'result.json');assert b['pass']and b['jit']['failures']==0 and b['jit']['exitStatus']==0 and b['serverClosed']and b['browserExit']['code']==0;assert b['allocatorLocks']['waits']>0 and b['allocatorLocks']['woken']>0 and b['allocatorLocks']['errors']==0
 reports={}
 for gate in gates:reports[gate]=load(d/(gate+'-result.json'));assert reports[gate]['pass']
 assert reports['arity']['runs']==6 and reports['arity']['threads']==1 and reports['arity']['isolated']and all(v for k,v in reports['arity']['transport'].items());assert reports['jumps']['diagnostics']==3 and all(r['pass']for r in reports['jumps']['negative'])
 for path,sha in b['inputs'].items():assert digest(path)['sha256']==sha,path;pin(path)
 build=load(T/package/'build.json');assert build['pass']and build['sha256']==digest(T/'objects'/module)['sha256'];assert build['archiveSha256']==digest(T/package/'initramfs.cpio')['sha256'];assert build['taskLocalWorkerSha256']==digest(T/'source/worker.js')['sha256']
 traces=[json.loads(x['text'].split('GNU_ARITY_TRACE ',1)[1])for x in b['consoleMessages']if 'GNU_ARITY_TRACE 'in x['text']];samples=[s for trace in traces for s in trace.get('167',{}).get('samples',[])];optionsSeen={s['args'][0]for s in samples};assert {7,8,23,24,27,28,47}<=optionsSeen
 assert any(s['args'][0]==28 and s['args'][1]==-1 and s['ret']==-1 for s in samples);assert any(s['args'][0]==47 and s['args'][3]==1 and s['ret']==-22 for s in samples)
 runs[mode]={'directory':str(d),'passes':b['jit']['passes'],'failures':0,'module':{'path':str(T/'objects'/module),**digest(T/'objects'/module)},'package':str(T/package),'gates':reports,'allocatorLocks':b['allocatorLocks'],'arityTraceRecords':len(traces),'observedPrctlOptions':sorted(optionsSeen),'browserPid':b['browserPid'],'browserExit':b['browserExit'],'serverClosed':True}
terminal=load(T/'external-terminal-proof.json');assert terminal['pass'];supervision={}
expectedFailures={'build1','build2','link3','native1','fpcast1'}
for p in(T/'logs/supervision').glob('*.json'):
 j=load(p);assert j['exit']==(1 if p.stem in expectedFailures else 0)and not j['terminalMembers'];supervision[p.stem]=j
assert expectedFailures<=set(supervision)
assert not load(T/'native-run1/arity-result.json')['pass']and load(T/'native-run1/result.json')['pass'];assert load(T/'native-run2/arity-result.json')['pass']
for p in [R/'fixture.c',R/'prctl.c',T/'source/startup.c',T/'source/worker.js',T/'source/index.html',T/'objects/arity-v3.wasm',T/'objects/arity-v3-fpcast.wasm',*paths]:pin(p)
(T/'logs/current-original-snapshot-inputs.json').write_text(json.dumps({'pass':True,'inputs':inputs},indent=2)+'\n')
result={'pass':True,'phase':'prepared for root freeze review','linkObjects':238,'formats':formats,'objects':objects,'unchangedBaseObjects':231,'replacedBaseObject':'startup-run2.o','baseInputs':base,'selectedProviders':selection['selected'],'make':make,'clientAndStartupAttempts':attempts,'publicHeaderMeasurements':{'volatilePublicRefs':6,'variadicArgumentCounts':sorted(arity),'nameGuardBytes':48,'namePayloadBytes':16,'nameAfterOffset':32,'intGuardBytes':36,'intPayloadBytes':4,'intAfterOffset':20},'unchangedGNUHeaders':public,'prctlMatrix':{'genericSourceCases':72,'capabilitySourceCases':7,'options':optionRows,'actualConfig':{'path':str(config),**digest(config)},'dispatchPolicy':'Explicit kernel-consumed operands; reserved argument validators require all four explicit operands. Unknown options read none. Future option behavior and full public prctl acceptance pending.'},'kernelBodies':kernelBodies,'inputs':inputs,'imports':imports,'runs':runs,'supervision':supervision,'terminal':terminal,'retainedFailures':['build1 stale generated metadata before architecture overlay','build2 duplicate old/new startup object','link3 missing getpgrp provider; fixture corrected to accepted getpgid(0)','native1 shell-fork session precondition and misplaced observer source; main allocator gate passed but overall arity failed','fpcast1 invalid harness mode before browser launch'],'priorScopedPass':'native2 earlier 72-option module passed; preserved old module/package/source snapshots; newest acceptance uses unique v3 module/package and native3/fpcast2','limits':['GNUmake-selected owned architecture C implementations; no GNU-authored upstream Wasm implementations','init_module/delete_module historical GLIBC_2.0 exports have no current GNU public header; owned declarations match selected current Linux3/2 operand signatures','79-option dispatch design, bounded measured option behavior only; no full prctl acceptance or missing-required-argument caller support','single-arena explicitly tuned policy and manually reserved genuine GNU TLS startup inherited','old memory provider unchanged; actual GNUmake memory integration remains separate','no full libc/sysroot/NPTL/cancellation/forced unwind/C++/Nightly/JIT/GPU/release acceptance']}
(T/'prepared-acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'pass':True,'objects':238,'formats':formats,'common':231,'runs':{k:v['passes']for k,v in runs.items()},'sourcePins':len(inputs),'groups':len(supervision)}))
