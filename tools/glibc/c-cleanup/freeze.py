#!/usr/bin/env python3
"""Terminal hash freeze of reviewed source, headers, compiler and runtime evidence."""
import os,pathlib,json,hashlib,shlex,subprocess,shutil,re
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2];L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
assert json.loads((T/'acceptance.json').read_text())['pass'];assert not (T/'manifest.json').exists()
# Repository checkpoint inventory is exact and deliberately excludes root-owned
# status documents. Those are independently reviewed by the parent agent.
repoFiles=sorted([*R.rglob('*'),repo/'docs/glibc-c-cleanup-20261002.md',*[repo/'web/linux/dist'/n for n in ['wasm.js','worker.js','wasm.d.ts']]])
repoFiles=[p for p in repoFiles if p.is_file()]
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p) for p in repoFiles},indent=2)+'\n')
files={p.resolve() for p in R.parent.rglob('*') if p.is_file()}
files.update(p.resolve() for p in repoFiles)
for p in T.rglob('*'):
 if p.is_file() and not {'profile','cache','xdg','control-prototype-profile','c-control-prototype-profile'}.intersection(p.relative_to(T).parts) and not any(part.startswith('Singleton') for part in p.relative_to(T).parts):files.add(p.resolve())
includes=set()
for dep in [*(T/'logs').rglob('*.d'),*(T/'objects').rglob('*.d'),*(T/'objects').rglob('*.dt')]:
 text=dep.read_text().replace('\\\n',' ')
 if ':' not in text:continue
 for word in shlex.split(text.split(':',1)[1]):
  p=pathlib.Path(word.removesuffix(':'))
  if p.is_absolute() and p.is_file():includes.add(p.resolve())
files.update(includes)
compiler=json.loads((T/'logs/compiler/result.json').read_text());files.update(pathlib.Path(p).resolve() for p in compiler['linkArchives']);files.add((L/'lib/libclangCodeGen.a').resolve())
for name in ['clang','llvm-config','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-readobj','llvm-objdump','wasm-ld']:files.add((L/'bin'/name).resolve())
for name in ['g++','gcc','python3','bash','tar','patch','make','du','df','stat','ldd','prlimit','node','wasm-opt','wasm-validate','wasm-objdump']:files.add(pathlib.Path(shutil.which(name)).resolve())
S=pathlib.Path(os.environ['GLIBC_LLVM_SOURCE']);files.add((S/'clang/lib/CodeGen/CGException.cpp').resolve())
for name in ['driver.cpp','cc1_main.cpp','cc1as_main.cpp','cc1gen_reproducer_main.cpp']:files.add((S/'clang/tools/driver'/name).resolve())
P=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET']);files.add((P/'logs/primary-failures.json').resolve())
for row in json.loads((P/'logs/primary-failures.json').read_text())['failedUnits']:
 if row['primaryClass']=='C cleanup DWARF/native Wasm EH mismatch':files.add(pathlib.Path(row['sourceSnapshot']).resolve())
files.add(pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve());files.add(pathlib.Path(os.environ['GLIBC_CHROMIUM']).resolve())
for label,binary in [('owned-clang',T/'objects/compiler/clang'),('original-clang',L/'bin/clang'),('host-g++',pathlib.Path(shutil.which('g++')))]:
 output=subprocess.check_output(['ldd',str(binary)],text=True);q=T/'logs/compiler'/('final-ldd-'+label+'.txt');q.write_text(output);files.add(q)
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
# Accepted guest inputs, including kernel and actual production JS, are inputs.
for name in ['native','fpcast']:
 j=json.loads((T/os.environ.get('GLIBC_'+name.upper()+'_RUN','guest-'+name+'-production-run1')/'result.json').read_text())
 for p,h in j['inputs'].items():
  p=pathlib.Path(p);assert digest(p)['sha256']==h;files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
manifest={'scope':'owned Clang C native cleanup and bounded GNU runtime acceptance; not full sysroot/NPTL/C++/Nightly','absoluteIncludeFiles':len(includes),'files':entries}
(T/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');identity=digest(T/'manifest.json')['sha256']
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'pass':True,'manifestSha256':identity,'entries':len(entries),'absoluteIncludes':len(includes),'repositoryPaths':len(repoFiles),'acceptanceSha256':digest(T/'acceptance.json')['sha256'],'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
