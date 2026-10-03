#!/usr/bin/env python3
"""Compile explicit GNU/owner inputs using the measured peer jump64 closure."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
PEER_RESULT_SHA = '9758296af736a23eae5ee8a03e50b12727bc854c65df6d23f0533414f6966e0a'
COHERENT_SHA = '220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97'
GNU_UNITS = {
    'cancellation': 'nptl/cancellation.c',
    'sigjmp-save': 'setjmp/sigjmp.c',
    'gnu-longjmp': 'setjmp/longjmp.c',
    'gnu-longjmp-chk': 'debug/longjmp_chk.c',
    'gnu-jmp-unwind': 'sysdeps/nptl/jmp-unwind.c',
    'gnu-cleanup-upto': 'nptl/pthread_cleanup_upto.c',
    'gnu-pthread-create': 'nptl/pthread_create.c',
    'gnu-pthread-exit': 'nptl/pthread_exit.c',
    'gnu-setcancelstate': 'nptl/pthread_setcancelstate.c',
    'gnu-setcanceltype': 'nptl/pthread_setcanceltype.c',
    'gnu-testcancel': 'nptl/pthread_testcancel.c',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'peer-result', 'peer-plan', 'pristine', 'coherent', 'toolchain'):
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--unit', default='cancellation', choices=(*GNU_UNITS, 'owner-startup', 'owner-gate',
                    'bridge-lifetime', 'native-bridge', 'gnu-helper', 'gnu-handler'))
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    assert digest(args.peer_result) == PEER_RESULT_SHA
    peer = json.loads(args.peer_result.read_text())
    plan = json.loads(args.peer_plan.read_text())
    assert peer['compilePass'] and not peer['runtimeAccepted'] and not peer['nativeRecordsAdmitted']
    assert peer['layoutValues'][:9] == [64, 4, 196, 4, 64, 68, 84, 16, 84]
    assert peer['inputPins'] == plan['pins']
    assert digest(args.coherent / 'manifest.json') == COHERENT_SHA
    frozen = json.loads((args.coherent / 'manifest.json').read_text())['files']
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('source', 'objects', 'logs', 'snapshots', 'tmp', 'cache'):
        (task / name).mkdir()
    include = task / 'source/include'
    (include / 'bits').mkdir(parents=True)
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins, commands, dependencies = {}, [], []

    def pin(path, snapshot=True):
        path = path.resolve()
        row = {'path': str(path), 'sha256': digest(path), 'bytes': path.stat().st_size}
        if str(path) in frozen:
            assert row['sha256'] == frozen[str(path)]['sha256'] and row['bytes'] == frozen[str(path)]['bytes']
        if snapshot:
            dest = task / 'snapshots' / (row['sha256'] + '-' + path.name)
            if dest.exists():
                assert dest.read_bytes() == path.read_bytes()
            else:
                shutil.copyfile(path, dest)
            row['snapshot'] = str(dest)
        pins[str(path)] = row
        return row

    for path in (args.peer_result, args.peer_plan, args.coherent / 'manifest.json', Path(__file__), HERE / 'run-owned.py'):
        pin(path)
    shutil.copyfile(HERE / 'run-owned.py', task / 'source/run-owned.py')
    shutil.copyfile(Path(__file__), task / 'source/compile-gnu-cancellation.py')
    # Borrow exact retained bytes, never the peer's evolving repository headers.
    wanted = {'setjmp.h': 'bits/setjmp.h', 'forced-abi.h': 'forced-abi.h', 'frame-abi.h': 'frame-abi.h',
              'jmpbuf-unwind.h': 'jmpbuf-unwind.h', 'jump-abi-v2.h': 'jump-abi-v2.h',
              'unwind.h': 'unwind.h', 'gnu-unwind.h': 'gnu-unwind.h'}
    seen = set()
    for row in peer['inputPins']:
        name = Path(row['path']).name
        retained = Path(row.get('snapshot', row['path']))
        assert digest(retained) == row['sha256'] and retained.stat().st_size == row['bytes']
        pin(retained, name != 'clang')
        if name in wanted:
            assert name not in seen
            seen.add(name)
            shutil.copyfile(retained, include / wanted[name])
    assert seen == set(wanted)
    for name in ('gnu-helper.h', 'native-bridge.h', 'cancellation-pc-check.h'):
        pin(HERE / name)
        shutil.copyfile(HERE / name, include / name)
    source = args.pristine / GNU_UNITS[args.unit] if args.unit in GNU_UNITS else HERE / (args.unit + '.c')
    source_pin = pin(source)
    owned = task / 'source' / (args.unit + '.c')
    shutil.copyfile(source, owned)
    assert owned.read_bytes() == source.read_bytes()
    compiler_row = next(row for row in peer['inputPins'] if Path(row['path']).name == 'clang')
    compiler = Path(compiler_row['path'])
    assert digest(compiler) == compiler_row['sha256']
    # The first two include directories were peer-owned overlays. Replace both
    # with this attempt's exact snapshots, leaving genuine GNU flags unchanged.
    assert plan['flags'][0].startswith('-I') and plan['flags'][1].startswith('-I')
    flags = ['-I' + str(include), *plan['flags'][2:]]
    tools = {name: args.toolchain / 'bin' / name for name in ('opt', 'llc', 'llvm-readobj')}
    tools['metadata'] = args.coherent / 'objects/warnings'
    for path in [compiler, *tools.values()]:
        pin(path, False)
    cwd = args.coherent / 'source/glibc-2.44/nptl'

    def run(stage, argv):
        result = subprocess.run(['python3', str(task / 'source/run-owned.py'), '--task', str(task),
                                 '--label', stage, '--seconds', '30', *map(str, argv)],
                                cwd=cwd, capture_output=True, text=True)
        (task / 'logs' / (stage + '.log')).write_text(result.stdout + result.stderr)
        row = json.loads((task / 'supervision' / stage / 'result.json').read_text())
        commands.append({'stage': stage, **row})
        (task / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        assert result.returncode == 0, row

    proof = {'pass': False, 'runtimeAcceptance': False, 'nativeRecordsAdmitted': False,
             'scope': 'explicit input flags-off compilation with measured backend64 header closure',
             'unit': args.unit,
             'peerLayoutValues': peer['layoutValues'], 'source': source_pin}
    try:
        raw, dep = task / 'objects/front.ll', task / 'objects/front.d'
        run('frontend', [compiler, *flags, '-S', '-emit-llvm', owned, '-MD', '-MF', dep,
                         '-MT', args.unit, '-o', raw])
        for word in shlex.split(dep.read_text().replace('\\\n', ' ').split(':', 1)[1]):
            path = Path(word)
            dependencies.append(pin(path if path.is_absolute() else cwd / path))
        metadata, opt = task / 'objects/metadata.bc', task / 'objects/opt.bc'
        run('metadata', [tools['metadata'], raw, metadata])
        run('optimizer', [tools['opt'], '-passes=default<O2>', metadata, '-o', opt])
        backend = [tools['llc'], '-mattr=+atomics,+bulk-memory,+exception-handling',
                   '-exception-model=wasm', '-wasm-enable-eh', '-wasm-enable-sjlj', '-wasm-use-legacy-eh']
        obj, assembly = task / 'objects' / (args.unit + '.o'), task / 'objects' / (args.unit + '.s')
        run('backend', [*backend, '-filetype=obj', opt, '-o', obj])
        run('assembly', [*backend, '-filetype=asm', opt, '-o', assembly])
        run('symbols', [tools['llvm-readobj'], '--symbols', obj])
        assert obj.read_bytes()[:8] == b'\0asm\1\0\0\0'
        ir = raw.read_text()
        if args.unit == 'cancellation':
            for name in ('__internal_syscall_cancel', '__syscall_cancel', '__syscall_do_cancel', '__syscall_cancel_arch', '__pthread_unwind'):
                assert name in ir
        if args.unit == 'native-bridge':
            import re
            text = assembly.read_text()
            assert not re.search(r'global\.set\s+__stack_pointer', text)
            assert not re.search(r'^\s*(?:call|call_indirect|return_call|return_call_indirect)\b', text, re.M)
            assert '.import_module' not in text
        for row in pins.values():
            assert digest(Path(row['path'])) == row['sha256']
        assert owned.read_bytes() == source.read_bytes()
        assert shutil.disk_usage(task).free >= 5 * 1024**3
        assert sum(p.stat().st_size for p in task.rglob('*') if p.is_file()) < 2 * 1024**3
        proof.update(pass_=True, unchangedGNUBytes=(args.unit in GNU_UNITS), outputs=[pin(obj), pin(raw), pin(assembly)],
                     requiredUnresolved=(['__syscall_cancel_arch', '__pthread_unwind'] if args.unit in ('cancellation', 'owner-gate') else []))
        proof['pass'] = proof.pop('pass_')
    except Exception as error:
        proof['error'] = str(error)
        raise
    finally:
        proof.update(inputPins=list(pins.values()), dependencies=dependencies, commands=commands)
        (task / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
        print(json.dumps({'pass': proof['pass'], 'proof': str(task / 'proof.json'), 'sha256': digest(task / 'proof.json')}))


if __name__ == '__main__':
    main()
