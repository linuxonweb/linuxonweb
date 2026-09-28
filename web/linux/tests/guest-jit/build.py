#!/usr/bin/env python3
"""Compile the guest JIT test and package an isolated test-only initramfs.

Only packed /init changes (the test runs in the foreground before the durable
home mount) and bin/guest-jit-test is added. The accepted plain image is
hash-checked against boot-manifest.json and never modified. All output goes to
a new directory under the disk-backed task root.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

TASK = Path('/mnt/p6/build/guest-jit-20260928')
CC = ('/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8'
      '/bin/wasm32-unknown-linux-musl-clang')
BINARY = 'bin/guest-jit-test'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def filesystem(path):
    path = Path(path).resolve()
    entries = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields, fs = line.split(' - ', 1)
        mount = Path(fields.split()[4].replace('\\040', ' '))
        if path == mount or path.is_relative_to(mount):
            entries.append((len(str(mount)), str(mount), fs.split()[0]))
    _, mount, kind = max(entries)
    if kind in ('tmpfs', 'ramfs'):
        raise ValueError('memory filesystem prohibited: ' + str(path))
    ancestor = path
    while not ancestor.exists():
        ancestor = ancestor.parent
    stats = os.statvfs(ancestor)
    free = stats.f_bavail * stats.f_frsize
    if free < 1024**3:
        raise ValueError('less than 1 GiB free')
    return {'mount': mount, 'type': kind, 'availableBytes': free}


def checked_storage(output):
    output = Path(output).resolve()
    if not output.is_relative_to(TASK) or output == TASK:
        raise ValueError('output must be a new child of ' + str(TASK))
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        value = os.environ.get(name)
        if not value or not Path(value).resolve().is_relative_to(TASK) or not Path(value).is_dir():
            raise ValueError(name + ' must be exported to a directory under ' + str(TASK))
        filesystem(value)
        scratch[name] = value
    return output, {'output': str(output), 'filesystem': filesystem(output), 'scratch': scratch}


def records(data):
    offset = 0
    while True:
        start = offset
        header = data[offset:offset + 110]
        if len(header) != 110 or header[:6] != b'070701':
            raise ValueError('invalid newc header')
        size, namesize = int(header[54:62], 16), int(header[94:102], 16)
        offset += 110
        name = data[offset:offset + namesize]
        offset += namesize
        offset += (-offset) % 4
        body = data[offset:offset + size]
        offset += size
        offset += (-offset) % 4
        if len(body) != size or not name.endswith(b'\0') or offset > len(data):
            raise ValueError('truncated newc')
        key = name[:-1].decode().removeprefix('./').lstrip('/')
        yield key, header, name, body, data[start:offset]
        if key == 'TRAILER!!!':
            return


def record(header, name, body):
    header = header[:54] + f'{len(body):08x}'.encode() + header[62:94] + f'{len(name):08x}'.encode() + header[102:]
    return header + name + b'\0' * (-(110 + len(name)) % 4) + body + b'\0' * (-len(body) % 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    out, storage = checked_storage(args.output)
    out.mkdir(parents=True, exist_ok=False)
    here = Path(__file__).resolve().parent
    root = here.parents[3]
    source = here / 'jit-test.c'
    frozen = out / 'jit-test.c'
    frozen.write_bytes(source.read_bytes())
    artifact = out / 'guest-jit-test.wasm'
    command = [CC, '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread', '-matomics', '-mbulk-memory',
               '-static', str(frozen),
               '-Wl,--import-memory,--export-table,--growable-table,--shared-memory',
               '-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144', '-o', str(artifact)]
    for name, cmd in [('compile', command), ('validate', ['wasm-validate', '--enable-all', str(artifact)]),
                      ('abi', ['wasm-objdump', '-x', str(artifact)])]:
        (out / (name + '.command.txt')).write_text(shlex.join(cmd) + '\n')
        with (out / (name + '.log')).open('w') as log:
            subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, env=os.environ.copy(), check=True, timeout=300)
    abi = (out / 'abi.log').read_text()
    imports = re.findall(r' <- (\S+)', abi)
    if 'env.memory' not in imports or 'linux.syscall' not in imports or \
            set(imports) - {'env.memory', 'linux.syscall', 'linux.get_thread_area', 'linux.copy_siginfo'}:
        raise ValueError('unexpected imports: ' + repr(imports))
    if '-> "__indirect_function_table"' not in abi:
        raise ValueError('function table must be exported')
    table = re.search(r'table\[0\] type=funcref initial=(\d+)( max=(\d+))?', abi)
    if not table or table.group(2):
        raise ValueError('main table must be growable (no maximum)')
    binary = artifact.read_bytes()

    plain = root / 'web/linux/initramfs.cpio'
    manifest = json.loads((root / 'web/linux/boot-manifest.json').read_text())['assets']['plain']
    raw = plain.read_bytes()
    if len(raw) != manifest['bytes'] or digest(raw) != manifest['sha256']:
        raise ValueError('accepted plain image does not match manifest')
    original = list(records(raw))
    anchor = b'# Keep the picker available without requiring Firefox to fork a helper on NOMMU.'
    injected = (b'# Isolated guest JIT runtime primitive test (foreground).\n/' + BINARY.encode() +
                b'\necho "GUEST_JIT_EXIT status=$?"\n\n')
    chunks, changes = [], 0
    for key, header, name, body, encoded in original:
        if key == 'init':
            if body.count(anchor) != 1:
                raise ValueError('init anchor missing or repeated')
            chunks.append(record(header, name, body.replace(anchor, injected + anchor)))
            changes += 1
        elif key == 'TRAILER!!!':
            newname = BINARY.encode() + b'\0'
            fields = [0x7ffffffe, 0o100755, 0, 0, 1, 0, len(binary), 0, 0, 0, 0, len(newname), 0]
            newheader = b'070701' + b''.join(f'{value:08x}'.encode() for value in fields)
            chunks += [record(newheader, newname, binary), encoded]
        else:
            chunks.append(encoded)
    if changes != 1:
        raise ValueError('init must appear once')
    tail = raw[sum(len(r[4]) for r in original):]
    result = b''.join(chunks) + tail
    after = list(records(result))
    old = {r[0]: r[4] for r in original}
    new = {r[0]: r[4] for r in after}
    if set(new) - set(old) != {BINARY} or set(old) - set(new):
        raise ValueError('unexpected archive paths changed')
    if [key for key in old if old[key] != new[key]] != ['init']:
        raise ValueError('unexpected original record changed')
    (out / 'initramfs.cpio').write_bytes(result)
    report = {
        'pass': True, 'testOnly': True,
        'artifact': str(artifact), 'bytes': len(binary), 'sha256': digest(binary),
        'sourceSha256': digest(source.read_bytes()), 'imports': imports,
        'mainTableInitial': int(table.group(1)),
        'archive': str(out / 'initramfs.cpio'), 'archiveBytes': len(result), 'archiveSha256': digest(result),
        'plainSourceSha256': manifest['sha256'], 'modified': ['init'], 'added': [BINARY],
        'unchangedOriginalRecords': len(original) - 1,
        'workerSha256': digest((root / 'web/linux/dist/worker.js').read_bytes()),
        'guestJitSha256': digest((root / 'web/linux/dist/guest-jit.js').read_bytes()),
        'storage': storage,
    }
    (out / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'output': str(out), 'bytes': len(binary)}))


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    main()
