#!/usr/bin/env python3
"""Pinned candidate: let single-process DevTools read watcher session data.

In this wasm build the parent process also hosts the DevToolsProcess JS actor.
Its read-only `Services.cpmm.sharedData` snapshot is a second mapping of the
serialized shared-memory descriptor, which the wasm mmap shim does not keep
coherent with the writer's mapping, so the watcher session data is missing and
the toolbox stays blank. In the parent process the same data is available
directly from the writable `Services.ppmm.sharedData` map, whose entries are
flushed by ParentProcessWatcherRegistry after every change. Only that one
packed DevTools module changes; every other CPIO record is preserved.
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
TASK = Path('/mnt/p6/build/firefox-devtools-20260928')
# Sites v9 / 29331a186e50 accepted inputs.
SOURCE_SHA = '7bd5e9041d568c6b5b325abba16754d943a51b009c368c39901c0fb0a751508a'
MANIFEST_SHA = '595c01ac6d0d0c3e67441eedc69dc0946a71a79c9b30ae7a7966f5169306e516'
MEMBER = ('opt/firefox/browser/chrome/devtools/modules/devtools/server/connectors/'
          'js-process-actor/ContentProcessWatcherRegistry.sys.mjs')
MEMBER_SHA = '46f8517806978398c9b4739494d64c44371d574445680de9570c467b730ef815'
OLD_READ = b'const { sharedData } = Services.cpmm;'
NEW_READ = b'const sharedData = getWatcherSharedData();'
OLD_ANCHOR = b'const SHARED_DATA_KEY_NAME = "DevTools:watchedPerWatcher";\n'
NEW_ANCHOR = OLD_ANCHOR + b'''
// linuxonweb wasm: the parent process hosts this actor too. Its read-only
// cpmm snapshot is a second mapping of the serialized descriptor, which the
// wasm mmap shim does not keep coherent with the writer's mapping. The writable
// ppmm map holds the same, already flushed, entries in the parent process.
function getWatcherSharedData() {
  return Services.appinfo.processType == Services.appinfo.PROCESS_TYPE_DEFAULT
    ? Services.ppmm.sharedData
    : Services.cpmm.sharedData;
}
'''


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
    if base.digest(before) != MEMBER_SHA or before.count(OLD_READ) != 2 or before.count(OLD_ANCHOR) != 1:
        raise ValueError('pinned DevTools watcher registry required')
    after = before.replace(OLD_ANCHOR, NEW_ANCHOR).replace(OLD_READ, NEW_READ)
    if after.replace(NEW_READ, OLD_READ).replace(NEW_ANCHOR, OLD_ANCHOR) != before:
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
    (out / 'ContentProcessWatcherRegistry.before.sys.mjs').write_bytes(before)
    (out / 'ContentProcessWatcherRegistry.after.sys.mjs').write_bytes(after)
    (out / 'initramfs-firefox.cpio.gz').write_bytes(encoded)
    (out / 'boot-manifest.json').write_text(json.dumps(new_manifest, indent=2) + '\n')
    report = dict(passPackage=True, candidateOnly=True, sourceSha256=SOURCE_SHA,
        sourceManifestSha256=MANIFEST_SHA, sourceVersion=manifest['version'],
        archiveSha256=base.digest(encoded), bytes=len(encoded),
        uncompressedBytes=len(candidate), version=new_manifest['version'],
        memberBeforeSha256=base.digest(before), memberAfterSha256=base.digest(after),
        unchangedRecords=len(old) - 1, modified=[MEMBER], added=[], originalOrderPreserved=True,
        tailPreserved=True, metadataExceptSizePreserved=True, profilePreferencesUnchanged=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()),
        filesystems=filesystems, scratch=scratch,
        releaseGatesPending=['devtools-console-eval', 'cold-and-automatic-warm-input',
                             'update-and-home-preservation', 'public-acceptance'])
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded), 'output': str(out)}))


if __name__ == '__main__':
    main()
