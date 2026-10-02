#!/usr/bin/env python3
"""Prove the native static requirement survives GC and extracts its archive."""
import json
import os
import pathlib
import re
import subprocess
import sys

task = pathlib.Path(os.environ['GLIBC_TASK'])
root = pathlib.Path(__file__).resolve().parent
tools = pathlib.Path(os.environ['GLIBC_TOOLCHAIN']) / 'bin'
label = sys.argv[1] if len(sys.argv) == 2 else 'static-require-control'
assert re.fullmatch(r'[A-Za-z0-9_-]+', label)
dest = task / 'objects' / label
dest.mkdir()
logdir = task / 'logs' / label
logdir.mkdir()
sources = task / 'source' / label
sources.mkdir()
(sources / 'control.c').write_text('#include <pthreadP.h>\nextern int require_probe(int);\n'
                                 'PTHREAD_STATIC_FN_REQUIRE(require_probe)\n'
                                 'int run(void) { return 19; }\n')
(sources / 'provider.c').write_text('int require_probe(int value) { return value + 11; }\n')
attempts = [json.loads(p.read_text()) for p in (task / 'logs/c-attempts').glob('*/attempt.json')]
matches = [row for row in attempts if row.get('pass') and row['output'].endswith('/nptl/pthread_exit.o')]
assert len(matches) == 1
template = matches[0]
records = []

def execute(label, argv, cwd=None, expected=0):
    proc = subprocess.run(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (logdir / (label + '.stdout')).write_bytes(proc.stdout)
    (logdir / (label + '.stderr')).write_bytes(proc.stderr)
    records.append({'label': label, 'argv': argv, 'cwd': str(cwd or pathlib.Path.cwd()),
                    'exit': proc.returncode})
    (logdir / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
    assert proc.returncode == expected, (label, proc.returncode)
    return proc

for name in ['control', 'provider']:
    argv = template['originalArgs'].copy()
    # The frozen driver's retained list is normalized for its frontend stage.
    argv.append('-c')
    argv[argv.index('pthread_exit.c')] = str(sources / (name + '.c'))
    for flag, value in [('-o', dest / (name + '.o')), ('-MF', dest / (name + '.dt')),
                        ('-MT', dest / (name + '.o'))]:
        argv[argv.index(flag) + 1] = str(value)
    execute('compile-' + name, [sys.executable, str(root.parent / 'syscalls-fixed/compiler.py'), *argv],
            cwd=template['cwd'])
symbols = execute('undefined', [str(tools / 'llvm-nm'), '--undefined-only', str(dest / 'control.o')]).stdout.decode()
assert any(line.split() == ['U', 'require_probe'] for line in symbols.splitlines())
flags = ['--no-entry', '--export=run', '--export-table', '--export-memory', '--gc-sections']
missing = execute('missing-provider', [str(tools / 'wasm-ld'), *flags, str(dest / 'control.o'),
                                      '-o', str(dest / 'missing.wasm')], expected=1)
assert b'undefined symbol: require_probe' in missing.stderr
execute('archive', [str(tools / 'llvm-ar'), 'crs', str(dest / 'provider.a'), str(dest / 'provider.o')])
execute('link', [str(tools / 'wasm-ld'), *flags, str(dest / 'control.o'), str(dest / 'provider.a'),
                 '-o', str(dest / 'native.wasm')])
execute('transform', ['wasm-opt', '--all-features', '--disable-compact-imports',
                      '--pass-arg=max-func-params@23', '--fpcast-emu', str(dest / 'native.wasm'),
                      '-o', str(dest / 'fpcast.wasm')])
for name in ['native', 'fpcast']:
    execute('validate-' + name, ['wasm-validate', '--enable-all', str(dest / (name + '.wasm'))])
execute('host', ['node', str(root / 'controls.mjs'), str(dest), str(logdir / 'host-result.json')])
result = {'pass': True, 'missingProviderFails': True, 'strongUndefinedRelocation': True,
          'archiveExtractedUnderGC': True,
          'host': json.loads((logdir / 'host-result.json').read_text()),
          'scope': 'private static-link control; no GNU cancellation provider or guest pthread lifecycle'}
(logdir / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
