#!/usr/bin/env python3
"""Audit actual GNU source/header inputs, statx calls and public alias identities."""
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess

task = pathlib.Path(os.environ['GLIBC_TASK'])
source = task / 'source/glibc-2.44'
pristine = pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
toolchain = pathlib.Path(os.environ['GLIBC_TOOLCHAIN']) / 'bin'
result = json.loads((task / 'logs/stat-build/result.json').read_text())
assert result['pass'] and result['actualMakeTargets'] == 9
assert json.loads((task / 'logs/signatures/result.json').read_text())['pass']
attempts = [(p, json.loads(p.read_text())) for p in (task / 'logs/c-attempts').glob('*/attempt.json')]
inputs = {}
units = []


def record(path):
    data = path.read_bytes()
    row = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    inputs[str(path.resolve())] = row
    return row


def audit_attempt(output):
    matches = [(p, row) for p, row in attempts if row.get('pass') and
               row['output'] == str(output) and row['objectSha256'] == record(output)['sha256']]
    assert len(matches) == 1, str(output)
    path, row = matches[0]
    actual_source = pathlib.Path(row['source'])
    assert actual_source.read_bytes() == pathlib.Path(row['sourceSnapshot']).read_bytes()
    assert all(stage['exit'] == 0 for stage in row['stages'])
    for item in [path, actual_source, pathlib.Path(row['sourceSnapshot']), path.parent / 'front.ll']:
        record(item)
    dep = output.with_suffix(output.suffix + '.dt')
    record(dep)
    for word in shlex.split(dep.read_text().replace('\\\n', ' ').split(':', 1)[1]):
        if word.endswith(':'):
            continue
        header = pathlib.Path(word)
        if not header.is_absolute():
            header = pathlib.Path(row['cwd']) / header
        assert header.is_file(), str(header)
        record(header)
    return path, row, (path.parent / 'front.ll').read_text()


for artifact in result['objects']:
    output = task / 'objects/fullmake' / artifact['unit']
    assert record(output) == {key: artifact[key] for key in ['sha256', 'bytes']}
    attempt_path, attempt, front = audit_attempt(output)
    genuine = pathlib.Path(artifact['genuineSource'])
    assert genuine.read_bytes() == (pristine / genuine.relative_to(source)).read_bytes()
    record(genuine)
    symbols_text = subprocess.check_output([str(toolchain / 'llvm-nm'), str(output)], text=True)
    symbols = {}
    for line in symbols_text.splitlines():
        words = line.split()
        if len(words) == 3:
            symbols[words[-1]] = {'address': words[0], 'binding': words[1]}
    stem = output.stem
    if stem in ['stat64', 'lstat64', 'fstat64', 'fstatat64']:
        body, public = '__' + stem, stem
        ordinary = stem.removesuffix('64')
        assert symbols[body]['binding'] == 'T'
        for name in [public, ordinary]:
            assert symbols[name] == {'address': symbols[body]['address'], 'binding': 'W'}
        assert symbols['__' + ordinary] == symbols[body]
    calls = [line.strip() for line in front.splitlines() if re.search(r'call i32 @__wasm_linux_syscall\(', line)]
    expected_raw = stem in ['fstatat64', 'xstat64', 'lxstat64', 'fxstat64', 'fxstatat64']
    assert bool(calls) == expected_raw, stem
    assert all(re.search(r'\(i32 noundef 291,', call) for call in calls), (stem, calls)
    if stem == 'statx_cp':
        assert symbols['__cp_stat64_statx']['binding'] == 'T'
        assert attempt['source'].endswith('/wasm32/statx_cp.c')
        assert str(genuine.resolve()) in inputs
    else:
        assert pathlib.Path(attempt['source']).read_bytes() == genuine.read_bytes()
    units.append({'unit': artifact['unit'], 'attempt': str(attempt_path),
                  'rawStatxCalls': calls, 'symbols': symbols})

signature_path, _, signature_ir = audit_attempt(task / 'objects/stat-signatures.o')
for name in ['stat', 'lstat', 'fstat', 'fstatat', 'stat64', 'lstat64', 'fstat64', 'fstatat64']:
    assert any(line.startswith('@GNU_STAT_REF_' + name + ' = ') and
               'global ptr @' + name + ',' in line for line in signature_ir.splitlines()), name
layout = next(line for line in signature_ir.splitlines() if line.startswith('@GNU_STAT_LAYOUT = '))
assert 'i32 128, i32 128, i32 256' in layout
for item in ['kernel_stat.h', 'statx_cp.c', 'kernel-features.h']:
    assert str((source / 'sysdeps/unix/sysv/linux/wasm32' / item).resolve()) in inputs

groups = {}
for path in (task / 'logs/supervision').glob('*.json'):
    row = json.loads(path.read_text())
    assert row['exit'] == 0 and not row['terminalMembers']
    groups[row['pgid']] = str(path)
live = []
for path in pathlib.Path('/proc').glob('[0-9]*/stat'):
    try:
        fields = path.read_text().rsplit(')', 1)[1].split()
        if int(fields[2]) in groups and fields[0] != 'Z':
            live.append(int(path.parent.name))
    except (OSError, ValueError):
        pass
assert not live
accepted = {'pass': True, 'GNUObjects': 9, 'originalFailuresCompiled': 2,
            'publicHeaderReferences': 8, 'GNUStatLayout': layout,
            'units': units, 'signatureAttempt': str(signature_path), 'inputs': inputs,
            'terminalGroups': groups, 'liveMembers': live,
            'scope': 'actual GNU stat compilation, types and statx routing; runtime semantics/sysroot/Nightly pending'}
(task / 'compile-acceptance.json').write_text(json.dumps(accepted, indent=2) + '\n')
print(json.dumps({'pass': True, 'GNUObjects': 9, 'publicHeaderReferences': 8,
                  'actualInputs': len(inputs), 'terminalGroups': len(groups)}))
