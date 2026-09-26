#!/usr/bin/env python3
"""Compile the archived Portable Baseline interpreter without mutating its build.

This compatibility gate does NOT produce a usable Firefox or safely relinkable
replacement: ENABLE_PORTABLE_BASELINE_INTERP changes shared JS engine layouts.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--objects', type=Path, required=True)
parser.add_argument('--libcxx-include', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--timeout', type=int, default=300)
args = parser.parse_args()
if not 1 <= args.timeout <= 300:
    parser.error('timeout must be 1..300 seconds')
obj, out, libcxx = args.objects.resolve(), args.output.resolve(), args.libcxx_include.resolve()
if out == obj or obj in out.parents:
    parser.error('output must be outside the preserved object tree')
if not libcxx.is_dir():
    parser.error('libcxx include directory does not exist')
entries = json.loads((obj / 'clangd/compile_commands.json').read_text())
entry = next(e for e in entries if e['file'].endswith('/vm/Interpreter.cpp'))
source = Path(entry['file'])
if not source.is_absolute():
    source = Path(entry['directory']) / source
source = source.resolve().with_name('PortableBaselineInterpret.cpp')
if not source.is_file():
    parser.error('archived PortableBaselineInterpret.cpp is missing')
if source.parent in out.parents or out == source.parent:
    parser.error('output must be outside the preserved source tree')
out.mkdir(parents=True, exist_ok=True)
output = out / 'PortableBaselineInterpret.o'
if output.exists():
    parser.error('use a fresh output directory: object already exists')
command = shlex.split(entry['command'])
output_index = command.index('-o') + 1
if command[output_index] != '/dev/null' or '-c' not in command:
    parser.error('unexpected archived compile command')
command[output_index] = str(output)
command[-1] = str(source)
insert = command.index('-I' + str(obj / 'dist/system_wrappers')) + 1
command[insert:insert] = ['-isystem', str(libcxx), '-DENABLE_PORTABLE_BASELINE_INTERP=1']
# A compile database should not write .d files into the preserved object tree.
if any(flag in command for flag in ['-MD', '-MMD', '-MF', '-MJ']):
    parser.error('unexpected dependency-output flags; inspect before using this gate')
(out / 'command.txt').write_text(shlex.join(command) + '\n')
report = {'source': str(source), 'objects': str(obj), 'timeoutSeconds': args.timeout,
          'scope': 'single translation unit compatibility only; not runnable JIT or Firefox',
          'preservedSourcesAndObjects': True}
env = os.environ.copy()
env['TMPDIR'] = str(out)
try:
    with (out / 'compile.log').open('w') as log:
        completed = subprocess.run(command, cwd=entry['directory'], env=env,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   timeout=args.timeout, check=False)
    report['exitCode'] = completed.returncode
    report['pass'] = completed.returncode == 0 and output.is_file()
except subprocess.TimeoutExpired:
    report['pass'] = False
    report['timeout'] = True
report['objectBytes'] = output.stat().st_size if output.exists() else 0
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
sys.exit(0 if report['pass'] else 1)
