#!/usr/bin/env python3
"""Verified, isolated Firefox archive overlay: local GPU homepage and defaults.

Works with current or future musl/Nightly rootfs archives, without assuming a
Firefox version. Explicit input hashes bind the caller's reviewed inputs.
Only default preferences and installed GPU-check assets change; init, Firefox
code, archive metadata and home/profile records remain byte-identical.
"""
import argparse
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ready_package', Path(__file__).with_name('package-aurora-ready.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TASK = Path('/mnt/p6/build/firefox-default-gpu-page-20261002')
PAGE = Path(__file__).with_name('firefox-gpu-check') / 'gpu-check.html'
PAGE_URL = 'file:///opt/firefox/gpu-check/gpu-check.html'
PREF_PATH = 'opt/firefox/defaults/pref/wasm.js'
INI_PATH = 'opt/firefox/distribution/distribution.ini'
PREFS = {
    'browser.startup.homepage': PAGE_URL,
    'browser.startup.page': 1,
    'webgl.force-enabled': True,
    'webgl.disabled': False,
    'webgl.enable-webgl2': True,
    'webgl.disable-fail-if-major-performance-caveat': True,
    'dom.webgpu.enabled': True,
    'gfx.webgpu.ignore-blocklist': True,
}
BEGIN = '// BEGIN Linux on Web local GPU homepage defaults\n'
END = '// END Linux on Web local GPU homepage defaults\n'
DISTRIBUTION = f'''[Global]
id=linuxonweb
version=1.0
about=Linux on Web

[Preferences]
browser.startup.homepage="{PAGE_URL}"

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


def defaults(before):
    text = before.decode('utf-8')
    if text.count(BEGIN) != text.count(END) or text.count(BEGIN) > 1:
        raise ValueError('invalid existing managed preference block')
    text = re.sub(re.escape(BEGIN) + '.*?' + re.escape(END), '', text, flags=re.S)
    # Replace these defaults while retaining unrelated preferences verbatim.
    for key in [*PREFS, 'dom.webgpu.workers.enabled']:
        pattern = r'^\s*pref\(\s*([\"\x27])' + re.escape(key) + r'\1\s*,[^;]*\);[^\n]*(?:\n|$)'
        text = re.sub(pattern, '', text, flags=re.M)
        if re.search(r'[\"\x27]' + re.escape(key) + r'[\"\x27]\s*,', text):
            raise ValueError('unrecognized existing preference syntax: ' + key)
    block = BEGIN + '// Defaults only: saved user preferences still win.\n'
    block += '// Set startup-only gfx.webgpu.ignore-blocklist before StaticPrefs initialize.\n'
    block += ''.join(f'pref({json.dumps(key)}, {json.dumps(value)});\n' for key, value in PREFS.items()) + END
    return (text + ('\n' if text and not text.endswith('\n') else '') + block).encode()


def distribution(before):
    """Retain unrelated INI settings; early GPU defaults remain authoritative."""
    if before is None:
        return DISTRIBUTION
    lines = before.decode('utf-8').splitlines(keepends=True)
    found = False
    section = None
    result = []
    for line in lines:
        match = re.match(r'\s*\[([^]]+)\]', line)
        if match:
            if section == 'Preferences' and not found:
                result.append(f'browser.startup.homepage="{PAGE_URL}"\n')
                found = True
            section = match[1]
        if section == 'Preferences' and re.match(r'\s*browser\.startup\.homepage\s*=', line):
            if found:
                raise ValueError('duplicate distribution homepage setting')
            line = f'browser.startup.homepage="{PAGE_URL}"\n'
            found = True
        if section == 'Preferences':
            setting = re.match(r'\s*([^=\s]+)\s*=', line)
            # Distribution customization runs later. Remove managed GPU/startup
            # settings here so it cannot override the early wasm.js defaults.
            if setting and setting[1] in {*PREFS, 'dom.webgpu.workers.enabled'} - {'browser.startup.homepage'}:
                continue
        result.append(line)
    if not found:
        if result and not result[-1].endswith('\n'):
            result[-1] += '\n'
        if section != 'Preferences':
            result.append('\n[Preferences]\n')
        result.append(f'browser.startup.homepage="{PAGE_URL}"\n')
    return ''.join(result).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--task-root', type=Path, default=TASK)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    task, out = args.task_root.resolve(strict=True), args.output.resolve()
    build_roots = (Path('/mnt/p6/build'), Path('/mnt/p6/project/build'))
    if not any(task.is_relative_to(root) and task != root for root in build_roots):
        parser.error('task root must be a dedicated disk-backed build directory')
    if not out.is_relative_to(task) or out == task or out.exists() or args.output.is_symlink() or not out.parent.is_dir():
        parser.error('fresh output under existing task root required')
    filesystems = {str(p.resolve()): base.disk_filesystem(p) for p in (args.source, args.manifest, out.parent)}
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        p = Path(os.environ.get(name, '/tmp')).resolve()
        if not p.is_relative_to(task) or not p.is_dir():
            parser.error(name + ' must be an existing disk-backed task directory')
        filesystems[str(p)] = base.disk_filesystem(p)
        scratch[name] = str(p)
    if shutil.disk_usage(out.parent).free < 20 * 1024**3:
        parser.error('20 GiB free-space reserve required')
    for value in (args.source_sha256, args.manifest_sha256):
        if not re.fullmatch('[0-9a-f]{64}', value):
            parser.error('explicit lowercase SHA-256 hashes required')
    source, manifest_bytes, page = args.source.read_bytes(), args.manifest.read_bytes(), PAGE.read_bytes()
    if base.digest(source) != args.source_sha256 or base.digest(manifest_bytes) != args.manifest_sha256:
        parser.error('verified input hash mismatch')
    manifest = json.loads(manifest_bytes)
    asset = manifest['assets']['firefox']
    if asset['sha256'] != args.source_sha256 or asset['bytes'] != len(source):
        parser.error('manifest does not describe source archive')
    raw = gzip.decompress(source)
    original = list(base.records(raw))
    old = {r[0]: r for r in original}
    if len(old) != len(original) or original[-1][0] != 'TRAILER!!!':
        raise ValueError('duplicate archive paths or missing trailer')
    if PREF_PATH not in old or 'init' not in old:
        raise ValueError('Firefox defaults and guest init required')
    # Reject a Firefox startup URL; do not alter the established guest launcher.
    for line in old['init'][3].decode().splitlines():
        if 'exec /bin/firefox ' in line and re.search(r'\b(?:https?|file)://', line):
            raise ValueError('guest launcher must honor saved startup preferences, without a mandatory URL')
    replacements = {PREF_PATH: defaults(old[PREF_PATH][3])}
    bodies = [
        ('opt/firefox/gpu-check', 0o40755, b'', 2),
        ('opt/firefox/gpu-check/gpu-check.html', 0o100644, page, 1),
        ('opt/firefox/distribution', 0o40755, b'', 2),
        (INI_PATH, 0o100644, distribution(old[INI_PATH][3] if INI_PATH in old else None), 1),
    ]
    added = []
    for name, mode, body, nlink in bodies:
        if name in old:
            if int(old[name][1][14:22], 16) & 0o170000 != mode & 0o170000:
                raise ValueError('unexpected record type: ' + name)
            if old[name][3] != body:
                replacements[name] = body
        else:
            added.append((name, mode, body, nlink))
    if int(old[PREF_PATH][1][14:22], 16) & 0o170000 != 0o100000:
        raise ValueError('defaults must be a regular file')
    inode = max(int(r[1][6:14], 16) for r in original) + 1
    tail = raw[sum(len(r[4]) for r in original):]
    inserted = b''.join(record(name, mode, body, inode + i, nlink) for i, (name, mode, body, nlink) in enumerate(added))
    candidate = b''.join(base.replace_body(r, replacements[r[0]]) if r[0] in replacements else r[4] for r in original[:-1])
    candidate += inserted + original[-1][4] + tail
    changed = list(base.records(candidate))
    new = {r[0]: r for r in changed}
    if [r[0] for r in changed] != [r[0] for r in original[:-1]] + [a[0] for a in added] + ['TRAILER!!!']:
        raise ValueError('archive paths/order changed')
    modified = [name for name in old if old[name][4] != new[name][4]]
    if any(name not in replacements for name in modified):
        raise ValueError('unexpected existing record change')
    for name, body in replacements.items():
        if new[name][3] != body or old[name][1][:54] + old[name][1][62:] != new[name][1][:54] + new[name][1][62:]:
            raise ValueError('replacement body or metadata changed: ' + name)
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
    report = dict(passPackage=True, candidateOnly=True, sourceSha256=args.source_sha256,
        sourceManifestSha256=args.manifest_sha256, sourceVersion=manifest['version'],
        archiveSha256=base.digest(encoded), bytes=len(encoded), uncompressedBytes=len(candidate), version=new_manifest['version'],
        added={name: {'mode': oct(mode), 'bytes': len(body), 'sha256': base.digest(body)} for name, mode, body, _ in added},
        modified=modified, unchangedRecords=len(old) - len(modified), totalRecords=len(changed),
        pageSource=str(PAGE.resolve()), pageSha256=base.digest(page), pageUrl=PAGE_URL,
        defaults=PREFS, defaultsSha256=base.digest(new[PREF_PATH][3]),
        originalOrderPreserved=True, tailPreserved=True, existingMetadataExceptBodySizePreserved=True,
        initUnchanged=old['init'][4] == new['init'][4], homeAndProfilesUnchanged=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()), filesystems=filesystems, scratch=scratch,
        releaseGatesPending=['guest-Firefox-version-and-GPU-rendering', 'cold-warm-startup', 'profile-preserving-update'])
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded),
        'archiveSha256': report['archiveSha256'], 'output': str(out)}))


if __name__ == '__main__':
    main()
