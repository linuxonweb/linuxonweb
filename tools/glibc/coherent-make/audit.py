#!/usr/bin/env python3
"""Audit fresh coherent GNU make objects, archives, sources and actual failures."""
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
def archive_members(data):
 assert data.startswith(b'!<arch>\n'), 'unsupported or partial archive'
 rows=[];i=8;names=b''
 while i<len(data):
  assert i+60<=len(data) and data[i+58:i+60]==b'`\n', 'truncated archive header'
  h=data[i:i+60];size=int(h[48:58]);start=i+60;end=start+size
  assert end<=len(data), 'truncated archive member'
  name=h[:16].decode('ascii').strip();body=data[start:end]
  i=end+(size%2)
  assert i<=len(data), 'missing archive padding'
  if name=='//':names=body;continue
  if name in ['/', '/SYM64/']:continue
  if name.startswith('#1/'):
   length=int(name[3:]);assert length<=len(body)
   name=body[:length].decode();body=body[length:]
  elif name.startswith('/') and name[1:].isdigit():
   offset=int(name[1:]);assert offset<len(names)
   stop=names.find(b'/\n',offset);assert stop>=offset
   name=names[offset:stop].decode()
  else:name=name.removesuffix('/')
  if name.startswith('__.SYMDEF'):continue
  if complete(body):kind='Wasm-v1'
  elif body.startswith(b'BC\xc0\xde'):
   z=subprocess.run([str(L/'llvm-dis'),'-','-o','/dev/null'],input=body,capture_output=True)
   kind='LLVM-bitcode' if z.returncode==0 else 'invalid-bitcode'
  elif name=='stamp.o' and re.fullmatch(rb'[A-Za-z0-9_./\s-]*',body):kind='GNU-text-stamp'
  else:kind='partial-or-unknown'
  rows.append({'index':len(rows),'name':name,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'format':kind})
 assert i==len(data)
 return rows
label=sys.argv[1] if len(sys.argv)>1 else 'run1'
assert re.fullmatch(r'[A-Za-z0-9_-]+',label)
reportLabel=sys.argv[2] if len(sys.argv)>2 else label
assert re.fullmatch(r'[A-Za-z0-9_-]+',reportLabel)
destination=T/'logs'/('coherent-audit-'+reportLabel+'.json')
assert not destination.exists(), 'preserve prior audit; select a unique label'
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
 try:
  row['orderedMemberAudit']=archive_members(p.read_bytes())
  row['completeObjectMembers']=sum(r['format'] in ['Wasm-v1','LLVM-bitcode'] for r in row['orderedMemberAudit'])
  row['unknownOrPartialMembers']=[r for r in row['orderedMemberAudit'] if r['format'] not in ['Wasm-v1','LLVM-bitcode','GNU-text-stamp']]
 except (AssertionError,ValueError,UnicodeDecodeError) as error:row['archiveAuditFailure']=str(error)
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
originalPacket=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])
originalManifest=originalPacket/'manifest.json'
assert digest(originalManifest)['sha256']=='8b53d66f81cbdc96a3b6b38491be44ec84c2fa9df4d09c3627b23de41bbae929'
originalPath=originalPacket/'logs/primary-failures.json'
assert digest(originalPath)==json.loads(originalManifest.read_text())['files'][str(originalPath)]
original=json.loads(originalPath.read_text())['failedUnits'];assert len(original)==168
old={str(pathlib.Path(r['target']).relative_to(originalPacket/'objects/fullmake')):r for r in original}
for row in failed:
 rel=str(pathlib.Path(row['output']).relative_to(O));text=row['diagnostic'];prior=old.get(rel)
 row['relativeTarget']=rel;row['originalClass']=prior['primaryClass'] if prior else None
 if 'no audited native Wasm public signature' in text:kind='unaudited generated syscall signature'
 elif '__builtin_return_address' in text or 'return address' in text:kind='native caller provenance'
 elif '__sched_priority' in text or 'incomplete definition of type' in text and 'sched_param' in text:kind='scheduler public structure selection'
 elif '.size' in text:kind='GNU cancellation assembly marker'
 elif 'unsupported' in text and ('asm' in text or '.globl' in text):kind='unadapted GNU assembly/alias metadata'
 elif 'called object type' in text or 'incomplete' in text:kind='actual C type or layout diagnostic requiring review'
 else:kind='new actual diagnostic requiring review'
 row['primaryClass']=kind
currentInterrupted=[r for r in incomplete if latest.get(r['output'])==r['proof']]
targetOutcomes={}
for target,proof in latest.items():
 j=json.loads(pathlib.Path(proof).read_text())
 successful=j.get('pass') is True if 'stages' in j else j.get('exit')==0
 failedNow=any(r['proof']==proof for r in currentFailed)
 status='failed' if failedNow else 'interrupted' if not successful else 'complete' if target in objects else 'GNU-text-stamp' if target in stamps else 'missing-or-invalid-output'
 targetOutcomes[target]={'latestProof':proof,'status':status,'completeArtifactExists':target in objects}
comparison=[]
for rel,oldrow in sorted(old.items()):
 key=str(O/rel);new=[r for r in currentFailed if r['output']==key]
 comparison.append({'target':rel,'originalClass':oldrow['primaryClass'],'status':'failed' if new else 'complete' if targetOutcomes.get(key,{}).get('status')=='complete' else 'attempted-incomplete' if key in targets else 'not-attempted','currentFailureProofs':[r['proof'] for r in new]})
