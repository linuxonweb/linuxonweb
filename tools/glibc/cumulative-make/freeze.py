#!/usr/bin/env python3
"""Freeze cumulative build discovery; a successful audit is not a make pass."""
import hashlib,json,os,pathlib,re,shutil,subprocess

T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
R=pathlib.Path(__file__).resolve().parent
repo=R.parents[2]
P=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']).resolve()
C=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']).resolve()
L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])

def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}

assert not any((T/n).exists() for n in ['manifest.json','acceptance.json','repository-freeze.json'])
assert digest(P/'manifest.json')['sha256']=='4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042'
old=json.loads((P/'manifest.json').read_text())['files']
a=json.loads((T/'logs/cumulative-audit.json').read_text())
f=json.loads((T/'logs/cumulative-final-audit.json').read_text())
terminal=json.loads((T/'logs/terminal-source-proof.json').read_text())
assert f['pass'] and a['exit']['exit']==2 and not a['exit']['processGroupLiveMembers']
assert not a['archives'] and not a['partialOrUnknownOutputs']
assert terminal['pass'] and all(not g['freshLiveMembers'] for g in terminal['groups'])
files=set()
for row in terminal['sourceSnapshots']:
 for k in ['source','snapshot']:
  p=pathlib.Path(row[k]);assert digest(p)=={k:row[k] for k in ['sha256','bytes']};files.add(p.resolve())
for group in ['objects','actualIncludes']:
 for name,h in a[group].items():
  p=pathlib.Path(name);assert digest(p)=={k:h[k] for k in ['sha256','bytes']};files.add(p.resolve())
for name,row in a['sources'].items():
 p=pathlib.Path(row['snapshot']);assert digest(p)['sha256']==row['sha256'];files.add(p.resolve())
 if row['currentExists']:
  p=pathlib.Path(name);assert digest(p)['sha256']==row['sha256'];files.add(p.resolve())
for rows in f['driverVersions'].values():
 for row in rows:files.update(pathlib.Path(row[k]).resolve() for k in ['proof','snapshot'])
borrowed=json.loads((T/'logs/borrowed-inputs.json').read_text());assert borrowed['pass']
for row in borrowed['rows']:
 p=pathlib.Path(row['source']).resolve();assert digest(p)==row['verified']==old[str(p)];files.add(p)
 if 'snapshot' in row:
  q=pathlib.Path(row['snapshot']);assert digest(q)==row['verified'];files.add(q.resolve())
for root in [C/'logs/compiler',C/'source-snapshots/compiler',C/'objects/compiler']:
 for p in root.rglob('*'):
  if p.is_file():
   p=p.resolve();assert digest(p)==old[str(p)];files.add(p)
files.update([P/'manifest.json',C/'manifest.json'])
for name in ['clang','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-readobj','llvm-objdump','wasm-ld']:
 files.add((L/'bin'/name).resolve())
for name in ['python3','bash','tar','patch','make','du','df','stat','ldd','prlimit','git','wasm-validate']:
 files.add(pathlib.Path(shutil.which(name)).resolve())
archive=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve()
assert digest(archive)['sha256']=='37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667';files.add(archive)
for label,binary in [('owned-clang',C/'objects/compiler/clang'),('original-clang',L/'bin/clang')]:
 output=subprocess.check_output(['ldd',str(binary)],text=True)
 q=T/'logs'/('freeze-ldd-'+label+'.txt');assert not q.exists();q.write_text(output)
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
repoFiles=sorted([p for p in R.rglob('*') if p.is_file()]+[repo/'docs/glibc-cumulative-make-20261002.md'])
assert len(repoFiles)==15
repoFreeze={str(p.relative_to(repo)):digest(p) for p in repoFiles}
(T/'repository-freeze.json').write_text(json.dumps(repoFreeze,indent=2)+'\n')
acceptance={'pass':True,'scope':'audited cumulative GNU build discovery; not runtime or sysroot acceptance',
 'GNUmakePass':False,'makeExit':2,'completeObjects':f['objectCounts'],'GNUTextStamps':f['GNUTextStamps'],
 'partialOutputs':f['partialOutputs'],'archiveCount':f['archiveCount'],'failedTargets':len(f['currentFailedTargets']),
 'original168Comparison':f['original168ComparisonCounts'],'failureClasses':f['currentFailureClasses'],
 'audit':{'path':str(T/'logs/cumulative-final-audit.json'),'hash':digest(T/'logs/cumulative-final-audit.json')},
 'includes':len(a['actualIncludes']),'borrowedInputs':len(borrowed['rows']),
 'limitations':['no libc.a produced','header installation not attempted','no runtime acceptance','forced O2 bounded C driver is not a production compiler driver']}
(T/'acceptance.json').write_text(json.dumps(acceptance,indent=2)+'\n')
files.update(p.resolve() for p in repoFiles)
for p in T.rglob('*'):
 if p.is_file() and not {'cache','profile','xdg'}.intersection(p.relative_to(T).parts):files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
(T/'manifest.json').write_text(json.dumps({'scope':acceptance['scope'],'absoluteIncludeFiles':len(a['actualIncludes']),'files':entries},indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'entries':len(entries),'repositoryPaths':len(repoFiles),'includes':len(a['actualIncludes']),
 'manifestSha256':digest(T/'manifest.json')['sha256'],'acceptanceSha256':digest(T/'acceptance.json')['sha256'],
 'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
