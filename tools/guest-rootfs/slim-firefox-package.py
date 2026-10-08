#!/usr/bin/env python3
"""Drop Firefox binaries the guest never executes from a packaged initramfs.

The guest kernel has no fork(), so Firefox runs single-process and never
launches plugin-container; xpcshell is a test shell.  firefox-bin is a
byte-identical copy of firefox and becomes a symlink to it.  Each copy is
~220 MiB of wasm that every boot downloads, decompresses and unpacks into
guest RAM.  --pref appends default prefs to Firefox's browser firefox.js, which
loads after the GRE defaults/pref files and so also overrides its own values.
All other records are copied unchanged.

Reads SOURCE_DIR/{initramfs-firefox.cpio.gz,boot-manifest.json,package.json}
from a package-firefox-native-gpu.py package and writes the same three files to
OUTPUT_DIR (which must not exist), ready for web/desktop/publish-build.mjs.

usage: slim-firefox-package.py SOURCE_DIR OUTPUT_DIR [--pref NAME=VALUE]...
"""
import argparse, gzip, hashlib, json, stat
from pathlib import Path

ARCHIVE = 'initramfs-firefox.cpio.gz'
DROP = {'opt/firefox/plugin-container', 'opt/firefox/xpcshell'}
LINKS = {'opt/firefox/firefox-bin': 'opt/firefox/firefox'}
PREFS_FILE = 'opt/firefox/browser/defaults/preferences/firefox.js'


def fields(header):
    if len(header) != 110 or header[:6] not in (b'070701', b'070702'):
        raise ValueError('invalid newc header')
    return [int(header[6 + i * 8:14 + i * 8], 16) for i in range(13)]


def exact(f, size):
    value = f.read(size)
    if len(value) != size:
        raise ValueError('short archive field')
    return value


def body_sha(src, size, dst=None):
    h = hashlib.sha256()
    while size:
        value = exact(src, min(size, 1 << 20))
        size -= len(value)
        h.update(value)
        if dst is not None:
            dst.write(value)
    return h.hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def with_size(header, size, mode=None):
    if mode is not None:
        header = header[:14] + f'{mode:08x}'.encode() + header[22:]
    return header[:54] + f'{size:08x}'.encode() + header[62:]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', type=Path)
    ap.add_argument('output', type=Path)
    ap.add_argument('--pref', action='append', default=[], metavar='NAME=VALUE',
                    help='default pref; VALUE is a JS literal, e.g. false or "text"')
    a = ap.parse_args()
    prefs = dict(p.split('=', 1) for p in a.pref)
    block = ('// BEGIN Linux on Web slim package defaults\n'
             + ''.join(f'pref("{k}", {v});\n' for k, v in prefs.items())
             + '// END Linux on Web slim package defaults\n').encode()
    source_manifest = json.loads((a.source / 'boot-manifest.json').read_text())
    source_report = json.loads((a.source / 'package.json').read_text())
    if source_report.get('passPackage') is not True:
        raise ValueError('source package does not report passPackage')
    asset = source_manifest['assets']['firefox']
    source = a.source / ARCHIVE
    if source.stat().st_size != asset['bytes'] or file_sha(source) != asset['sha256']:
        raise ValueError('source archive does not match its manifest')

    a.output.mkdir()
    archive = a.output / ARCHIVE
    seen, hashes, dropped = set(), {}, {}
    with gzip.open(source, 'rb') as src, archive.open('xb') as target, \
            gzip.GzipFile(filename='', fileobj=target, mode='wb', mtime=0, compresslevel=6) as dst:
        while True:
            header = exact(src, 110)
            values = fields(header)
            name_raw = exact(src, values[11])
            name = name_raw.rstrip(b'\0').decode()
            padding = exact(src, -(110 + values[11]) % 4)
            size = values[6]
            if name in seen:
                raise ValueError('duplicate archive path ' + name)
            seen.add(name)
            if name in DROP or name in LINKS:
                if stat.S_IFMT(values[1]) != stat.S_IFREG:
                    raise ValueError('expected regular file ' + name)
                hashes[name] = body_sha(src, size)
                exact(src, -size % 4)
                if name in LINKS:
                    target_name = LINKS[name]
                    if hashes.get(target_name) != hashes[name]:
                        raise ValueError(f'{name} is not identical to earlier {target_name}')
                    body = Path(target_name).name.encode()
                    dst.write(with_size(header, len(body), stat.S_IFLNK | 0o777) + name_raw + padding
                              + body + b'\0' * (-len(body) % 4))
                else:
                    dropped[name] = {'bytes': size, 'sha256': hashes[name]}
                continue
            if name == PREFS_FILE and prefs:
                if stat.S_IFMT(values[1]) != stat.S_IFREG:
                    raise ValueError('expected regular file ' + name)
                body = exact(src, size) + block
                exact(src, -size % 4)
                dst.write(with_size(header, len(body)) + name_raw + padding + body + b'\0' * (-len(body) % 4))
                continue
            dst.write(header + name_raw + padding)
            sha = body_sha(src, size, dst)
            if name in LINKS.values():
                hashes[name] = sha
            dst.write(exact(src, -size % 4))
            if name == 'TRAILER!!!':
                dst.write(src.read())
                break
    if set(dropped) != DROP or not set(LINKS) <= seen or (prefs and PREFS_FILE not in seen):
        raise ValueError('expected records missing')

    sha, size = file_sha(archive), archive.stat().st_size
    manifest = json.loads(json.dumps(source_manifest))
    manifest['version'] = sha[:12]
    manifest['assets']['firefox'].update(bytes=size, sha256=sha, label=asset['label'] + ' (slim)')
    (a.output / 'boot-manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    report = {**source_report, 'version': sha[:12],
              'archive': {'path': str(archive.resolve()), 'bytes': size, 'sha256': sha},
              'slim': {'source': {'path': str(source.resolve()), 'bytes': asset['bytes'], 'sha256': asset['sha256']},
                       'recipe': {'path': str(Path(__file__).resolve()), 'sha256': file_sha(Path(__file__))},
                       'dropped': dropped, 'symlinks': LINKS, 'prefs': prefs}}
    (a.output / 'package.json').write_text(json.dumps(report, indent=1) + '\n')
    print(json.dumps(report['archive']))


if __name__ == '__main__':
    main()
