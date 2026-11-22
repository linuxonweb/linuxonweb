#!/usr/bin/env python3
"""Compile genuine GNU handler/accessor and state helpers, retaining unresolved frame prerequisites."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'coherent', 'toolchain', 'gnu'):
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--label', required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert re.fullmatch('gnu-helpers[0-9A-Za-z_-]+', args.label)
    assert str(task).startswith('/mnt/p6/build/')
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for var in ('TMPDIR', 'TMP', 'TEMP'):
        assert Path(os.environ[var]).resolve().is_relative_to(task)
    output = task / args.label
    output.mkdir()
    snapshots = output / 'snapshots'
    snapshots.mkdir()
    pins = {}
    commands = []

    def pin(path):
        path = path.resolve()
        data = path.read_bytes()
        snapshot = snapshots / (sha(path) + '-' + path.name)
        if snapshot.exists(): assert snapshot.read_bytes() == data
        else: snapshot.write_bytes(data)
        row = {'path': str(path), 'snapshot': str(snapshot), 'sha256': sha(path), 'bytes': len(data)}
        pins[str(path)] = row
        return row

    manifest_path = args.coherent / 'manifest.json'
    assert sha(manifest_path) == '220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97'
    manifest = json.loads(manifest_path.read_text())['files']

    def frozen(path):
        path = path.resolve()
        row = manifest[str(path)]
        assert sha(path) == row['sha256'] and path.stat().st_size == row['bytes']
        return pin(path)

    for path in HERE.iterdir():
        if path.is_file(): pin(path)
    compiler = args.coherent / 'objects/compiler/clang'
    frozen(compiler)
    metadata = args.coherent / 'objects/warnings'
    lower = args.coherent / 'objects/lower'
    frozen(metadata); frozen(lower)
    llc = args.toolchain / 'bin/llc'
    opt = args.toolchain / 'bin/opt'
    readobj = args.toolchain / 'bin/llvm-readobj'
    for path in (llc, opt, readobj): pin(path)
    selected = []
    for path in sorted((args.coherent / 'logs/c-attempts').glob('*/attempt.json')):
        attempt = json.loads(path.read_text())
        if attempt.get('pass') and attempt.get('output', '').endswith('/nptl/cancellation.o'):
            selected.append((path, attempt))
    assert selected
    attempt_path, attempt = selected[-1]
    frozen(attempt_path)
    front = attempt['stages'][0]
    assert front['stage'] == 'frontend' and front['exit'] == 0
    cwd = Path(front['cwd'])
    flags = []
    i = 1
    while i < len(front['argv']):
        token = front['argv'][i]
        if token in ('-o', '-MF', '-MT', '-MQ'): i += 2; continue
        if token in ('-MD', '-MMD', '-MP', 'cancellation.c'): i += 1; continue
        flags.append(token); i += 1
    gnu_body = args.coherent / 'source/glibc-2.44/nptl/pthread_cancel.c'
    frozen(gnu_body)
    pin(args.gnu / 'nptl/pthread_cancel.c')
    assert gnu_body.read_bytes() == (args.gnu / 'nptl/pthread_cancel.c').read_bytes()
    dependencies = {}
    objects = []

    def run(stage, argv):
        log = output / (stage + '.log')
        start = time.monotonic()
        supervisor = task / 'supervision' / (args.label + '-' + stage)
        result = subprocess.run(['python3', str(HERE / 'run-owned.py'), '--task', str(task),
                                 '--label', supervisor.name, '--seconds', '30', *map(str, argv)],
                                cwd=cwd, capture_output=True, text=True)
        log.write_text(result.stdout + result.stderr)
        proof = json.loads((supervisor / 'result.json').read_text())
        commands.append({'stage': stage, 'supervision': str(supervisor), **proof})
        (output / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        assert result.returncode == 0, {'stage': stage, 'proof': proof}
        return (supervisor / 'output.log').read_text()

    for name in ('gnu-helper', 'gnu-handler'):
        raw = output / (name + '.ll')
        dep = output / (name + '.d')
        run(name + '-frontend', [compiler, '-I', HERE, *flags, HERE / (name + '.c'),
                                '-o', raw, '-MD', '-MF', dep, '-MT', name])
        for word in shlex.split(dep.read_text().replace('\\\n', ' ').split(':', 1)[1]):
            path = Path(word)
            if not path.is_absolute(): path = cwd / path
            path = path.resolve()
            dependencies[str(path)] = pin(path) if path.is_relative_to(HERE) else frozen(path)
        warning = output / (name + '-metadata.bc')
        lowered = output / (name + '-lower.bc')
        optimized = output / (name + '-opt.bc')
        obj = output / (name + '.o')
        run(name + '-metadata', [metadata, raw, warning])
        run(name + '-jumps', [lower, warning, lowered])
        run(name + '-optimizer', [opt, '-passes=default<O2>', lowered, '-o', optimized])
        run(name + '-backend', [llc, '-mattr=+atomics,+bulk-memory,+exception-handling',
                               '-exception-model=wasm', '-wasm-enable-eh', '-wasm-enable-sjlj',
                               '-wasm-use-legacy-eh', '-filetype=obj', optimized, '-o', obj])
        assert obj.read_bytes()[:8] == b'\0asm\1\0\0\0'
        objects.append(pin(obj))
        symbols = run(name + '-symbols', [readobj, '--symbols', obj])
        (output / (name + '-symbols.txt')).write_text(symbols)
    required = ['__wasm_boundary_native_checkpoint_v3', '__wasm_boundary_native_current_v3',
                '__wasm_boundary_native_cancellable_v3', '__wasm_boundary_native_leave_v3',
                '__wasm_boundary_native_invalidate_v3', '__wasm_boundary_gnu_sigcancel_handler_v3',
                '__wasm_boundary_v3_import_enter', '__wasm_boundary_v3_import_leave']
    symbols = (output / 'gnu-helper-symbols.txt').read_text()
    for name in required:
        block = symbols.split('Name: ' + name + '\n', 1)[1].split('  }', 1)[0]
        assert 'UNDEFINED' in block and 'BINDING_WEAK' not in block
    assert sum(p.stat().st_size for p in task.rglob('*') if p.is_file()) < 2 * 1024**3
    result = {'pass': True, 'scope': 'actual unchanged GNU pthread_cancel body plus owned accessor and GNU state helper object compilation only',
              'runtimeAcceptance': False, 'requiredUndefinedFrameProviders': required,
              'commands': commands, 'objects': objects, 'dependencies': list(dependencies.values()),
              'sourcePins': list(pins.values()), 'GNUBody': str(gnu_body)}
    (output / 'proof.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'pass': True, 'objects': len(objects), 'includes': len(dependencies),
                      'runtimeAcceptance': False}))


if __name__ == '__main__':
    main()
