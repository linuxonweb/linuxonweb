#!/usr/bin/env python3
"""Compose an isolated package-persistence candidate; never publish automatically.

The pinned input archive is copied as decoded CPIO records, followed by a small
reviewed overlay, then encoded as one gzip member for production Chromium.
"""
import argparse
import copy
import gzip
import hashlib
import importlib.util
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('smoke', HERE / 'make-smoke.py')
cpio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cpio)

HOOK = '''
# Signed package generations are restored before desktop processes can run.
# Recovery is explicit; an incompatible/corrupt generation never silently falls back.
if grep -qw 'home.persistent=1' /proc/cmdline; then
  if grep -qw 'packages.base=1' /proc/cmdline; then
    echo 'apk-persist: explicit base-only boot; saved generations retained' >&2
  elif ! /usr/sbin/apk-persist restore; then
    echo 'apk-persist: RESTORE FAILED; desktop startup stopped' >&2
    echo 'Recovery: apk-persist disable; then Stop and Start. Saved generations are retained.' >&2
    exec setsid cttyhack sh
  fi
fi

'''
ANCHOR = '# Give the guest desktop account access to the devices used by TinyX/input.\n'


def sha(path):
    with pathlib.Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def scan(archive):
    wanted = {'init', 'etc/apk/world', 'lib/apk/db/installed', 'sbin/apk', 'bin/busybox'}
    records = {}
    maxino = 1
    with pathlib.Path(archive).open('rb') as raw:
        compressed = raw.read(2) == b'\x1f\x8b'
    opener = gzip.open if compressed else open
    with opener(archive, 'rb') as stream:
        while True:
            first = stream.read(1)
            while first == b'\0':
                first = stream.read(1)
            if not first:
                break
            header = first + cpio.read_exact(stream, 109)
            if header[:6] not in (b'070701', b'070702'):
                raise ValueError('invalid input newc stream')
            mode, size, namesize = (int(header[a:b], 16) for a, b in ((14, 22), (54, 62), (94, 102)))
            maxino = max(maxino, int(header[6:14], 16))
            name = cpio.read_exact(stream, namesize).rstrip(b'\0').decode().removeprefix('./')
            cpio.read_exact(stream, (-(110 + namesize)) % 4)
            keep = name in wanted or name.startswith('etc/apk/keys/') or name.startswith('lib/apk/db/')
            if keep:
                data = cpio.read_exact(stream, size)
                records[name] = (mode, data)
            else:
                remaining = size
                while remaining:
                    part = cpio.read_exact(stream, min(remaining, 1048576))
                    remaining -= len(part)
            cpio.read_exact(stream, (-size) % 4)
    return records, maxino


def metadata_files(original, manifest):
    installed = original['lib/apk/db/installed'][1].decode()
    packages = []
    for block in installed.strip().split('\n\n'):
        values = dict(line.split(':', 1) for line in block.splitlines() if line[:2] in ('P:', 'V:', 'C:'))
        packages.append((values['P'], values['V'], values['C']))
    if {p for p, v, c in packages} != {'apk-tools', 'busybox', 'ca-certificates', 'curl'}:
        raise ValueError('persistence v1 requires the reviewed four-package base')
    base_inventory = ''.join(f'{p} {v} {c}\n' for p, v, c in sorted(packages)).encode()
    keys = sorted((name, data) for name, (mode, data) in original.items() if name.startswith('etc/apk/keys/') and (mode & 0o170000) == 0o100000)
    if not keys:
        raise ValueError('no image signing trust')
    trust = ''.join(f'{digest(data)}  {name}\n' for name, data in keys).encode()
    compatibility = json.dumps({'schema': 1, 'packageTarget': 'wasm32-linux-musl',
        'kernelSha256': manifest['assets']['kernel']['sha256'],
        'apkNativeSha256': digest(original['sbin/apk'][1]),
        'busyboxNativeSha256': digest(original['bin/busybox'][1]),
        'baseInventorySha256': digest(base_inventory), 'baseInstalledDatabaseSha256': digest(original['lib/apk/db/installed'][1]), 'signingTrustSha256': digest(trust)}, sort_keys=True, indent=2).encode() + b'\n'
    return {'etc/linuxonweb-packages/compatibility': (0o100644, compatibility),
            'etc/linuxonweb-packages/installed': (0o100644, base_inventory),
            'etc/linuxonweb-packages/trust.sha256': (0o100644, trust),
            'etc/linuxonweb-packages/base-world': (0o100644, original['etc/apk/world'][1])}


