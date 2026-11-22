#!/usr/bin/env python3
"""Freeze compile-only GNU stat provenance without traversing other agents' work."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess

task = pathlib.Path(os.environ['GLIBC_TASK']).resolve()
root = pathlib.Path(__file__).resolve().parent
repo = root.parents[2]
fixed = pathlib.Path('/mnt/p6/build/glibc-syscalls-fixed-20261002')
cleanup = pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET'])
fenv = pathlib.Path(os.environ['GLIBC_FENV_PACKET'])
inventory = pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])
toolchain = pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(4194304), b''):
            h.update(block)
    return {'sha256': h.hexdigest(), 'bytes': path.stat().st_size}


assert not (task / 'manifest.json').exists()
acceptance = json.loads((task / 'compile-acceptance.json').read_text())
assert acceptance['pass'] and acceptance['GNUObjects'] == 9
assert acceptance['publicHeaderReferences'] == 8
assert not acceptance['liveMembers']
files = set()
parents = {}
for packet, expected in [
    (fixed, 'b17e5f7744e2f4eae6714db5f4544b7e953a18b89a0bf419f89ead66ad2e784f'),
    (cleanup, '15bcb2d693cb08ced4f962c197a934232c7ff6d29b8c4806459f0a51f5db8e17'),
    (fenv, 'c575dc6867d292bb6ca120831ffa7c13e48a7732671d6a190009937f86c17cd1'),
    (inventory, '8b53d66f81cbdc96a3b6b38491be44ec84c2fa9df4d09c3627b23de41bbae929')]:
    manifest = packet / 'manifest.json'
    assert digest(manifest)['sha256'] == expected
    parents[packet] = json.loads(manifest.read_text())['files']
    files.add(manifest.resolve())


def inherited(packet, path, expected=None):
    path = pathlib.Path(path).resolve()
    actual = digest(path)
    assert actual == parents[packet][str(path)], str(path)
    if expected is not None:
        assert actual == expected, str(path)
    files.add(path)


borrowed = json.loads((task / 'borrowed-tool-inputs.json').read_text())
assert borrowed['pass'] and len(borrowed['rows']) == 144
for row in borrowed['rows']:
    inherited(fixed, row['path'], {key: row[key] for key in ['sha256', 'bytes']})
reuse = json.loads((task / 'logs/reuse-compiler.json').read_text())
assert reuse['pass']
for row in reuse['rows']:
    inherited(cleanup, row['input'], row['verified'])
for tree in ['logs/compiler', 'objects/compiler', 'source-snapshots/compiler']:
    for p in (cleanup / tree).rglob('*'):
        if p.is_file():
            inherited(cleanup, p)
runtime = json.loads((task / 'logs/reuse-fenv-runtime.json').read_text())
assert runtime['pass'] and runtime['objects'] == 123
inherited(fenv, fenv / 'logs/final-runtime-inputs.json')
for row in runtime['rows']:
    h = {key: row[key] for key in ['sha256', 'bytes']}
    inherited(fenv, row['path'], h)
    inherited(fenv, row['snapshot'], h)
for name, expected in acceptance['inputs'].items():
    p = pathlib.Path(name).resolve()
    assert digest(p) == expected, name
    files.add(p)
sourceplan = json.loads((task / 'source-plan.json').read_text())
for row in sourceplan['originalFailures']:
    inherited(inventory, row['sourceSnapshot'])
pristine = pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
for row in acceptance['units']:
    stem = pathlib.Path(row['unit']).stem
    p = pristine / 'sysdeps/unix/sysv/linux' / (stem + '.c')
    assert p.read_bytes() == (task / 'source/glibc-2.44/sysdeps/unix/sysv/linux' / (stem + '.c')).read_bytes()
    files.add(p.resolve())
kernel = repo / 'web/linux/vmlinux.wasm'
assert digest(kernel)['sha256'] == sourceplan['kernelSHA']
files.add(kernel.resolve())
archive = pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE'])
assert digest(archive)['sha256'] == '37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667'
files.add(archive.resolve())
for name in ['clang', 'opt', 'llc', 'llvm-config', 'llvm-nm', 'llvm-ar',
             'llvm-ranlib', 'llvm-dis', 'llvm-readelf', 'llvm-readobj',
             'llvm-objdump', 'wasm-ld']:
    files.add((toolchain / 'bin' / name).resolve())
for name in ['python3', 'bash', 'make', 'tar', 'patch', 'g++', 'gcc', 'awk',
             'sed', 'perl', 'cmp', 'du', 'df', 'stat', 'ldd', 'wasm-validate']:
    files.add(pathlib.Path(shutil.which(name)).resolve())
for label, binary in [('owned-clang', task / 'objects/compiler/clang'),
                      ('original-clang', toolchain / 'bin/clang')]:
    output = subprocess.check_output(['ldd', str(binary)], text=True)
    q = task / 'logs' / ('freeze-ldd-' + label + '.txt')
    assert not q.exists()
    q.write_text(output)
    for word in re.findall(r'(/[^\s()]+)', output):
        p = pathlib.Path(word)
        if p.is_file():
            files.add(p.resolve())
repoFiles = sorted([p for p in root.rglob('*') if p.is_file()] + [
    repo / 'docs/glibc-stat-plan-20261002.md',
    repo / 'docs/glibc-stat-20261002.md'])
assert len(repoFiles) == 12
(task / 'repository-freeze.json').write_text(json.dumps({
    str(p.relative_to(repo)): digest(p) for p in repoFiles}, indent=2) + '\n')
files.update(p.resolve() for p in repoFiles)
for p in task.rglob('*'):
    if p.is_file() and not {'cache', 'profile', 'xdg'}.intersection(p.relative_to(task).parts):
        files.add(p.resolve())
entries = {str(p): digest(p) for p in sorted(files)}
for name, h in entries.items():
    assert digest(pathlib.Path(name)) == h, name
result = {'scope': 'nine GNU stat objects, public types and statx routing; not runtime/sysroot/Nightly',
          'actualCompileInputs': len(acceptance['inputs']), 'borrowedToolInputs': len(borrowed['rows']),
          'files': entries}
(task / 'manifest.json').write_text(json.dumps(result, indent=2) + '\n')
for name, h in entries.items():
    assert digest(pathlib.Path(name)) == h, name
print(json.dumps({'pass': True, 'entries': len(entries), 'repositoryPaths': len(repoFiles),
                 'manifestSha256': digest(task / 'manifest.json')['sha256'],
                 'acceptanceSha256': digest(task / 'compile-acceptance.json')['sha256'],
                 'repositoryFreezeSha256': digest(task / 'repository-freeze.json')['sha256']}))
