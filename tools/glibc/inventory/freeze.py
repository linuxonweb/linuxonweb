#!/usr/bin/env python3
"""Freeze an unsuccessful GNU build inventory and future source plan."""
import os,pathlib,hashlib,json,shlex,re,shutil
root=pathlib.Path(__file__).resolve().parent;task=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
files={p.resolve() for p in root.parent.rglob('*') if p.is_file()}
files.add(root.parents[2]/'docs/glibc-fullmake-inventory-20261002.md')
for area in ['source','objects','logs','source-snapshots','tmp']:
 files.update(p.resolve() for p in (task/area).rglob('*') if p.is_file())
includes=set()
for dep in [*(task/'logs').glob('host-*.d'),*(task/'objects').rglob('*.dt')]:
 text=dep.read_text().replace('\\\n',' ')
 for word in shlex.split(text.split(':',1)[1]):
  p=pathlib.Path(word.removesuffix(':'))
  if p.is_absolute() and p.is_file():includes.add(p.resolve())
files.update(includes)
for word in shlex.split((task/'logs/host-llvm-libfiles.txt').read_text()):files.add(pathlib.Path(word).resolve())
for log in (task/'logs').glob('host-*-ldd.txt'):
 for word in re.findall(r'(/[^\s()]+)',log.read_text()):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
for name in ['clang','llvm-config','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib','llvm-readelf','llvm-objdump']:
 files.add((pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'/name).resolve())
for name in ['g++','gcc','python3','bash','tar','patch','make','du','df','stat','ldd','prlimit']:
 files.add(pathlib.Path(shutil.which(name)).resolve())
files.add(pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve())
for name in ['config.sh','acceptance.json','repository-freeze.json']:files.add(task/name)
J=json.loads((task/'logs/object-inventory.json').read_text());assert J['exit']['exit']==2
assert J['partialOrNonWasmObjectCount']==0
assert all(digest(pathlib.Path(p))['sha256']==h['sha256'] for p,h in J['objects'].items())
plan=json.loads((task/'logs/static-loader-plan.json').read_text())
for row in plan['evidence']:
 p=pathlib.Path(row['source']);assert digest(p)['sha256']==row['sha256'];files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
out=task/'manifest.json';assert not out.exists()
out.write_text(json.dumps({'scope':'GNU full make FAIL; bounded valid-object/failure inventory and source-only loader plan','includeFiles':len(includes),'files':entries},indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'rechecked':len(entries),'includes':len(includes),'sha256':digest(out)['sha256']}))
