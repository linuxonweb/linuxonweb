#!/usr/bin/env python3
"""Build GNU stat families with actual architecture-selected statx conversion."""
import hashlib
import json
import os
import pathlib
import subprocess

task = pathlib.Path(os.environ['GLIBC_TASK'])
source = task / 'source/glibc-2.44'
objects = task / 'objects/fullmake'
pristine = pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent / 'source/glibc-2.44'
inventory = pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])
toolchain = pathlib.Path(os.environ['GLIBC_TOOLCHAIN']) / 'bin'
logs = task / 'logs/stat-build'
logs.mkdir()
commands = []
units = {
    'io': ['stat64', 'lstat64', 'fstat64', 'fstatat64', 'statx_cp'],
    'misc': ['xstat64', 'lxstat64', 'fxstat64', 'fxstatat64', 'makedev'],
}

failures = json.loads((inventory / 'logs/primary-failures.json').read_text())['failedUnits']
original = [row for row in failures if row['primaryClass'] == 'kernel/public stat ABI selection']
assert len(original) == 2
for row in original:
    new = source / pathlib.Path(row['source']).relative_to(inventory / 'source/glibc-2.44')
    assert new.read_bytes() == pathlib.Path(row['sourceSnapshot']).read_bytes()

for subdir, names in units.items():
    argv = ['make', '-C', str(source / subdir), 'objdir=' + str(objects), '-j2',
            *[str(objects / subdir / (name + '.o')) for name in names]]
    with (logs / (subdir + '.log')).open('wb') as output:
        process = subprocess.run(argv, stdout=output, stderr=subprocess.STDOUT)
    commands.append({'argv': argv, 'cwd': str(pathlib.Path.cwd()), 'exit': process.returncode})
    (logs / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
    if process.returncode:
        raise SystemExit(process.returncode)

artifacts = []
for subdir, names in units.items():
    for name in names:
        output = objects / subdir / (name + '.o')
        data = output.read_bytes()
        assert data[:8] == b'\x00asm\x01\x00\x00\x00'
        subprocess.run(['wasm-validate', '--enable-all', str(output)], check=True)
        symbols = subprocess.check_output([str(toolchain / 'llvm-nm'), str(output)], text=True)
        (logs / (name + '-symbols.txt')).write_text(symbols)
        genuine = source / ('misc/makedev.c' if name=='makedev' else 'sysdeps/unix/sysv/linux/' + name + '.c')
        assert genuine.read_bytes() == (pristine / genuine.relative_to(source)).read_bytes()
        artifacts.append({'unit': subdir + '/' + name + '.o',
                          'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                          'genuineSource': str(genuine),
                          'genuineSourceSha256': hashlib.sha256(genuine.read_bytes()).hexdigest()})

result = {'pass': True, 'actualMakeTargets': len(artifacts), 'originalFailuresClosed': 2,
          'objects': artifacts, 'commands': commands,
          'scope': 'selected GNU stat compilation; public runtime/time64/sysroot acceptance pending'}
(logs / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
