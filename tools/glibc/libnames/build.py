#!/usr/bin/env python3
"""Build actual GNU metadata and the three formerly blocked NPTL objects."""
import hashlib
import json
import os
import pathlib
import subprocess

task = pathlib.Path(os.environ['GLIBC_TASK'])
inventory = pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])
pristine = pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
source = task / 'source/glibc-2.44'
objects = task / 'objects/fullmake'
logs = task / 'logs/libnames-build'
logs.mkdir()
rows = []

def run(label, command):
    log = logs / (label + '.log')
    with log.open('wb') as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
    rows.append({'label': label, 'argv': command, 'cwd': str(pathlib.Path.cwd()),
                 'exit': result.returncode, 'log': str(log)})
    (logs / 'commands.json').write_text(json.dumps(rows, indent=2) + '\n')
    if result.returncode:
        raise SystemExit(result.returncode)

run('metadata', ['make', '-C', str(objects), '-j1', str(objects / 'gnu/lib-names.h'),
                 str(objects / 'wasm-libnames-sonames.txt')])
header = objects / 'gnu/lib-names.h'
sonames = objects / 'wasm-libnames-sonames.txt'
script = source / 'scripts/lib-names.awk'
assert script.read_bytes() == (pristine / 'scripts/lib-names.awk').read_bytes()
actual = [line for line in header.read_text().splitlines() if line.startswith('#define ')]
with sonames.open('rb') as input_file:
    expected = subprocess.check_output(['awk', '-f', str(script)], stdin=input_file,
                                       env={**os.environ, 'LC_ALL': 'C'}).decode().splitlines()
assert sorted(line for line in actual if not line.startswith('#define __GNU_LIB_NAMES_H')) == sorted(expected)
failed = json.loads((inventory / 'logs/primary-failures.json').read_text())['failedUnits']
units = [row for row in failed if row['primaryClass'] == 'GNU library-name header generation']
assert len(units) == 3
for row in units:
    new = source / pathlib.Path(row['unit']).with_suffix('.c')
    assert new.read_bytes() == pathlib.Path(row['sourceSnapshot']).read_bytes()
run('selected-nptl', ['make', '-C', str(source / 'nptl'), 'objdir=' + str(objects),
                      '-j2', *[str(objects / row['unit']) for row in units]])
artifacts = []
toolchain = pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])
for row in units:
    obj = objects / row['unit']
    data = obj.read_bytes()
    assert data[:8] == b'\x00asm\x01\x00\x00\x00'
    subprocess.run(['wasm-validate', '--enable-all', str(obj)], check=True)
    symbols = subprocess.check_output([str(toolchain / 'bin/llvm-nm'), '--defined-only', str(obj)], text=True)
    name = pathlib.Path(row['unit']).stem
    assert any(line.split()[-2:] == ['W', name] or line.split()[-2:] == ['T', name]
               for line in symbols.splitlines() if len(line.split()) >= 2)
    (logs / (name + '-symbols.txt')).write_text(symbols)
    artifacts.append({'unit': row['unit'], 'bytes': len(data),
                      'sha256': hashlib.sha256(data).hexdigest()})
result = {'pass': True, 'actualMakeTargets': 3, 'genuineGeneratorMacros': len(expected),
          'headerSha256': hashlib.sha256(header.read_bytes()).hexdigest(),
          'objects': artifacts, 'commands': rows,
          'scope': 'GNU static metadata and selected object builds; no public pthread lifecycle/cancellation/sysroot/Nightly acceptance'}
(logs / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
