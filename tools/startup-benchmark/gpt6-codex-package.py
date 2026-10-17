"""Private single-binary diagnostic overlay; no publication or runtime claims."""

import gzip
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def exact(stream, size):
    body = stream.read(size)
    if len(body) != size:
        raise ValueError('truncated newc record')
    return body


def copy_bytes(source, destination, size):
    checksum = hashlib.sha256()
    while size:
        body = exact(source, min(size, 262144))
        checksum.update(body)
        if destination is not None:
            destination.write(body)
        size -= len(body)
    return checksum.hexdigest()


def package(source, destination, source_sha, binary, old_sha, binary_sha):
    source, destination, binary = map(Path, (source, destination, binary))
    if destination.exists() or destination.resolve() in {source.resolve(), binary.resolve()}:
        raise FileExistsError('use a new, private output path')
    if digest(source) != source_sha or digest(binary) != binary_sha:
        raise ValueError('input checksum mismatch')
    with binary.open('rb') as stream:
        if stream.read(8) != b'\0asm\x01\0\0\0':
            raise ValueError('candidate is not WebAssembly v1')
    binary_size = binary.stat().st_size
    if binary_size > 512 * 1024**2:
        raise ValueError('candidate exceeds record bound')
    seen, changed = set(), []
    descriptor, temporary = tempfile.mkstemp(prefix=destination.name + '-', dir=destination.parent)
    try:
        with gzip.open(source, 'rb') as inp, os.fdopen(descriptor, 'wb') as raw:
            with gzip.GzipFile(filename='', fileobj=raw, mode='wb', compresslevel=6, mtime=0) as out:
                while True:
                    header = exact(inp, 110)
                    if header[:6] != b'070701' or not re.fullmatch(b'[0-9a-fA-F]{104}', header[6:]):
                        raise ValueError('invalid newc header')
                    fields = [int(header[6 + index * 8:14 + index * 8], 16) for index in range(13)]
                    size, name_size = fields[6], fields[11]
                    if not 1 <= name_size <= 4096 or size > 512 * 1024**2 or fields[12] != 0:
                        raise ValueError('invalid newc record bounds')
                    name = exact(inp, name_size)
                    if not name.endswith(b'\0') or b'\0' in name[:-1]:
                        raise ValueError('invalid newc name')
                    key = name[:-1].decode().removeprefix('./')
                    if not key or key.startswith('/') or (key != '.' and any(part in {'', '.', '..'} for part in key.split('/'))) or key in seen:
                        raise ValueError('unsafe or duplicate newc path')
                    seen.add(key)
                    name_padding = exact(inp, -(110 + name_size) % 4)
                    if key == 'opt/firefox/firefox':
                        if not stat.S_ISREG(fields[1]) or fields[4] != 1:
                            raise ValueError('native executable must be a regular unlinked record')
                        if copy_bytes(inp, None, size) != old_sha:
                            raise ValueError('old native executable checksum mismatch')
                        exact(inp, -size % 4)
                        out.write(header[:54] + f'{binary_size:08x}'.encode() + header[62:] + name + name_padding)
                        with binary.open('rb') as candidate:
                            if copy_bytes(candidate, out, binary_size) != binary_sha or candidate.read(1):
                                raise ValueError('candidate changed during copy')
                        out.write(b'\0' * (-binary_size % 4))
                        changed.append(key)
                    else:
                        out.write(header + name + name_padding)
                        copy_bytes(inp, out, size + (-size % 4))
                    if key == 'TRAILER!!!':
                        if size:
                            raise ValueError('nonempty newc trailer')
                        while tail := inp.read(262144):
                            out.write(tail)
                        break
            raw.flush()
            os.fsync(raw.fileno())
        if changed != ['opt/firefox/firefox']:
            raise ValueError('missing native executable')
        if digest(source) != source_sha or digest(binary) != binary_sha:
            raise ValueError('input changed during packaging')
        os.link(temporary, destination)
    finally:
        os.unlink(temporary)
    return {'changed': changed, 'records': len(seen), 'sourceSha256': source_sha,
            'oldNativeSha256': old_sha, 'nativeSha256': binary_sha,
            'sha256': digest(destination), 'bytes': destination.stat().st_size,
            'runtimeAcceptance': False}