counts={}
for row in currentFailed:counts[row['primaryClass']]=counts.get(row['primaryClass'],0)+1
cumulativePacket=pathlib.Path(os.environ['GLIBC_CUMULATIVE_PACKET'])
cumulativePath=cumulativePacket/'logs/cumulative-final-audit.json'
cumulativeManifest=json.loads((cumulativePacket/'manifest.json').read_text())['files']
assert digest(cumulativePacket/'manifest.json')['sha256']=='dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09'
assert digest(cumulativePath)==cumulativeManifest[str(cumulativePath)]
cumulative=json.loads(cumulativePath.read_text());cumulativeComparison=[]
for oldrow in cumulative['currentFailedTargets']:
 rel=pathlib.Path(oldrow['output']).relative_to(cumulativePacket/'objects/fullmake').as_posix()
 key=str(O/rel);outcome=targetOutcomes.get(key)
 cumulativeComparison.append({'target':rel,'priorFailureProof':oldrow['proof'],'priorClass':oldrow['primaryClass'],'currentStatus':outcome['status'] if outcome else 'not-attempted','currentProof':outcome['latestProof'] if outcome else None})
# Actual include files consumed by successful or failed compiler units, separate from inferred headers.
headers={};dependencyFiles={};missingDependencies=[]
for dep in sorted({*O.rglob('*.dt'),*O.rglob('*.d')}):
 dependencyFiles[str(dep)]=digest(dep)
 text=dep.read_text(errors='strict').replace('\\\n',' ')
 cwd=S/dep.relative_to(O).parent
 # GNU postprocesses .dt into .d, replacing source/build roots with these
 # Make variables. Expand only the explicitly audited names, never eval.
 for line in text.splitlines():
  if ':' not in line:continue
  for name in re.split(r'\s+',line.partition(':')[2].strip()):
   if not name or name=='\\':continue
   original=name
   for variable,value in [('$(common-objpfx)',str(O)+'/'),('$(..)',str(S)+'/'),('$(objpfx)',str(O/dep.relative_to(O).parent)+'/')]:name=name.replace(variable,value)
   assert '$' not in name,('unknown GNU dependency variable',dep,name)
   p=pathlib.Path(name);p=(p if p.is_absolute() else cwd/p).resolve()
   if p.is_file():headers[str(p)]=digest(p)
   else:missingDependencies.append({'dependencyFile':str(dep),'token':original,'resolved':str(p)})
drivers={}
for row in [*attempts,*queries]:
 p=pathlib.Path(row['driverSnapshot']);h=digest(p)
 assert h['sha256']==row['driverSha256']
 drivers.setdefault(h['sha256'],{'snapshot':str(p),'records':[]})['records'].append(row['proof'])
makeLog=T/'logs'/('fullmake-'+label+'.log')
makeErrors=[line for line in makeLog.read_text(errors='replace').splitlines() if re.search(r'make(?:\[\d+\])?: \*\*\*',line)]
headerStatus={'installationAttempted':False,'installationAccepted':False,'sysrootDirectoryExists':(T/'sysroot').exists(),'generatedStubLists':{str(p):digest(p) for p in sorted(O.rglob('stubs')) if p.is_file()},'generatedGNUHeaders':{str(p):digest(p) for p in sorted((O/'gnu').rglob('*.h')) if p.is_file()}}
report={'scope':'finite genuine coherent GNU make discovery; no archive/runtime/sysroot acceptance','inventoryLabel':label,'reportLabel':reportLabel,'validationScope':'Wasm-v1 magic and complete section framing; LLVM bitcode parsed by llvm-dis; no runtime acceptance','exit':exitProof,'objectCounts':{k:sum(r['format']==k for r in objects.values()) for k in ['Wasm-v1','LLVM-bitcode']},'objects':objects,'GNUTextStamps':stamps,'partialOrUnknownOutputs':partial,'archives':archives,'headers':headerStatus,'attemptedObjectTargets':len(targets),'targetProofs':targets,'targetOutcomes':targetOutcomes,'targetOutcomeCounts':{k:sum(r['status']==k for r in targetOutcomes.values()) for k in ['complete','failed','interrupted','GNU-text-stamp','missing-or-invalid-output']},'CCompilerAttempts':len(attempts),'nonCOrConfigureQueries':len(queries),'failedObjectAttempts':failed,'currentFailedTargets':currentFailed,'interruptedAttempts':incomplete,'currentInterruptedTargets':currentInterrupted,'failureClasses':counts,'sources':sources,'actualIncludes':headers,'dependencyFiles':dependencyFiles,'missingDependencies':missingDependencies,'executedDrivers':drivers,'makeLog':{'path':str(makeLog),**digest(makeLog)},'makeErrorLines':makeErrors,'original168Comparison':comparison,'originalComparisonCounts':{k:sum(r['status']==k for r in comparison) for k in ['complete','failed','attempted-incomplete','not-attempted']},'cumulativeFailureComparisonSource':{'path':str(cumulativePath),**digest(cumulativePath)},'cumulativeFailureComparison':cumulativeComparison,'cumulativeComparisonCounts':{k:sum(r['currentStatus']==k for r in cumulativeComparison) for k in ['complete','failed','interrupted','GNU-text-stamp','missing-or-invalid-output','not-attempted']}}
destination.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['objectCounts','attemptedObjectTargets','CCompilerAttempts','nonCOrConfigureQueries','failureClasses','originalComparisonCounts']},indent=2))
