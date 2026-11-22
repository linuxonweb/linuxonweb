#!/usr/bin/env python3
"""Freeze the compile/host packet; live supervision must be outside its tree."""
import hashlib,json,os,pathlib,re,shutil,subprocess
T=pathlib.Path(os.environ['GLIBC_MEMORY_PACKET']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
P=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']);C=P.parent/'glibc-cumulative-make-20261002';E=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])
assert pathlib.Path(os.environ['GLIBC_TASK']).resolve()!=T
def digest(p):
 p=pathlib.Path(p);h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'bytes':p.stat().st_size,'sha256':h.hexdigest()}
def members(group):
 rows=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   fields=p.read_text().rsplit(')',1)[1].split()
   if int(fields[2])==group and fields[0]!='Z':rows.append(int(p.parent.name))
  except(FileNotFoundError,PermissionError,ProcessLookupError):pass
 return rows
assert not any((T/n).exists()for n in ['manifest.json','acceptance.json','repository-freeze.json'])
assert digest(P/'manifest.json')['sha256']=='4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042'
assert digest(C/'manifest.json')['sha256']=='dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09'
old=json.loads((P/'manifest.json').read_text())['files'];cf=json.loads((C/'manifest.json').read_text())['files'];a=json.loads((T/'logs/memory-audit.json').read_text())
assert a['pass']and len(a['units'])==13 and len(a['headers'])==309 and len(a['modules'])==2
files={P/'manifest.json',C/'manifest.json'}
for name,h in {**a['headers'],**a['drivers'],**a['modules']}.items():
 p=pathlib.Path(name);assert digest(p)==h;files.add(p.resolve())
for u in a['units']:
 for n,h in [('source','sourceHash'),('sourceSnapshot','sourceHash'),('object','objectHash')]:
  p=pathlib.Path(u[n]);assert digest(p)==u[h];files.add(p.resolve())
for name,d in json.loads((C/'repository-freeze.json').read_text()).items():
 p=repo/name;assert digest(p)==d;files.add(p.resolve())
borrowed=json.loads((T/'logs/borrowed-inputs.json').read_text());assert borrowed['pass']
for row in borrowed['rows']:
 p=pathlib.Path(row['source']).resolve();assert digest(p)==row['verified']==old[str(p)];files.add(p)
 if 'snapshot'in row:
  p=pathlib.Path(row['snapshot']).resolve();assert digest(p)==row['verified'];files.add(p)
for root in [E/'logs/compiler',E/'source-snapshots/compiler',E/'objects/compiler']:
 for p in root.rglob('*'):
  if p.is_file():
   p=p.resolve();assert digest(p)==old[str(p)];files.add(p)
for n in ['clang','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-readobj','llvm-objdump','wasm-ld']:files.add((L/'bin'/n).resolve())
for n in ['python3','node','bash','tar','patch','make','du','df','stat','ldd','prlimit','git','wasm-validate','wasm-opt']:files.add(pathlib.Path(shutil.which(n)).resolve())
archive=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve();assert digest(archive)['sha256']=='37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667';files.add(archive)
for label,binary in [('owned-clang',E/'objects/compiler/clang'),('original-clang',L/'bin/clang')]:
 output=subprocess.check_output(['ldd',str(binary)],text=True);p=T/'logs'/('freeze-ldd-'+label+'.txt');assert not p.exists();p.write_text(output)
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
for row in a['groups']:
 j=json.loads(pathlib.Path(row['proof']).read_text());assert j['exit']==row['exit']and not j['terminalMembers']and not members(j['pgid'])
assert len(a['groups'])==5
repoFiles=sorted([p for p in R.rglob('*')if p.is_file()]+[repo/'docs/glibc-memory-make-20261002.md'])
assert len(repoFiles)==17 and not any('__pycache__'in p.parts for p in repoFiles)
snapshot=T/'source-snapshots/frozen-repository';snapshot.mkdir()
for p in repoFiles:
 q=snapshot/p.relative_to(repo);q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes());assert digest(q)==digest(p)
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p)for p in repoFiles},indent=2)+'\n')
acceptance={'pass':True,'scope':a['scope'],'GNUmakeUnits':13,'pristineGNUunits':6,'ownedArchitectureUnits':7,'absoluteIncludes':309,'nativeChecks':291,'FPCASTChecks':291,'host':a['host'],'modules':a['modules'],'audit':{'path':str(T/'logs/memory-audit.json'),'hash':digest(T/'logs/memory-audit.json')},'retainedFailure':a['retainedFailure'],'limitations':a['limitations']}
(T/'acceptance.json').write_text(json.dumps(acceptance,indent=2)+'\n');files.update(p.resolve()for p in repoFiles)
for p in T.rglob('*'):
 if p.is_file()and not {'cache','profile','xdg'}.intersection(p.relative_to(T).parts):files.add(p.resolve())
entries={str(p):digest(p)for p in sorted(files)};assert all(digest(p)==h for p,h in entries.items())
(T/'manifest.json').write_text(json.dumps({'pass':True,'scope':a['scope'],'files':entries},indent=2)+'\n');assert all(digest(p)==h for p,h in entries.items())
print(json.dumps({'pass':True,'entries':len(entries),'repositoryPaths':len(repoFiles),'manifest':digest(T/'manifest.json'),'acceptance':digest(T/'acceptance.json'),'repositoryFreeze':digest(T/'repository-freeze.json')}))
