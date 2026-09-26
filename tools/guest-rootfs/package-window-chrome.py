#!/usr/bin/env python3
"""Overlay EWMH-capable Aurora WM and optional Firefox popup chrome onto a hash-verified guest archive.

Preserves every other member, including the deployed init adaptations for
fonts, certificates, keyboard, devpts and display sizing. Removes default packet/body tracing; opt in with firefox_trace=1. Never edits the input.
"""
import argparse
import gzip
import hashlib
import os
from contextlib import nullcontext
from pathlib import Path
import tempfile

TRACE_ENV = b" LOWLAND_BLOB_TRACE=1 MOZ_LOG=timestamp,pipnss:4,nsHttp:3,nsSocketTransport:3"
TRACE_OPT_IN = b"""# Packet/body tracing is expensive; enable only for an explicit diagnostic boot.
if grep -qw 'firefox_trace=1' /proc/cmdline; then
  export LOWLAND_BLOB_TRACE=1 MOZ_LOG=timestamp,pipnss:4,nsHttp:3,nsSocketTransport:3
else
  unset LOWLAND_BLOB_TRACE MOZ_LOG
fi

"""


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def exact(stream, size):
    data = stream.read(size)
    if len(data) != size:
        raise ValueError('truncated newc archive')
    return data


def package(source, destination, expected_sha256, wm, chrome=None):
    if source.resolve() == destination.resolve():
        raise ValueError('use a separate output path')
    if sha256(source) != expected_sha256:
        raise ValueError('baseline checksum mismatch; input was not changed')
    replacements = {'bin/aurora-wm': wm}
    if chrome:
        replacements['lowland-userChrome.css'] = chrome
    with wm.open('rb') as stream:
        if stream.read(8) != b'\0asm\x01\0\0\0':
            raise ValueError(f'not a WebAssembly binary: {wm}')
    with source.open('rb') as stream:
        compressed = stream.read(2) == b'\x1f\x8b'
    reader = gzip.open if compressed else open
    destination.parent.mkdir(parents=True, exist_ok=True)
    touched = set()
    fd, temporary = tempfile.mkstemp(prefix=destination.name + '.', dir=destination.parent)
    try:
        with reader(source, 'rb') as inp, os.fdopen(fd, 'wb') as raw:
            writer = gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) if compressed else nullcontext(raw)
            with writer as out:
                while True:
                    header = exact(inp, 110)
                    if header[:6] != b'070701':
                        raise ValueError('expected newc archive')
                    size = int(header[54:62], 16)
                    namesize = int(header[94:102], 16)
                    name = exact(inp, namesize)
                    namepad = exact(inp, (-(110 + namesize)) % 4)
                    key = name.rstrip(b'\0').decode('utf-8').removeprefix('./').lstrip('/')
                    if key in replacements or key == 'init':
                        if key in touched:
                            raise ValueError(f'duplicate member: {key}')
                        data = exact(inp, size)
                        exact(inp, (-size) % 4)
                        if key == 'init':
                            if TRACE_OPT_IN not in data and TRACE_ENV in data:
                                if data.count(TRACE_ENV) != 1:
                                    raise ValueError('unexpected diagnostic environment')
                                data = data.replace(TRACE_ENV, b'')
                                anchor = b'launch_firefox() {\n'
                                if data.count(anchor) != 1:
                                    raise ValueError('unexpected guest init')
                                data = data.replace(anchor, TRACE_OPT_IN + anchor)
                        else:
                            data = replacements[key].read_bytes()
                        header = header[:54] + f'{len(data):08x}'.encode() + header[62:]
                        out.write(header + name + namepad)
                        out.write(data)
                        out.write(b'\0' * ((-len(data)) % 4))
                        touched.add(key)
                    else:
                        out.write(header + name + namepad)
                        remaining = size + (-size) % 4
                        while remaining:
                            chunk = exact(inp, min(remaining, 1024 * 1024))
                            out.write(chunk)
                            remaining -= len(chunk)
                    if key == 'TRAILER!!!':
                        out.write(inp.read())
                        break
        if touched != set(replacements) | {'init'}:
            raise ValueError(f'missing requested members: {(set(replacements) | {"init"}) - touched}')
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f'{sha256(destination)}  {destination}')
    print('Replaced: ' + ', '.join(sorted(touched)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--wm', type=Path, required=True)
    parser.add_argument('--chrome', type=Path)
    args = parser.parse_args()
    package(args.source, args.destination, args.expected_sha256, args.wm, args.chrome)
