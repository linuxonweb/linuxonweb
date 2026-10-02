#!/usr/bin/env python3
"""Freeze audited GNU build discovery after external terminal supervision."""
import hashlib,json,os,pathlib,re,shutil,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
assert os.environ.get('GLIBC_COHERENT_FREEZE_AUTHORIZED')=='1', 'root review required'
assert T.name=='glibc-coherent-make-20261002'
for key in ['TMPDIR','TMP','TEMP']:
 p=pathlib.Path(os.environ[key]).resolve();assert not p.is_relative_to(T),'freezer temporary files must be external'
assert subprocess.check_output(['findmnt','-n','-o','FSTYPE','--target',str(T)],text=True).strip()=='ext4'
assert shutil.disk_usage(T).free>8589934592
assert int(subprocess.check_output(['du','-sk',str(T)]).split()[0])*1024<2147483648
assert not any((T/n).exists() for n in ['manifest.json','acceptance.json','repository-freeze.json'])
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
def members(g):
 v=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   f=p.read_text().rsplit(')',1)[1].split()
   if int(f[2])==g and f[0]!='Z':v.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return v
A=json.loads((T/'logs/coherent-audit-run2-final.json').read_text());F=json.loads((T/'logs/final-prepared-proof.json').read_text())
assert F['pass'] and A['exit']['exit']==2 and isinstance(A['currentFailedTargets'],list) and len(A['currentFailedTargets'])==6
assert A['objectCounts']=={'Wasm-v1':1729,'LLVM-bitcode':0} and not A['archives'] and not A['partialOrUnknownOutputs'] and not A['missingDependencies']
assert F['audit']['hash']==digest(T/'logs/coherent-audit-run2-final.json')
files=set()
for row in F['currentFileRows']:
 p=pathlib.Path(row['source']);assert digest(p)==row['verified'];files.add(p.resolve())
for row in F['sourceRows']:
 p=pathlib.Path(row['snapshot']);assert digest(p)==row['verified'];files.add(p.resolve())
 if row['currentExists']:
  p=pathlib.Path(row['source']);assert digest(p)==row['verified'];files.add(p.resolve())
for p in sorted((T/'logs/supervision').glob('*.json')):
 j=json.loads(p.read_text());assert 'exit' in j and not j['terminalMembers'] and not members(j['pgid'])
for p in sorted((T/'logs').glob('inventory-*-exit.json')):
 j=json.loads(p.read_text());assert not j['processGroupLiveMembers'] and not members(j['pid'])
borrowed=json.loads((T/'logs/coherent-input-pins.json').read_text());assert borrowed['pass'] and borrowed['targetObjectsCopied']==0
for row in borrowed['rows']:
 p=pathlib.Path(row['source']);assert digest(p)==row['verified'];files.add(p.resolve())
 if 'snapshot' in row:
  p=pathlib.Path(row['snapshot']);assert digest(p)==row['verified'];files.add(p.resolve())
M=json.loads((T/'logs/coherent-final-overlay.json').read_text());assert M['pass'] and M['acceptedTargetObjectsCopied']==0
p=pathlib.Path(M['memoryManifest']);assert digest(p)==M['memoryManifestHash'];files.add(p.resolve())
for row in M['memorySources']:
 for key in ['source','selected']:
  p=pathlib.Path(row[key]);assert digest(p)==row['verified'];files.add(p.resolve())
for p in T.rglob('*'):
 if p.is_file() and not {'cache','profile','xdg'}.intersection(p.relative_to(T).parts):files.add(p.resolve())
L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])
for name in ['clang','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-readobj','llvm-objdump','wasm-ld']:
 files.add((L/'bin'/name).resolve())
for name in ['python3','bash','tar','patch','make','du','df','findmnt','stat','ldd','prlimit','wasm-validate']:
 p=shutil.which(name);assert p;files.add(pathlib.Path(p).resolve())
for label,binary in [('owned-clang',T/'objects/compiler/clang'),('original-clang',L/'bin/clang')]:
 output=subprocess.check_output(['ldd',str(binary)],text=True);p=T/'logs'/('freeze-ldd-'+label+'.txt');assert not p.exists();p.write_text(output);files.add(p.resolve())
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
repoFiles=sorted([p for p in R.rglob('*') if p.is_file()]+[repo/'docs/glibc-coherent-make-20261002.md']);assert len(repoFiles)==16
pins=json.loads((T/'logs/final-repository-pins.json').read_text());assert pins['files']=={str(p.relative_to(repo)):digest(p) for p in repoFiles}
(T/'repository-freeze.json').write_text(json.dumps(pins['files'],indent=2)+'\n')
acceptance={'pass':True,'scope':'audited genuine GNU fullmake discovery; make FAIL, no archive/runtime/sysroot acceptance','GNUmakePass':False,'makeExit':2,'completeObjects':A['objectCounts'],'GNUTextStamps':len(A['GNUTextStamps']),'failedTargets':6,'archives':0,'includes':len(A['actualIncludes']),'dependencyFiles':len(A['dependencyFiles']),'missingDependencies':0,'original168Comparison':A['originalComparisonCounts'],'cumulative44Comparison':A['cumulativeComparisonCounts'],'unchangedRun1Objects':1727,'targetObjectsCopied':0,'audit':F['audit'],'limitations':['no libc.a or installed sysroot','header installation not attempted','native caller provenance and cancellation markers fail','forced unwind remains unprovided','diagnostic O2/C driver is not production flag or C++ acceptance','no new runtime/Nightly/JIT/GPU acceptance']}
(T/'acceptance.json').write_text(json.dumps(acceptance,indent=2)+'\n');files.update([T/'acceptance.json',T/'repository-freeze.json']);files.update(p.resolve() for p in repoFiles)
entries={str(p):digest(p) for p in sorted(files)};assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
(T/'manifest.json').write_text(json.dumps({'scope':acceptance['scope'],'absoluteIncludeFiles':len(A['actualIncludes']),'files':entries},indent=2)+'\n');assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'entries':len(entries),'repositoryPaths':len(repoFiles),'includes':len(A['actualIncludes']),'manifestSha256':digest(T/'manifest.json')['sha256'],'acceptanceSha256':digest(T/'acceptance.json')['sha256'],'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
