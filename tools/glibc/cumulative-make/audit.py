#!/usr/bin/env python3
"""Audit actual finite cumulative GNU make outcomes, not inherited runtime objects."""
import hashlib,json,os,pathlib,re,subprocess,tarfile,sys
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';O=T/'objects/fullmake';L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def complete(b):
 if len(b)<=8 or b[:8]!=b'\0asm\1\0\0\0':return False
 i=8
 while i<len(b):
  i+=1;n=shift=0
  while True:
   if i>=len(b) or shift>35:return False
   c=b[i];i+=1;n|=(c&127)<<shift
   if not c&128:break
   shift+=7
  i+=n
  if i>len(b):return False
 return i==len(b)
label=sys.argv[1] if len(sys.argv)>1 else 'run2'
exitProof=json.loads((T/'logs'/('inventory-'+label+'-exit.json')).read_text());assert not exitProof['processGroupLiveMembers']
objects={};partial={};stamps={};archives={}
for p in sorted(p for p in O.rglob('*') if p.is_file() and p.suffix in ['.o','.os','.oS']):
 b=p.read_bytes();row=digest(p)
 if complete(b):row['format']='Wasm-v1';objects[str(p)]=row
 elif b.startswith(b'BC\xc0\xde'):
  z=subprocess.run([str(L/'llvm-dis'),str(p),'-o','/dev/null'],capture_output=True);row.update(format='LLVM-bitcode',validationExit=z.returncode)
  (objects if z.returncode==0 else partial)[str(p)]=row
 elif p.name=='stamp.o' and re.fullmatch(rb'[A-Za-z0-9_./\s-]*',b):
  row['format']='GNU-text-stamp';stamps[str(p)]=row
 else:row['format']='partial-or-unknown';partial[str(p)]=row
for p in sorted(O.rglob('*.a')):
 row=digest(p);z=subprocess.run([str(L/'llvm-ar'),'t',str(p)],capture_output=True,text=True);row.update(listExit=z.returncode,members=z.stdout.splitlines(),stderr=z.stderr)
 archives[str(p)]=row
attempts=[];targets={};failed=[];incomplete=[];queries=[];sources={}
for p in sorted((T/'logs/c-attempts').glob('*/attempt.json')):
 j=json.loads(p.read_text());row={'proof':str(p),**j};attempts.append(row);q=pathlib.Path(j['source']);sources[str(q)]={'snapshot':j['sourceSnapshot'],'sha256':j['sourceSha256']}
 if pathlib.Path(j['output']).is_relative_to(O) and pathlib.Path(j['output']).parent!=O:targets.setdefault(j['output'],[]).append(str(p))
 if j.get('pass') is False and pathlib.Path(j['output']).parent!=O:
  bad=next(s for s in j['stages'] if s.get('exit',0)!=0);log=p.parent/(bad['stage']+'.log');text=log.read_text(errors='replace');failed.append({**row,'failedStage':bad['stage'],'diagnostic':text,'primaryClass':None})
 elif not j.get('pass') and pathlib.Path(j['output']).parent!=O:incomplete.append(row)
for p in sorted((T/'logs/compiler-queries').glob('*/command.json')):
 j=json.loads(p.read_text());queries.append({'proof':str(p),**j});a=j['argv']
 if '-o' in a:
  q=pathlib.Path(a[a.index('-o')+1]);q=q if q.is_absolute() else pathlib.Path(j['cwd'])/q
  if q.suffix in ['.o','.os','.oS'] and q.is_relative_to(O) and q.parent!=O:targets.setdefault(str(q),[]).append(str(p))
 for source in j['sources']:sources[source['source']]={'snapshot':source['snapshot'],'sha256':source['sha256']}
 if j.get('exit',0)!=0 and '-c' in a:
  q=pathlib.Path(a[a.index('-o')+1]) if '-o' in a else None
  if q and not q.is_absolute():q=pathlib.Path(j['cwd'])/q
  if q and q.is_relative_to(O) and q.parent!=O:failed.append({'proof':str(p),'output':str(q),'sources':j['sources'],'cwd':j['cwd'],'failedStage':'assembler/non-C compiler','diagnostic':(p.parent/'stderr').read_text(errors='replace'),'argv':a,'exit':j['exit'],'primaryClass':None})
