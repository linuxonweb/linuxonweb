#!/usr/bin/env python3
"""Add devpts boot setup; optionally reuse the verified keyboard fix for Start X."""
import argparse
import gzip
import hashlib
from contextlib import nullcontext
from pathlib import Path

BASELINES = {
    # Firefox/font-fixed gzip archive; lighter console/X raw archive.
    'd117b9f45b51373558ef020f9d53455772455800cda0f03dd02455d397347e7e': True,
    '411f644e0673c2b56cfc0fa1b85de7efce83f56bd472b66eee01e5105701d0f2': False,
    # Already-deployed devpts archives, for the additional X11 request limit.
    'ecc14881fe6075183651324e337900b71bce57b783f20467ec1db98a57254be8': True,
    '79880130d978880df0b1c2fa217e9d59201dc0af9096dcde09695b8916ef00c1': False,
}
DEVPTS_BASELINES = {
    'ecc14881fe6075183651324e337900b71bce57b783f20467ec1db98a57254be8',
    '79880130d978880df0b1c2fa217e9d59201dc0af9096dcde09695b8916ef00c1',
}
ANCHOR = b'mount -t devtmpfs devtmpfs /dev\n'
SETUP = b'''# PTY-backed terminals need the slave device filesystem as well as /dev/ptmx.
mkdir -p /dev/pts
mount -t devpts -o mode=0620,ptmxmode=0666 devpts /dev/pts
chmod 0666 /dev/ptmx
'''


def copy_bytes(inp, out, size):
    while size:
        data = inp.read(min(size, 1024 * 1024))
        assert data, 'truncated cpio member'
        out.write(data)
        size -= len(data)


def package(source, destination, keyboard_wasm=None, limit_x11_requests=False):
    assert source.resolve() != destination.resolve(), 'use a separate candidate path'
    with source.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
        assert digest in BASELINES, 'unexpected baseline'
    compressed = BASELINES[digest]
    if digest in DEVPTS_BASELINES:
        assert limit_x11_requests, 'devpts already installed; request an additional fix'
    keyboard = keyboard_wasm.read_bytes() if keyboard_wasm else None
    if keyboard is not None:
        assert not compressed, 'Firefox baseline already has the keyboard fix'
        assert hashlib.sha256(keyboard).hexdigest() == '6cce82cafaf7c86ca9704e13283ecfac3bf41cf682f56c4b0dff01b1f624e796', 'unexpected keyboard binary'
    open_source = gzip.open if compressed else open
    replaced = 0
    keyboard_replaced = 0
    with open_source(source, 'rb') as inp, destination.open('wb') as raw:
        output = gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) if compressed else nullcontext(raw)
        with output as out:
            while True:
                header = inp.read(110)
                assert len(header) == 110 and header[:6] == b'070701'
                size, name_size = int(header[54:62], 16), int(header[94:102], 16)
                name = inp.read(name_size)
                padding = inp.read((-(110 + name_size)) % 4)
                if name.rstrip(b'\0') == b'init':
                    data = inp.read(size)
                    inp.read((-size) % 4)
                    if digest in DEVPTS_BASELINES:
                        assert data.count(SETUP) == 1
                    else:
                        assert data.count(ANCHOR) == 1 and b'mount -t devpts' not in data
                        data = data.replace(ANCHOR, ANCHOR + SETUP)
                    if limit_x11_requests:
                        old = b'exec /bin/Xfbdev :0 -ac -screen '
                        assert data.count(old) == 1 and b'-maxbigreqsize' not in data
                        data = data.replace(old, b'exec /bin/Xfbdev :0 -ac -maxbigreqsize 1 -screen ')
                    header = header[:54] + f'{len(data):08x}'.encode() + header[62:]
                    out.write(header + name + padding + data + b'\0' * ((-len(data)) % 4))
                    replaced += 1
                elif keyboard is not None and name.rstrip(b'\0') == b'bin/Xfbdev':
                    data = inp.read(size)
                    inp.read((-size) % 4)
                    assert hashlib.sha256(data).hexdigest() == 'cab3811d3b29129a2846a7c2097b6de829c56760dda2dda7a5f96895e7cda966', 'unexpected old keyboard binary'
                    header = header[:54] + f'{len(keyboard):08x}'.encode() + header[62:]
                    out.write(header + name + padding + keyboard + b'\0' * ((-len(keyboard)) % 4))
                    keyboard_replaced += 1
                else:
                    out.write(header + name + padding)
                    copy_bytes(inp, out, size + (-size) % 4)
                if name.rstrip(b'\0') == b'TRAILER!!!':
                    out.write(inp.read())
                    break
    assert replaced == 1
    assert keyboard_replaced == (1 if keyboard is not None else 0)
    with destination.open('rb') as f:
        print('candidate', destination, 'sha256', hashlib.file_digest(f, 'sha256').hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--keyboard-wasm', type=Path, help='exact validated TinyX evdev binary for the lighter archive')
    parser.add_argument('--limit-x11-requests', action='store_true', help='advertise TinyX requests within its 4 MiB receive buffer')
    args = parser.parse_args()
    package(args.source, args.destination, args.keyboard_wasm, args.limit_x11_requests)
