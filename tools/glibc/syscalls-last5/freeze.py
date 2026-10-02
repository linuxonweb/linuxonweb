#!/usr/bin/env python3
"""Freeze reviewed five-wrapper evidence from an external supervision task."""
import hashlib,json,os,pathlib,re,shutil,subprocess

assert os.environ.get('GLIBC_LAST5_FREEZE_AUTHORIZED')=='1', 'independent review authorization required'
T=pathlib.Path(os.environ['GLIBC_LAST5_PACKET']).resolve()
assert T!=pathlib.Path(os.environ['GLIBC_TASK']).resolve(), 'external supervision workspace required'
R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
B=pathlib.Path(os.environ['GLIBC_CHECKED_RUNTIME_PACKET']).resolve()
C=pathlib.Path(os.environ['GLIBC_CUMULATIVE_PACKET']).resolve()
P=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']).resolve()
E=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']).resolve()
L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']).resolve()

def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}

def members(group):
 live=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   a=p.read_text().rsplit(')',1)[1].split()
   if int(a[2])==group and a[0]!='Z':live.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return live

assert not any((T/n).exists() for n in ['manifest.json','repository-freeze.json','acceptance.json'])
anchors=[(B,'12fbdae877de5e2f639df6152106c00c08536a0b2046dbc8d29edf50ab331c0d'),
 (C,'dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09'),
 (P,'4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042')]
files=set();maps={}
for packet,sha in anchors:
 p=packet/'manifest.json';assert digest(p)['sha256']==sha
 maps[packet]=json.loads(p.read_text())['files'];files.add(p)

def pin(p,expected=None):
 p=pathlib.Path(p).resolve();d=digest(p)
 if expected is not None:assert d==expected,(str(p),'hash drift')
 files.add(p);return d

auditPath=T/'logs/prepared-acceptance.json';audit=json.loads(auditPath.read_text())
assert audit['pass'] and audit['linkObjects']==239
assert audit['formats']=={'Wasm-v1':218,'LLVM-bitcode':21}
assert [r['passes'] for r in audit['runs']]==[48761,48756]
assert len(audit['includes'])==408
final=json.loads((T/'logs/final-runtime-inputs.json').read_text())
assert final['linkObjects']==239 and final['formats']==audit['formats']
for name,h in final['inputs'].items():
 d={k:h[k] for k in ['sha256','bytes']};pin(name,d);pin(h['snapshot'],d)
for name,h in audit['includes'].items():pin(name,h)
for row in audit['objects']:
 p=pathlib.Path(row['path']);pin(p,{k:row[k] for k in ['sha256','bytes']})
 magic=p.read_bytes()[:8]
 assert (magic==b'\0asm\1\0\0\0' if row['format']=='Wasm-v1' else magic[:4]==b'BC\xc0\xde')

plan=json.loads((T/'logs/plan.json').read_text());assert plan['pass']
for name,h in plan['inputHashes'].items():pin(name,h)
for row in plan['rows']:
 for name in ['source','sourceSnapshot','retainedCommands']:
  h=row[name];pin(h['path'],{k:h[k] for k in ['sha256','bytes']})
borrowed=json.loads((T/'logs/borrowed-inputs.json').read_text());assert borrowed['pass']
for row in borrowed['rows']:
 p=pathlib.Path(row['source']).resolve();pin(p,row['verified']);assert row['verified']==maps[P][str(p)]
 if 'snapshot' in row:pin(row['snapshot'],row['verified'])

reuse=json.loads((T/'logs/reuse-runtime.json').read_text());assert reuse['pass']
assert reuse['manifestHash']==digest(B/'manifest.json')
historical=[]
for row in reuse['inputs']:
 p=pathlib.Path(row['source']).resolve();pin(p,row['verified']);assert maps[B][str(p)]==row['verified']
 q=pathlib.Path(row['snapshot']).resolve()
 if q.is_relative_to(B):pin(q,row['verified'])
 else:
  historical.append({'historicalCopy':str(q),'immutableOriginal':str(p),'hash':row['verified'],
   'note':'startup/worker/index may evolve in the owned task; immutable original remains pinned'})
