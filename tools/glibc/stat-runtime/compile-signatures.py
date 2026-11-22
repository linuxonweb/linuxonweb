#!/usr/bin/env python3
"""Compile independent public stat types with the actual GNU make flags."""
import json
import os
import pathlib
import shutil
import subprocess

task = pathlib.Path(os.environ['GLIBC_TASK'])
root = pathlib.Path(__file__).resolve().parent
attempts = [json.loads(p.read_text()) for p in (task / 'logs/c-attempts').glob('*/attempt.json')]
row = next(row for row in attempts if row.get('pass') and
           row['output'] == str(task / 'objects/fullmake/io/fstatat64.o'))
source = task / 'source/signatures.c'
assert not source.exists() or source.read_bytes() == (root / 'signatures.c').read_bytes()
shutil.copy2(root / 'signatures.c', source)
args = row['originalArgs'].copy()
indices = [i for i, value in enumerate(args) if value.endswith('.c')]
assert len(indices) == 1
args[indices[0]] = str(source)
output = task / 'objects/stat-signatures.o'
args[args.index('-o') + 1] = str(output)
for flag, value in [('-MF', str(output) + '.dt'), ('-MT', str(output))]:
    args[args.index(flag) + 1] = value
# This owned driver records an independent original argv before mutation.
assert '-c' in args
command = ['python3', str(root / 'compiler.py'), *args]
logs = task / 'logs/signatures'
logs.mkdir()
(logs / 'command.json').write_text(json.dumps({'argv': command, 'cwd': row['cwd'],
    'scope': 'independent genuine public stat ABI/types'}, indent=2) + '\n')
with (logs / 'stdout').open('wb') as out, (logs / 'stderr').open('wb') as err:
    process = subprocess.run(command, cwd=row['cwd'], stdout=out, stderr=err)
(logs / 'result.json').write_text(json.dumps({'exit': process.returncode,
    'pass': process.returncode == 0}, indent=2) + '\n')
print((logs / 'stderr').read_text())
raise SystemExit(process.returncode)
