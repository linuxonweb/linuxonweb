#!/usr/bin/env python3
"""Freeze typed GNU syscall evidence and verified inherited provenance."""
import hashlib,json,os,pathlib,re,shlex,shutil,subprocess

T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
P=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']).resolve()
F=pathlib.Path(os.environ['GLIBC_FENV_PACKET']).resolve()
I=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET']).resolve()
R=pathlib.Path(__file__).resolve().parent
repo=R.parents[2]
L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])

def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}

assert json.loads((T/'acceptance.json').read_text())['pass']
assert not (T/'manifest.json').exists() and not (T/'repository-freeze.json').exists()
assert digest(P/'manifest.json')['sha256']=='15bcb2d693cb08ced4f962c197a934232c7ff6d29b8c4806459f0a51f5db8e17'
old=json.loads((P/'manifest.json').read_text())['files']
repoFiles=sorted([p for p in R.rglob('*') if p.is_file()]+[
 repo/'docs/glibc-syscalls-fixed-20261002.md',repo/'docs/glibc-syscalls-fixed-kernel-20261002.md'])
assert len(repoFiles)==27
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p) for p in repoFiles},indent=2)+'\n')
files={p.resolve() for p in R.parent.rglob('*') if p.is_file()}
files.update(p.resolve() for p in repoFiles)
files.add(P/'manifest.json')
files.add(F/'manifest.json')
files.add(I/'manifest.json')
assert digest(F/'manifest.json')['sha256']=='c575dc6867d292bb6ca120831ffa7c13e48a7732671d6a190009937f86c17cd1'
assert digest(I/'manifest.json')['sha256']=='8b53d66f81cbdc96a3b6b38491be44ec84c2fa9df4d09c3627b23de41bbae929'
frozenF=json.loads((F/'manifest.json').read_text())['files']
frozenI=json.loads((I/'manifest.json').read_text())['files']

def inherited(p):
 p=pathlib.Path(p).resolve()
 assert digest(p)==old[str(p)],str(p)
 files.add(p)

includes=set()
inheritedIncludes=set()
for packet in [T,P,F]:
 for dep in [*(packet/'logs').rglob('*.d'),*(packet/'objects').rglob('*.d'),*(packet/'objects').rglob('*.dt')]:
  body=dep.read_text().replace('\\\n',' ')
  if ':' not in body:continue
  if packet==P:inherited(dep)
  elif packet==F:assert digest(dep)==frozenF[str(dep.resolve())];files.add(dep.resolve())
  for word in shlex.split(body.split(':',1)[1]):
   p=pathlib.Path(word.removesuffix(':'))
   if p.is_absolute() and p.is_file():
    p=p.resolve();includes.add(p)
    if packet==P:inherited(p);inheritedIncludes.add(p)
    elif packet==F:assert digest(p)==frozenF[str(p)];files.add(p);inheritedIncludes.add(p)
files.update(includes)
for name in ['compiler']:
 proof=json.loads((T/'logs'/('reuse-'+name+'.json')).read_text())
 assert proof['pass']
 for row in proof['rows']:
  p=pathlib.Path(row['input']);assert digest(p)==row['verified'];inherited(p)
proof=json.loads((T/'logs/reuse-fenv-runtime.json').read_text());assert proof['pass']
for row in proof['rows']:
 for name in ['path','snapshot']:
  p=pathlib.Path(row[name]).resolve();assert digest(p)==frozenF[str(p)];files.add(p)
files.add(F/'logs/final-runtime-inputs.json')
assert digest(F/'logs/final-runtime-inputs.json')==frozenF[str(F/'logs/final-runtime-inputs.json')]
for row in json.loads((T/'logs/selected-fixed-syscalls.json').read_text())['wrappers']:
 p=pathlib.Path(row['historicalSourceSnapshot']).resolve();assert digest(p)==frozenI[str(p)];files.add(p)
 assert p.read_bytes()==pathlib.Path(row['stream']).read_bytes()
runtime=json.loads((P/'logs/runtime-inputs.json').read_text())
for row in runtime['inputs'].values():inherited(row['snapshot'])
for root in [P/'logs/compiler',P/'source-snapshots/compiler',P/'objects/compiler']:
 for p in root.rglob('*'):
  if p.is_file():inherited(p)
compiler=json.loads((P/'logs/compiler/result.json').read_text())
for p in compiler['linkArchives']:inherited(p)
inherited(L/'lib/libclangCodeGen.a')
for name in ['clang','llvm-config','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-readobj','llvm-objdump','wasm-ld']:
 files.add((L/'bin'/name).resolve())
for name in ['g++','gcc','python3','bash','tar','patch','make','du','df','stat','ldd','prlimit','node','wasm-opt','wasm-validate','wasm-objdump']:
 files.add(pathlib.Path(shutil.which(name)).resolve())
files.add(pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve())
files.add(pathlib.Path(os.environ['GLIBC_CHROMIUM']).resolve())
assert digest(pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']))['sha256']=='37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667'
for label,binary in [('owned-clang',T/'objects/compiler/clang'),('original-clang',L/'bin/clang'),('node',pathlib.Path(shutil.which('node')))]:
 output=subprocess.check_output(['ldd',str(binary)],text=True)
 q=T/'logs'/('final-ldd-'+label+'.txt');assert not q.exists();q.write_text(output)
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
for mode,run in [('native','guest-native-run3'),('fpcast','guest-fpcast-run1')]:
 j=json.loads((T/run/'result.json').read_text());assert j['pass']
 for name,h in j['inputs'].items():
  p=pathlib.Path(name);assert digest(p)['sha256']==h;files.add(p.resolve())
for p in T.rglob('*'):
 if p.is_file() and not {'profile','cache','xdg'}.intersection(p.relative_to(T).parts) and not any(part.startswith('Singleton') for part in p.relative_to(T).parts):files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
manifest={'scope':'36 typed GNU syscall wrappers with real native/FPCAST Linux runtime; not full libc/sysroot/NPTL/Nightly',
 'absoluteIncludeFiles':len(includes),'inheritedAbsoluteIncludeFiles':len(inheritedIncludes),'files':entries}
(T/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'manifestSha256':digest(T/'manifest.json')['sha256'],'entries':len(entries),
 'absoluteIncludes':len(includes),'inheritedAbsoluteIncludes':len(inheritedIncludes),'repositoryPaths':len(repoFiles),
 'acceptanceSha256':digest(T/'acceptance.json')['sha256'],'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
