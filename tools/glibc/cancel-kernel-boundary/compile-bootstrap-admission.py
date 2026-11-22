#!/usr/bin/env python3
"""Compile reviewed blocked-signal startup copies; admission remains separate."""
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
PLAN_SHA = 'cc16e739490c97f5f4427a4dfda56330fa13e2e32dcb8724344495ee9b8704ac'
BASIS = {'owner-startup': '607fd7186649e1b788982d5cb0f9a0764b48ad4574d5df6efc20d5e3705e075b',
         'owner-gate': 'b7c6c3aa572a1a2d5f72be5b7c23d81bf5e9d7c2e35e8f9acb78e2d4be051668'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def function(text, name):
    match = re.search(r'^' + re.escape(name) + r':.*?^\s*end_function', text, re.M | re.S)
    assert match, name
    return match.group()


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'plan', 'startup-basis', 'gate-basis', 'toolchain'):
        ap.add_argument('--' + name, type=Path, required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    assert digest(args.plan / 'prepared.json') == PLAN_SHA
    plan = json.loads((args.plan / 'prepared.json').read_text())
    assert plan['prepared'] and not plan['runtimeAcceptance']
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('source', 'objects', 'logs', 'snapshots', 'tmp', 'cache'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins, commands, dependencies = {}, [], []

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

    pin(args.plan / 'prepared.json')
    for row in plan['inputPins']:
        retained = Path(row['snapshot'])
        assert digest(retained) == row['sha256'] and retained.stat().st_size == row['bytes']
        pin(retained)
    for name in ('compile-bootstrap-admission.py', 'run-owned.py'):
        pin(HERE / name)
        shutil.copyfile(HERE / name, task / 'source' / name)
    for name in ('owner-startup.c', 'owner-gate.c', 'owner-entry.s'):
        pin(args.plan / 'source' / name)
        shutil.copyfile(args.plan / 'source' / name, task / 'source' / name)
    cwd = None

    def run(stage, argv):
        result = subprocess.run(['python3', str(task / 'source/run-owned.py'), '--task', str(task),
                                 '--label', stage, '--seconds', '30', *map(str, argv)],
                                cwd=cwd, capture_output=True, text=True)
        (task / 'logs' / (stage + '.log')).write_text(result.stdout + result.stderr)
        record = json.loads((task / 'supervision' / stage / 'result.json').read_text())
        commands.append({'stage': stage, **record})
        (task / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        assert result.returncode == 0 and not record['terminalMembers'], record

    proof = {'pass': False, 'runtimeAcceptance': False, 'nativeRecordsAdmitted': False,
             'scope': 'reviewed startup copies actual flags-off compilation and machine ordering; startup seal, final module start-section, recorded restore and runtime still required'}
    try:
        compiler = None
        for unit, basis_path in [('owner-startup', args.startup_basis), ('owner-gate', args.gate_basis)]:
            assert digest(basis_path) == BASIS[unit]
            pin(basis_path)
            basis = json.loads(basis_path.read_text())
            assert basis['pass'] and not basis['runtimeAcceptance']
            original = basis_path.parent
            for row in basis['inputPins']:
                retained = Path(row.get('snapshot', row['path']))
                assert digest(retained) == row['sha256'] and retained.stat().st_size == row['bytes']
                pin(retained, retained.name not in ('clang', 'opt', 'llc', 'llvm-readobj', 'warnings'))
            include = task / 'source' / unit / 'include'
            shutil.copytree(original / 'source/include', include)
            out = task / 'objects' / unit
            out.mkdir()
            cwd = Path(basis['commands'][0]['cwd'])
            for record in basis['commands']:
                argv = [arg.replace(str(original / 'source/include'), str(include))
                        .replace(str(original / 'source' / (unit + '.c')), str(task / 'source' / (unit + '.c')))
                        .replace(str(original / 'objects'), str(out)) for arg in record['argv']]
                pin(Path(argv[0]), False)
                if compiler is None:
                    compiler = argv[0]
                run(unit + '-' + record['stage'], argv)
            dep = out / 'front.d'
            for word in shlex.split(dep.read_text().replace('\\\n', ' ').split(':', 1)[1]):
                path = Path(word)
                dependencies.append(pin(path if path.is_absolute() else cwd / path))
            assert (out / (unit + '.o')).read_bytes()[:8] == b'\0asm\1\0\0\0'
            for path in out.iterdir():
                pin(path)
        cwd = task / 'source'
        entry = task / 'objects/owner-entry.o'
        readobj, objdump = [args.toolchain / 'bin' / name for name in ('llvm-readobj', 'llvm-objdump')]
        for path in (readobj, objdump):
            pin(path, False)
        run('entry-assembler', [compiler, '--target=wasm32-unknown-linux-gnu', '-c', '-matomics', '-mbulk-memory',
                                task / 'source/owner-entry.s', '-o', entry])
        run('entry-symbols', [readobj, '--symbols', '--relocations', entry])
        run('entry-disassembly', [objdump, '-d', '-r', entry])
        text = (task / 'supervision/entry-disassembly/output.log').read_text()
        calls = re.findall(r'R_WASM_FUNCTION_INDEX_LEB\s+([A-Za-z_][A-Za-z0-9_]*)\+0(?:\s|$)', text)
        expected = ['bootstrap_block_signals', 'startup_prepare', '__wasm_init_tls', 'owner_bootstrap', 'owner_recorded_gate']
        assert calls == expected and 'global.set' not in text, calls
        startup = (task / 'objects/owner-startup/owner-startup.s').read_text()
        block = function(startup, 'bootstrap_block_signals')
        assert '__stack_pointer' not in block and '__tls_base' not in block and 'TLS' not in block
        assert re.findall(r'^\s*call\s+(\w+)', block, re.M) == ['owner_raw', 'owner_raw']
        assert 'i32.const\t134' in block and 'i32.const\t8' in block and 'i32.const\t94' in block
        assert 'bootstrap_full_mask' in block and 'bootstrap_saved_mask' in block and 'unreachable' in block
        restore = function(startup, 'owner_restore_signals')
        assert re.findall(r'^\s*call\s+(\w+)', restore, re.M) == ['owner_raw']
        assert 'i32.const\t134' in restore and 'i32.const\t2' in restore and 'i32.const\t8' in restore
        raw = (task / 'objects/owner-startup/front.ll').read_text()
        assert '@bootstrap_full_mask = internal constant [2 x i32] [i32 -1, i32 -1], align 4' in raw
        assert '@bootstrap_saved_mask = internal global [2 x i32] zeroinitializer, align 4' in raw
        assert '@llvm.global_ctors' not in raw
        assert '@owner_restore_signals' in (task / 'objects/owner-gate/front.ll').read_text()
        pin(entry)
        for row in pins.values():
            assert digest(Path(row['path'])) == row['sha256']
        assert sum(path.stat().st_size for path in task.rglob('*') if path.is_file()) < 2 * 1024**3
        assert shutil.disk_usage(task).free >= 5 * 1024**3
        proof.update(pass_=True, actualEntryCallOrder=calls, firstMaskCallHasNoLinearSPorTLS=True,
                     kernelMaskWords=[4294967295, 4294967295], savedMaskBytes=8,
                     maskFailureRawExit=93, failureExitCannotReturn=True,
                     restoreClassification='requires descriptor4 and published owner gate, flags-off evidence only',
                     restoreErrors='-EINVAL if not masked; actual raw syscall error propagated to gate FAIL and raw exit99',
                     constructorIRAbsent=True, startSectionGuarantee='final linked module not built; must reject any start section')
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
