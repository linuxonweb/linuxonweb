#!/usr/bin/env python3
"""Freeze accepted bounded gates and failed GNU make diagnostics separately."""
import os,pathlib,hashlib,json,shlex,re,shutil
root=pathlib.Path(__file__).resolve().parent;task=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
files={p.resolve() for p in root.parent.rglob('*') if p.is_file()}
files.add(root.parents[2]/'docs/glibc-fullmake-warnings-20261002.md')
for area in ['source','objects','logs','source-snapshots','tmp']:
 files.update(p.resolve() for p in (task/area).rglob('*') if p.is_file())
includes=set()
deps=[*(task/'logs/full-dependencies-complete').glob('*.d'),*(task/'objects').rglob('*.dt')]
for dep in deps:
 for word in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):
  p=pathlib.Path(word.removesuffix(':'))
  if p.is_absolute() and p.is_file():includes.add(p.resolve())
files.update(includes)
for word in shlex.split((task/'logs/host-llvm-libfiles.txt').read_text()):files.add(pathlib.Path(word).resolve())
for word in re.findall(r'(/[^\s()]+)',(task/'logs/host-lower-ldd.txt').read_text()):files.add(pathlib.Path(word).resolve())
for name in ['guest-native-run1','guest-fpcast-run1']:
 run=task/name;report=json.loads((run/'result.json').read_text());assert report['pass']
 assert json.loads((run/'warnings-result.json').read_text())['pass']
 for p,h in report['inputs'].items():
  p=pathlib.Path(p).resolve();assert digest(p)['sha256']==h;files.add(p)
 files.update(p for p in run.iterdir() if p.is_file())
for name in ['native-package','fpcast-package']:files.update(p for p in (task/name).iterdir() if p.is_file())
for name in ['clang','clang++','wasm-ld','llvm-config','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-objdump']:
 files.add((pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'/name).resolve())
for name in ['g++','gcc','python3','node','bash','tar','patch','make','wasm-opt','wasm-validate','wasm-objdump']:
 files.add(pathlib.Path(shutil.which(name)).resolve())
files.add(pathlib.Path(os.environ['GLIBC_CHROMIUM']).resolve())
files.add(pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve())
for name in ['config.sh','acceptance.json','repository-freeze.json']:
 p=task/name
 if p.exists():files.add(p)
entries={str(p):digest(p) for p in sorted(files)}
out=task/'manifest.json';assert not out.exists()
out.write_text(json.dumps({'scope':'Bounded GNU warning metadata and sigaltstack runtime; full make FAIL on return-address','includeFiles':len(includes),'files':entries},indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'rechecked':len(entries),'includes':len(includes),'sha256':digest(out)['sha256']}))
