#!/usr/bin/env python3
"""Replace the complete Firefox runtime in an isolated, audited newc archive.

No build, promotion or guest acceptance is performed. See the package doc for
the required caller-reviewed full-build/fpcast evidence schema.
"""
import argparse
import configparser
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
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('nightly_package_base', Path(__file__).with_name('package-aurora-ready.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TASK = Path('/mnt/p6/build/firefox-nightly-package-20261002')
PREFIX = 'opt/firefox'
PREFS = {'network.process.enabled': False, 'dom.ipc.processCount': 1,
         'fission.autostart': False, 'layout.css.shared-memory-ua-sheets.enabled': False}
PREF_BODY = ('// Native Wasm Linux single-process and mmap adapters.\n' +
             ''.join(f'pref({json.dumps(k)}, {json.dumps(v)});\n' for k, v in PREFS.items())).encode()
CRITICAL = {'init', 'bin/firefox', 'nss-ca-profile/cert9.db', 'nss-ca-profile/key4.db',
            'nss-ca-profile/pkcs11.txt', 'etc/ssl/cert.pem',
            'lowland-OpenSans-Regular.ttf', 'lowland-userChrome.css'}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(path):
    return base.file_digest(path)


def exact(stream, count):
    data = stream.read(count)
    if len(data) != count:
        raise ValueError('truncated newc archive')
    return data


def cpio(stream):
    """Bounded by one record rather than by the complete uncompressed image."""
    seen = set()
    while True:
        header = exact(stream, 110)
        if header[:6] != b'070701':
            raise ValueError('expected newc archive')
        fields = [int(header[6 + i * 8:14 + i * 8], 16) for i in range(13)]
        size, namesize = fields[6], fields[11]
        if not 1 <= namesize <= 4096:
            raise ValueError('invalid name size')
        name = exact(stream, namesize)
        if not name.endswith(b'\0') or b'\0' in name[:-1]:
            raise ValueError('invalid archive name')
        key = name[:-1].decode().removeprefix('./')
        if key.startswith('/') or '..' in key.split('/') or key in seen:
            raise ValueError('unsafe or duplicate archive path: ' + key)
        seen.add(key)
        namepad = exact(stream, -(110 + namesize) % 4)
        body = exact(stream, size)
        padding = exact(stream, -size % 4)
        encoded = header + name + namepad + body + padding
        yield key, fields, body, encoded
        if key == 'TRAILER!!!':
            if body: raise ValueError('nonempty trailer')
            return


def encode(name, mode, body, inode):
    name = name.encode() + b'\0'
    fields = [inode, mode, 0, 0, 2 if stat.S_ISDIR(mode) else 1, 0,
              len(body), 0, 0, 0, 0, len(name), 0]
    header = b'070701' + b''.join(f'{n:08x}'.encode() for n in fields)
    return header + name + b'\0' * (-(110 + len(name)) % 4) + body + b'\0' * (-len(body) % 4)


def summary(key, fields, body, encoded):
    return {'name': key, 'mode': fields[1], 'bytes': len(body),
            'sha256': base.digest(body), 'recordSha256': base.digest(encoded)}


def inventory_archive(path):
    rows = []
    with gzip.open(path, 'rb') as stream:
        for key, fields, body, encoded in cpio(stream):
            rows.append(summary(key, fields, body, encoded))
        tail = hashlib.file_digest(stream, 'sha256').hexdigest()
    return rows, tail


def runtime_inventory(runtime, source_root, object_root):
    """Materialize dist symlinks, allowing only this source/object tree.

    Directory symlinks are walked with cycle detection. No host links survive
    into the guest; modes are normalized while keeping file execute bits.
    """
    roots = (source_root.resolve(strict=True), object_root.resolve(strict=True))
    runtime = runtime.resolve(strict=True)
    if not runtime.is_relative_to(roots[1]):
        raise ValueError('runtime must be inside the owned object tree')
    rows = []
    paths = {}

    def walk(path, relative, ancestry):
        resolved = path.resolve(strict=True)
        if not any(resolved.is_relative_to(root) for root in roots):
            raise ValueError('runtime symlink escapes source/object tree: ' + relative)
        info = resolved.stat()
        if info.st_mode & 0o7000:
            raise ValueError('special permission bits forbidden: ' + relative)
        if stat.S_ISDIR(info.st_mode):
            if resolved in ancestry:
                raise ValueError('runtime directory symlink cycle: ' + relative)
            row = {'name': relative, 'mode': 0o40755, 'bytes': 0, 'sha256': base.digest(b'')}
            rows.append(row)
            paths[relative] = None
            for child in sorted(resolved.iterdir(), key=lambda p: p.name):
                walk(child, relative + '/' + child.name if relative else child.name, ancestry | {resolved})
        elif stat.S_ISREG(info.st_mode):
            if resolved.suffix in {'.js', '.mjs', '.json', '.ini', '.css', '.html', '.manifest'}:
                if b'/mnt/p6/' in resolved.read_bytes():
                    raise ValueError('host task path in installed resource: ' + relative)
            row = {'name': relative, 'mode': 0o100755 if info.st_mode & 0o111 else 0o100644,
                   'bytes': info.st_size, 'sha256': sha(resolved)}
            rows.append(row)
            paths[relative] = resolved
        else:
            raise ValueError('runtime contains a special file: ' + relative)
    walk(runtime, '', set())
    if len({r['name'] for r in rows}) != len(rows):
        raise ValueError('duplicate runtime path')
    return rows, paths


def check_stamps(paths, identity):
    result = {}
    for name, section in [('application.ini', 'App'), ('platform.ini', 'Build')]:
        path = paths.get(name)
        if path is None:
            raise ValueError('complete Nightly runtime missing ' + name)
        parser = configparser.ConfigParser(interpolation=None)
        parser.read_string(path.read_text())
        data = parser[section]
        version = data['Version' if section == 'App' else 'Milestone']
        if (version != identity['version'] or data['BuildID'] != identity['localBuildID'] or
                data['SourceStamp'] != identity['hgRevision']):
            raise ValueError('Nightly application/platform/source stamps mismatch: ' + name)
        result[name] = {'version': version, 'buildID': data['BuildID'], 'sourceStamp': data['SourceStamp']}
    return result


def check_prefs(source_root):
    definitions = [source_root / p for p in ['modules/libpref/init/StaticPrefList.yaml',
                   'modules/libpref/init/all.js', 'browser/app/profile/firefox.js']]
    texts = {p: p.read_text() for p in definitions}
    proof = {}
    for key in PREFS:
        pattern = (r'^\s*- name: ' + re.escape(key) + r'\s*$|'
                   r'\bpref\(\s*["\x27]' + re.escape(key) + r'["\x27]\s*,')
        matches = [p for p, text in texts.items() if re.search(pattern, text, re.M)]
        if not matches:
            raise ValueError('guest adapter preference absent in current source: ' + key)
        proof[key] = [{'path': p.relative_to(source_root).as_posix(), 'sha256': sha(p)} for p in matches]
    return proof


def guest_defaults(before):
    """Keep unrelated current-build defaults, replacing only managed keys."""
    text = before.decode('utf-8')
    for key in PREFS:
        pattern = (r'^\s*pref\(\s*(["\x27])' + re.escape(key) +
                   r'\1\s*,[^;]*\);[^\n]*(?:\n|$)')
        text = re.sub(pattern, '', text, flags=re.M)
        if re.search(r'["\x27]' + re.escape(key) + r'["\x27]\s*,', text):
            raise ValueError('unrecognized existing guest default syntax: ' + key)
    return (text.encode() + (b'\n' if text and not text.endswith('\n') else b'') + PREF_BODY)


def verify_evidence(evidence, identity_sha, runtime_sha, raw_binary_sha, final_binary_sha):
    expected = {'schema': 1, 'completeBuild': True, 'sourceIdentitySHA256': identity_sha,
                'runtimeInventorySHA256': runtime_sha, 'rawBinarySHA256': raw_binary_sha,
                'finalBinarySHA256': final_binary_sha}
    for key, value in expected.items():
        if evidence.get(key) != value:
            raise ValueError('build evidence mismatch: ' + key)
    commands = evidence.get('commands', {})
    for name in ('fullBuild', 'fpcast', 'structuralValidation'):
        entry = commands.get(name, {})
        argv = entry.get('argv', [])
        if entry.get('exitCode') != 0 or not isinstance(argv, list) or not argv:
            raise ValueError('successful command evidence required: ' + name)
        if name == 'fpcast' and ('--fpcast-emu' not in argv or '--pass-arg=max-func-params@23' not in argv):
            raise ValueError('23-parameter fpcast command evidence required')
        if name == 'structuralValidation' and Path(argv[0]).name not in ('wasm-validate', 'wasm-opt'):
            raise ValueError('complete Wasm validator command required')
        log = Path(entry['log']).resolve(strict=True)
        base.disk_filesystem(log)
        if sha(log) != entry.get('logSHA256'):
            raise ValueError('command log hash mismatch: ' + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'manifest', 'source-root', 'object-root', 'runtime', 'source-identity', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('source-sha256', 'manifest-sha256', 'source-identity-sha256'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--inventory-only', action='store_true', help='write preflight inventory; never a runnable archive')
    parser.add_argument('--binary', type=Path, help='final structurally validated/fpcast Nightly Wasm binary')
    parser.add_argument('--build-evidence', type=Path)
    parser.add_argument('--build-evidence-sha256')
    args = parser.parse_args()
    task, out = TASK.resolve(strict=True), args.output.resolve()
    if args.output.is_symlink() or out.exists() or out == task or not out.is_relative_to(task) or not out.parent.is_dir():
        parser.error('fresh output under the dedicated disk-backed task required')
    filesystems = {}
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        p = Path(os.environ.get(key, '/tmp')).resolve(strict=True)
        if not p.is_relative_to(task) or not p.is_dir():
            parser.error(key + ' must be an existing task-owned scratch directory')
        filesystems[str(p)] = base.disk_filesystem(p)
    for path in (args.source, args.manifest, args.source_root, args.object_root, args.source_identity, out.parent):
        filesystems[str(path.resolve())] = base.disk_filesystem(path)
    for path, expected in [(args.source, args.source_sha256), (args.manifest, args.manifest_sha256),
                           (args.source_identity, args.source_identity_sha256)]:
        if not re.fullmatch('[a-f0-9]{64}', expected) or sha(path) != expected:
            raise ValueError('explicit input hash mismatch: ' + str(path))
    manifest = json.loads(args.manifest.read_text())
    asset = manifest['assets']['firefox']
    if asset['bytes'] != args.source.stat().st_size or asset['sha256'] != args.source_sha256:
        raise ValueError('manifest does not describe accepted source archive')
    for name in ('kernel', 'plain'):
        record = manifest['assets'][name]
        asset_path = args.manifest.parent / record['url']
        filesystems[str(asset_path.resolve())] = base.disk_filesystem(asset_path)
        if asset_path.stat().st_size != record['bytes'] or sha(asset_path) != record['sha256']:
            raise ValueError('preserved kernel/plain asset mismatch: ' + name)
    identity = json.loads(args.source_identity.read_text())
    if identity['version'] != '159.0a1' or not re.fullmatch('[0-9]{14}', identity['localBuildID']):
        raise ValueError('expected reviewed Nightly159 source identity')
    milestone = (args.source_root / 'config/milestone.txt').read_text().splitlines()
    if identity['version'] not in [line.strip() for line in milestone if not line.startswith('#')]:
        raise ValueError('source milestone mismatch')
    rows, paths = runtime_inventory(args.runtime, args.source_root, args.object_root)
    if paths.get('firefox') is None:
        raise ValueError('complete build missing native Wasm Firefox binary')
    with paths['firefox'].open('rb') as stream:
        if stream.read(8) != b'\0asm\x01\0\0\0':
            raise ValueError('complete build missing native Wasm Firefox binary')
    stamps = check_stamps(paths, identity)
    if not (paths.get('omni.ja') and paths.get('browser/omni.ja')):
        # Unpacked development dist layout: require both complete resource roots.
        if not all(any(r['name'].startswith(prefix) and r['bytes'] for r in rows)
                   for prefix in ('chrome/', 'browser/chrome/')):
            raise ValueError('complete toolkit/browser resources missing')
    prefs_proof = check_prefs(args.source_root)
    inventory_sha = base.digest(canonical(rows))
    if args.inventory_only:
        out.mkdir()
        (out / 'runtime-inventory.json').write_text(json.dumps(rows, indent=2) + '\n')
        report = {'inventoryOnly': True, 'runtimeInventorySHA256': inventory_sha, 'sourceIdentitySHA256': args.source_identity_sha256,
                  'rawBinarySHA256': sha(paths['firefox']), 'stamps': stamps, 'prefsSourceReview': prefs_proof,
                  'archiveCreated': False, 'guestAcceptance': False}
        (out / 'preflight.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report)); return
    if not args.binary or not args.build_evidence or not args.build_evidence_sha256:
        raise ValueError('full-build/fpcast/structural evidence and final binary required')
    for path in (args.binary, args.build_evidence):
        filesystems[str(path.resolve())] = base.disk_filesystem(path)
    if sha(args.build_evidence) != args.build_evidence_sha256:
        raise ValueError('build evidence input hash mismatch')
    final_sha = sha(args.binary)
    with args.binary.open('rb') as stream:
        if stream.read(8) != b'\0asm\x01\0\0\0': raise ValueError('final binary is not Wasm')
    verify_evidence(json.loads(args.build_evidence.read_text()), args.source_identity_sha256,
                    inventory_sha, sha(paths['firefox']), final_sha)
    before, tail_before = inventory_archive(args.source)
    old = {r['name']: r for r in before}
    if not CRITICAL <= old.keys(): raise ValueError('required guest/NSS adapter records missing')
    with gzip.open(args.source, 'rb') as inp:
        for key, fields, body, _ in cpio(inp):
            if key == 'bin/firefox' and (not stat.S_ISLNK(fields[1]) or body != b'/opt/firefox/firefox'):
                raise ValueError('known-good Firefox launcher must target /opt/firefox/firefox')
            if key == 'init' and b'home: persistent storage mounted' not in body:
                raise ValueError('persistent-home init marker missing')
    installed = {r['name']: dict(r) for r in rows}
    for rel in ('defaults', 'defaults/pref'):
        if rel in paths and paths[rel] is not None: raise ValueError('preference parent must be a directory')
        installed.setdefault(rel, {'name': rel, 'mode': 0o40755, 'bytes': 0, 'sha256': base.digest(b'')})
    installed['firefox'].update(mode=0o100755, bytes=args.binary.stat().st_size, sha256=final_sha)
    pref_path = paths.get('defaults/pref/wasm.js')
    if 'defaults/pref/wasm.js' in paths and pref_path is None:
        raise ValueError('existing guest defaults must be a regular file')
    pref_before = pref_path.read_bytes() if pref_path else b''
    pref_after = guest_defaults(pref_before)
    installed['defaults/pref/wasm.js'] = {'name': 'defaults/pref/wasm.js', 'mode': 0o100644,
                                      'bytes': len(pref_after), 'sha256': base.digest(pref_after)}
    # A conservative bound protects both the dedicated allowance and free reserve.
    bound = args.source.stat().st_size + sum(r['bytes'] for r in installed.values()) + 8 * 1024**2
    usage = sum(p.stat().st_size for p in task.rglob('*') if p.is_file() and not p.is_symlink())
    if usage + bound > 2 * 1024**3: raise ValueError('2 GiB package task allowance would be exceeded')
    if shutil.disk_usage(out.parent).free - bound < 20 * 1024**3:
        raise ValueError('20 GiB free-space reserve would be exceeded')
    out.mkdir()
    destination = out / 'initramfs-firefox.cpio.gz'
    with gzip.open(args.source, 'rb') as inp, destination.open('xb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) as writer:
            inode = 0
            for key, fields, body, encoded in cpio(inp):
                inode = max(inode, fields[0])
                if key == 'TRAILER!!!':
                    for rel, row in sorted(installed.items()):
                        inode += 1
                        if inode > 0xffffffff: raise ValueError('CPIO inode exhausted')
                        if rel == 'firefox': data = args.binary.read_bytes()
                        elif rel == 'defaults/pref/wasm.js': data = pref_after
                        elif stat.S_ISDIR(row['mode']): data = b''
                        else: data = paths[rel].read_bytes()
                        if len(data) != row['bytes'] or base.digest(data) != row['sha256']:
                            raise ValueError('runtime input changed during packaging: ' + rel)
                        writer.write(encode(PREFIX + ('/' + rel if rel else ''), row['mode'], data, inode))
                    writer.write(encoded)
                elif key != PREFIX and not key.startswith(PREFIX + '/'):
                    writer.write(encoded)
            shutil.copyfileobj(inp, writer, 1024 * 1024)
    after, tail_after = inventory_archive(destination)
    new = {r['name']: r for r in after}
    preserved = [r for r in before if r['name'] != PREFIX and not r['name'].startswith(PREFIX + '/')]
    new_preserved = [r for r in after if r['name'] != PREFIX and not r['name'].startswith(PREFIX + '/')]
    if preserved != new_preserved or tail_before != tail_after:
        raise ValueError('independent audit: record outside runtime or archive tail changed')
    expected = {PREFIX + ('/' + k if k else ''): v for k, v in installed.items()}
    actual = {k: v for k, v in new.items() if k == PREFIX or k.startswith(PREFIX + '/')}
    if expected.keys() != actual.keys(): raise ValueError('independent audit: wrong installed paths')
    for key, row in expected.items():
        if any(actual[key][field] != row[field] for field in ('mode', 'bytes', 'sha256')):
            raise ValueError('independent audit: runtime record mismatch: ' + key)
    if (sha(args.source) != args.source_sha256 or sha(args.binary) != final_sha or
            sha(args.manifest) != args.manifest_sha256 or sha(args.source_identity) != args.source_identity_sha256 or
            sha(args.build_evidence) != args.build_evidence_sha256 or
            runtime_inventory(args.runtime, args.source_root, args.object_root)[0] != rows or
            check_prefs(args.source_root) != prefs_proof):
        raise ValueError('input changed during packaging')
    updated = copy.deepcopy(manifest)
    archive_sha = sha(destination)
    updated['assets']['firefox'].update(bytes=destination.stat().st_size, sha256=archive_sha,
                                      label='TEST ONLY: Firefox Nightly159')
    updated['version'] = 'test-nightly-' + archive_sha[:16]
    updated.pop('previous', None)
    # Asset URL is deliberately caller-set when mounting the isolated task output
    # in the QA server; no production manifest or localStorage is touched.
    (out / 'boot-manifest.json').write_text(json.dumps(updated, indent=2) + '\n')
    (out / 'baseline-inventory.json').write_text(json.dumps(before, indent=2) + '\n')
    (out / 'archive-inventory.json').write_text(json.dumps(after, indent=2) + '\n')
    (out / 'runtime-inventory.json').write_text(json.dumps(rows, indent=2) + '\n')
    report = {'passPackage': True, 'candidateOnly': True, 'guestAcceptance': False,
              'archiveSHA256': archive_sha, 'archiveBytes': destination.stat().st_size,
              'archiveSha256': archive_sha, 'bytes': destination.stat().st_size, 'version': updated['version'],
              'sourceVersion': manifest['version'], 'sourceSha256': args.source_sha256,
              'sourceManifestSha256': args.manifest_sha256,
              'sourceArchiveSHA256': args.source_sha256, 'sourceManifestSHA256': args.manifest_sha256,
              'sourceIdentitySHA256': args.source_identity_sha256, 'buildEvidenceSHA256': args.build_evidence_sha256,
              'runtimeInventorySHA256': inventory_sha, 'rawBinarySHA256': sha(paths['firefox']), 'finalBinarySHA256': final_sha,
              'identity': identity, 'stamps': stamps, 'preservedRecords': len(preserved), 'removedRuntimeRecords': len(before)-len(preserved),
              'installedRuntimeRecords': len(installed), 'allOutsideRuntimeRecordsIdentical': True, 'tailPreserved': True,
              'criticalRecords': {k: old[k] for k in sorted(CRITICAL)}, 'prefsSourceReview': prefs_proof,
              'guestDefaultsBeforeSHA256': base.digest(pref_before), 'guestDefaultsSHA256': base.digest(pref_after),
              'runtimeSymlinksMaterialized': True, 'filesystems': filesystems,
              'pending': ['default-GPU-homepage-overlay', 'Nightly-resource/static-adapter-audit',
                          'Nightly-NSS-trust-seed-freshness', 'eight-CPU-guest-startup/update', 'native-Wasm-JIT', 'guest-GPU']}
    (out / 'package-report.json').write_text(json.dumps(report, indent=2) + '\n')
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'output': str(out), 'archiveSHA256': archive_sha}))


if __name__ == '__main__':
    main()
