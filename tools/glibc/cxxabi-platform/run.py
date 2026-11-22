#!/usr/bin/env python3
"""Isolated, bounded native Wasm GNU-target member-pointer ABI diagnostic."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import time

resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
parser = argparse.ArgumentParser()
parser.add_argument('--task', type=Path, required=True)
parser.add_argument('--toolchain', type=Path, required=True)
parser.add_argument('--node', type=Path, required=True)
args = parser.parse_args()
task = args.task.resolve()
if not task.is_relative_to(Path('/mnt/p6/build')):
    parser.error('task must be under /mnt/p6/build')
task.mkdir()
for directory in ['source', 'objects', 'logs', 'tmp', 'cache']:
    (task / directory).mkdir()
os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'),
                  TEMP=str(task / 'tmp'), XDG_CACHE_HOME=str(task / 'cache'))
source_dir = Path(__file__).resolve().parent
for source in source_dir.iterdir():
    if source.is_file():
        (task / 'source' / source.name).write_bytes(source.read_bytes())


def pin(path):
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()}


def group(pgid):
    members = []
    for stat in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = stat.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                members.append({'pid': int(stat.parent.name), 'state': fields[0]})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return members


def storage():
    used = sum(p.stat().st_size for p in task.rglob('*') if p.is_file())
    fs = os.statvfs(task)
    free = fs.f_bavail * fs.f_frsize
    assert used < 2 * 1024 ** 3 and free > 5 * 1024 ** 3, (used, free)
    return free


commands = []


def run(stage, argv):
    assert storage() >= 8 * 1024 ** 3
    argv = [str(x) for x in argv]
    log = task / 'logs' / (stage + '.log')
    start = time.monotonic()
    with log.open('wb') as stream:
        child = subprocess.Popen(argv, cwd=task, stdout=stream,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        row = None
        error = None
        code = None
        try:
            row = {'stage': stage, 'argv': argv, 'cwd': str(task),
                   'pid': child.pid, 'pgid': child.pid, 'log': str(log)}
            commands.append(row)
            (task / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
            while child.poll() is None:
                if time.monotonic() - start >= 60:
                    raise TimeoutError(stage)
                storage()
                time.sleep(.1)
        except BaseException as exc:
            error = repr(exc)
            raise
        finally:
            def stop(sig):
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass
            if child.poll() is None or error:
                stop(signal.SIGTERM)
            try:
                code = child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                stop(signal.SIGKILL)
                code = child.wait(timeout=2)
            stop(signal.SIGKILL)
            deadline = time.monotonic() + 3
            while group(child.pid) and time.monotonic() < deadline:
                time.sleep(.05)
            if row is None:
                row = {'stage': stage, 'argv': argv, 'pid': child.pid,
                       'pgid': child.pid, 'log': str(log)}
                commands.append(row)
            row.update(exit=code, supervisorError=error,
                       elapsedSeconds=time.monotonic() - start,
                       terminalGroupMembers=group(child.pid))
            (task / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
    assert code == 0 and not row['terminalGroupMembers'], row
    print(stage, 'PASS', child.pid, flush=True)


clang = args.toolchain.resolve() / 'bin/clang++'
linker = args.toolchain.resolve() / 'bin/wasm-ld'
objdump = args.toolchain.resolve() / 'bin/llvm-objdump'
source = task / 'source/member-pointer.cpp'
test = task / 'source/member-pointer.mjs'
results = []
for opt in ['O0', 'O2']:
    for mode in ['linux-default', 'wasm-cxxabi']:
        stem = opt + '-' + mode
        output = task / 'objects' / stem
        flags = ['--target=wasm32-unknown-linux-gnu', '-' + opt,
                 '-fno-rtti', '-fno-exceptions', '-nostdinc++', '-nostdlib']
        if mode == 'wasm-cxxabi':
            flags += ['-fc++-abi=webassembly']
        run(stem + '-compile', [clang, *flags, '-c', source, '-o', str(output) + '.o'])
        run(stem + '-link', [linker, '--no-entry', '--export=plain',
            '--export=polymorphic', '--export=adjusted', '--export=member_word',
            '--export=member_size', '--export=adjusted_word', str(output) + '.o',
            '-o', str(output) + '.wasm'])
        run(stem + '-dump', [objdump, '-d', str(output) + '.wasm'])
        result = task / 'objects' / (stem + '-results.json')
        run(stem + '-execute', [args.node.resolve(), test, str(output) + '.wasm',
                               mode, result])
        results.append(json.loads(result.read_text()))
proof = {'scope': 'native Wasm GNU-target C++ ABI diagnostic; no libc, guest or full application acceptance',
         'pins': [pin(clang), pin(linker), pin(objdump), pin(args.node.resolve())] +
                 [pin(p) for p in (task / 'source').iterdir() if p.is_file()] +
                 [pin(p) for p in (task / 'objects').iterdir() if p.is_file()],
         'results': [{k: r[k] for k in ['mode', 'passed', 'rejected', 'memberWords', 'adjustedWords']}
                     for r in results],
         'commands': commands, 'pass': True}
(task / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps({'proof': pin(task / 'proof.json'), 'results': proof['results']}))
