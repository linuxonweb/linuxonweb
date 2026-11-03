#!/usr/bin/env python3
"""Create a reviewed plain desktop candidate from signed base package payloads.

The legacy package registry is archived as provenance, never described as the
current registry. Every unmanaged original newc record is preserved exactly.
The result remains a candidate until actual plain desktop/recovery tests pass.
"""
import argparse
import base64
import copy
import gzip
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import posixpath
import subprocess
import tarfile
import zlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('overlay', HERE / 'overlay-persistence.py')
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)
BASE_NAMES = {'apk-tools', 'busybox', 'ca-certificates', 'curl'}


def records(path):
    with path.open('rb') as source:
        compressed = source.read(2) == b'\x1f\x8b'
    opener = gzip.open if compressed else open
    result = []
    with opener(path, 'rb') as stream:
        while True:
            first = stream.read(1)
            while first == b'\0':
                first = stream.read(1)
            if not first:
                break
            header = first + overlay.cpio.read_exact(stream, 109)
            if header[:6] != b'070701':
                raise ValueError('reviewed newc format required')
            fields = [int(header[6 + n * 8:14 + n * 8], 16) for n in range(13)]
            inode, mode, uid, gid, nlink, mtime, size, devmaj, devmin, rmaj, rmin, namesize, check = fields
            if not 2 <= namesize <= 4096 or size > 64 * 1024 * 1024 or len(result) >= 16384:
                raise ValueError('unexpected newc name, record size or record count')
            encoded_name = overlay.cpio.read_exact(stream, namesize)
            if not encoded_name.endswith(b'\0') or encoded_name.count(b'\0') != 1:
                raise ValueError('newc name must have one final NUL')
            name = encoded_name[:-1].decode().removeprefix('./')
            root_directory = name == '.' and mode & 0o170000 == 0o040000
            if name != 'TRAILER!!!' and not root_directory and (not name or name.startswith('/') or any(part in ('', '.', '..') for part in name.split('/'))):
                raise ValueError('unsafe original newc path')
            name_pad = overlay.cpio.read_exact(stream, -(110 + namesize) % 4)
            data = overlay.cpio.read_exact(stream, size)
            data_pad = overlay.cpio.read_exact(stream, -size % 4)
            if nlink > 1 and mode & 0o170000 == 0o100000:
                raise ValueError('regular hardlinks require a separate reviewed migration')
            result.append({'name': name, 'mode': mode, 'data': data, 'inode': inode,
                           'raw': header + encoded_name + name_pad + data + data_pad})
    return result


def latest(rows):
    return {row['name']: row for row in rows if row['name'] != 'TRAILER!!!'}


def load_payloads(repo, reference, original, host_apk):
    installed = {}
    for block in original['lib/apk/db/installed']['data'].decode().strip().split('\n\n'):
        values = dict(line.split(':', 1) for line in block.splitlines() if line[:2] in ('P:', 'V:', 'C:'))
        installed[values['P']] = values
    if set(installed) != BASE_NAMES:
        raise ValueError('reference must contain exactly the reviewed four-package base')
    accepted = {p['name']: p for p in reference['packages']}
    if set(accepted) != BASE_NAMES:
        raise ValueError('unexpected console package provenance')
    key = repo / 'linuxonweb-dev.rsa.pub'
    if key.read_bytes() != original['etc/apk/keys/' + key.name]['data']:
        raise ValueError('repository trust differs from accepted console')
    host = host_apk.resolve()
    environment = {**os.environ, 'LD_LIBRARY_PATH': str(host.parent)}
    files, owners, receipts = {}, {}, []
    for name in sorted(BASE_NAMES):
        accepted_package = accepted[name]
        version = installed[name]['V']
        if accepted_package['version'] != version:
            raise ValueError('reference package version mismatch')
        archive = repo / 'wasm32' / (name + '-' + version + '.apk')
        if overlay.sha(archive) != accepted_package['sha256']:
            raise ValueError('exact accepted package archive required')
        subprocess.run([str(host), '--keys-dir', str(key.resolve().parent), 'verify', str(archive.resolve())],
                       env=environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=15)
        remaining = archive.read_bytes()
        segments, decoded = [], []
        while remaining:
            decoder = zlib.decompressobj(31)
            data = decoder.decompress(remaining) + decoder.flush()
            used = len(remaining) - len(decoder.unused_data)
            if used <= 0 or len(data) > 32 * 1024 * 1024:
                raise ValueError('invalid or unexpectedly large APK stream')
            segments.append(remaining[:used])
            decoded.append(data)
            remaining = decoder.unused_data
        if len(segments) != 3 or installed[name]['C'] != 'Q1' + base64.b64encode(hashlib.sha1(segments[1]).digest()).decode():
            raise ValueError('exact native installed C identity required')
        with tarfile.open(fileobj=io.BytesIO(decoded[2]), mode='r:') as archive_tar:
            for member in archive_tar:
                path = member.name.rstrip('/')
                if not path or path.startswith(('/', '.')) or '\\' in path or any(x in ('', '..') for x in path.split('/')):
                    raise ValueError('unsafe signed package member')
                if member.uid != 0 or member.gid != 0:
                    raise ValueError('unexpected package file ownership')
                if member.isdir():
                    continue
                if member.isfile():
                    value = (0o100000 | member.mode, archive_tar.extractfile(member).read())
                elif member.issym():
                    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), member.linkname))
                    if not member.linkname or '\0' in member.linkname or member.linkname.startswith('/') or resolved == '..' or resolved.startswith('../'):
                        raise ValueError('package symlink escapes image')
                    value = (0o120777, member.linkname.encode())
                else:
                    raise ValueError('unsupported signed package member')
                if path in files and files[path] != value:
                    raise ValueError('conflicting package owners')
                known = original.get(path)
                if not known or (known['mode'], known['data']) != value:
                    raise ValueError('payload differs from accepted console: ' + path)
                files[path] = value
                owners[path] = name
        receipts.append({**accepted_package, 'nativeChecksum': installed[name]['C'], 'signatureVerified': True})
    return files, owners, receipts


