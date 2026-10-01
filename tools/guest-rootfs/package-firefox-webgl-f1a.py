#!/usr/bin/env python3
"""Pinned candidate: Firefox WebGL F1a (static Mesa EGL + Zink + guest Vulkan ICD).

The module is produced by tools/build-firefox-webgl-f1a.py: the W1 link plus
the zink-egl-static.o / zink_static_vk.o adapters and copies of the B3 Mesa
archives (no Firefox source change). Source is the GPU check candidate-run5
rootfs (version d5103be54146), whose Firefox module is the W1 module.

Changed members (metadata except size preserved):
  opt/firefox/firefox                        relinked module
  opt/firefox/distribution/distribution.ini  [Preferences] gains
                                             gfx.x11-egl.force-enabled=true and
                                             webgl.out-of-process=false (all
                                             earlier forced prefs kept)
  opt/firefox/defaults/pref/wasm.js          gains pref("gfx.x11-egl.force-enabled", true).
                                             That pref is a `once` static pref,
                                             snapshotted before distribution.ini
                                             [Preferences] are applied (guest-run1
                                             showed the GLX path), so it must be an
                                             app default-pref file entry.
Added before the CPIO trailer:
  opt/firefox/glxtest                        web/linux/firefox-shims/glxtest-egl.c
                                             (reports TEST_TYPE EGL; no GL probe)

All other records, their order and the archive tail are preserved and verified.
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
TASK = Path('/mnt/p6/build/firefox-webgl-f1a-20260930')
SOURCE_SHA = '65b7fc22562015bec5a17534d86fe0d8f38451029975dfa8a06cd7fcc10aa975'
MANIFEST_SHA = 'a572184bb0a68213a6768b5898625d0f16d7d561252f76bf3544479c17ca6086'
SOURCE_VERSION = 'd5103be54146'
MEMBER = 'opt/firefox/firefox'
MEMBER_SHA = '3a1af53de3306e5380c84fa900bcc505f09bae6ffb856be03972c9b9b2aa3db6'  # W1 module
DIST = 'opt/firefox/distribution/distribution.ini'
DIST_SHA = 'f24dbc472cb52bb153b26305d758167e3a43ae1ced262cc48869b247cfb34cad'
DIST_ANCHOR = b'gfx.webgpu.ignore-blocklist=true\n'
DIST_ADD = b'gfx.x11-egl.force-enabled=true\nwebgl.out-of-process=false\n'
GLXTEST = 'opt/firefox/glxtest'
PREFS = 'opt/firefox/defaults/pref/wasm.js'
PREFS_SHA = '544a838463c452b884d6a3f9935e39a2977875e09b143ee49a25d0c8eb2949ae'
PREFS_ADD = (b'\n// WebGL F1a: Mesa EGL (surfaceless, Zink) is linked into firefox. X11_EGL\n'
             b'// makes GLContextProvider use EGL instead of GLX (no libGL/GLX in the\n'
             b'// guest). A `once` pref: distribution.ini applies too late for it.\n'
             b'pref("gfx.x11-egl.force-enabled", true);\n')


def record(name, mode, body, inode, nlink):
    name = name.encode() + b'\0'
    fields = [inode, mode, 0, 0, nlink, 0, len(body), 0, 0, 0, 0, len(name), 0]
    header = b'070701' + b''.join(f'{n:08x}'.encode() for n in fields)
    return header + name + b'\0' * (-(110 + len(name)) % 4) + body + b'\0' * (-len(body) % 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--build', type=Path, required=True, help='build-firefox-webgl-f1a.py output dir')
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
    if not build.get('pass'):
        parser.error('passing relink report required')
    module = Path(build['candidate']).read_bytes()
    if base.digest(module) != build['sha256'] or len(module) != build['bytes']:
        parser.error('relinked module does not match its build report')
    glxtest = Path(build['glxtest']['path']).read_bytes()
    if base.digest(glxtest) != build['glxtest']['sha256']:
        parser.error('glxtest does not match its build report')
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
    if len(old) != len(original) or original[-1][0] != 'TRAILER!!!':
        raise ValueError('duplicate archive paths or missing trailer')
    if base.digest(old[MEMBER][3]) != MEMBER_SHA:
        raise ValueError('pinned W1 Firefox module required')
    if base.digest(old[DIST][3]) != DIST_SHA or old[DIST][3].count(DIST_ANCHOR) != 1:
        raise ValueError('pinned run5 distribution.ini required')
    if base.digest(old[PREFS][3]) != PREFS_SHA:
        raise ValueError('pinned W1 wasm.js required')
    if GLXTEST in old:
        raise ValueError('glxtest already present')
    replacements = {MEMBER: module, DIST: old[DIST][3].replace(DIST_ANCHOR, DIST_ANCHOR + DIST_ADD),
                    PREFS: old[PREFS][3] + PREFS_ADD}
    inode = max(int(r[1][6:14], 16) for r in original) + 1
    trailer = original[-1][4]
    body = b''.join(base.replace_body(r, replacements[r[0]]) if r[0] in replacements else r[4]
                    for r in original[:-1])
    tail = raw[sum(len(r[4]) for r in original):]
    candidate = body + record(GLXTEST, 0o100755, glxtest, inode, 1) + trailer + tail
    changed = list(base.records(candidate))
    new = {r[0]: r for r in changed}
    if [r[0] for r in changed] != [r[0] for r in original[:-1]] + [GLXTEST, 'TRAILER!!!']:
        raise ValueError('archive paths/order changed')
    modified = [key for key in old if old[key][4] != new[key][4]]
    if sorted(modified) != sorted(replacements):
        raise ValueError('unexpected record change: ' + repr(modified))
    unchanged = sum(1 for key in old if key not in replacements and old[key][4] == new[key][4])
    for key, data in replacements.items():
        if old[key][1][:54] + old[key][1][62:] != new[key][1][:54] + new[key][1][62:]:
            raise ValueError('member metadata change: ' + key)
        if new[key][3] != data:
            raise ValueError('member body mismatch: ' + key)
    if new[GLXTEST][3] != glxtest:
        raise ValueError('glxtest body mismatch')
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
        members={key: {'beforeSha256': base.digest(old[key][3]), 'afterSha256': base.digest(data),
                       'beforeBytes': len(old[key][3]), 'afterBytes': len(data)}
                 for key, data in replacements.items()},
        added={GLXTEST: {'mode': oct(0o100755), 'bytes': len(glxtest), 'sha256': base.digest(glxtest)}},
        distributionIni=replacements[DIST].decode(), wasmPrefs=replacements[PREFS].decode(),
        relinkReport=str((args.build / 'report.json').resolve()),
        totalRecords=len(changed), unchangedRecords=unchanged, modified=modified,
        originalOrderPreserved=True, tailPreserved=True, metadataExceptSizePreserved=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()),
        filesystems=filesystems, scratch=scratch)
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded),
                      'archiveSha256': report['archiveSha256'], 'unchangedRecords': unchanged,
                      'output': str(out)}))


if __name__ == '__main__':
    main()
