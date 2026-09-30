#!/usr/bin/env python3
"""Pinned candidate: WebGL/WebGPU check page bookmarked and opened by default.

Adapter only: no Firefox module or existing member changes. Source is the W1
WebGPU candidate (version c27a1a7c6e6a). New records are inserted before the
CPIO trailer:

  opt/firefox/gpu-check/                       directory
  opt/firefox/gpu-check/gpu-check.html         tools/guest-rootfs/firefox-gpu-check
  opt/firefox/distribution/                    directory
  opt/firefox/distribution/distribution.ini    bookmarks + default homepage

Firefox's own distribution customizer (distribution.sys.mjs) applies the
[Preferences] section on the default branch, so a homepage a user sets
still wins. It adds the bookmarks once per profile, including existing
profiles, tracked by distribution.linuxonweb.bookmarksProcessed.
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
TASK = Path('/mnt/p6/build/firefox-gpu-check-20260929')
SOURCE_SHA = 'dbd64c0dcf7228f6385f54f3409c806df53448387451b8fe8ec688594b3ab5c2'
MANIFEST_SHA = '9b6dcb449335a761e99e5fe6a42084aef2633a61edc0969d29cbeb43fcaea52b'
SOURCE_VERSION = 'c27a1a7c6e6a'
PAGE = Path(__file__).with_name('firefox-gpu-check') / 'gpu-check.html'
PAGE_URL = 'file:///opt/firefox/gpu-check/gpu-check.html'
DISTRIBUTION = f'''[Global]
id=linuxonweb
version=1.0
about=Linux on Web

[Preferences]
browser.startup.homepage="{PAGE_URL}"
browser.toolbars.bookmarks.visibility="always"

[BookmarksToolbar]
item.1.title=GPU check (WebGL / WebGPU)
item.1.link={PAGE_URL}

[BookmarksMenu]
item.1.title=GPU check (WebGL / WebGPU)
item.1.link={PAGE_URL}
'''.encode()


def record(name, mode, body, inode, nlink):
    name = name.encode() + b'\0'
    fields = [inode, mode, 0, 0, nlink, 0, len(body), 0, 0, 0, 0, len(name), 0]
    header = b'070701' + b''.join(f'{n:08x}'.encode() for n in fields)
    return header + name + b'\0' * (-(110 + len(name)) % 4) + body + b'\0' * (-len(body) % 4)


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
    if shutil.disk_usage(out.parent).free < 4 * 1024**3:
        parser.error('4 GiB free disk required')
    source, manifest_bytes, page = args.source.read_bytes(), args.manifest.read_bytes(), PAGE.read_bytes()
    if base.digest(source) != SOURCE_SHA or base.digest(manifest_bytes) != MANIFEST_SHA:
        parser.error('pinned input hash mismatch')
    manifest = json.loads(manifest_bytes)
    if manifest['assets']['firefox']['sha256'] != SOURCE_SHA or manifest['version'] != SOURCE_VERSION:
        parser.error('manifest does not describe source archive')
    raw = gzip.decompress(source)
    original = list(base.records(raw))
    old = {r[0]: r for r in original}
    if len(old) != len(original) or original[-1][0] != 'TRAILER!!!':
        raise ValueError('duplicate archive paths or missing trailer')
    inode = max(int(r[1][6:14], 16) for r in original) + 1
    added = [('opt/firefox/gpu-check', 0o40755, b'', 2),
             ('opt/firefox/gpu-check/gpu-check.html', 0o100644, page, 1),
             ('opt/firefox/distribution', 0o40755, b'', 2),
             ('opt/firefox/distribution/distribution.ini', 0o100644, DISTRIBUTION, 1)]
    if any(name in old for name, *_ in added):
        raise ValueError('added path already present')
    trailer = original[-1][4]
    body_end = sum(len(r[4]) for r in original)
    tail = raw[body_end:]
    inserted = b''.join(record(name, mode, body, inode + i, nlink) for i, (name, mode, body, nlink) in enumerate(added))
    candidate = raw[:body_end - len(trailer)] + inserted + trailer + tail
    changed = list(base.records(candidate))
    new = {r[0]: r for r in changed}
    expected_order = [r[0] for r in original[:-1]] + [a[0] for a in added] + ['TRAILER!!!']
    if [r[0] for r in changed] != expected_order:
        raise ValueError('archive paths/order changed')
    if any(old[key][4] != new[key][4] for key in old):
        raise ValueError('existing record changed')
    for name, _, body, _ in added:
        if new[name][3] != body:
            raise ValueError('added body mismatch: ' + name)
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
        added={name: {'mode': oct(mode), 'bytes': len(body), 'sha256': base.digest(body)} for name, mode, body, _ in added},
        pageSource=str(PAGE.resolve()), pageUrl=PAGE_URL, distributionIni=DISTRIBUTION.decode(),
        totalRecords=len(changed), unchangedRecords=len(old), modified=[],
        originalOrderPreserved=True, tailPreserved=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()),
        filesystems=filesystems, scratch=scratch)
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded),
                      'archiveSha256': report['archiveSha256'], 'output': str(out)}))


if __name__ == '__main__':
    main()
