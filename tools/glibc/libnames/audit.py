#!/usr/bin/env python3
"""Verify actual GNU compile inputs, static requirements and owned process exits."""
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess

task = pathlib.Path(os.environ['GLIBC_TASK'])
tools = pathlib.Path(os.environ['GLIBC_TOOLCHAIN']) / 'bin'
source = task / 'source/glibc-2.44'
pristine = pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
result = json.loads((task / 'logs/libnames-build/result.json').read_text())
assert result['pass']
controls = json.loads((task / 'logs/static-require-control2/result.json').read_text())
assert controls['pass']
binding = json.loads((task / 'logs/gnu-binding-control/result.json').read_text())
assert binding['pass'] and binding['hostMetadataOnly']
attempts = [(p, json.loads(p.read_text())) for p in (task / 'logs/c-attempts').glob('*/attempt.json')]
inputs = {}
rows = []

def record(path):
    data = path.read_bytes()
    row = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    inputs[str(path.resolve())] = row
    return row

for obj in result['objects']:
    output = task / 'objects/fullmake' / obj['unit']
    assert record(output)['sha256'] == obj['sha256']
    matches = [(p, row) for p, row in attempts if row.get('pass') and row['output'] == str(output)
               and row['objectSha256'] == obj['sha256']]
    assert len(matches) == 1
    attempt_path, attempt = matches[0]
    actual_source = pathlib.Path(attempt['source'])
    assert actual_source.read_bytes() == pathlib.Path(attempt['sourceSnapshot']).read_bytes()
    assert actual_source.read_bytes() == (pristine / actual_source.relative_to(source)).read_bytes()
    assert all(stage['exit'] == 0 for stage in attempt['stages'])
    require = re.findall(r'PTHREAD_STATIC_FN_REQUIRE\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)',
                         actual_source.read_text())
    symbols = subprocess.check_output([str(tools / 'llvm-nm'), '--undefined-only', str(output)], text=True)
    strong = {line.split()[-1] for line in symbols.splitlines() if len(line.split()) >= 2 and line.split()[-2] == 'U'}
    weak = {line.split()[-1] for line in symbols.splitlines() if len(line.split()) >= 2 and line.split()[-2] == 'w'}
    # Genuine libc-lockP.h explicitly makes trylock weak in the static build.
    # GNU .globl does not erase that weak binding; preserve the same boundary.
    allowed_weak = {'__pthread_mutex_trylock'} if obj['unit'] == 'nptl/pthread_create.o' else set()
    assert set(require) - allowed_weak <= strong, (obj['unit'], set(require) - strong - allowed_weak)
    assert allowed_weak <= weak
    front = (attempt_path.parent / 'front.ll').read_text()
    assert not any(line.startswith('module asm') for line in front.splitlines())
    for name in require:
        variable = '@__wasm_static_require_' + name
        assert any(line.startswith(variable + ' = internal constant ptr @' + name)
                   for line in front.splitlines()), name
        assert any(line.startswith('@llvm.used = ') and variable in line
                   for line in front.splitlines()), name
    for path in [actual_source, pathlib.Path(attempt['sourceSnapshot']), attempt_path,
                 attempt_path.parent / 'front.ll']:
        record(path)
    dep = output.with_suffix(output.suffix + '.dt')
    record(dep)
    words = shlex.split(dep.read_text().replace('\\\n', ' ').split(':', 1)[1])
    for word in words:
        if word.endswith(':'):
            continue
        path = pathlib.Path(word)
        if not path.is_absolute():
            path = pathlib.Path(attempt['cwd']) / path
        assert path.is_file(), str(path)
        record(path)
    rows.append({'unit': obj['unit'], 'successfulAttempt': str(attempt_path),
                 'requiredStrongSymbols': sorted(set(require) - allowed_weak),
                 'genuineWeakRequirements': sorted(allowed_weak), 'noModuleAssembly': True})

groups = {}
for path in (task / 'logs/supervision').glob('*.json'):
    report = json.loads(path.read_text())
    assert 'exit' in report and not report['terminalMembers']
    groups[report['pgid']] = {'record': str(path), 'exit': report['exit']}
live = []
for path in pathlib.Path('/proc').glob('[0-9]*/stat'):
    try:
        fields = path.read_text().rsplit(')', 1)[1].split()
        if int(fields[2]) in groups and fields[0] != 'Z':
            live.append(int(path.parent.name))
    except (OSError, ValueError):
        pass
assert not live
accepted = {'pass': True, 'units': rows, 'inputs': inputs, 'terminalGroups': groups,
            'liveMembers': live, 'controls': controls, 'GNUWeakBindingControl': binding,
            'scope': 'selected GNU build metadata/static requirements; runtime pthread/Nightly incomplete'}
(task / 'acceptance.json').write_text(json.dumps(accepted, indent=2) + '\n')
print(json.dumps({'pass': True, 'GNUObjects': len(rows), 'strongStaticRequirements': sum(len(row['requiredStrongSymbols']) for row in rows),
                  'actualInputs': len(inputs), 'terminalGroups': len(groups)}))