def build(args):
    manifest = json.loads(args.manifest.read_text())
    console_manifest = json.loads(args.console_manifest.read_text())
    package = json.loads(args.reference_package.read_text())
    if overlay.sha(args.base) != manifest['assets']['plain']['sha256'] or args.base.stat().st_size != manifest['assets']['plain']['bytes']:
        raise ValueError('plain image differs from pinned manifest')
    if overlay.sha(args.console) != console_manifest['image']['sha256']:
        raise ValueError('reference console differs from pinned manifest')
    if overlay.sha(args.kernel) != manifest['assets']['kernel']['sha256']:
        raise ValueError('kernel ABI differs from pinned manifest')
    helper = args.helper.read_bytes()
    if overlay.digest(helper) != package['nativeHelperSha256'] or helper[:8] != b'\0asm\x01\0\0\0':
        raise ValueError('exact default native helper required')
    base_rows = records(args.base)
    base = latest(base_rows)
    console = latest(records(args.console))
    if len(base) != sum(row['name'] != 'TRAILER!!!' for row in base_rows):
        raise ValueError('duplicate plain records require explicit review')
    signed, owners, packages = load_payloads(args.repo, console_manifest, console, args.host_apk)
    protected = {name: (row['mode'], row['data']) for name, row in console.items()}
    metadata = overlay.metadata_files(protected, manifest)
    if json.loads(metadata['etc/linuxonweb-packages/compatibility'][1]) != package['compatibility']:
        raise ValueError('plain package compatibility must equal accepted Firefox and console')
    files = {**signed, **metadata}
    for name in ['etc/apk/world', 'etc/apk/repositories', 'lib/apk/db/installed', 'lib/apk/db/scripts.tar', 'lib/apk/db/triggers']:
        files[name] = (console[name]['mode'], console[name]['data'])
    for name, row in console.items():
        if name.startswith('etc/apk/keys/') and row['mode'] & 0o170000 == 0o100000:
            files[name] = (row['mode'], row['data'])
    sudo_receipt = next(x for x in json.loads(args.sudo_receipt.read_text())['overlayMembers'] if x['path'] == 'usr/bin/sudo')
    if overlay.sha(args.sudo) != sudo_receipt['sha256'] or args.sudo.stat().st_size != sudo_receipt['bytes'] or sudo_receipt['mode'] != '0o104755':
        raise ValueError('exact accepted native sudo required')
    init = base['init']['data'].decode()
    if init.count(overlay.ANCHOR) != 1 or '/usr/sbin/apk-persist' in init:
        raise ValueError('reviewed plain init anchor missing or changed')
    files.update({'init': (0o100755, init.replace(overlay.ANCHOR, overlay.HOOK + overlay.ANCHOR, 1).encode()),
                  'bin/apk': (0o120777, b'../sbin/apk'), 'etc/apk/arch': (0o100644, b'wasm32\n'),
                  'usr/bin/sudo': (0o104755, args.sudo.read_bytes()), 'usr/sbin/apk-persist': (0o100755, helper),
                  'usr/share/doc/linuxonweb-packages/PERSISTENCE.txt': (0o100644, (HERE / 'PERSISTENCE.md').read_bytes()),
                  'usr/share/linuxonweb-image/PACKAGE_OWNERSHIP.txt': (0o100644,
                   b'This image has four signed package-managed base packages: apk-tools, BusyBox, CA certificates and curl.\n'
                   b'Existing desktop programs, fonts and other distribution files are image-managed; they are not asserted to be installed APK packages.\n'
                   b'The former package database, world and legacy APK executable are retained under legacy-apk for provenance only. They are not active signing trust or a restore source.\n'
                   b'Use explicit apk-persist add/del/save for signed generations. Ordinary apk changes alone are session-only.\n')})
    legacy = {}
    for name, row in base.items():
        if row['mode'] & 0o170000 == 0o040000:
            continue
        if name == 'bin/apk' or name.startswith(('etc/apk/', 'lib/apk/db/', 'var/cache/apk/')):
            target = 'usr/share/linuxonweb-image/legacy-apk/' + name
            files[target] = (0o100644, row['data'])
            legacy[name] = {'sha256': overlay.digest(row['data']), 'bytes': len(row['data']), 'mode': oct(row['mode']), 'archivedPath': target}
    replaced = set(files)
    removed = {name for name, row in base.items() if row['mode'] & 0o170000 != 0o040000 and name.startswith(('etc/apk/', 'lib/apk/db/', 'var/cache/apk/'))}
    preserved = [row for row in base_rows if row['name'] != 'TRAILER!!!' and row['name'] not in replaced | removed]
    directories = set()
    for name in files:
        parent = pathlib.PurePosixPath(name).parent
        while str(parent) != '.':
            if str(parent) not in base:
                directories.add(str(parent))
            elif base[str(parent)]['mode'] & 0o170000 != 0o040000:
                raise ValueError('overlay parent is not an existing directory')
            parent = parent.parent
    inode = max(row['inode'] for row in base_rows) + 1
    args.out.mkdir(parents=True, exist_ok=False)
    image = args.out / 'initramfs.cpio'
    with image.open('wb') as target:
        for row in preserved:
            target.write(row['raw'])
        for name in sorted(directories, key=lambda value: (value.count('/'), value)):
            target.write(overlay.cpio.entry(name, mode=0o040755, ino=inode))
            inode += 1
        for name, (mode, data) in sorted(files.items()):
            target.write(overlay.cpio.entry(name, data, mode, inode))
            inode += 1
        target.write(overlay.cpio.entry('TRAILER!!!', mode=0, ino=inode))
        target.write(b'\0' * (-target.tell() % 512))
    output = latest(records(image))
    if any(output[row['name']]['raw'] != row['raw'] for row in preserved):
        raise ValueError('unmanaged desktop record changed')
    if any((output[name]['mode'], output[name]['data']) != value for name, value in files.items()):
        raise ValueError('managed overlay file mismatch')
    if any(name not in files and name in output for name in removed):
        raise ValueError('stale package metadata remains active')
    updated = copy.deepcopy(manifest)
    updated['assets']['plain'].update(bytes=image.stat().st_size, sha256=overlay.sha(image), label='Desktop with signed native packages and explicit persistence')
    updated['version'] = overlay.digest(json.dumps(updated['assets'], sort_keys=True).encode())[:12]
    (args.out / 'boot-manifest.json').write_text(json.dumps(updated, indent=2) + '\n')
    preservation = [{'path': row['name'], 'recordSha256': overlay.digest(row['raw']), 'bytes': len(row['data']), 'mode': oct(row['mode'])} for row in preserved]
    (args.out / 'preserved-records.json').write_text(json.dumps(preservation, indent=2) + '\n')
    report = {'candidateOnly': True, 'productionAccepted': False, 'sourcePlainSha256': manifest['assets']['plain']['sha256'],
              'archiveSha256': updated['assets']['plain']['sha256'], 'archiveBytes': image.stat().st_size,
              'version': updated['version'], 'firefoxAssetUnchanged': updated['assets']['firefox'] == manifest['assets']['firefox'],
              'packages': packages, 'compatibility': package['compatibility'], 'nativeHelperSha256': package['nativeHelperSha256'],
              'nativeSudoSha256': sudo_receipt['sha256'], 'legacyMetadata': legacy,
              'preservedUnmanagedRecords': len(preserved), 'preservedRecordsManifestSha256': overlay.sha(args.out / 'preserved-records.json'),
              'managedFiles': {name: {'bytes': len(data), 'sha256': overlay.digest(data), 'mode': oct(mode), 'packageOwner': owners.get(name), 'replacesExisting': name in base} for name, (mode, data) in files.items()},
              'pendingGates': ['actual plain desktop and console launches', 'native signed package add/save/Stop/restart', 'interactive recovery', 'unchanged unmanaged desktop usability']}
    (args.out / 'composition.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['candidateOnly', 'archiveSha256', 'archiveBytes', 'version', 'firefoxAssetUnchanged', 'preservedUnmanagedRecords']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for argument in ['base', 'manifest', 'console', 'console-manifest', 'reference-package', 'repo', 'host-apk', 'kernel', 'helper', 'sudo', 'sudo-receipt', 'out']:
        parser.add_argument('--' + argument, type=pathlib.Path, required=True)
    build(parser.parse_args())
