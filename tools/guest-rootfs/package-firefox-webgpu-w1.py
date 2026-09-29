#!/usr/bin/env python3
"""Pinned candidate: Firefox WebGPU W1 (RELEASE_OR_BETA gates relaxed under wasm).

The module is produced by tools/build-firefox-webgpu-gates.py, which relinks
the W0 MAP_SHARED candidate with only gfx/thebes/gfxPlatform.o and
dom/webgpu/Unified_cpp_dom_webgpu0.o replaced by objects compiled with
`#if defined(RELEASE_OR_BETA) && !defined(__wasm__)` at the two WebGPU gates.

Source is the W0 candidate-noworkaround-run1 rootfs (version 9fe35012a2b7).
Exactly two CPIO members change:

  opt/firefox/firefox                  relinked module
  opt/firefox/defaults/pref/wasm.js    existing wasm adapter default-pref file;
                                       a WebGPU block is appended

All other records, their order, metadata except size, and the archive tail
are preserved and verified.
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
TASK = Path('/mnt/p6/build/firefox-webgpu-w1-20260929')
SOURCE_SHA = 'fe15ebdd7601aa567c658adf7b5d26873f4e6ca52219ae53cb1b30f70b6b2577'
MANIFEST_SHA = '88c0e2ef168b2b89649029bef3f5d8bc5740c8e0d8e3e618bf88bdaafd5afd52'
SOURCE_VERSION = '9fe35012a2b7'
MEMBER = 'opt/firefox/firefox'
MEMBER_SHA = '4f7492e4c7666039f559c8cec55a438093fdf5093224dcd93c4ff95dede4305d'
PREFS = 'opt/firefox/defaults/pref/wasm.js'
PREFS_SHA = '5c4072e335ae8f2d96a78bbded4fc83face99bad25b276d2534bbb6cf9b92910'
PREFS_APPEND = b'''
// WebGPU (W1). The two RELEASE_OR_BETA WebGPU gates are compiled out for
// wasm; these defaults expose navigator.gpu and let the parent-process
// gfxPlatform::InitWebGPUConfig ignore a GfxInfo blocklist entry. Adapter
// requests reach WebGPUParent; the in-guest wgpu HAL is Empty (no adapter).
pref("dom.webgpu.enabled", true);
pref("gfx.webgpu.ignore-blocklist", true);
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--build', type=Path, required=True, help='build-firefox-webgpu-gates.py output dir')
    parser.add_argument('--output', type=Path, required=True)
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
        parser.error('pinned input hash mismatch')
    manifest = json.loads(manifest_bytes)
    if manifest['assets']['firefox']['sha256'] != SOURCE_SHA or manifest['version'] != SOURCE_VERSION:
        parser.error('manifest does not describe source archive')
    for key in ('kernel', 'plain'):
        asset = manifest['assets'][key]
        p = args.manifest.parent / asset['url']
        if not p.exists():
            p = Path(__file__).resolve().parents[2] / 'web/linux' / asset['url']
        filesystems[str(p.resolve())] = base.disk_filesystem(p)
        if p.stat().st_size != asset['bytes'] or base.file_digest(p) != asset['sha256']:
            parser.error('pinned ' + key + ' mismatch')
    raw = gzip.decompress(source)
    original = list(base.records(raw))
    old = {r[0]: r for r in original}
    if len(old) != len(original):
        raise ValueError('duplicate archive paths')
    if base.digest(old[MEMBER][3]) != MEMBER_SHA:
        raise ValueError('pinned W0 Firefox module required')
    if base.digest(old[PREFS][3]) != PREFS_SHA:
        raise ValueError('pinned wasm.js default prefs required')
    replacements = {MEMBER: module, PREFS: old[PREFS][3] + PREFS_APPEND}
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
    unchanged = sum(1 for key in old if key not in replacements and old[key][4] == new[key][4])
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
    if gzip.decompress(encoded) != candidate:
        raise ValueError('compressed archive does not round-trip')
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
        prefsAppended=PREFS_APPEND.decode(),
        relinkReport=str((args.build / 'report.json').resolve()),
        patchSha256=build.get('patchSha256'), objects=build.get('objects'),
        totalRecords=len(old), unchangedRecords=unchanged, modified=modified, added=[],
        originalOrderPreserved=True, tailPreserved=True, metadataExceptSizePreserved=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()),
        filesystems=filesystems, scratch=scratch,
        releaseGatesPending=['webgpu-fixture', 'cold-and-automatic-warm-input', 'update-and-home-preservation',
                             'devtools-console-eval-inspector', 'public-acceptance'])
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded),
                      'archiveSha256': report['archiveSha256'], 'unchangedRecords': unchanged,
                      'output': str(out)}))


if __name__ == '__main__':
    main()
