#!/usr/bin/env python3
"""Supplement the retained discovery audit with exact classification and lineage."""
import collections,hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';O=T/'objects/fullmake'
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def put(name,data):
 p=T/'logs'/name;assert not p.exists();p.write_text(json.dumps(data,indent=2)+'\n')
p=T/'logs/cumulative-audit.json';j=json.loads(p.read_text())
assert j['exit']['exit']==2 and not j['exit']['processGroupLiveMembers']
# Audit1's broad asm-text heuristic also matched macro notes in missing syscall
# diagnostics. Preserve its report; classify the actual error and source here.
failures=[]
for r in j['currentFailedTargets']:
 q=dict(r)
 if r['originalClass']=='omitted kernel memory syscalls':
  assert r['relativeTarget'] in ['misc/brk.o','misc/mmap64.o','misc/mremap.o']
  assert 'undeclared identifier' in r['diagnostic'] and '__NR_' in r['diagnostic']
  q['primaryClass']='omitted kernel memory syscalls'
 elif r['relativeTarget']=='io/xstatconv.o':
  assert 'incomplete' in r['diagnostic'] and 'struct kernel_stat' in r['diagnostic']
  q['primaryClass']='legacy kernel stat conversion source selection'
 failures.append(q)
versions={}
for root,file in [('c-attempts','attempt.json'),('compiler-queries','command.json')]:
 for p in sorted((T/'logs'/root).glob('*/'+file)):
  r=json.loads(p.read_text());s=pathlib.Path(r['driverSnapshot']);d=digest(s)
  assert d['sha256']==r['driverSha256']
  versions.setdefault(r['driverSha256'],[]).append({'proof':str(p),'snapshot':str(s),'cwd':r['cwd']})
for group in ['objects','actualIncludes']:
 for name,r in j[group].items():assert digest(pathlib.Path(name))['sha256']==r['sha256'],name
for r in failures:
 proof=pathlib.Path(r['proof']);a=json.loads(proof.read_text())
 if 'sourceSnapshot' in a:assert digest(pathlib.Path(a['sourceSnapshot']))['sha256']==a['sourceSha256']
 else:
  for source in a['sources']:assert digest(pathlib.Path(source['snapshot']))['sha256']==source['sha256']
recipes={}
pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent/'source/glibc-2.44'
for name,ranges in [('Makefile',[(424,470)]),('Makerules',[(793,813),(1140,1175),(1420,1449)])]:
 p=S/name;expected=(pristine/name).read_bytes();hook=None
 if name=='Makerules':
  old=b'# Even before that, we need abi-versions.h which is generated right here.\nifeq ($(build-shared),yes)'
  new=old.replace(b'ifeq ($(build-shared),yes)',b'ifneq (,$(filter yes,$(build-shared))$(filter wasm32,$(base-machine)))')
  assert expected.count(old)==1;expected=expected.replace(old,new)
  hook='accepted wasm32 abi-versions.h generation hook only; install/stubs recipes unchanged'
 assert p.read_bytes()==expected
 lines=p.read_text().splitlines();recipes[name]={'hash':digest(p),'pristine':str(pristine/name),'architectureHook':hook,'ranges':[{'first':a,'last':b,'text':'\n'.join(lines[a-1:b])} for a,b in ranges]}
headers={'scope':'installation not attempted; generated headers are build metadata, not installed sysroot acceptance','sysrootExists':(T/'sysroot').exists(),'installedGNUStubsExists':(T/'sysroot/include/gnu/stubs.h').exists(),'generatedSubdirStubLists':[str(p) for p in O.glob('*/stubs')],'recipes':recipes}
counts=dict(collections.Counter(r['primaryClass'] for r in failures))
report={'pass':True,'scope':'discovery evidence only; GNU make remains FAIL','basis':{'path':str(T/'logs/cumulative-audit.json'),'hash':digest(T/'logs/cumulative-audit.json')},'currentFailureClasses':counts,'currentFailedTargets':failures,'driverVersions':versions,'archiveCount':len(j['archives']),'installHeaderEvidence':headers,'original168ComparisonCounts':j['originalComparisonCounts'],'objectCounts':j['objectCounts'],'GNUTextStamps':len(j['GNUTextStamps']),'partialOutputs':len(j['partialOrUnknownOutputs']),'actualIncludeCount':len(j['actualIncludes']),'sourceCount':len(j['sources'])}
put('cumulative-final-audit.json',report)
print(json.dumps({k:report[k] for k in ['pass','objectCounts','GNUTextStamps','partialOutputs','currentFailureClasses','original168ComparisonCounts']},indent=2))
