#!/usr/bin/env python3
"""Compile the exact GNU reference-body selection; no runtime acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ('task', 'basis', 'selection', 'coherent', 'toolchain'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('source', 'objects', 'logs', 'snapshots', 'tmp', 'cache'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    manifest = args.coherent / 'manifest.json'
    assert digest(manifest) == '220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97'
    frozen = json.loads(manifest.read_text())['files']
    pins, commands = {}, []

    def pin(path, snapshot=True):
        path = path.resolve()
        data = path.read_bytes()
        row = {'path': str(path), 'sha256': digest(path), 'bytes': len(data)}
        if str(path) in frozen:
            assert row['sha256'] == frozen[str(path)]['sha256'] and row['bytes'] == frozen[str(path)]['bytes']
        if snapshot:
            destination = task / 'snapshots' / (row['sha256'] + '-' + path.name)
            if destination.exists():
                assert destination.read_bytes() == data
            else:
                destination.write_bytes(data)
            row['snapshot'] = str(destination)
        pins[str(path)] = row
        return row

    pin(args.basis)
    basis = json.loads(args.basis.read_text())
    assert basis['pass'] and not basis['runtimeAcceptance']
    assert basis['peerLayoutValues'][:9] == [64, 4, 196, 4, 64, 68, 84, 16, 84]
    # Preserve the basis's executed snapshots, rather than treating later edits
    # to its original repository paths as the bytes used by that attempt.
    for row in basis['inputPins']:
        retained = Path(row.get('snapshot', row['path']))
        assert digest(retained) == row['sha256'] and retained.stat().st_size == row['bytes']
        pin(retained, retained.name != 'clang')
    selection_proof = args.selection / 'proof.json'
    pin(selection_proof)
    selected = json.loads(selection_proof.read_text())
    assert selected['reverseExactGNUBytes'] and not selected['runtimeAcceptance']
    assert selected['source']['sha256'] == '1552ef7f9424bd54d0897abc77df370de2d655be8e7b37ee40fed1c99f5155bd'
    source = args.selection / 'syscall_cancel_arch.c'
    assert digest(source) == selected['output']['sha256']
    assert selected['output']['sha256'] == '1b732ec024578865497dcaeeeea383bf43e0ecdd57a5aeb5ecc0da04b7f065b3'
    assert digest(args.selection / 'syscall_cancel-original.c') == selected['source']['sha256']
    for path in (source, args.selection / 'syscall_cancel-original.c', HERE / 'run-owned.py', Path(__file__)):
        pin(path)
        shutil.copyfile(path, task / 'source' / path.name)
    frontend = basis['commands'][0]
    argv = list(frontend['argv'])
    # Preserve the actual GNU compiler/header/metadata flags and cwd. Only the
    # selected source and owned output destinations differ from the basis.
    start = next(i for i, word in enumerate(argv) if word.endswith('/native-bridge.c'))
    argv = argv[:start]
    compiler = Path(argv[0])
    pin(compiler, False)
    tools = {name: args.toolchain / 'bin' / name for name in ('opt', 'llc', 'llvm-readobj')}
    tools.update(metadata=args.coherent / 'objects/warnings', lower=args.coherent / 'objects/lower')
    for path in tools.values():
        pin(path, False)
    cwd = Path(frontend['cwd'])

    def run(stage, command):
        result = subprocess.run(['python3', str(task / 'source/run-owned.py'), '--task', str(task),
                                 '--label', stage, '--seconds', '30', *map(str, command)],
                                cwd=cwd, capture_output=True, text=True)
        (task / 'logs' / (stage + '.log')).write_text(result.stdout + result.stderr)
        row = json.loads((task / 'supervision' / stage / 'result.json').read_text())
        commands.append({'stage': stage, **row})
        (task / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        assert result.returncode == 0, row

    dependencies = []
    try:
        raw, dep = task / 'objects/front.ll', task / 'objects/front.d'
        run('frontend', [*argv, task / 'source/syscall_cancel_arch.c', '-MD', '-MF', dep,
                         '-MT', 'syscall_cancel_arch', '-o', raw])
        for word in shlex.split(dep.read_text().replace('\\\n', ' ').split(':', 1)[1]):
            path = Path(word)
            dependencies.append(pin(path if path.is_absolute() else cwd / path))
        metadata, lower, optimized = (task / 'objects' / name for name in ('metadata.bc', 'lower.bc', 'opt.bc'))
        run('metadata', [tools['metadata'], raw, metadata])
        run('jumps', [tools['lower'], metadata, lower])
        run('optimizer', [tools['opt'], '-passes=default<O2>', lower, '-o', optimized])
        backend = [tools['llc'], '-mattr=+atomics,+bulk-memory,+exception-handling',
                   '-exception-model=wasm', '-wasm-enable-eh', '-wasm-enable-sjlj', '-wasm-use-legacy-eh']
        obj, assembly = task / 'objects/syscall_cancel_arch.o', task / 'objects/syscall_cancel_arch.s'
        run('backend', [*backend, '-filetype=obj', optimized, '-o', obj])
        run('assembly', [*backend, '-filetype=asm', optimized, '-o', assembly])
        run('symbols', [tools['llvm-readobj'], '--symbols', obj])
        assert obj.read_bytes()[:8] == b'\0asm\1\0\0\0'
        objects = [pin(obj)]
        text = raw.read_text()
        assert '__syscall_cancel_arch' in text and '__syscall_do_cancel' in text
        assert '__syscall_cancel_arch_start' not in text and '__syscall_cancel_arch_end' not in text
        for row in pins.values():
            assert digest(Path(row['path'])) == row['sha256']
        assert shutil.disk_usage(task).free >= 5 * 1024**3
        assert sum(path.stat().st_size for path in task.rglob('*') if path.is_file()) < 2 * 1024**3
        proof = {'pass': True, 'scope': 'genuine GNU cancellation syscall body architecture selection compilation',
                 'runtimeAcceptance': False, 'nativeRecordsAdmitted': False,
                 'peerLayoutValues': basis['peerLayoutValues'],
                 'objects': objects, 'requiredUnresolved': ['__syscall_do_cancel']}
    except Exception as error:
        proof = {'pass': False, 'error': str(error), 'runtimeAcceptance': False}
        proof.update(sourcePins=list(pins.values()), dependencies=dependencies, commands=commands)
        (task / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
        raise
    proof.update(sourcePins=list(pins.values()), dependencies=dependencies, commands=commands)
    (task / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'pass': True, 'proof': str(task / 'proof.json'), 'sha256': digest(task / 'proof.json')}))


if __name__ == '__main__':
    main()
