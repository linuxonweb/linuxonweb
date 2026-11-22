#!/usr/bin/env python3
"""Freeze typed GNU syscall evidence and verified inherited provenance."""
import hashlib,json,os,pathlib,re,shlex,shutil,subprocess

T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
P=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']).resolve()
F=pathlib.Path(os.environ['GLIBC_FENV_PACKET']).resolve()
I=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET']).resolve()
B=pathlib.Path(os.environ['GLIBC_FIXED_PACKET']).resolve()
N=pathlib.Path(os.environ['GLIBC_NEXT26_PACKET']).resolve()
V=pathlib.Path(os.environ['GLIBC_STAT_PACKET']).resolve()
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
 repo/'docs/glibc-stat-runtime-20261002.md'])
assert len(repoFiles)==22
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p) for p in repoFiles},indent=2)+'\n')
# Other agents may have mutable untracked overlays; only committed predecessor
# tools and this owned scope participate. No unrelated tree-wide traversal.
tracked=subprocess.check_output(['git','ls-files','tools/glibc'],cwd=repo,text=True).splitlines()
files={(repo/name).resolve() for name in tracked}
files.update(p.resolve() for p in repoFiles)
files.add(P/'manifest.json')
files.add(F/'manifest.json')
files.add(B/'manifest.json')
assert digest(B/'manifest.json')['sha256']=='b17e5f7744e2f4eae6714db5f4544b7e953a18b89a0bf419f89ead66ad2e784f'
frozenB=json.loads((B/'manifest.json').read_text())['files']
files.add(I/'manifest.json')
files.add(N/'manifest.json');assert digest(N/'manifest.json')['sha256']=='8a7fd6467b2e0f4811d855472845bd55ffad61e15aaebf02475c871c30be5766'
frozenN=json.loads((N/'manifest.json').read_text())['files']
files.add(V/'manifest.json');assert digest(V/'manifest.json')['sha256']=='e6efcd1c146eb5d559ab782aa5013908cb83f8d487c8005860c727fc19119a1a'
frozenV=json.loads((V/'manifest.json').read_text())['files']
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
for packet in [T,P,F,B,N]:
 for dep in [*(packet/'logs').rglob('*.d'),*(packet/'objects').rglob('*.d'),*(packet/'objects').rglob('*.dt')]:
  body=dep.read_text().replace('\\\n',' ')
  if ':' not in body:continue
  if packet==P:inherited(dep)
  elif packet==F:assert digest(dep)==frozenF[str(dep.resolve())];files.add(dep.resolve())
  elif packet==B:assert digest(dep)==frozenB[str(dep.resolve())];files.add(dep.resolve())
  elif packet==N:assert digest(dep)==frozenN[str(dep.resolve())];files.add(dep.resolve())
  for word in shlex.split(body.split(':',1)[1]):
   p=pathlib.Path(word.removesuffix(':'))
   if p.is_absolute() and p.is_file():
    p=p.resolve();includes.add(p)
    if packet==P:inherited(p);inheritedIncludes.add(p)
    elif packet==F:assert digest(p)==frozenF[str(p)];files.add(p);inheritedIncludes.add(p)
    elif packet==B:assert digest(p)==frozenB[str(p)];files.add(p);inheritedIncludes.add(p)
    elif packet==N:assert digest(p)==frozenN[str(p)];files.add(p);inheritedIncludes.add(p)
dependency=json.loads((T/'logs/dependency-audit.json').read_text());assert dependency['pass']
for name,h in dependency['inputs'].items():
 p=pathlib.Path(name);assert digest(p)==h;files.add(p.resolve())
 if p.suffix=='.h':includes.add(p.resolve())
files.update(includes)
for name in ['compiler']:
 proof=json.loads((T/'logs'/('reuse-'+name+'.json')).read_text())
 assert proof['pass']
 for row in proof['rows']:
  p=pathlib.Path(row['input']);assert digest(p)==row['verified'];inherited(p)
proof=json.loads((T/'logs/reuse-next26-runtime.json').read_text());assert proof['pass'] and proof['objects']==191
for row in proof['rows']:
 for name in ['path','snapshot']:
  p=pathlib.Path(row[name]).resolve();assert digest(p)==frozenN[str(p)];files.add(p)
files.add(N/'logs/final-runtime-inputs.json')
assert digest(N/'logs/final-runtime-inputs.json')==frozenN[str(N/'logs/final-runtime-inputs.json')]
nd=N/'logs/dependency-audit.json';assert digest(nd)==frozenN[str(nd)];files.add(nd)
for name,h in json.loads(nd.read_text())['headers'].items():
 p=pathlib.Path(name).resolve();assert digest(p)==h==frozenN[str(p)];files.add(p);includes.add(p);inheritedIncludes.add(p)
for row in json.loads((T/'logs/stat-overlay-inputs.json').read_text()):
 p=pathlib.Path(row['snapshot']);assert digest(p)=={k:row[k] for k in ['sha256','bytes']};files.add(p.resolve())
 original=(repo/row['path']).resolve();assert digest(original)==frozenV[str(original)];files.add(original)
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
for mode,run in [('native','guest-native-run3'),('fpcast','guest-fpcast-run3')]:
 j=json.loads((T/run/'result.json').read_text());assert j['pass']
 for name,h in j['inputs'].items():
  p=pathlib.Path(name);assert digest(p)['sha256']==h;files.add(p.resolve())
for p in T.rglob('*'):
 if p.is_file() and not {'profile','cache','xdg'}.intersection(p.relative_to(T).parts) and not any(part.startswith('Singleton') for part in p.relative_to(T).parts):files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
manifest={'scope':'eight public GNU stat/time64 APIs, ten genuine GNU implementation units, contiguous guard native/FPCAST Linux gate; not full libc/sysroot/NPTL/Nightly',
 'absoluteIncludeFiles':len(includes),'inheritedAbsoluteIncludeFiles':len(inheritedIncludes),'files':entries}
(T/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'manifestSha256':digest(T/'manifest.json')['sha256'],'entries':len(entries),
 'absoluteIncludes':len(includes),'inheritedAbsoluteIncludes':len(inheritedIncludes),'repositoryPaths':len(repoFiles),
 'acceptanceSha256':digest(T/'acceptance.json')['sha256'],'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
