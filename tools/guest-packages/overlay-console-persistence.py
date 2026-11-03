#!/usr/bin/env python3
"""Overlay the native helper onto the verified small console, never publish it."""
import argparse
import copy
import gzip
import hashlib
import importlib.util
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('overlay', HERE / 'overlay-persistence.py')
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)

ANCHOR = '/bin/busybox mkdir -p /home/admin\n'
OLD_BANNER = "Linux package console: real wasm32 Linux; /home persists, package installs reset on restart."
NEW_BANNER = "Linux package console: real wasm32 Linux; /home persists. Use apk-persist add/del/save for signed package generations."
HOOK = '''# Replay exact signed packages before the console advertises normal readiness.
if ! /usr/sbin/apk-persist restore; then
 /bin/busybox echo 'apk-persist: RESTORE FAILED; package console is in recovery mode.' >&2
 /bin/busybox echo 'APK_PERSIST_RECOVERY_REQUIRED' >&2
 /bin/busybox echo 'Recovery: apk-persist disable, then Stop and Start. Saved generations and user files are retained.' >&2
 export PS1='linux:/home/admin # '
 cd /home/admin
 exec /bin/busybox setsid /bin/busybox cttyhack /bin/busybox sh
fi
'''


def build(args):
    manifest = json.loads(args.console_manifest.read_text())
    reference = json.loads(args.reference_manifest.read_text())
    package = json.loads(args.reference_package.read_text())
    if manifest.get('guestMemoryBytes') != 536870912:
        raise ValueError('accepted 512MiB console configuration required')
    if overlay.sha(args.console) != manifest['image']['sha256'] or args.console.stat().st_size != manifest['image']['bytes']:
        raise ValueError('console image differs from its pinned manifest')
    if overlay.sha(args.kernel) != reference['assets']['kernel']['sha256']:
        raise ValueError('kernel differs from reference package ABI')
    helper = args.helper.read_bytes()
    if helper[:8] != b'\0asm\x01\0\0\0' or hashlib.sha256(helper).hexdigest() != package['nativeHelperSha256']:
        raise ValueError('exact default accepted helper required; test helper rejected')
    original, maxino = overlay.scan(args.console)
    files = overlay.metadata_files(original, reference)
    compatibility = json.loads(files['etc/linuxonweb-packages/compatibility'][1])
    if compatibility != package['compatibility']:
        raise ValueError('console base package/trust/kernel identity is not compatible with Firefox')
    script = original['init'][1].decode()
    if script.count(ANCHOR) != 1 or script.count(OLD_BANNER) != 1 or '/usr/sbin/apk-persist' in script:
        raise ValueError('reviewed console init anchors missing or changed')
    patched = script.replace(ANCHOR, ANCHOR + HOOK, 1).replace(OLD_BANNER, NEW_BANNER, 1).encode()
    files.update({
        'init': (0o100755, patched),
        'usr/sbin/apk-persist': (0o100755, helper),
        'usr/share/doc/linuxonweb-packages/PERSISTENCE.txt': (0o100644, (HERE / 'PERSISTENCE.md').read_bytes()),
    })
    directories = set()
    for name in files:
        parent = pathlib.PurePosixPath(name).parent
        while str(parent) != '.':
            directories.add(str(parent))
            parent = parent.parent
    ino = maxino + 1
    chunks = []
    for directory in sorted(directories, key=lambda name: (name.count('/'), name)):
        chunks.append(overlay.cpio.entry(directory, mode=0o040755, ino=ino))
        ino += 1
    for name, (mode, data) in sorted(files.items()):
        chunks.append(overlay.cpio.entry(name, data, mode, ino))
        ino += 1
    chunks.append(overlay.cpio.entry('TRAILER!!!', mode=0, ino=ino))
    extra = b''.join(chunks)
    extra += b'\0' * (-len(extra) % 512)
    args.out.mkdir(parents=True, exist_ok=False)
    image = args.out / 'package-console.cpio.gz'
    decoded_bytes = 0
    with gzip.open(args.console, 'rb') as source, image.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0, compresslevel=6) as target:
        while data := source.read(1048576):
            target.write(data)
            decoded_bytes += len(data)
        target.write(extra)
        decoded_bytes += len(extra)
    updated = copy.deepcopy(manifest)
    updated['image'].update(url='./package-console.cpio.gz', bytes=image.stat().st_size, sha256=overlay.sha(image))
    updated.update(rootfsPayloadBytes=decoded_bytes,
                   persistence='explicit native apk-persist signed generations and persistent home; ordinary apk alone is session-only',
                   nativeHelperSha256=package['nativeHelperSha256'],
                   packageCompatibility=compatibility,
                   androidAccepted=False, iosAccepted=False)
    (args.out / 'console-manifest.json').write_text(json.dumps(updated, indent=2) + '\n')
    report = {
        'candidateOnly': True, 'productionAccepted': False,
        'sourceConsoleSha256': manifest['image']['sha256'],
        'archiveSha256': updated['image']['sha256'], 'archiveBytes': updated['image']['bytes'],
        'gzipMembers': 1, 'rootfsPayloadBytes': decoded_bytes,
        'nativeHelperSha256': package['nativeHelperSha256'],
        'exactFirefoxPackageCompatibility': True, 'compatibility': compatibility,
        'originalInitSha256': hashlib.sha256(original['init'][1]).hexdigest(),
        'patchedInitSha256': hashlib.sha256(patched).hexdigest(),
        'overlayFiles': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'mode': oct(mode)} for name, (mode, data) in files.items()},
        'pendingGates': ['normal console signed install/save/restart', 'actual recovery input and clear recovery UI', 'Android HTTPS worker/native command/Python duration with 1CPU512MiB'],
    }
    (args.out / 'composition.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['candidateOnly', 'archiveSha256', 'archiveBytes', 'rootfsPayloadBytes', 'nativeHelperSha256']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['console', 'console-manifest', 'reference-manifest', 'reference-package', 'kernel', 'helper', 'out']:
        parser.add_argument('--' + name, type=pathlib.Path, required=True)
    build(parser.parse_args())
