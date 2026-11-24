#!/usr/bin/env python3
"""Compile/audit actual GNU owner bridge; this does not execute cancellation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--task', type=Path, required=True)
    parser.add_argument('--basis', type=Path, required=True)
    parser.add_argument('--coherent', type=Path, required=True)
    parser.add_argument('--frame-header', type=Path, required=True)
    parser.add_argument('--toolchain', type=Path, required=True)
    args = parser.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('tmp', 'cache', 'source', 'logs', 'objects', 'snapshots'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    manifest_path = args.coherent / 'manifest.json'
    assert sha(manifest_path) == '220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97'
    frozen = json.loads(manifest_path.read_text())['files']
    pins = {}
    commands = []

    def pin(path, copy=True):
        path = path.resolve()
        if str(path) in frozen:
            expected = frozen[str(path)]
            assert sha(path) == expected['sha256'] and path.stat().st_size == expected['bytes']
        data = path.read_bytes()
        row = {'path': str(path), 'sha256': sha(path), 'bytes': len(data)}
        if copy:
            snapshot = task / 'snapshots' / (row['sha256'] + '-' + path.name)
            if snapshot.exists():
                assert snapshot.read_bytes() == data
            else:
                snapshot.write_bytes(data)
            row['snapshot'] = str(snapshot)
        pins[str(path)] = row
        return row

    basis_path = args.basis.resolve()
    pin(basis_path)
    basis = json.loads(basis_path.read_text())
    assert basis['pass'] and not basis['runtimeAcceptance']
    old_front = basis['commands'][0]
    assert old_front['exit'] == 0
    argv = list(old_front['argv'])
    compiler = Path(argv.pop(0))
    pin(compiler, False)
    for name in ('native-bridge.c', 'native-bridge.h', 'gnu-helper.c', 'gnu-helper.h',
                 'gnu-handler.c', 'cancellation-pc-check.h', 'compile-native-bridge.py', 'run-owned.py'):
        path = HERE / name
        pin(path)
        shutil.copyfile(path, task / 'source' / name)
    header = args.frame_header.resolve()
    assert sha(header) == '6f0b34bb2c838776b12f3b62490307f7457084e35ecf9f29a341ea102877eb17'
    pin(header)
    shutil.copyfile(header, task / 'source/frame-abi.h')
    flags = []
    index = 0
    while index < len(argv):
        token = argv[index]
        if token in ('-o', '-MF', '-MT', '-MQ'):
            index += 2
            continue
        if token in ('-MD', '-MMD', '-MP') or token.endswith('/gnu-helper.c'):
            index += 1
            continue
        if token == '-I' and argv[index + 1] == str(HERE):
            flags.extend(['-I', str(task / 'source')])
            index += 2
            continue
        flags.append(token)
        index += 1
    cwd = Path(old_front['cwd'])
    tools = {name: args.toolchain / 'bin' / name for name in ('opt', 'llc', 'llvm-readobj')}
    tools.update(metadata=args.coherent / 'objects/warnings', lower=args.coherent / 'objects/lower')
    for path in tools.values():
        pin(path, False)

    def run(name, command):
        result = subprocess.run(['python3', str(task / 'source/run-owned.py'), '--task', str(task),
                                 '--label', name, '--seconds', '30', *map(str, command)],
                                cwd=cwd, capture_output=True, text=True)
        (task / 'logs' / (name + '.log')).write_text(result.stdout + result.stderr)
        row = json.loads((task / 'supervision' / name / 'result.json').read_text())
        commands.append({'stage': name, **row})
        (task / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        assert result.returncode == 0, row

    dependencies, objects = {}, []
    try:
        for name in ('native-bridge', 'gnu-helper', 'gnu-handler'):
            source = task / 'source' / (name + '.c')
            raw = task / 'objects' / (name + '.ll')
            dep = task / 'objects' / (name + '.d')
            run(name + '-frontend', [compiler, *flags, source, '-MD', '-MF', dep, '-MT', name, '-o', raw])
            for word in shlex.split(dep.read_text().replace('\\\n', ' ').split(':', 1)[1]):
                path = Path(word)
                if not path.is_absolute():
                    path = cwd / path
                path = path.resolve()
                dependencies[str(path)] = pin(path)
            metadata = task / 'objects' / (name + '-metadata.bc')
            lower = task / 'objects' / (name + '-lower.bc')
            optimized = task / 'objects' / (name + '-opt.bc')
            obj = task / 'objects' / (name + '.o')
            assembly = task / 'objects' / (name + '.s')
            run(name + '-metadata', [tools['metadata'], raw, metadata])
            run(name + '-jumps', [tools['lower'], metadata, lower])
            run(name + '-optimizer', [tools['opt'], '-passes=default<O2>', lower, '-o', optimized])
            backend = [tools['llc'], '-mattr=+atomics,+bulk-memory,+exception-handling',
                       '-exception-model=wasm', '-wasm-enable-eh', '-wasm-enable-sjlj', '-wasm-use-legacy-eh']
            run(name + '-backend', [*backend, '-filetype=obj', optimized, '-o', obj])
            run(name + '-assembly', [*backend, '-filetype=asm', optimized, '-o', assembly])
            run(name + '-symbols', [tools['llvm-readobj'], '--symbols', obj])
            assert obj.read_bytes()[:8] == b'\0asm\1\0\0\0'
            objects.append(pin(obj))
            if name == 'native-bridge':
                text = assembly.read_text()
                assert not re.search(r'global\.set\s+__stack_pointer', text), 'primitive linear-stack allocation'
                assert not re.search(r'^\s*(?:call|call_indirect|return_call|return_call_indirect)\b', text, re.M), 'primitive calls'
                assert '.import_module' not in text, 'primitive imports'
        for row in pins.values():
            assert sha(Path(row['path'])) == row['sha256']
        assert sum(path.stat().st_size for path in task.rglob('*') if path.is_file()) < 2 * 1024**3
        proof = {'pass': True, 'scope': 'actual GNU owner/import bridge primitive object audit and GNU helper compilation',
                 'runtimeAcceptance': False, 'cancellationAcceptance': False, 'sourcePins': list(pins.values()),
                 'dependencies': list(dependencies.values()), 'objects': objects, 'commands': commands,
                 'unresolvedRequired': ['__wasm_boundary_native_root_v3', '__syscall_cancel_arch', '__pthread_unwind']}
    except Exception as error:
        proof = {'pass': False, 'error': str(error), 'runtimeAcceptance': False,
                 'sourcePins': list(pins.values()), 'dependencies': list(dependencies.values()), 'commands': commands}
        (task / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
        raise
    (task / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'pass': True, 'proof': str(task / 'proof.json'), 'sha256': sha(task / 'proof.json')}))


if __name__ == '__main__':
    main()
