#!/usr/bin/env python3
"""Pinned candidate: keep an unresolved startup tab local in single-process Firefox."""
import argparse
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ready_package', Path(__file__).with_name('package-aurora-ready.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TASK = Path('/mnt/p6/build/firefox-homepage-20260926')
SOURCE_SHA = '7ad492fe595d19e210da1a365640d5e10680d5ba4e41ae85c73e0949fc2761b0'
MANIFEST_SHA = '0d3fd6063362027f0a992562017809a7636fe6a1b9f3e03e66df1376b67d9f7b'
MEMBER = 'opt/firefox/browser/chrome/browser/content/browser/tabbrowser/tabbrowser.js'
MEMBER_SHA = '15d62a56c85a4f254871064e230d648c7f3837d9f414bfa6029d502f4948b848'
OLD = b'          remoteType = E10SUtils.PRIVILEGEDABOUT_REMOTE_TYPE;'
NEW = b'''          // A pending startup URL must not create a content process when
          // this build runs browser and content in the same process.
          remoteType = gMultiProcessBrowser
            ? E10SUtils.PRIVILEGEDABOUT_REMOTE_TYPE
            : E10SUtils.NOT_REMOTE;'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    if not out.is_relative_to(TASK) or out == TASK or out.exists() or args.output.is_symlink() or not out.parent.is_dir():
        parser.error('fresh output under existing task root required')
    filesystems = {str(p.resolve()): base.disk_filesystem(p) for p in (args.source, args.manifest, out.parent)}
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        p = Path(os.environ.get(name, '/tmp')).resolve()
        if not p.is_relative_to(TASK) or not p.is_dir():
            parser.error(name + ' must be an existing disk-backed task directory')
        filesystems[str(p)] = base.disk_filesystem(p)
        scratch[name] = str(p)
    if shutil.disk_usage(out.parent).free < 2 * 1024**3:
        parser.error('2 GiB free disk required')
    source, manifest_bytes = args.source.read_bytes(), args.manifest.read_bytes()
    if base.digest(source) != SOURCE_SHA or base.digest(manifest_bytes) != MANIFEST_SHA:
        parser.error('accepted input hash mismatch')
    manifest = json.loads(manifest_bytes)
    for key in ('kernel', 'plain'):
        asset = manifest['assets'][key]
        p = args.manifest.parent / asset['url']
        filesystems[str(p.resolve())] = base.disk_filesystem(p)
        if p.stat().st_size != asset['bytes'] or base.file_digest(p) != asset['sha256']:
            parser.error('accepted ' + key + ' mismatch')
    raw = gzip.decompress(source)
    original = list(base.records(raw))
    old = {r[0]: r for r in original}
    if len(old) != len(original):
        raise ValueError('duplicate archive paths')
    before = old[MEMBER][3]
    if base.digest(before) != MEMBER_SHA or before.count(OLD) != 1:
        raise ValueError('unique pinned startup fallback required')
    after = before.replace(OLD, NEW)
    if after.replace(NEW, OLD) != before:
        raise ValueError('unintended source substitution')
    tail = raw[sum(len(r[4]) for r in original):]
    candidate = b''.join(base.replace_body(r, after) if r[0] == MEMBER else r[4] for r in original) + tail
    changed = list(base.records(candidate))
    new = {r[0]: r for r in changed}
    if [r[0] for r in original] != [r[0] for r in changed]:
        raise ValueError('archive paths/order changed')
    if [key for key in old if old[key][4] != new[key][4]] != [MEMBER]:
        raise ValueError('unexpected record change')
    if old[MEMBER][1][:54] + old[MEMBER][1][62:] != new[MEMBER][1][:54] + new[MEMBER][1][62:]:
        raise ValueError('member metadata change')
    if candidate[sum(len(r[4]) for r in changed):] != tail:
        raise ValueError('archive tail changed')
    compressed = io.BytesIO()
    with gzip.GzipFile(filename='', fileobj=compressed, mode='wb', compresslevel=9, mtime=0) as stream:
        stream.write(candidate)
    encoded = compressed.getvalue()
    new_manifest = copy.deepcopy(manifest)
    new_manifest['assets']['firefox'].update(bytes=len(encoded), sha256=base.digest(encoded))
    new_manifest['version'] = base.digest(json.dumps(new_manifest['assets'], sort_keys=True).encode())[:12]
    out.mkdir()
    (out / 'tabbrowser.before.js').write_bytes(before)
    (out / 'tabbrowser.after.js').write_bytes(after)
    (out / 'init.after.sh').write_bytes(old['init'][3])
    (out / 'initramfs-firefox.cpio.gz').write_bytes(encoded)
    (out / 'boot-manifest.json').write_text(json.dumps(new_manifest, indent=2) + '\n')
    report = dict(passPackage=True, candidateOnly=True, sourceSha256=SOURCE_SHA,
        sourceManifestSha256=MANIFEST_SHA, archiveSha256=base.digest(encoded), bytes=len(encoded),
        uncompressedBytes=len(candidate), version=new_manifest['version'],
        memberBeforeSha256=base.digest(before), memberAfterSha256=base.digest(after),
        unchangedRecords=len(old)-1, modified=[MEMBER], added=[], originalOrderPreserved=True,
        tailPreserved=True, metadataExceptSizePreserved=True, profilePreferencesUnchanged=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()),
        filesystems=filesystems, scratch=scratch,
        releaseGatesPending=['cold-and-automatic-warm-input', 'real-session-restoration',
                             'update-and-home-preservation', 'public-acceptance'])
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded), 'output': str(out)}))


if __name__ == '__main__':
    main()
