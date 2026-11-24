#!/usr/bin/env python3
"""Prove caller-local GNU mask lowering against the measured backend64 header.

This produces IR only. The prepare symbol must later resolve to the new,
recorded backend64 provider; this control links no old jump objects.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
MANIFEST = '220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97'
LOWER = '2a2d87b3f3f126fad3d1b0155bc1c1171f6e61c9eea642d6f24034eeae3652ef'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ('task', 'basis', 'coherent', 'lower', 'toolchain'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    basis = json.loads(args.basis.read_text())
    assert basis['pass'] and basis['unchangedGNUBytes'] and basis['unit'] == 'gnu-pthread-create'
    assert not basis['runtimeAcceptance'] and not basis['nativeRecordsAdmitted']
    assert basis['peerLayoutValues'][:9] == [64, 4, 196, 4, 64, 68, 84, 16, 84]
    assert digest(args.coherent / 'manifest.json') == MANIFEST
    frozen = json.loads((args.coherent / 'manifest.json').read_text())['files']
    assert digest(args.lower) == LOWER == frozen[str(args.lower)]['sha256']
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('source', 'objects', 'tmp', 'cache', 'snapshots'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins = []

    def pin(path, snapshot=True):
        path = path.resolve()
        row = {'path': str(path), 'sha256': digest(path), 'bytes': path.stat().st_size}
        if snapshot:
            target = task / 'snapshots' / (row['sha256'] + '-' + path.name)
            if target.exists():
                assert target.read_bytes() == path.read_bytes()
            else:
                shutil.copyfile(path, target)
            row['snapshot'] = str(target)
        pins.append(row)
        return row

    for row in basis['inputPins']:
        retained = Path(row.get('snapshot', row['path']))
        assert digest(retained) == row['sha256'] and retained.stat().st_size == row['bytes']
    raw_row = next(row for row in basis['outputs'] if row['path'].endswith('/front.ll'))
    raw = Path(raw_row['snapshot'])
    assert digest(raw) == raw_row['sha256']
    source_row = basis['source']
    assert digest(Path(source_row['snapshot'])) == source_row['sha256']
    for path in (args.basis, args.coherent / 'manifest.json', raw, Path(source_row['snapshot']),
                 Path(__file__), HERE / 'run-owned.py'):
        pin(path)
    pin(args.lower, False)
    dis = args.toolchain / 'bin/llvm-dis'
    pin(dis, False)
    shutil.copyfile(HERE / 'run-owned.py', task / 'source/run-owned.py')
    shutil.copyfile(Path(__file__), task / 'source/audit-gnu-jump-caller.py')
    front = task / 'source/front.ll'
    shutil.copyfile(raw, front)
    commands = []

    def run(label, argv):
        result = subprocess.run(['python3', str(task / 'source/run-owned.py'), '--task', str(task),
                                 '--label', label, '--seconds', '30', *map(str, argv)], check=False)
        commands.append(json.loads((task / 'supervision' / label / 'result.json').read_text()))
        assert result.returncode == 0

    output = task / 'objects/lowered.bc'
    text = task / 'objects/lowered.ll'
    run('gnu-caller-lower', [args.lower, front, output])
    run('gnu-caller-disassemble', [dis, output, '-o', text])
    original = front.read_text()
    lowered = text.read_text()
    function = lambda value: re.search(r'^define internal i32 @start_thread\(.*?^}', value, re.M | re.S).group(0)
    before, after = function(original), function(lowered)
    assert len(re.findall(r'call i32 @_setjmp\(', before)) == 1
    assert not re.search(r'\b(?:call|invoke)\b.*@(?:_setjmp|__sigsetjmp)\(', after)
    sequence = re.search(r'call i32 @__sigjmp_save\(ptr (%[0-9]+), i32 0\)\s*\n'
                         r'\s*(%[0-9]+) = call ptr @llvm.stacksave.p0\(\)\s*\n'
                         r'\s*call void @__wasm_jmp_prepare\(ptr \1, ptr \2\)\s*\n'
                         r'\s*%[0-9]+ = call i32 @setjmp\(ptr \1\)', after)
    assert sequence, 'GNU mask save, actual SP prepare and canonical jump must remain in start_thread'
    assert '__wasm_gnu' not in after, 'control must not fabricate compiler records'
    for row in pins:
        assert digest(Path(row['path'])) == row['sha256']
    proof = {'pass': True, 'runtimeAcceptance': False, 'nativeRecordsAdmitted': False,
             'scope': 'unchanged GNU start_thread direct caller IR lowering only',
             'backendBytes': 64, 'publicJumpBytes': 196, 'internalCancelBytes': 84,
             'maskSavedFlagOffset': 64, 'maskArgument': 0,
             'requiredFutureProvider': 'exact reviewed recorded backend64 __wasm_jmp_prepare',
             'oldJumpObjectsLinked': False, 'basis': pin(args.basis), 'inputPins': pins,
             'commands': commands, 'outputs': [pin(output), pin(text)]}
    path = task / 'proof.json'
    path.write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'proof': str(path), 'sha256': digest(path), 'pass': True}))


if __name__ == '__main__':
    main()
