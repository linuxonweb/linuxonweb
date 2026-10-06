#!/usr/bin/env python3
"""Patch Nightly's pending startup tab for the single-process Linux guest.

The input archive is immutable. Only Tabbrowser.sys.mjs is changed; existing
profiles, init, browser binary, trust stores and all other records are copied.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil


MEMBER = 'opt/firefox/moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs'
SOURCE_SHA = '013635ec1bb3b7600109bae07aa30769f71176af6ed651d8969ce9d748451ccb'
MEMBER_SHA = '539985deedecc3d81953bbe24a09c9787e01ce55cfab60cc2437cf05aac8dc6a'
OLD = b'        remoteType = lazy.E10SUtils.PRIVILEGEDABOUT_REMOTE_TYPE;'
NEW = (b'        remoteType = this.documentGlobal.gMultiProcessBrowser\n'
       b'          ? lazy.E10SUtils.PRIVILEGEDABOUT_REMOTE_TYPE\n'
       b'          : lazy.E10SUtils.NOT_REMOTE;')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def consume(stream, size, sink=None):
    digest = hashlib.sha256()
    while size:
        chunk = stream.read(min(size, 65536))
        if not chunk:
            raise ValueError('truncated archive')
        digest.update(chunk)
        if sink:
            sink.write(chunk)
        size -= len(chunk)
    return digest.hexdigest()


def transform(source, destination):
    count = 0
    changed = []
    input_offset = output_offset = 0
    with gzip.open(source, 'rb') as inp, destination.open('xb') as raw_out:
        with gzip.GzipFile(filename='', fileobj=raw_out, mode='wb', compresslevel=9, mtime=0) as out:
            while True:
                header = inp.read(110)
                if len(header) != 110 or header[:6] != b'070701':
                    raise ValueError('invalid newc header')
                input_offset += 110
                numbers = [int(header[6 + i * 8:14 + i * 8], 16) for i in range(13)]
                size, name_size = numbers[6], numbers[11]
                if name_size < 1 or name_size > 4096:
                    raise ValueError('invalid member name length')
                name_bytes = inp.read(name_size)
                if len(name_bytes) != name_size or not name_bytes.endswith(b'\0'):
                    raise ValueError('invalid member name')
                name = name_bytes[:-1].decode().removeprefix('./').lstrip('/')
                if '..' in name.split('/'):
                    raise ValueError('unsafe member name')
                input_offset += name_size
                name_pad = inp.read((-input_offset) % 4)
                input_offset += len(name_pad)
                if name == MEMBER:
                    if changed:
                        raise ValueError('duplicate target')
                    before = inp.read(size)
                    if len(before) != size or sha(before) != MEMBER_SHA or before.count(OLD) != 1:
                        raise ValueError('unexpected target content')
                    after = before.replace(OLD, NEW)
                    if after.replace(NEW, OLD) != before:
                        raise ValueError('unexpected substitution')
                    new_header = header[:54] + f'{len(after):08x}'.encode() + header[62:]
                    out.write(new_header + name_bytes + name_pad + after)
                    output_offset += 110 + name_size + len(name_pad) + len(after)
                    out.write(b'\0' * ((-output_offset) % 4))
                    output_offset += (-output_offset) % 4
                    changed.append({'name': name, 'beforeSHA256': sha(before),
                                    'afterSHA256': sha(after), 'beforeBytes': size,
                                    'afterBytes': len(after)})
                else:
                    out.write(header + name_bytes + name_pad)
                    output_offset += 110 + name_size + len(name_pad)
                    consume(inp, size, out)
                    output_offset += size
                    body_pad = inp.read((-input_offset - size) % 4)
                    out.write(body_pad)
                    output_offset += len(body_pad)
                input_offset += size
                if name == MEMBER:
                    inp.read((-input_offset) % 4)
                input_offset += (-input_offset) % 4
                count += 1
                if name == 'TRAILER!!!':
                    consume(inp, 0)
                    while chunk := inp.read(65536):
                        out.write(chunk)
                    break
    if len(changed) != 1:
        raise ValueError('target missing')
    return count, changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    task = Path('/mnt/p6/build/browser-bugs-20261005')
    if not output.is_relative_to(task) or output == task or output.exists():
        parser.error('fresh output under the browser-bugs task required')
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ.get(key, '/tmp')).resolve()
        if not scratch.is_relative_to(task) or not scratch.is_dir():
            parser.error(key + ' must be task-owned disk scratch')
    if shutil.disk_usage(task).free < 4 * 1024**3:
        parser.error('4 GiB free space required')
    source = args.source.resolve(strict=True)
    manifest_path = args.manifest.resolve(strict=True)
    if source.parent != manifest_path.parent or file_sha(source) != SOURCE_SHA:
        parser.error('source identity mismatch')
    manifest = json.loads(manifest_path.read_text())
    if manifest['assets']['firefox']['sha256'] != SOURCE_SHA:
        parser.error('manifest source mismatch')
    output.mkdir()
    archive = output / 'initramfs-firefox.cpio.gz'
    count, changed = transform(source, archive)
    result = dict(manifest)
    result['assets'] = dict(manifest['assets'])
    result['assets']['firefox'] = dict(manifest['assets']['firefox'])
    result['assets']['firefox'].update(bytes=archive.stat().st_size, sha256=file_sha(archive))
    result['version'] = sha(json.dumps(result['assets'], sort_keys=True).encode())[:12]
    (output / 'boot-manifest.json').write_text(json.dumps(result, indent=2) + '\n')
    report = {'candidateOnly': True, 'sourceSHA256': SOURCE_SHA,
              'archiveSHA256': result['assets']['firefox']['sha256'],
              'archiveBytes': archive.stat().st_size, 'records': count,
              'changed': changed, 'version': result['version'],
              'runtimeAcceptance': 'pending'}
    (output / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
