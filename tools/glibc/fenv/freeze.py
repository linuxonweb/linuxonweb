#!/usr/bin/env python3
"""Freeze accepted fixed-rounding evidence and verified inherited provenance."""
import hashlib,json,os,pathlib,re,shlex,shutil,subprocess

T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
P=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']).resolve()
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
 repo/'docs/glibc-fenv-20261002.md',repo/'docs/glibc-syscalls-fixed-plan-20261002.md'])
assert len(repoFiles)==17
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p) for p in repoFiles},indent=2)+'\n')
files={p.resolve() for p in R.parent.rglob('*') if p.is_file()}
files.update(p.resolve() for p in repoFiles)
files.add(P/'manifest.json')

def inherited(p):
 p=pathlib.Path(p).resolve()
 assert digest(p)==old[str(p)],str(p)
 files.add(p)

includes=set()
inheritedIncludes=set()
for packet in [T,P]:
 for dep in [*(packet/'logs').rglob('*.d'),*(packet/'objects').rglob('*.d'),*(packet/'objects').rglob('*.dt')]:
  body=dep.read_text().replace('\\\n',' ')
  if ':' not in body:continue
  if packet==P:inherited(dep)
  for word in shlex.split(body.split(':',1)[1]):
   p=pathlib.Path(word.removesuffix(':'))
   if p.is_absolute() and p.is_file():
    p=p.resolve();includes.add(p)
    if packet==P:inherited(p);inheritedIncludes.add(p)
files.update(includes)
for name in ['compiler','runtime']:
 proof=json.loads((T/'logs'/('reuse-'+name+'.json')).read_text())
 assert proof['pass']
 for row in proof['rows']:
  p=pathlib.Path(row['input']);assert digest(p)==row['verified'];inherited(p)
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
for mode in ['native','fpcast']:
 j=json.loads((T/('guest-'+mode+'-run1')/'result.json').read_text());assert j['pass']
 for name,h in j['inputs'].items():
  p=pathlib.Path(name);assert digest(p)['sha256']==h;files.add(p.resolve())
for p in T.rglob('*'):
 if p.is_file() and not {'profile','cache','xdg'}.intersection(p.relative_to(T).parts) and not any(part.startswith('Singleton') for part in p.relative_to(T).parts):files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
manifest={'scope':'eight GNU unit builds and public fixed-nearest rounding runtime; not full libm/sysroot/NPTL/Nightly',
 'absoluteIncludeFiles':len(includes),'inheritedAbsoluteIncludeFiles':len(inheritedIncludes),'files':entries}
(T/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'manifestSha256':digest(T/'manifest.json')['sha256'],'entries':len(entries),
 'absoluteIncludes':len(includes),'inheritedAbsoluteIncludes':len(inheritedIncludes),'repositoryPaths':len(repoFiles),
 'acceptanceSha256':digest(T/'acceptance.json')['sha256'],'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
