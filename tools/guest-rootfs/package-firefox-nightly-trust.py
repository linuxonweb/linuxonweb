#!/usr/bin/env python3
"""Preparatory init-only static Nightly trust bootstrap adapter.

This archive still contains the input browser. Never boot, promote or deploy it
alone: use it as the source for package-firefox-nightly.py, then the GPU page
overlay, and require separate real Nightly NSS/guest acceptance.
"""
import argparse
import copy
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('nightly_trust_base', Path(__file__).with_name('package-aurora-ready.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TASK = Path('/mnt/p6/build/firefox-nightly-trust-package-20261002')
PUBLIC_V10_SHA = 'ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745'
INIT_SHA = '413549e4d0156d3016ad9f39a2dd83f6aebaa44b05e40d3e296361be577422c0'
ADAPTED_INIT_SHA = '55d55013be46cb13541320943ef03c50a43580bf69dd5d4c425963a41a5d8803'
OLD_SEED = b'''  for profile_file in cert9.db key4.db pkcs11.txt; do
    if [ ! -e "/home/admin/.mozilla/firefox/http1-profile/$profile_file" ]; then
      cp "/nss-ca-profile/$profile_file" /home/admin/.mozilla/firefox/http1-profile/
    fi
  done
  echo "[NSS_CA_DB] imported profile root store" >&2
  ls -l /home/admin/.mozilla/firefox/http1-profile/cert9.db /home/admin/.mozilla/firefox/http1-profile/key4.db /home/admin/.mozilla/firefox/http1-profile/pkcs11.txt >&2
'''
NEW_SEED = b'''  # Nightly uses its statically linked Rust trust-anchors PKCS#11 module.
  # NSS creates fresh databases itself; existing profile trust is left intact.
  echo "[NSS_CA_DB] static Nightly roots; preserving existing profile databases" >&2
'''
OLD_CHOWN = b'  chown 1000:1000 /home/admin/.mozilla/firefox /home/admin/.mozilla/firefox/http1-profile /home/admin/.mozilla/firefox/http1-profile/chrome /home/admin/.mozilla/firefox/http1-profile/user.js /home/admin/.mozilla/firefox/http1-profile/cert9.db /home/admin/.mozilla/firefox/http1-profile/key4.db /home/admin/.mozilla/firefox/http1-profile/pkcs11.txt /home/admin/.mozilla/firefox/http1-profile/chrome/userChrome.css\n'
NEW_CHOWN = b'  chown 1000:1000 /home/admin/.mozilla/firefox /home/admin/.mozilla/firefox/http1-profile /home/admin/.mozilla/firefox/http1-profile/chrome /home/admin/.mozilla/firefox/http1-profile/user.js /home/admin/.mozilla/firefox/http1-profile/chrome/userChrome.css\n'
MAX_RECORD_BYTES = 512 * 1024**2
ALLOWANCE = 2 * 1024**3
RESERVE = 20 * 1024**3


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def adapt_init(body):
    if base.digest(body) != INIT_SHA:
        raise ValueError('unknown or already-adapted init SHA-256')
    if body.count(OLD_SEED) != 1 or body.count(OLD_CHOWN) != 1:
        raise ValueError('audited seed and chown anchors must each be unique')
    if NEW_SEED in body or NEW_CHOWN in body:
        raise ValueError('init is already adapted')
    result = body.replace(OLD_SEED, NEW_SEED).replace(OLD_CHOWN, NEW_CHOWN)
    if (result.replace(NEW_SEED, OLD_SEED).replace(NEW_CHOWN, OLD_CHOWN) != body or
            base.digest(result) != ADAPTED_INIT_SHA):
        raise ValueError('change differs from exact audited init draft')
    if b'/nss-ca-profile/' in result or b'profile_file' in result:
        raise ValueError('legacy seed bootstrap reference remains')
    syntax = subprocess.run(['sh', '-n'], input=result, capture_output=True)
    if syntax.returncode:
        raise ValueError('adapted init fails shell syntax: ' + syntax.stderr.decode())
    return result


def exact(stream, count):
    body = stream.read(count)
    if len(body) != count:
        raise ValueError('truncated newc archive')
    return body


def records(stream):
    """Keep exact encoded records, rejecting malformed or aliased paths."""
    seen = set()
    while True:
        header = exact(stream, 110)
        if header[:6] != b'070701' or not re.fullmatch(b'[0-9a-fA-F]{104}', header[6:]):
            raise ValueError('invalid newc header')
        fields = [int(header[6 + i * 8:14 + i * 8], 16) for i in range(13)]
        size, namesize = fields[6], fields[11]
        if not 1 <= namesize <= 4096 or size > MAX_RECORD_BYTES or fields[12] != 0:
            raise ValueError('invalid newc name/record size or checksum')
        name = exact(stream, namesize)
        if not name.endswith(b'\0') or b'\0' in name[:-1]:
            raise ValueError('invalid newc name')
        key = name[:-1].decode('utf-8').removeprefix('./')
        if (not key or key.startswith('/') or (key != '.' and
                any(part in {'', '.', '..'} for part in key.split('/'))) or key in seen):
            raise ValueError('unsafe or duplicate newc path: ' + key)
        seen.add(key)
        namepad = exact(stream, -(110 + namesize) % 4)
        body = exact(stream, size)
        bodypad = exact(stream, -size % 4)
        yield key, fields, body, header + name + namepad + body + bodypad
        if key == 'TRAILER!!!':
            if size:
                raise ValueError('nonempty newc trailer')
            return


def replace_body(encoded, body):
    namesize = int(encoded[94:102], 16)
    start = 110 + namesize
    start += -start % 4
    return (encoded[:54] + f'{len(body):08x}'.encode() + encoded[62:start] +
            body + b'\0' * (-len(body) % 4))


def summary(key, fields, body, encoded):
    namesize = fields[11]
    start = 110 + namesize
    start += -start % 4
    return {'name': key, 'bytes': len(body), 'fields': fields,
            'sha256': base.digest(body), 'recordSha256': base.digest(encoded),
            'metadataExceptSizeSHA256': base.digest(encoded[:54] + encoded[62:start]),
            'encodedBytes': len(encoded)}


def inventory(path):
    rows = []
    init = None
    with gzip.open(path, 'rb') as stream:
        for key, fields, body, encoded in records(stream):
            rows.append(summary(key, fields, body, encoded))
            if key == 'init':
                if not stat.S_ISREG(fields[1]) or fields[4] != 1:
                    raise ValueError('init must be a unique regular file, without hardlinks')
                init = body
        tail = hashlib.sha256()
        tail_bytes = 0
        while chunk := stream.read(1024 * 1024):
            tail.update(chunk)
            tail_bytes += len(chunk)
    if init is None:
        raise ValueError('missing init record')
    return rows, {'bytes': tail_bytes, 'sha256': tail.hexdigest()}, init


def verify_preservation(before, after, old_tail, new_tail):
    if [r['name'] for r in before] != [r['name'] for r in after]:
        raise ValueError('independent audit: record paths/order changed')
    changed = [a['name'] for a, b in zip(before, after) if a != b]
    if changed != ['init'] or old_tail != new_tail:
        raise ValueError('independent audit: record outside init or tail changed')
    old_init = next(r for r in before if r['name'] == 'init')
    new_init = next(r for r in after if r['name'] == 'init')
    if (old_init['metadataExceptSizeSHA256'] != new_init['metadataExceptSizeSHA256'] or
            old_init['fields'][:6] + old_init['fields'][7:] !=
            new_init['fields'][:6] + new_init['fields'][7:] or
            old_init['sha256'] != INIT_SHA or new_init['sha256'] != ADAPTED_INIT_SHA):
        raise ValueError('independent audit: init metadata or exact body mismatch')
    unchanged = [r for r in before if r['name'] != 'init']
    return {'modifiedRecords': changed, 'unchangedRecords': len(unchanged),
            'totalRecords': len(before), 'allOutsideInitEncodedRecordsIdentical': True,
            'outsideInitEncodedInventorySHA256': base.digest(canonical(unchanged)),
            'originalOrderPreserved': True, 'initMetadataExceptBodySizePreserved': True,
            'tailPreserved': True, 'tail': old_tail}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'manifest', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('source-sha256', 'manifest-sha256'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    task, out = TASK.resolve(strict=True), args.output.resolve()
    if (args.output.is_symlink() or out.exists() or out == task or
            not out.is_relative_to(task) or not out.parent.is_dir()):
        parser.error('fresh output below dedicated task required')
    filesystems, scratch = {}, {}
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        path = Path(os.environ.get(key, '/tmp')).resolve(strict=True)
        if not path.is_dir() or not path.is_relative_to(task):
            parser.error(key + ' must be an existing task-owned scratch directory')
        filesystems[str(path)] = base.disk_filesystem(path)
        scratch[key] = str(path)
    for path in (args.source, args.manifest, out.parent):
        filesystems[str(path.resolve())] = base.disk_filesystem(path)
    for path, expected in ((args.source, args.source_sha256), (args.manifest, args.manifest_sha256)):
        if not re.fullmatch('[a-f0-9]{64}', expected) or base.file_digest(path) != expected:
            raise ValueError('explicit input SHA-256 mismatch: ' + str(path))
    manifest = json.loads(args.manifest.read_text())
    asset = manifest['assets']['firefox']
    if asset['bytes'] != args.source.stat().st_size or asset['sha256'] != args.source_sha256:
        raise ValueError('manifest does not describe hash-pinned input archive')
    assets = {}
    for name in ('kernel', 'plain'):
        row = manifest['assets'][name]
        if not re.fullmatch(r'\./[A-Za-z0-9_.-]+', row['url']) or row['url'] in {
                './initramfs-firefox.cpio.gz', './boot-manifest.json', './package.json',
                './package-report.json', './init-before.sh', './init-after.sh',
                './baseline-inventory.json', './archive-inventory.json'}:
            raise ValueError('safe companion asset URL required: ' + name)
        path = (args.manifest.parent / row['url']).resolve(strict=True)
        filesystems[str(path)] = base.disk_filesystem(path)
        if path.stat().st_size != row['bytes'] or base.file_digest(path) != row['sha256']:
            raise ValueError('preserved kernel/plain asset hash mismatch: ' + name)
        assets[name] = path
    if manifest['assets']['kernel']['url'] == manifest['assets']['plain']['url']:
        raise ValueError('companion assets must have distinct URLs')
    before, old_tail, old_init = inventory(args.source)
    new_init = adapt_init(old_init)
    uncompressed = sum(r['encodedBytes'] for r in before) + old_tail['bytes']
    # A conservative gzip upper bound plus inventories, not the old compressed size.
    bound = uncompressed + uncompressed // 100 + 16 * 1024**2
    usage = sum(p.stat().st_size for p in task.rglob('*') if p.is_file() and not p.is_symlink())
    if usage + bound > ALLOWANCE:
        raise ValueError('2 GiB task allowance would be exceeded')
    if shutil.disk_usage(out.parent).free - bound < RESERVE:
        raise ValueError('20 GiB free-space reserve would be exceeded')
    out.mkdir()
    destination = out / 'initramfs-firefox.cpio.gz'
    with gzip.open(args.source, 'rb') as inp, destination.open('xb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) as writer:
            for key, _, body, encoded in records(inp):
                if key == 'init':
                    if body != old_init:
                        raise ValueError('init input changed during packaging')
                    encoded = replace_body(encoded, new_init)
                writer.write(encoded)
            shutil.copyfileobj(inp, writer, 1024 * 1024)
    after, new_tail, audited_init = inventory(destination)
    proof = verify_preservation(before, after, old_tail, new_tail)
    if audited_init != new_init:
        raise ValueError('independent audit: adapted init bytes differ')
    if (base.file_digest(args.source) != args.source_sha256 or
            base.file_digest(args.manifest) != args.manifest_sha256 or
            any(base.file_digest(path) != manifest['assets'][name]['sha256']
                for name, path in assets.items())):
        raise ValueError('pinned input changed during packaging')
    archive_sha = base.file_digest(destination)
    updated = copy.deepcopy(manifest)
    updated['assets']['firefox'].update(bytes=destination.stat().st_size, sha256=archive_sha,
                                      label='PREPARATORY ONLY: static Nightly trust init; input browser retained')
    updated['version'] = 'prep-nightly-trust-' + archive_sha[:16]
    updated.pop('previous', None)
    # Keep asset descriptors exact and make the next packager's input verification
    # possible without copying or changing the accepted system assets.
    for name, path in assets.items():
        (out / manifest['assets'][name]['url']).symlink_to(path)
    manifest_output = out / 'boot-manifest.json'
    manifest_output.write_text(json.dumps(updated, indent=2) + '\n')
    (out / 'baseline-inventory.json').write_text(json.dumps(before, indent=2) + '\n')
    (out / 'archive-inventory.json').write_text(json.dumps(after, indent=2) + '\n')
    (out / 'init-before.sh').write_bytes(old_init)
    (out / 'init-after.sh').write_bytes(new_init)
    report = {'schema': 1, 'stage': 'preparatory-static-nightly-trust-init',
              'passPackage': True, 'candidateOnly': True, 'runtimeAcceptance': False,
              'guestAcceptance': False, 'tlsAcceptance': False, 'mustNotRunStandalone': True,
              'browserRuntimeChanged': False, 'legacySeedCopiedAtStartup': False,
              'sourceArchiveSHA256': args.source_sha256, 'sourceSha256': args.source_sha256,
              'sourceManifestSHA256': args.manifest_sha256, 'sourceManifestSha256': args.manifest_sha256,
              'sourceInitSHA256': INIT_SHA, 'outputInitSHA256': ADAPTED_INIT_SHA,
              'archiveSHA256': archive_sha, 'archiveSha256': archive_sha,
              'archiveBytes': destination.stat().st_size, 'bytes': destination.stat().st_size,
              'outputManifestSHA256': base.file_digest(manifest_output),
              'sourceVersion': manifest['version'], 'version': updated['version'],
              'inputMatchesPublicV10': args.source_sha256 == PUBLIC_V10_SHA,
              'publicV10ArchiveSHA256': PUBLIC_V10_SHA, 'recordIdentityProof': proof,
              'preservedSystemAssets': {name: {'descriptor': manifest['assets'][name],
                  'source': str(path), 'outputReadOnlyReference': manifest['assets'][name]['url']}
                  for name, path in assets.items()},
              'shellSyntax': {'argv': ['sh', '-n'], 'exitCode': 0},
              'source': str(args.source.resolve()), 'manifest': str(args.manifest.resolve()),
              'packagerSHA256': base.file_digest(Path(__file__)),
              'filesystems': filesystems, 'scratch': scratch,
              'pending': ['complete-native-Wasm-Nightly-runtime-and-fpcast', 'GPU-default-page-overlay',
                          'linked-static-NSS-module-ABI-and-current-DER-purpose-date-inventory',
                          'fresh-and-existing-profile-TLS-acceptance', 'host-count-guest-gates',
                          'native-Wasm-JIT', 'guest-GPU']}
    for name in ('package-report.json', 'package.json'):
        (out / name).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'candidateOnly': True, 'runtimeAcceptance': False,
                      'mustNotRunStandalone': True, 'output': str(out), 'archiveSHA256': archive_sha}))


if __name__ == '__main__':
    main()
