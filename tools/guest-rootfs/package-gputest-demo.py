#!/usr/bin/env python3
"""gputest G2: package the rotating-cube demo as an uncompressed newc CPIO.

The archive is appended to the guest initramfs by web/linux/gputest.mjs when the
page runs with ?gputest=1 (rdinit=/gputest-init). It contains only regular
files (no directory entries, so existing /bin etc. keep their modes), owned by
0:0 with mtime 0 and sequential inode numbers, so the output is byte-for-byte
reproducible from its inputs. The rootfs /init is not touched.

Usage: package-gputest-demo.py --wasm BUILD/vkcube-lite.wasm [--output web/linux/gpu/gputest.cpio]
Writes OUTPUT and OUTPUT.json (sha256/size of the archive and each member).
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / 'web/linux/tests/gputest-demo'


def newc_entry(ino, name, mode, data):
    name_bytes = name.encode() + b'\0'
    fields = [ino, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(name_bytes), 0]
    header = b'070701' + b''.join(b'%08X' % v for v in fields)
    out = header + name_bytes
    out += b'\0' * (-len(out) % 4)
    out += data
    out += b'\0' * (-len(out) % 4)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--wasm', type=Path, required=True, help='built vkcube-lite.wasm')
    parser.add_argument('--output', type=Path, default=ROOT / 'web/linux/gpu/gputest.cpio')
    args = parser.parse_args()
    members = [('gputest-init', 0o100755, (DEMO / 'gputest-init').read_bytes()),
               ('gputest-waiter', 0o100755, (DEMO / 'gputest-waiter').read_bytes()),
               ('bin/vkcube-lite', 0o100755, args.wasm.read_bytes())]
    if members[2][2][:4] != b'\0asm': raise ValueError('not a wasm module: ' + str(args.wasm))
    archive = b''.join(newc_entry(i + 1, name, mode, data) for i, (name, mode, data) in enumerate(members))
    archive += newc_entry(0, 'TRAILER!!!', 0, b'')
    archive += b'\0' * (-len(archive) % 512)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(archive)
    record = {'archive': str(args.output), 'bytes': len(archive), 'sha256': hashlib.sha256(archive).hexdigest(), 'format': 'newc, uncompressed, no directory entries, uid/gid 0, mtime 0',
              'members': [{'path': '/' + name, 'mode': oct(mode & 0o7777), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, mode, data in members],
              'wasmSource': str(args.wasm.resolve())}
    Path(str(args.output) + '.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'bytes': record['bytes'], 'sha256': record['sha256']}))


if __name__ == '__main__':
    main()