def build(base, manifest_path, kernel, helper, out):
    helper_data = helper.read_bytes()
    if helper_data[:8] != b"\0asm\x01\0\0\0":
        raise ValueError("native checked Wasm helper required; shell prototype is rejected")
    manifest = json.loads(manifest_path.read_text())
    if sha(base) != manifest['assets']['firefox']['sha256']:
        raise ValueError('input image differs from pinned manifest')
    if sha(kernel) != manifest['assets']['kernel']['sha256']:
        raise ValueError('kernel differs from pinned manifest')
    original, maxino = scan(base)
    init = original['init'][1]
    script = init.decode()
    if script.count(ANCHOR) != 1 or 'Signed package generations are restored' in script:
        raise ValueError('reviewed init hook anchor not unique or already patched')
    patched = script.replace(ANCHOR, HOOK + ANCHOR, 1).encode()
    files = metadata_files(original, manifest)
    compatibility = files['etc/linuxonweb-packages/compatibility'][1]
    files.update({'init': (0o100755, patched),
                  'usr/sbin/apk-persist': (0o100755, helper_data),
                  'etc/linuxonweb-packages/source-image': (0o100644, (manifest['version'] + '\n' + sha(base) + '\n').encode())})
    dirs = set()
    for name in files:
        parent = pathlib.PurePosixPath(name).parent
        while str(parent) != '.':
            dirs.add(str(parent)); parent = parent.parent
    chunks = []
    ino = maxino + 1
    for directory in sorted(dirs, key=lambda n: (n.count('/'), n)):
        chunks.append(cpio.entry(directory, mode=0o040755, ino=ino)); ino += 1
    for name, (mode, data) in sorted(files.items()):
        chunks.append(cpio.entry(name, data, mode, ino)); ino += 1
    chunks.append(cpio.entry('TRAILER!!!', mode=0, ino=ino))
    overlay = b''.join(chunks)
    overlay += b'\0' * (-len(overlay) % 512)
    out.mkdir(parents=True, exist_ok=False)
    archive = out / 'initramfs-firefox.cpio.gz'
    decoded = hashlib.sha256()
    decoded_bytes = 0
    with gzip.open(base, 'rb') as source, archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='', compresslevel=6) as target:
        while data := source.read(1048576):
            decoded.update(data); decoded_bytes += len(data); target.write(data)
        decoded.update(overlay); decoded_bytes += len(overlay); target.write(overlay)
    new = copy.deepcopy(manifest)
    new['assets']['firefox'].update(bytes=archive.stat().st_size, sha256=sha(archive), label='Firefox with explicit signed package persistence')
    new['version'] = digest(json.dumps(new['assets'], sort_keys=True).encode())[:12]
    (out / 'boot-manifest.json').write_text(json.dumps(new, indent=2) + '\n')
    report = {'candidateOnly': True, 'productionAccepted': False, 'inputArchiveSha256': sha(base),
              'inputVersion': manifest['version'], 'archiveSha256': sha(archive), 'version': new['version'],
              'gzipMembers': 1, 'decodedSha256': decoded.hexdigest(), 'decodedBytes': decoded_bytes,
              'originalInitSha256': digest(init), 'patchedInitSha256': digest(patched),
              'nativeHelperSha256': digest(helper_data), 'nativeHelperBytes': len(helper_data),
              'compatibility': json.loads(compatibility), 'overlayFiles': sorted(files),
              'scope': 'explicit apk-persist commands; native apk alone is ephemeral; package scripts replay; manual changes outside /home are not persisted',
              'pendingGates': ['native helper primitives', 'offline two-boot signed replay with payload/database/world coherence', 'bad signature/corrupt generation and incompatible base recovery', 'interrupted save preservation', 'actual production decompression/composition/desktop/Stop']}
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('candidateOnly', 'inputVersion', 'archiveSha256', 'version', 'gzipMembers')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('base', 'manifest', 'kernel', 'helper', 'out'):
        parser.add_argument('--' + name, type=pathlib.Path, required=True)
    args = parser.parse_args()
    build(args.base, args.manifest, args.kernel, args.helper, args.out)
