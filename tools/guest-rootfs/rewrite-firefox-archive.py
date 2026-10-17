"""Stream reviewed Firefox file replacements into a fresh newc gzip archive."""

import gzip
import hashlib
from pathlib import Path
import stat


def _exact(stream, size):
    data = stream.read(size)
    if len(data) != size:
        raise ValueError('Truncated CPIO archive')
    return data


def _name(value):
    if value.startswith('./'):
        value = value[2:]
    if value == '.':
        return value
    if not value or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('Unsafe CPIO path: ' + value)
    return value


def _file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _scan(source, output=None, changes=None, append=None):
    rows = {}
    with gzip.open(source, 'rb') as stream:
        while True:
            header = _exact(stream, 110)
            if header[:6] != b'070701':
                raise ValueError('Expected unchecksummed newc archive')
            try:
                fields = [int(header[offset:offset + 8], 16) for offset in range(6, 110, 8)]
            except ValueError as error:
                raise ValueError('Invalid CPIO header') from error
            size, namesize = fields[6], fields[11]
            if not 1 <= namesize <= 4096:
                raise ValueError('Invalid CPIO name size')
            encoded = _exact(stream, namesize)
            if encoded[-1:] != b'\0' or b'\0' in encoded[:-1]:
                raise ValueError('Invalid CPIO name')
            name = _name(encoded[:-1].decode('utf-8'))
            if name in rows:
                raise ValueError('Duplicate CPIO path: ' + name)
            prefix = header + encoded + _exact(stream, -(110 + namesize) % 4)
            keep = output is not None and name not in (changes or {})
            if name == 'TRAILER!!!':
                if size:
                    raise ValueError('Nonempty CPIO trailer')
                if append:
                    append(output)
            if keep:
                output.write(prefix)
            digest = hashlib.sha256()
            remaining = size
            while remaining:
                data = _exact(stream, min(remaining, 1024 * 1024))
                digest.update(data)
                if keep:
                    output.write(data)
                remaining -= len(data)
            padding = _exact(stream, -size % 4)
            if keep:
                output.write(padding)
            rows[name] = {'fields': fields, 'prefix': prefix, 'padding': padding,
                          'sha256': digest.hexdigest()}
            if name == 'TRAILER!!!':
                tail_hash = hashlib.sha256()
                tail_size = 0
                while data := stream.read(1024 * 1024):
                    if any(data):
                        raise ValueError('Nonzero data after CPIO trailer')
                    tail_hash.update(data)
                    tail_size += len(data)
                    if output:
                        output.write(data)
                return rows, (tail_size, tail_hash.hexdigest())


def replace_firefox_files(source, destination, replacements):
    source, destination = Path(source), Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Destination must not exist')
    changes = {}
    pins = {}
    for name, value in replacements.items():
        if _name(name) != name or not name.startswith('opt/firefox/'):
            raise ValueError('Only canonical Firefox file paths may change')
        path = None if value is None else Path(value)
        if path is not None:
            if not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError('Replacement must be a regular file')
            pins[name] = (path.stat().st_size, _file_hash(path))
            if pins[name][0] > 0xffffffff:
                raise ValueError('Replacement exceeds newc file size')
        changes[name] = path
    before, tail = _scan(source)
    native = before.get('opt/firefox/firefox')
    if not native or not stat.S_ISREG(native['fields'][1]):
        raise ValueError('Native Firefox is missing')
    for name, path in changes.items():
        old = before.get(name)
        if old and (not stat.S_ISREG(old['fields'][1]) or old['fields'][4] != 1):
            raise ValueError('Only single-link regular records may change')
        if not old:
            if path is None:
                raise ValueError('Removal is absent from source: ' + name)
            parent = before.get(name.rsplit('/', 1)[0])
            if not parent or not stat.S_ISDIR(parent['fields'][1]):
                raise ValueError('New file parent is not an existing directory')
        if name == 'opt/firefox/firefox' and (path is None or pins[name] != (native['fields'][6], native['sha256'])):
            raise ValueError('Resource packaging must preserve the native binary')
    inode = max(row['fields'][0] for row in before.values())
    additions = sum(name not in before for name in changes)
    if inode + additions > 0xffffffff:
        raise ValueError('No newc inode numbers available')

    def append(output):
        next_inode = inode
        for name, path in sorted(changes.items()):
            if path is None:
                continue
            encoded = name.encode() + b'\0'
            old = before.get(name)
            if old:
                fields = old['fields'].copy()
            else:
                next_inode += 1
                fields = [next_inode, 0o100644, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]
            fields[6], fields[11] = pins[name][0], len(encoded)
            prefix = b'070701' + ''.join(f'{value:08x}' for value in fields).encode() + encoded
            output.write(prefix + bytes(-len(prefix) % 4))
            digest = hashlib.sha256()
            count = 0
            with path.open('rb') as replacement:
                while data := replacement.read(1024 * 1024):
                    count += len(data)
                    digest.update(data)
                    output.write(data)
            if (count, digest.hexdigest()) != pins[name]:
                raise ValueError('Replacement changed during copy: ' + name)
            output.write(bytes(-count % 4))

    with destination.open('xb') as target:
        with gzip.GzipFile(filename='', fileobj=target, mode='wb', mtime=0, compresslevel=6) as output:
            after, after_tail = _scan(source, output, changes, append)
    if after != before or after_tail != tail:
        raise ValueError('Source changed during archive rewrite; output is not accepted')
    return {'sourceRecords': len(before), 'changedPaths': sorted(changes),
            'preservedRecords': len(before) - sum(name in before for name in changes),
            'nativeSHA256': native['sha256'], 'archiveSHA256': _file_hash(destination),
            'archiveBytes': destination.stat().st_size, 'runtimeAcceptance': False}