for row in reuse['objects']:
 d={k:row[k] for k in ['sha256','bytes']};p=pathlib.Path(row['original']).resolve()
 pin(p,d);assert maps[B][str(p)]==d;q=pathlib.Path(row['copy'])
 if q.exists():pin(q,d)
 else:
  assert q.name=='startup-run2.o'
  retained=T/'source-snapshots/inherited-startup-run2.o';pin(retained,d)
  historical.append({'historicalCopy':str(q),'retained':str(retained),'hash':d})

for root in [E/'logs/compiler',E/'source-snapshots/compiler',E/'objects/compiler']:
 for p in root.rglob('*'):
  if p.is_file():
   p=p.resolve();pin(p,maps[P][str(p)])
for name in ['clang','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-readobj','llvm-objdump','wasm-ld']:
 pin(L/'bin'/name)
for name in ['python3','node','bash','tar','patch','make','du','df','stat','ldd','prlimit','git','wasm-validate','wasm-objdump','wasm-opt']:
 pin(shutil.which(name))
archive=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve()
assert pin(archive)['sha256']=='37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667'
for label,binary in [('owned-clang',E/'objects/compiler/clang'),('original-clang',L/'bin/clang')]:
 output=subprocess.check_output(['ldd',str(binary)],text=True)
 q=T/'logs'/('freeze-ldd-'+label+'.txt');assert not q.exists();q.write_text(output)
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():pin(p)

groups=[]
for p in sorted((T/'logs/supervision').glob('*.json')):
 j=json.loads(p.read_text());live=members(j['pgid'])
 assert 'exit' in j and j['terminalMembers']==[] and not live
 groups.append({'proof':str(p),'pgid':j['pgid'],'exit':j['exit'],'liveMembers':live})
assert len(groups)==15
for row in audit['runs']:
 group=row['browserPid'];live=members(group);assert not live
 groups.append({'pgid':group,'browser':True,'liveMembers':live})
(T/'logs/freeze-terminal-groups.json').write_text(json.dumps(groups,indent=2)+'\n')
(T/'logs/freeze-historical-copy-map.json').write_text(json.dumps(historical,indent=2)+'\n')

repoFiles=sorted([p for p in R.rglob('*') if p.is_file()]+[repo/'docs/glibc-syscalls-last5-20261002.md'])
assert len(repoFiles)==31 and not any('__pycache__' in p.parts for p in repoFiles)
proposed=json.loads((T/'logs/proposed-repository-pins.json').read_text())
current={str(p.relative_to(repo)):digest(p) for p in repoFiles};assert proposed==current
(T/'repository-freeze.json').write_text(json.dumps(current,indent=2)+'\n')
acceptance={**audit,'phase':'frozen bounded five-wrapper GNU make and actual guest acceptance',
 'preparedAudit':{'path':str(auditPath),'hash':digest(auditPath)},'terminalGroups':groups,
 'runtimeInputRecords':len(final['inputs']),'repositoryPaths':len(repoFiles),'fullLibcAccepted':False}
(T/'acceptance.json').write_text(json.dumps(acceptance,indent=2)+'\n')
files.update(p.resolve() for p in repoFiles)
for p in T.rglob('*'):
 if p.is_file() and not {'cache','profile','xdg'}.intersection(p.relative_to(T).parts):pin(p)
assert int(subprocess.check_output(['du','-sk',str(T)]).split()[0])*1024<2147483648
assert shutil.disk_usage(T).free>5368709120
entries={str(p):digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
(T/'manifest.json').write_text(json.dumps({'scope':'bounded GNU last-five wrapper make and Linux guest gates',
 'absoluteIncludeFiles':len(audit['includes']),'files':entries},indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'entries':len(entries),'repositoryPaths':len(repoFiles),'includes':408,
 'terminalGroups':len(groups),'manifestSha256':digest(T/'manifest.json')['sha256'],
 'acceptanceSha256':digest(T/'acceptance.json')['sha256'],
 'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
