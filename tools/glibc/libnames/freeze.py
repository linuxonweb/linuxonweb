#!/usr/bin/env python3
"""Freeze only owned metadata evidence and verified consumed predecessors."""
import hashlib
import json
import os
import pathlib
import shutil

task = pathlib.Path(os.environ['GLIBC_TASK']).resolve()
root = pathlib.Path(__file__).resolve().parent
repo = root.parents[2]
report = repo / 'docs/glibc-libnames-20261002.md'
assert not (task / 'manifest.json').exists()
assert shutil.disk_usage(task).free > 8589934592
assert sum(p.stat().st_size for p in task.rglob('*') if p.is_file()) < 2147483648

def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(4194304), b''):
            sha.update(data)
    return {'sha256': sha.hexdigest(), 'bytes': path.stat().st_size}

accepted = json.loads((task / 'acceptance.json').read_text())
assert accepted['pass']
files = {p.resolve() for p in task.rglob('*') if p.is_file()}
for name, expected in accepted['inputs'].items():
    path = pathlib.Path(name)
    assert digest(path) == expected
    files.add(path.resolve())
predecessor = pathlib.Path('/mnt/p6/build/glibc-syscalls-fixed-20261002')
assert digest(predecessor / 'manifest.json')['sha256'] == 'b17e5f7744e2f4eae6714db5f4544b7e953a18b89a0bf419f89ead66ad2e784f'
frozen = json.loads((predecessor / 'manifest.json').read_text())['files']
files.add(predecessor / 'manifest.json')
for row in json.loads((task / 'logs/frozen-tool-inputs.json').read_text())['rows']:
    path = pathlib.Path(row['path']).resolve()
    assert digest(path) == frozen[str(path)]
    files.add(path)
for proof in ['reuse-compiler.json', 'reuse-fenv-runtime.json']:
    for row in json.loads((task / 'logs' / proof).read_text())['rows']:
        for key in ['input', 'path', 'snapshot']:
            if key in row:
                path = pathlib.Path(row[key]).resolve()
                assert digest(path) == frozen[str(path)]
                files.add(path)
for name in ['GLIBC_TOOLCHAIN', 'GNU_RELEASE_ARCHIVE']:
    path = pathlib.Path(os.environ[name])
    if path.is_file():
        files.add(path.resolve())
toolchain = pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])
for name in ['clang', 'opt', 'llc', 'llvm-nm', 'llvm-ar', 'wasm-ld']:
    files.add((toolchain / 'bin' / name).resolve())
for name in ['python3', 'bash', 'awk', 'as', 'nm', 'node', 'make', 'wasm-opt', 'wasm-validate']:
    files.add(pathlib.Path(shutil.which(name)).resolve())
repository = sorted([p for p in root.iterdir() if p.is_file()] + [report])
repo_freeze = {str(p.relative_to(repo)): digest(p) for p in repository}
(task / 'repository-freeze.json').write_text(json.dumps(repo_freeze, indent=2) + '\n')
files.add(task / 'repository-freeze.json')
files.update(p.resolve() for p in repository)
entries = {str(p): digest(p) for p in sorted(files)}
assert all(digest(pathlib.Path(name)) == expected for name, expected in entries.items())
manifest = {'scope': 'GNU name generation and typed static requirements; selected3 object/control gates only',
            'files': entries, 'actualCompileInputs': len(accepted['inputs']),
            'repositoryPaths': len(repository)}
(task / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
assert all(digest(pathlib.Path(name)) == expected for name, expected in entries.items())
print(json.dumps({'pass': True, 'entries': len(entries), 'actualCompileInputs': len(accepted['inputs']),
                  'repositoryPaths': len(repository), 'manifest': digest(task / 'manifest.json'),
                  'repositoryFreeze': digest(task / 'repository-freeze.json')}))
