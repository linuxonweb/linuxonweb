#!/usr/bin/env python3
"""Pinned candidate: Firefox relinked with the coherent MAP_SHARED mmap shim.

The only code change is web/linux/firefox-shims/mmap-shim.c: file-backed
MAP_SHARED mappings of one file (st_dev, st_ino) now alias one per-file backing
inside the process, and dirty backings are written back on msync and on the
last munmap. That fixes the stale second mapping behind the DevTools
workaround (SharedMap/MemMapSnapshot readers) and is the W0 prerequisite for
Firefox WebGPU buffer mapping. The module is produced by
tools/build-firefox-mmap-shared.py, which relinks the exact deployed link
command with only the shim object replaced.

Source is the promoted b21b2cac65a3 rootfs. By default exactly one CPIO member
changes: opt/firefox/firefox. `--revert-devtools-workaround` additionally
restores the unmodified v9 DevTools ContentProcessWatcherRegistry.sys.mjs
(diagnostic candidate proving the shim alone fixes DevTools). All other
records, their order, metadata except size, and the archive tail are preserved.
"""
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
TASK = Path('/mnt/p6/build/firefox-mmap-w0-20260929')
SOURCE_SHA = 'd3d9afca272947ba1b6bb743585a6f0cf33de90c54adff1cd85b5c5bf9d8002b'
MANIFEST_SHA = '8fca6cf14e2a0e1ad77cd49aa28198ed0fa02a8649156bcb43468b877ca8cc45'
MEMBER = 'opt/firefox/firefox'
MEMBER_SHA = '644ab48f01a8a588706d1ec1c3a97006469964c705edc0f5d599286c890c610f'
DEVTOOLS = ('opt/firefox/browser/chrome/devtools/modules/devtools/server/connectors/'
            'js-process-actor/ContentProcessWatcherRegistry.sys.mjs')
DEVTOOLS_V9_SHA = '46f8517806978398c9b4739494d64c44371d574445680de9570c467b730ef815'
OLD_READ = b'const { sharedData } = Services.cpmm;'
NEW_READ = b'const sharedData = getWatcherSharedData();'
ANCHOR = b'const SHARED_DATA_KEY_NAME = "DevTools:watchedPerWatcher";\n'


def revert_devtools(body):
    start = body.index(ANCHOR) + len(ANCHOR)
    end = body.index(b'}\n', body.index(b'function getWatcherSharedData()', start)) + 2
    reverted = body[:start] + body[end:]
    reverted = reverted.replace(NEW_READ, OLD_READ)
    if base.digest(reverted) != DEVTOOLS_V9_SHA:
        raise ValueError('DevTools revert does not reproduce the v9 member')
    return reverted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--build', type=Path, required=True, help='build-firefox-mmap-shared.py output dir')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--revert-devtools-workaround', action='store_true')
    args = parser.parse_args()
    out = args.output.resolve()
    if not out.is_relative_to(TASK) or out == TASK or out.exists() or args.output.is_symlink() or not out.parent.is_dir():
        parser.error('fresh output under existing task root required')
    filesystems = {str(p.resolve()): base.disk_filesystem(p) for p in (args.source, args.manifest, args.build, out.parent)}
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        p = Path(os.environ.get(name, '/tmp')).resolve()
        if not p.is_relative_to(TASK) or not p.is_dir():
            parser.error(name + ' must be an existing disk-backed task directory')
        filesystems[str(p)] = base.disk_filesystem(p)
        scratch[name] = str(p)
    if shutil.disk_usage(out.parent).free < 4 * 1024**3:
        parser.error('4 GiB free disk required')
    build = json.loads((args.build / 'report.json').read_text())
    if not build.get('pass') or build.get('mode') != 'candidate':
        parser.error('passing candidate relink report required')
    module = Path(build['candidate']).read_bytes()
    if base.digest(module) != build['sha256'] or len(module) != build['bytes']:
        parser.error('relinked module does not match its build report')
    source, manifest_bytes = args.source.read_bytes(), args.manifest.read_bytes()
    if base.digest(source) != SOURCE_SHA or base.digest(manifest_bytes) != MANIFEST_SHA:
        parser.error('accepted input hash mismatch')
    manifest = json.loads(manifest_bytes)
    if manifest['assets']['firefox']['sha256'] != SOURCE_SHA:
        parser.error('manifest does not describe source archive')
    for key in ('kernel', 'plain'):
        asset = manifest['assets'][key]
        p = args.manifest.parent / asset['url']
        if not p.exists():
            p = Path(__file__).resolve().parents[2] / 'web/linux' / asset['url']
        filesystems[str(p.resolve())] = base.disk_filesystem(p)
        if p.stat().st_size != asset['bytes'] or base.file_digest(p) != asset['sha256']:
            parser.error('accepted ' + key + ' mismatch')
    raw = gzip.decompress(source)
    original = list(base.records(raw))
    old = {r[0]: r for r in original}
    if len(old) != len(original):
        raise ValueError('duplicate archive paths')
    before = old[MEMBER][3]
    if base.digest(before) != MEMBER_SHA:
        raise ValueError('pinned Firefox module required')
    replacements = {MEMBER: module}
    if args.revert_devtools_workaround:
        replacements[DEVTOOLS] = revert_devtools(old[DEVTOOLS][3])
    tail = raw[sum(len(r[4]) for r in original):]
    candidate = b''.join(base.replace_body(r, replacements[r[0]]) if r[0] in replacements else r[4]
                         for r in original) + tail
    changed = list(base.records(candidate))
    new = {r[0]: r for r in changed}
    if [r[0] for r in original] != [r[0] for r in changed]:
        raise ValueError('archive paths/order changed')
    modified = [key for key in old if old[key][4] != new[key][4]]
    if sorted(modified) != sorted(replacements):
        raise ValueError('unexpected record change: ' + repr(modified))
    for key, body in replacements.items():
        if old[key][1][:54] + old[key][1][62:] != new[key][1][:54] + new[key][1][62:]:
            raise ValueError('member metadata change: ' + key)
        if new[key][3] != body:
            raise ValueError('member body mismatch: ' + key)
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
    (out / 'initramfs-firefox.cpio.gz').write_bytes(encoded)
    (out / 'boot-manifest.json').write_text(json.dumps(new_manifest, indent=2) + '\n')
    report = dict(passPackage=True, candidateOnly=True, sourceSha256=SOURCE_SHA,
        sourceManifestSha256=MANIFEST_SHA, sourceVersion=manifest['version'],
        archiveSha256=base.digest(encoded), bytes=len(encoded),
        uncompressedBytes=len(candidate), version=new_manifest['version'],
        members={key: {'beforeSha256': base.digest(old[key][3]), 'afterSha256': base.digest(body),
                       'beforeBytes': len(old[key][3]), 'afterBytes': len(body)}
                 for key, body in replacements.items()},
        relinkReport=str((args.build / 'report.json').resolve()),
        shimSourceSha256=build.get('shimSourceSha256'), shimObjectSha256=build.get('shimObjectSha256'),
        devtoolsWorkaroundReverted=args.revert_devtools_workaround,
        unchangedRecords=len(old) - len(replacements), modified=modified, added=[],
        originalOrderPreserved=True, tailPreserved=True, metadataExceptSizePreserved=True,
        profilePreferencesUnchanged=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()),
        filesystems=filesystems, scratch=scratch,
        releaseGatesPending=['cold-and-automatic-warm-input', 'update-and-home-preservation',
                             'devtools-console-eval-inspector', 'public-acceptance'])
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded),
                      'archiveSha256': report['archiveSha256'], 'output': str(out)}))


if __name__ == '__main__':
    main()
