#!/usr/bin/env python3
"""Compile the explicit finite owner bootstrap entry; no link/runtime claim."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
BASIS_SHA = '607fd7186649e1b788982d5cb0f9a0764b48ad4574d5df6efc20d5e3705e075b'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'basis', 'toolchain'):
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--compiled-from', type=Path)
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    assert digest(args.basis) == BASIS_SHA
    basis = json.loads(args.basis.read_text())
    assert basis['pass'] and basis['unit'] == 'owner-startup'
    assert not basis['runtimeAcceptance'] and not basis['nativeRecordsAdmitted']
    assert basis['peerLayoutValues'][:9] == [64, 4, 196, 4, 64, 68, 84, 16, 84]
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('source', 'objects', 'logs', 'snapshots', 'tmp', 'cache'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins, commands = {}, []

    def pin(path, snapshot=True):
        path = path.resolve()
        row = {'path': str(path), 'sha256': digest(path), 'bytes': path.stat().st_size}
        if snapshot:
            dest = task / 'snapshots' / (row['sha256'] + '-' + path.name)
            if dest.exists():
                assert dest.read_bytes() == path.read_bytes()
            else:
                shutil.copyfile(path, dest)
            row['snapshot'] = str(dest)
        pins[str(path)] = row
        return row

    pin(args.basis)
    for row in basis['inputPins']:
        retained = Path(row.get('snapshot', row['path']))
        assert digest(retained) == row['sha256'] and retained.stat().st_size == row['bytes']
        pin(retained, retained.name != 'clang')
    for name in ('owner-entry.s', 'run-owned.py'):
        pin(HERE / name)
        shutil.copyfile(HERE / name, task / 'source' / name)
    pin(Path(__file__))
    shutil.copyfile(Path(__file__), task / 'source/compile-owner-entry.py')
    compiler = Path(basis['commands'][0]['argv'][0])
    row = next(row for row in basis['inputPins'] if row['path'] == str(compiler))
    assert digest(compiler) == row['sha256']
    readobj = args.toolchain / 'bin/llvm-readobj'
    objdump = args.toolchain / 'bin/llvm-objdump'
    for tool in (compiler, readobj, objdump):
        pin(tool, False)
    cwd = task / 'source'

    def run(stage, argv):
        result = subprocess.run(['python3', str(task / 'source/run-owned.py'), '--task', str(task),
                                 '--label', stage, '--seconds', '30', *map(str, argv)],
                                cwd=cwd, capture_output=True, text=True)
        (task / 'logs' / (stage + '.log')).write_text(result.stdout + result.stderr)
        record = json.loads((task / 'supervision' / stage / 'result.json').read_text())
        commands.append({'stage': stage, **record})
        (task / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        assert result.returncode == 0, record

    proof = {'pass': False, 'runtimeAcceptance': False, 'nativeRecordsAdmitted': False,
             'scope': 'explicit startup assembly object and TLS-before-owner routing; final link and root admission pending'}
    try:
        assembly = task / 'source/owner-entry.s'
        obj = task / 'objects/owner-entry.o'
        if args.compiled_from:
            prior = args.compiled_from.resolve()
            assert prior.parent == Path('/mnt/p6/build') and prior != task
            old = json.loads((prior / 'proof.json').read_text())
            assert not old['pass'] and not old['runtimeAcceptance']
            assert old['error'] == "'NoneType' object has no attribute 'start'"
            assert [record['stage'] for record in old['commands']] == ['assembler', 'symbols', 'disassembly']
            assert all(record['exit'] == 0 and not record['terminalMembers'] for record in old['commands'])
            assert (prior / 'source/owner-entry.s').read_bytes() == assembly.read_bytes()
            for path in (prior / 'proof.json', prior / 'source/owner-entry.s', prior / 'objects/owner-entry.o'):
                pin(path)
            shutil.copyfile(prior / 'objects/owner-entry.o', obj)
            proof['originalCompilation'] = {'proof': str(prior / 'proof.json'), 'commands': old['commands'],
                                            'reason': 'retain successful assembly; correct only +0 relocation-text parsing'}
        else:
            run('assembler', [compiler, '--target=wasm32-unknown-linux-gnu', '-c',
                              '-matomics', '-mbulk-memory', assembly, '-o', obj])
        run('symbols', [readobj, '--symbols', '--relocations', obj])
        run('disassembly', [objdump, '-d', '-r', obj])
        assert obj.read_bytes()[:8] == b'\0asm\1\0\0\0'
        dis = (task / 'supervision/disassembly/output.log').read_text()
        expected = ['startup_prepare', '__wasm_init_tls', 'owner_bootstrap', 'owner_recorded_gate']
        actual = re.findall(r'R_WASM_FUNCTION_INDEX_LEB\s+([A-Za-z_][A-Za-z0-9_]*)\+0(?:\s|$)', dis)
        assert actual == expected, actual
        assert 'global.set' not in dis
        for row in pins.values():
            assert digest(Path(row['path'])) == row['sha256']
        assert sum(path.stat().st_size for path in task.rglob('*') if path.is_file()) < 2 * 1024**3
        assert shutil.disk_usage(task).free >= 5 * 1024**3
        proof.update(pass_=True, object=pin(obj), actualCallOrder=expected,
                     unresolvedAreRequired=expected + ['__tls_size', '__tls_align', '__tls_base'],
                     linearStackPointerWrites=0)
        proof['pass'] = proof.pop('pass_')
    except Exception as error:
        proof['error'] = str(error)
        raise
    finally:
        proof.update(inputPins=list(pins.values()), commands=commands)
        (task / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
        print(json.dumps({'pass': proof['pass'], 'proof': str(task / 'proof.json'), 'sha256': digest(task / 'proof.json')}))


if __name__ == '__main__':
    main()
