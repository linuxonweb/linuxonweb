#!/usr/bin/env python3
"""Finite compile-only ABI + synthetic protocol checks, retaining every input."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import time

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def members(pgid):
    found = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                found.append({'pid': int(path.parent.name), 'state': fields[0]})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', type=Path, required=True)
    ap.add_argument('--kernel', type=Path, required=True)
    ap.add_argument('--coherent', type=Path, required=True)
    ap.add_argument('--gnu', type=Path, required=True)
    ap.add_argument('--toolchain', type=Path, required=True)
    ap.add_argument('--label', required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    for var in ('TMPDIR', 'TMP', 'TEMP'):
        assert Path(os.environ[var]).resolve().is_relative_to(task)
    assert re.fullmatch(r'controls[0-9A-Za-z_-]*', args.label)
    output = task / args.label
    output.mkdir()
    snapshots = output / 'snapshots'
    snapshots.mkdir()
    pins = []

    def pin(path):
        path = path.resolve()
        data = path.read_bytes()
        dest = snapshots / (sha(path) + '-' + path.name)
        if dest.exists():
            assert dest.read_bytes() == data
        else:
            dest.write_bytes(data)
        row = {'path': str(path), 'snapshot': str(dest), 'sha256': sha(path), 'bytes': len(data)}
        pins.append(row)
        return row

    commands = []

    def run(name, argv, cwd=HERE):
        log = output / (name + '.log')
        started = time.monotonic()
        with log.open('wb') as stream:
            p = subprocess.Popen(argv, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                                 start_new_session=True)
            timed_out = False
            try:
                status = p.wait(timeout=30)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(p.pid, signal.SIGTERM)
                try:
                    status = p.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(p.pid, signal.SIGKILL)
                    status = p.wait(timeout=2)
            if members(p.pid):
                os.killpg(p.pid, signal.SIGKILL)
                time.sleep(0.05)
            row = {'name': name, 'argv': argv, 'cwd': str(cwd), 'pid': p.pid,
                   'pgid': p.pid, 'exit': status, 'timedOut': timed_out,
                   'seconds': time.monotonic() - started, 'terminalMembers': members(p.pid)}
            commands.append(row)
            (output / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
            assert status == 0 and not timed_out and not row['terminalMembers'], row
        return log.read_text()

    manifest_path = args.coherent / 'manifest.json'
    assert sha(manifest_path) == '220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97'
    manifest = json.loads(manifest_path.read_text())['files']

    def frozen(path):
        path = path.resolve()
        row = manifest[str(path)]
        assert sha(path) == row['sha256'] and path.stat().st_size == row['bytes']
        return pin(path)

    for path in sorted(HERE.iterdir()):
        if path.is_file():
            pin(path)
    compiler = args.coherent / 'objects/compiler/clang'
    compiler_record = frozen(compiler)
    assert compiler_record['sha256'] == '14e5a2bba14dbb867273e91628d3d27263cce1b13d6ca0bbe12b91d81f94dc7c'
    # Minimal type/asm include shims only for the standalone proposed record.
    # Real Linux errno numbers are consumed unchanged; not a kernel unit build.
    shim = output / 'shim'
    (shim / 'linux').mkdir(parents=True)
    (shim / 'asm').mkdir()
    (shim / 'linux/types.h').write_text('typedef unsigned int u32; typedef int s32;\n')
    (shim / 'asm/errno.h').write_text('#include <asm-generic/errno.h>\n')
    for path in shim.rglob('*'):
        if path.is_file(): pin(path)
    flags = ['--target=wasm32-unknown-unknown', '-nostdlib', '-nostdinc', '-ffreestanding',
             '-I', str(shim), '-I', str(args.kernel / 'include'),
             '-I', str(args.kernel / 'include/uapi'), '-I', str(HERE), '-std=c11', '-O2']
    for relative in ['include/linux/errno.h', 'include/uapi/linux/errno.h',
                     'include/uapi/asm-generic/errno.h', 'include/uapi/asm-generic/errno-base.h']:
        pin(args.kernel / relative)
    run('abi-object', [str(compiler), *flags, '-c', str(HERE / 'control.c'),
                       '-o', str(output / 'control.o')])
    linker = args.toolchain / 'bin/wasm-ld'
    frozen(linker)
    run('abi-module', [str(linker), str(output / 'control.o'), '--no-entry',
                       '--export=kernel_protocol_controls', '-o', str(output / 'control.wasm')])
    runner = output / 'run-control.mjs'
    runner.write_text('import fs from "node:fs";\n'
                      'const m=new WebAssembly.Module(fs.readFileSync(process.argv[2]));\n'
                      'if(WebAssembly.Module.imports(m).length)throw new Error("imports");\n'
                      'const i=new WebAssembly.Instance(m,{});\n'
                      'const checks=i.exports.kernel_protocol_controls();\n'
                      'if(checks!==93)throw new Error("controls: "+checks);\n'
                      'console.log(JSON.stringify({pass:true,checks,scope:"synthetic kernel ABI"}));\n')
    pin(runner)
    kernel_controls = json.loads(run('abi-execution', ['node', str(runner), str(output / 'control.wasm')]))
    host_controls = json.loads(run('host-protocol', ['node', str(HERE / 'test-protocol.mjs')]))

    attempts = args.coherent / 'logs/c-attempts'
    selected = []
    for path in sorted(attempts.glob('*/attempt.json')):
        j = json.loads(path.read_text())
        if j.get('pass') and j.get('output', '').endswith('/nptl/cancellation.o'):
            selected.append((path, j))
    assert selected
    attempt_path, attempt = selected[-1]
    frozen(attempt_path)
    frozen(Path(attempt['source']))
    frozen(Path(attempt['sourceSnapshot']))
    frontend = attempt['stages'][0]
    assert frontend['stage'] == 'frontend' and frontend['exit'] == 0
    argv = []
    previous = frontend['argv']
    i = 0
    replaced_source = 0
    while i < len(previous):
        token = previous[i]
        if token in ('-o', '-MF', '-MT', '-MQ'):
            i += 2
            continue
        if token in ('-MD', '-MMD', '-MP'):
            i += 1
            continue
        if token == 'cancellation.c':
            argv.append(str(HERE / 'layout-gnu.c'))
            replaced_source += 1
        else:
            argv.append(token)
        i += 1
    assert replaced_source == 1
    layout = output / 'gnu-layout.ll'
    deps = output / 'gnu-layout.d'
    argv += ['-o', str(layout), '-MD', '-MF', str(deps), '-MT', 'gnu-boundary-layout']
    run('gnu-layout', argv, Path(frontend['cwd']))
    match = re.search(r'@boundary_gnu_layout\s*=.*?\[(.*?)\]', layout.read_text())
    # LLVM prints the array type first; parse the initializer separately.
    values = [int(value) for value in re.findall(r'i32 (-?\d+)',
              layout.read_text().split('@boundary_gnu_layout =', 1)[1].split('\n', 1)[0])]
    assert len(values) == 18, values
    assert values[3:12] == [128, 4, 0, 4, 8, 12, 16, 32, -6], values
    assert values[12:] == [1, 2, 4, 8, 16, 32], values
    dependency_rows = []
    flat = deps.read_text().replace('\\\n', ' ')
    for word in sorted(set(shlex.split(flat.split(':', 1)[1]))):
        path = Path(word)
        if not path.is_absolute(): path = Path(frontend['cwd']) / path
        path = path.resolve()
        if path.is_relative_to(HERE):
            row = pin(path)
        else:
            row = frozen(path)
        dependency_rows.append(row)
    for relative in ['nptl/pthread_cancel.c', 'nptl/cancellation.c', 'nptl/descr.h',
                     'sysdeps/nptl/cancellation-pc-check.h', 'nptl/unwind.c',
                     'sysdeps/unix/sysv/linux/internal-signals.h']:
        pin(args.gnu / relative)
    proof = {'pass': True, 'runtimeAcceptance': False,
             'scope': 'exact proposed ABI and genuine GNU header measurement; synthetic protocol only',
             'kernelControls': kernel_controls, 'hostControls': host_controls,
             'gnuLayout': values, 'gnuHeaderDependencies': dependency_rows,
             'commands': commands, 'sourcePins': pins}
    (output / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'pass': True, 'kernelControls': kernel_controls['checks'],
                      'hostControls': host_controls['checks'], 'gnuLayout': values,
                      'GNUIncludes': len(dependency_rows), 'runtimeAcceptance': False}))


if __name__ == '__main__':
    main()
