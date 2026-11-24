#!/usr/bin/env python3
"""Freeze actual inputs plus accepted gates and the separate GNU make diagnosis."""
import os,pathlib,hashlib,json,shlex,re
root=pathlib.Path(__file__).resolve().parent;task=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
files={p.resolve() for p in root.parent.rglob('*') if p.is_file()}
files.add(root.parents[2]/'docs/glibc-native-jumps-20261002.md')
for area in ['source','objects','logs']:
 files.update(p.resolve() for p in (task/area).rglob('*') if p.is_file())
includes=set()
for dep in (task/'logs/full-dependencies').glob('*.d'):
 includes.update(pathlib.Path(p).resolve() for p in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]))
files.update(includes)
for path in shlex.split((task/'logs/host-llvm-libfiles.txt').read_text()):files.add(pathlib.Path(path).resolve())
for path in re.findall(r'(/[^\s()]+)',(task/'logs/host-lower-ldd.txt').read_text()):files.add(pathlib.Path(path).resolve())
for runname in ['guest-native-run4','guest-fpcast-run1']:
 run=task/runname;r=json.loads((run/'result.json').read_text());j=json.loads((run/'jumps-result.json').read_text());assert r['pass'] and j['pass']
 for p,h in r['inputs'].items():
  p=pathlib.Path(p).resolve();assert digest(p)['sha256']==h;files.add(p)
 for f in ['result.json','jumps-result.json','guest-console.txt','requested.json','command.json','run-guest.mjs','build.json']:files.add(run/f)
for name in ['native-package-run1','native-package-run2','native-package-run3','fpcast-package-run1']:
 files.update(p for p in (task/name).iterdir() if p.is_file())
for runname in ['guest-native-run1','guest-native-run2','guest-native-run3']:
 files.update(p for p in (task/runname).iterdir() if p.is_file() and p.suffix in ['.json','.txt','.mjs'])
for name in ['clang','clang++','wasm-ld','llvm-config','opt','llc','llvm-dis','llvm-nm','llvm-ar','llvm-ranlib']:
 files.add((pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'/name).resolve())
files.add(pathlib.Path(os.environ.get('GLIBC_HOST_CXX','/usr/bin/g++')).resolve())
for f in ['config.sh','acceptance.json','abi.json','accepted-runtime-before-fullmake.json']:files.add(task/f)
entries={str(p):digest(p) for p in sorted(files)}
out=task/'manifest.json';assert not out.exists()
out.write_text(json.dumps({'scope':'Native GNU jumps; diagnostic partial make remains FAIL','includeFiles':len(includes),'files':entries},indent=2)+'\n')
assert all(digest(pathlib.Path(p))==h for p,h in entries.items())
print(json.dumps({'rechecked':len(entries),'includes':len(includes),'sha256':digest(out)['sha256']}))