# Pin actual genuine bodies and distinguish owned architecture sources explicitly.
needed={pathlib.Path(n).relative_to(S).as_posix() for n in sources if pathlib.Path(n).is_relative_to(S)};pristine={}
with tarfile.open(os.environ['GNU_RELEASE_ARCHIVE'],'r:xz') as f:
 for member in f:
  name=member.name.removeprefix('glibc-2.44/')
  if name in needed and member.isfile():pristine[name]=hashlib.sha256(f.extractfile(member).read()).hexdigest()
for name,row in sources.items():
 p=pathlib.Path(name);row['currentExists']=p.exists();assert not p.exists() or digest(p)['sha256']==row['sha256'];assert digest(pathlib.Path(row['snapshot']))['sha256']==row['sha256']
 if p.is_relative_to(S):
  assert p.exists(),('GNU source missing',p)
  rel=p.relative_to(S).as_posix();row.update(relativeGNUPath=rel,pristineSha256=pristine.get(rel),unchangedGNU=pristine.get(rel)==row['sha256'],ownedArchitecture=rel.startswith(('sysdeps/wasm32/','sysdeps/unix/sysv/linux/wasm32/')))
  assert row['unchangedGNU'] or row['ownedArchitecture'],('unexpected upstream body change',rel)
 else:row['generatedOrConfigure']=True
# Historical failed attempts remain separate from each target's latest status.
latest={target:max(proofs,key=lambda n:pathlib.Path(n).stat().st_mtime_ns) for target,proofs in targets.items()}
currentFailed=[r for r in failed if latest.get(r['output'])==r['proof']]
original=json.loads((pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])/'logs/primary-failures.json').read_text())['failedUnits'];old={str(pathlib.Path(r['target']).relative_to(pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])/'objects/fullmake')):r for r in original}
for row in failed:
 rel=str(pathlib.Path(row['output']).relative_to(O));text=row['diagnostic'];prior=old.get(rel)
 row['relativeTarget']=rel;row['originalClass']=prior['primaryClass'] if prior else None
 if 'no audited native Wasm public signature' in text:kind='unaudited generated syscall signature'
 elif '__builtin_return_address' in text or 'return address' in text:kind='native caller provenance'
 elif '__sched_priority' in text or 'incomplete definition of type' in text and 'sched_param' in text:kind='scheduler public structure selection'
 elif '.size' in text:kind='GNU cancellation assembly marker'
 elif 'unsupported' in text and ('asm' in text or '.globl' in text):kind='unadapted GNU assembly/alias metadata'
 elif prior:kind=prior['primaryClass']
 else:kind='new actual diagnostic requiring review'
 row['primaryClass']=kind
comparison=[]
for rel,oldrow in sorted(old.items()):
 key=str(O/rel);new=[r for r in currentFailed if r['output']==key]
 comparison.append({'target':rel,'originalClass':oldrow['primaryClass'],'status':'complete' if key in objects else 'failed' if new else 'attempted-incomplete' if key in targets else 'not-attempted','currentFailureProofs':[r['proof'] for r in new]})
counts={}
for row in currentFailed:counts[row['primaryClass']]=counts.get(row['primaryClass'],0)+1
# Actual include files consumed by successful or failed compiler units, separate from inferred headers.
headers={}
for dep in sorted(O.rglob('*.dt')):
 text=dep.read_text(errors='replace').replace('\\\n',' ')
 cwd=S/dep.relative_to(O).parent
 for name in re.split(r'\s+',text.partition(':')[2].strip()):
  if not name or name=='\\':continue
  p=pathlib.Path(name);p=(p if p.is_absolute() else cwd/p).resolve()
  if p.is_file():headers[str(p)]=digest(p)
report={'scope':'finite genuine cumulative GNU make discovery; no archive/runtime/sysroot acceptance','exit':exitProof,'objectCounts':{k:sum(r['format']==k for r in objects.values()) for k in ['Wasm-v1','LLVM-bitcode']},'objects':objects,'GNUTextStamps':stamps,'partialOrUnknownOutputs':partial,'archives':archives,'attemptedObjectTargets':len(targets),'targetProofs':targets,'CCompilerAttempts':len(attempts),'nonCOrConfigureQueries':len(queries),'failedObjectAttempts':failed,'currentFailedTargets':currentFailed,'interruptedAttempts':incomplete,'failureClasses':counts,'sources':sources,'actualIncludes':headers,'original168Comparison':comparison,'originalComparisonCounts':{k:sum(r['status']==k for r in comparison) for k in ['complete','failed','attempted-incomplete','not-attempted']}}
(T/'logs/cumulative-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['objectCounts','attemptedObjectTargets','CCompilerAttempts','nonCOrConfigureQueries','failureClasses','originalComparisonCounts']},indent=2))
