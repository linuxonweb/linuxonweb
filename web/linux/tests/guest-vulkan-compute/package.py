#!/usr/bin/env python3
"""Hash-guarded test copy of plain CPIO, output strictly on task build disk."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from storage import checked_storage

def digest(data):
    return hashlib.sha256(data).hexdigest()

def records(data):
    offset = 0
    while True:
        start = offset; header = data[offset:offset + 110]
        if len(header) != 110 or header[:6] != b'070701':
            raise ValueError('invalid newc header')
        size, namesize = int(header[54:62], 16), int(header[94:102], 16)
        if not 1 <= namesize <= 4096:
            raise ValueError('invalid newc name size')
        offset += 110
        name = data[offset:offset + namesize]; offset += namesize; offset += (-offset) % 4
        body = data[offset:offset + size]; offset += size; offset += (-offset) % 4
        if len(body) != size or len(name) != namesize or not name.endswith(b'\0') or offset > len(data):
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
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=['compute'], default='compute')
    args = parser.parse_args()
    out, storage = checked_storage(args.output)
    if out.exists():
        raise ValueError('output already exists')
    here = Path(__file__).resolve().parent
    root = here.parents[3]
    source = root / 'web/linux/initramfs.cpio'
    manifest = json.loads((root / 'web/linux/boot-manifest.json').read_text())['assets']['plain']
    raw = source.read_bytes()
    if len(raw) != manifest['bytes'] or digest(raw) != manifest['sha256']:
        raise ValueError('accepted plain image does not match manifest')
    build = json.loads(args.build.read_text()); binary = Path(build['artifact']).read_bytes()
    if not build['pass'] or not build['testOnly'] or len(binary) != build['bytes'] or digest(binary) != build['sha256']:
        raise ValueError('build artifact differs from verified build report')
    original = list(records(raw)); chunks = []; changes = 0
    anchor = b'# Keep the picker available without requiring Firefox to fork a helper on NOMMU.'
    argument = b''
    for key, header, name, body, encoded in original:
        if key == 'init':
            if body.count(anchor) != 1:
                raise ValueError('accepted init anchor missing or repeated')
            injected = b'# Isolated experimental Vulkan lifecycle/partial clear-copy test.\n/bin/guest-vulkan-public-client' + argument + b' &\n\n'
            chunks.append(record(header, name, body.replace(anchor, injected + anchor))); changes += 1
        elif key == 'TRAILER!!!':
            newname = b'bin/guest-vulkan-public-client\0'
            fields = [0x7ffffffe, 0o100755, 0, 0, 1, 0, len(binary), 0, 0, 0, 0, len(newname), 0]
            newheader = b'070701' + b''.join(f'{value:08x}'.encode() for value in fields)
            chunks += [record(newheader, newname, binary), encoded]
        else:
            chunks.append(encoded)
    if changes != 1:
        raise ValueError('init must appear once')
    tail = raw[sum(len(r[4]) for r in original):]
    result = b''.join(chunks) + tail
    after = list(records(result)); old = {r[0]: r[4] for r in original}; new = {r[0]: r[4] for r in after}
    if len(old) != len(original) or len(new) != len(after):
        raise ValueError('duplicate CPIO names')
    if set(new) - set(old) != {'bin/guest-vulkan-public-client'} or set(old) - set(new):
        raise ValueError('unexpected archive paths changed')
    if [key for key in old if old[key] != new[key]] != ['init']:
        raise ValueError('unexpected original archive record changed')
    out.mkdir(parents=True)
    (out / 'initramfs.cpio').write_bytes(result)
    report = {'passPackage': True, 'testOnly': True, 'mode': args.mode, 'archiveSha256': digest(result),
              'bytes': len(result), 'sourceSha256': manifest['sha256'], 'guestBinary': build,
              'unchangedOriginalRecords': len(original)-1, 'modified': ['init'],
              'added': ['bin/guest-vulkan-public-client'], 'tailPreserved': result.endswith(tail) if tail else True,
              'storage': storage}
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'output': str(out), 'mode': args.mode}))

if __name__ == '__main__':
    main()
