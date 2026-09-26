#!/usr/bin/env python3
"""Create an isolated, pinned Firefox rootfs with Aurora readiness startup.

Never reads the generic init.sh or overwrites an existing output directory.
See package-aurora-ready.md for the command and remaining release gates.
"""
import argparse
import copy
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil


TASK = Path('/mnt/p6/build/firefox-ready-20260926')
HELPER_SHA = '2c54b0b87a88366086672b3e199f886863082951a54c34ef01c2dcc6a015a2c3'
SOURCE_SHA = '6c7fad946e53f977bc6d55a80323f7ec6a9fa84858d1a245fe0916e2f6d17e65'
ACCEPTED_MANIFEST = {
    'schema': 1,
    'version': 'fa0217b54d99',
    'assets': {
        'kernel': {'url': './vmlinux.wasm', 'bytes': 6281750,
                   'sha256': '21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75',
                   'label': 'Linux kernel'},
        'plain': {'url': './initramfs.cpio', 'bytes': 40495556,
                  'sha256': '3abcabf273287eada1663c5fc4baedc7f7e28b379c580b796cfebea0f531d1be',
                  'label': 'Desktop system'},
        'firefox': {'url': './initramfs-firefox.cpio.gz', 'bytes': 88186382,
                    'sha256': SOURCE_SHA, 'label': 'Firefox system'},
    },
}
OLD_START = b'''  echo "firefox test mode: launching as admin in 10 seconds" >&2
  (
    sleep 10
'''
NEW_START = b'''  echo "firefox test mode: waiting for Aurora readiness (10-second deadline) before launching as admin" >&2
  (
    # A successful helper includes normal deadline expiry; do not wait twice.
    if [ ! -x /bin/wait-for-aurora ] || ! /bin/su -s /bin/sh -c 'export HOME=/home/admin USER=admin LOGNAME=admin DISPLAY=:0; exec /bin/wait-for-aurora' admin; then
      echo "[wm-ready] helper unavailable or failed; retaining sleep 10" >&2
      sleep 10
    fi
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def disk_filesystem(path):
    """Resolve the longest matching Linux mount, including bind mount paths."""
    path = path.resolve(strict=True)
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        before, after = line.split(' - ', 1)
        mount = Path(re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), before.split()[4]))
        if path == mount or path.is_relative_to(mount):
            mounts.append((len(mount.parts), mount, after.split()[0]))
    if not mounts:
        raise ValueError('cannot identify filesystem for ' + str(path))
    _, mount, fs_type = max(mounts, key=lambda entry: entry[0])
    if fs_type in {'tmpfs', 'ramfs', 'devtmpfs'}:
        raise ValueError('memory-backed filesystem forbidden: ' + str(path))
    if path == Path('/tmp') or path.is_relative_to('/tmp') or path.is_relative_to('/dev/shm'):
        raise ValueError('temporary filesystem path forbidden: ' + str(path))
    return {'mount': str(mount), 'type': fs_type}


def records(data):
    """Retain complete encoded newc records, including padding and metadata."""
    offset = 0
    while True:
        start = offset
        header = data[offset:offset + 110]
        if len(header) != 110 or header[:6] != b'070701':
            raise ValueError('invalid newc header')
        fields = [int(header[6 + i * 8:14 + i * 8], 16) for i in range(13)]
        size, namesize = fields[6], fields[11]
        if not 1 <= namesize <= 4096:
            raise ValueError('invalid newc name length')
        offset += 110
        name = data[offset:offset + namesize]
        offset += namesize
        offset += (-offset) % 4
        body_start = offset
        body = data[offset:offset + size]
        offset += size + (-size) % 4
        if len(body) != size or not name.endswith(b'\0') or b'\0' in name[:-1] or offset > len(data):
            raise ValueError('truncated or invalid newc record')
        key = name[:-1].decode().removeprefix('./').lstrip('/')
        if '..' in key.split('/'):
            raise ValueError('unsafe archive path')
        yield key, header, name, body, data[start:offset], body_start - start
        if key == 'TRAILER!!!':
            if size:
                raise ValueError('nonempty CPIO trailer')
            return


def replace_body(entry, body):
    _, header, _, _, encoded, body_start = entry
    header = header[:54] + f'{len(body):08x}'.encode() + header[62:]
    return header + encoded[110:body_start] + body + b'\0' * (-len(body) % 4)


def helper_record(helper, inode):
    name = b'bin/wait-for-aurora\0'
    fields = [inode, 0o100755, 0, 0, 1, 0, len(helper), 0, 0, 0, 0, len(name), 0]
    header = b'070701' + b''.join(f'{n:08x}'.encode() for n in fields)
    return header + name + b'\0' * (-(110 + len(name)) % 4) + helper + b'\0' * (-len(helper) % 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True, help='accepted boot-manifest.json')
    parser.add_argument('--output', type=Path, required=True, help='fresh directory below ' + str(TASK))
    args = parser.parse_args()
    out = args.output.resolve()
    if not out.is_relative_to(TASK) or out == TASK or args.output.exists() or args.output.is_symlink():
        parser.error('output must be fresh and below ' + str(TASK))
    scratch_env = os.environ.get('TMPDIR')
    scratch = Path(scratch_env).resolve() if scratch_env else None
    if scratch is None or not scratch.is_relative_to(TASK) or not scratch.is_dir():
        parser.error('export TMPDIR to an existing task scratch directory')
    if not out.parent.is_dir():
        parser.error('output parent must already exist')
    filesystems = {str(path.resolve()): disk_filesystem(path) for path in
                   (args.source, args.helper, args.manifest, out.parent, scratch)}
    free_bytes = shutil.disk_usage(out.parent).free
    if free_bytes < 2 * 1024 ** 3:
        parser.error('at least 2 GiB free disk capacity required before packaging')
    source, helper = args.source.read_bytes(), args.helper.read_bytes()
    if digest(source) != SOURCE_SHA or digest(helper) != HELPER_SHA:
        parser.error('accepted archive or pinned helper hash mismatch')
    if helper[:8] != b'\0asm\x01\0\0\0':
        parser.error('helper is not the expected WebAssembly format')
    manifest_bytes = args.manifest.read_bytes()
    baseline_manifest = json.loads(manifest_bytes)
    if baseline_manifest != ACCEPTED_MANIFEST or len(source) != ACCEPTED_MANIFEST['assets']['firefox']['bytes']:
        parser.error('accepted manifest content mismatch')
    # Verify referenced accepted system files but do not duplicate or mutate them.
    for key in ('kernel', 'plain'):
        asset = baseline_manifest['assets'][key]
        path = args.manifest.parent / asset['url']
        filesystems[str(path.resolve())] = disk_filesystem(path)
        if path.stat().st_size != asset['bytes'] or file_digest(path) != asset['sha256']:
            parser.error('accepted ' + key + ' bytes/hash mismatch')
    raw = gzip.decompress(source)
    original = list(records(raw))
    old = {r[0]: r for r in original}
    if len(old) != len(original) or 'bin/wait-for-aurora' in old:
        raise ValueError('duplicate archive path or helper already present')
    if 'init' not in old or int(old['init'][1][14:22], 16) & 0o170000 != 0o100000:
        raise ValueError('missing regular-file init')
    init_before = old['init'][3]
    if init_before.count(OLD_START) != 1 or init_before.count(b'    sleep 10\n') != 1:
        raise ValueError('Firefox startup anchor or original sleep is not unique')
    init_after = init_before.replace(OLD_START, NEW_START)
    if init_after.replace(NEW_START, OLD_START) != init_before:
        raise ValueError('unintended init change')
    inode = max(int(r[1][6:14], 16) for r in original) + 1
    if inode > 0xffffffff:
        raise ValueError('no unique inode available for helper')
    tail = raw[sum(len(r[4]) for r in original):]
    chunks = []
    for entry in original:
        if entry[0] == 'init':
            chunks.append(replace_body(entry, init_after))
        else:
            if entry[0] == 'TRAILER!!!':
                chunks.append(helper_record(helper, inode))
            chunks.append(entry[4])
    candidate = b''.join(chunks) + tail
    after = list(records(candidate))
    new = {r[0]: r for r in after}
    if len(new) != len(after) or set(new) - set(old) != {'bin/wait-for-aurora'} or set(old) - set(new):
        raise ValueError('unexpected archive paths')
    if [key for key in old if old[key][4] != new[key][4]] != ['init']:
        raise ValueError('unexpected changed record')
    if [r[0] for r in after if r[0] != 'bin/wait-for-aurora'] != [r[0] for r in original]:
        raise ValueError('original record order changed')
    before_header, after_header = old['init'][1], new['init'][1]
    if before_header[:54] + before_header[62:] != after_header[:54] + after_header[62:]:
        raise ValueError('init metadata changed outside file size')
    if candidate[sum(len(r[4]) for r in after):] != tail or new['bin/wait-for-aurora'][3] != helper:
        raise ValueError('archive tail or helper bytes changed')
    # GzipFile fixes filename, mtime and OS header rather than inheriting host metadata.
    compressed = io.BytesIO()
    with gzip.GzipFile(filename='', fileobj=compressed, mode='wb', compresslevel=9, mtime=0) as stream:
        stream.write(candidate)
    encoded = compressed.getvalue()
    manifest = copy.deepcopy(baseline_manifest)
    manifest['assets']['firefox'].update(bytes=len(encoded), sha256=digest(encoded))
    manifest['version'] = digest(json.dumps(manifest['assets'], sort_keys=True).encode())[:12]
    restored = copy.deepcopy(manifest)
    restored['version'] = baseline_manifest['version']
    restored['assets']['firefox'].update({key: baseline_manifest['assets']['firefox'][key]
                                        for key in ('bytes', 'sha256')})
    if restored != baseline_manifest or manifest['version'] == baseline_manifest['version']:
        raise ValueError('manifest transformation failed')
    manifest_output = (json.dumps(manifest, indent=2) + '\n').encode()
    report = dict(
        passPackage=True, candidateOnly=True, sourceSha256=SOURCE_SHA,
        helperSha256=HELPER_SHA, archiveSha256=digest(encoded), bytes=len(encoded),
        uncompressedBytes=len(candidate), compression={'format': 'gzip', 'level': 9, 'mtime': 0, 'filename': ''},
        sourceManifestSha256=digest(manifest_bytes), manifestSha256=digest(manifest_output),
        sourceVersion=baseline_manifest['version'], version=manifest['version'],
        initBeforeSha256=digest(init_before), initAfterSha256=digest(init_after),
        unchangedOriginalRecords=len(original) - 1, modified=['init'], added=['bin/wait-for-aurora'],
        originalOrderPreserved=True, tailPreserved=True, initOutsideSubstitutionPreserved=True,
        initMetadataExceptSizePreserved=True, helperMode='100755', helperUid=0, helperGid=0,
        helperInvocationAccount='admin', helperDisplay=':0', fallbackSleepSeconds=10,
        deadlineExitZeroSkipsFallback=True, unchangedManifestAssets=['kernel', 'plain'],
        changedManifestFields=['version', 'assets.firefox.bytes', 'assets.firefox.sha256'],
        source=str(args.source.resolve()), helper=str(args.helper.resolve()),
        sourceManifest=str(args.manifest.resolve()), output=str(out),
        scratch=str(scratch), filesystems=filesystems, freeBytesBefore=free_bytes,
        releaseGatesPending=['shell-fallback-tests', 'actual-early-Firefox-usability',
                             'matched-startup-observations', 'warm-cache', 'update-home-preservation'])
    out.mkdir()
    (out / 'initramfs-firefox.cpio.gz').write_bytes(encoded)
    (out / 'boot-manifest.json').write_bytes(manifest_output)
    (out / 'init.before.sh').write_bytes(init_before)
    (out / 'init.after.sh').write_bytes(init_after)
    # Commit the audit last so interrupted runs cannot masquerade as complete.
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
