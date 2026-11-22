#!/usr/bin/env python3
"""Freeze/recheck sources, real include closure, tools, runtime and gate evidence.

Run after final documentation using a new task manifest destination. No browser
profiles/caches or predecessor packets are copied to the repository.
"""
import hashlib,json,os,shlex
from pathlib import Path
root=Path(__file__).resolve().parent
task=Path(os.environ['GLIBC_TASK']).resolve()
report=task/'manifest.json'
if report.exists():raise SystemExit('Manifest exists; refusing replacement')
files=set(p.resolve() for p in root.rglob('*') if p.is_file())
files.add(root.parents[1]/'docs/glibc-port-integration-20261002.md')
files.update(p.resolve() for p in (task/'source').rglob('*') if p.is_file())
files.update(p.resolve() for p in (task/'objects').rglob('*') if p.is_file())
files.update(p.resolve() for p in (task/'logs').rglob('*') if p.is_file())
include_files=set()
for dep in (task/'logs/full-dependencies').glob('*.d'):
    body=dep.read_text().replace('\\\n',' ')
    include_files.update(Path(p).resolve() for p in shlex.split(body.split(':',1)[1]))
files.update(include_files)
for name in ['guest-native-run1','guest-fpcast-run1']:
    run=task/name
    result=json.loads((run/'result.json').read_text())
    if not result['pass']:raise SystemExit('Guest gate failed: '+name)
    for path,digest in result['inputs'].items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=digest:raise SystemExit('Guest input changed: '+path)
        files.add(Path(path).resolve())
    for filename in ['result.json','guest-console.txt','requested.json','command.json','run-guest.mjs','build.json']:
        files.add(run/filename)
for name in ['native-package-run1','fpcast-package-run1']:
    files.add(task/name/'build.json');files.add(task/name/'initramfs.cpio')
for name in ['clang','wasm-ld']:
    files.add((Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'/name).resolve())
files.update(task/p for p in ['config.sh','acceptance.json'])
entries={}
for path in sorted(files):
    body=path.read_bytes();entries[str(path)]={'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}
manifest={'scope':'Combined static GNU subset, not libc.a/sysroot/NPTL','includeFiles':len(include_files),'sourceFiles':sum(str(task/'source/glibc-2.44') in p for p in entries),'files':entries}
report.write_text(json.dumps(manifest,indent=2)+'\n')
for path,entry in entries.items():
    body=Path(path).read_bytes()
    if len(body)!=entry['bytes'] or hashlib.sha256(body).hexdigest()!=entry['sha256']:raise SystemExit('Final input changed: '+path)
print(json.dumps({'rechecked':len(entries),'includes':len(include_files),'manifestSha256':hashlib.sha256(report.read_bytes()).hexdigest()}))
