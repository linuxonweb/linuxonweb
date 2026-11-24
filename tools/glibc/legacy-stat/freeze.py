#!/usr/bin/env python3
"""Freeze the selected GNU conversion target and its exact synthetic controls."""
import hashlib,json,os,pathlib,re,shutil,subprocess
T=pathlib.Path(os.environ.get('GLIBC_LEGACY_PACKET',os.environ['GLIBC_TASK'])).resolve()
R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
C=pathlib.Path(os.environ['GLIBC_CUMULATIVE_PACKET']).resolve()
P=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']).resolve()
E=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']).resolve();L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
def members(group):
 live=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   fields=p.read_text().rsplit(')',1)[1].split()
   if int(fields[2])==group and fields[0]!='Z':live.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return live
assert not any((T/n).exists() for n in ['manifest.json','repository-freeze.json','acceptance.json'])
assert digest(C/'manifest.json')['sha256']=='dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09'
assert digest(P/'manifest.json')['sha256']=='4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042'
old=json.loads((P/'manifest.json').read_text())['files']
frozenC=json.loads((C/'manifest.json').read_text())['files']
audit=json.loads((T/'logs/legacy-audit.json').read_text());assert audit['pass']
assert len(audit['GNUunits'])==6 and len(audit['attempts'])==7 and len(audit['headers'])==281
assert len(audit['configureAttempts'])==15 and audit['publicVersions']==[0,0]
assert not audit['raw104BytePublicCopySupported']
files={C/'manifest.json',P/'manifest.json'}
for name,h in audit['headers'].items():
 p=pathlib.Path(name);assert digest(p)==h;files.add(p.resolve())
for row in audit['attempts']+audit['configureAttempts']:
 files.add(pathlib.Path(row['proof']).resolve())
 snap=pathlib.Path(row.get('snapshot',row.get('sourceSnapshot')))
 assert digest(snap)==row['sourceHash'];files.add(snap.resolve())
 if 'source' in row:
  p=pathlib.Path(row['source']);assert digest(p)==row['sourceHash'];files.add(p.resolve())
 if 'object' in row:
  p=pathlib.Path(row['object']);assert digest(p)==row['objectHash'];files.add(p.resolve())
for name,h in audit['hostLinkInputs'].items():
 p=pathlib.Path(name);assert digest(p)==h;files.add(p.resolve())
for row in audit['nativeAndFPCAST']:
 p=pathlib.Path(row['file']);assert digest(p)=={k:row[k] for k in ['sha256','bytes']}
 assert row['passed']==24612 and row['failed']==0 and not row['imports'];files.add(p.resolve())
for name in ['acceptance.json','repository-freeze.json']:
 p=C/name;assert digest(p)==frozenC[str(p)];files.add(p)
replay=json.loads((T/'logs/replay-inputs.json').read_text());assert replay['pass']
for row in replay['rows']:
 p=pathlib.Path(row['source']).resolve();assert digest(p)==row['verified']==frozenC[str(p)];files.add(p)
borrowed=json.loads((T/'logs/borrowed-inputs.json').read_text());assert borrowed['pass']
for row in borrowed['rows']:
 p=pathlib.Path(row['source']).resolve();assert digest(p)==row['verified']==old[str(p)];files.add(p)
 if 'snapshot' in row:
  q=pathlib.Path(row['snapshot']).resolve();assert digest(q)==row['verified'];files.add(q)
for root in [E/'logs/compiler',E/'source-snapshots/compiler',E/'objects/compiler']:
 for p in root.rglob('*'):
  if p.is_file():
   p=p.resolve();assert digest(p)==old[str(p)];files.add(p)
for name in ['clang','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-readobj','llvm-objdump','wasm-ld']:
 files.add((L/'bin'/name).resolve())
for name in ['python3','node','bash','tar','patch','make','du','df','stat','ldd','prlimit','git','wasm-validate','wasm-opt']:
 files.add(pathlib.Path(shutil.which(name)).resolve())
archive=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve()
assert digest(archive)['sha256']=='37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667';files.add(archive)
for label,binary in [('owned-clang',E/'objects/compiler/clang'),('original-clang',L/'bin/clang')]:
 output=subprocess.check_output(['ldd',str(binary)],text=True)
 q=T/'logs'/('freeze-ldd-'+label+'.txt');assert not q.exists();q.write_text(output)
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
groups=[]
expected={'prepare1':0,'build1':0,'hostbuild1':0,'hosttest1':0,'audit1':1,'audit2':0}
for p in sorted((T/'logs/supervision').glob('*.json')):
 j=json.loads(p.read_text());live=members(j['pgid'])
 assert p.stem in expected and j['exit']==expected[p.stem] and not j['terminalMembers'] and not live
 groups.append({'proof':str(p),'pgid':j['pgid'],'exit':j['exit'],'freshLiveMembers':live})
assert len(groups)==6
(T/'logs/freeze-terminal-groups.json').write_text(json.dumps(groups,indent=2)+'\n')
repoFiles=sorted([p for p in R.rglob('*') if p.is_file()]+[repo/'docs/glibc-legacy-stat-20261002.md'])
assert len(repoFiles)==15 and not any('__pycache__' in p.parts for p in repoFiles)
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p) for p in repoFiles},indent=2)+'\n')
acceptance={'pass':True,'scope':audit['scope'],'GNUmakeUnitPass':True,'unit':'io/xstatconv.o',
 'GNUunits':len(audit['GNUunits']),'selectedCompileAttempts':len(audit['attempts']),
 'configureProbes':len(audit['configureAttempts']),'dependencies':len(audit['headers']),
 'publicVersions':audit['publicVersions'],'raw104BytePublicCopySupported':False,
 'kernelLayout':audit['kernelLayout'],'publicLayout':audit['publicLayout'],
 'nativeAndFPCAST':audit['nativeAndFPCAST'],
 'audit':{'path':str(T/'logs/legacy-audit.json'),'hash':digest(T/'logs/legacy-audit.json')},
 'limitations':audit['limitations']}
(T/'acceptance.json').write_text(json.dumps(acceptance,indent=2)+'\n')
files.update(p.resolve() for p in repoFiles)
for p in T.rglob('*'):
 if p.is_file() and not {'cache','profile','xdg'}.intersection(p.relative_to(T).parts):files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
(T/'manifest.json').write_text(json.dumps({'scope':audit['scope'],'absoluteIncludeFiles':len(audit['headers']),'files':entries},indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'entries':len(entries),'repositoryPaths':len(repoFiles),'includes':len(audit['headers']),
 'manifestSha256':digest(T/'manifest.json')['sha256'],'acceptanceSha256':digest(T/'acceptance.json')['sha256'],
 'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
