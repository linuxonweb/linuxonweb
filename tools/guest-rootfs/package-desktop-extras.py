#!/usr/bin/env python3
"""Build the default desktop extras overlay without replacing a frozen base rootfs."""
import argparse
import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path
from importlib.machinery import SourceFileLoader
ROOT = Path(__file__).resolve().parents[2]
BENCH = Path('/mnt/p6/build/bench-src')
# The benchmarks reach the guest Vulkan ICD directly (vkmark) or through Mesa Zink
# (glmark2); the wrapper keeps any driver variables the caller already set.
GLMARK2 = b"""#!/bin/busybox sh
export MESA_LOADER_DRIVER_OVERRIDE=${MESA_LOADER_DRIVER_OVERRIDE-zink} LIBGL_ALWAYS_SOFTWARE=${LIBGL_ALWAYS_SOFTWARE-1}
export GUEST_VK_DEVICE_TYPE=${GUEST_VK_DEVICE_TYPE-cpu} GALLIUM_THREAD=${GALLIUM_THREAD-0}
exec /usr/libexec/glmark2/glmark2 "$@"
"""
newc_entry = SourceFileLoader('gputest_package', str(ROOT / 'tools/guest-rootfs/package-gputest-glgears.py')).load_module().newc_entry

def write_archive(output, archive, members, manifest=None):
    output = Path(output)
    compressed = gzip.compress(archive, compresslevel=6, mtime=0)
    metadata = dict(manifest or {})
    metadata.update(schema=1, bytes=len(archive), sha256=hashlib.sha256(archive).hexdigest(),
                    members=members, gzip={'bytes':len(compressed),'sha256':hashlib.sha256(compressed).hexdigest()})
    payloads = [(output, archive), (Path(str(output) + '.gz'), compressed),
                (Path(str(output) + '.json'), (json.dumps(metadata,indent=2)+'\n').encode())]
    staged = []
    try:
        for destination, body in payloads:
            with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.' + output.name + '.', suffix='.tmp', delete=False) as stream:
                staged.append((Path(stream.name), destination))
                stream.write(body)
        # Complete raw and gzip bytes become visible before metadata names them.
        for temporary, destination in staged:
            os.replace(temporary, destination)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    return metadata

def existing_archive_members(archive):
    """Check a standalone newc archive against its declared member inventory."""
    members = {}
    names = set()
    offset = 0
    while offset + 110 <= len(archive):
        header = archive[offset:offset + 110]
        if header[:6] != b'070701':
            raise ValueError('Expected an unchecksummed newc extras archive')
        fields = [int(header[index:index + 8], 16) for index in range(6, 110, 8)]
        mode, size, namesize = fields[1], fields[6], fields[11]
        if not 1 <= namesize <= 4096:
            raise ValueError('Invalid extras member name size')
        name_end = offset + 110 + namesize
        if name_end > len(archive):
            raise ValueError('Truncated extras member name')
        encoded = archive[offset + 110:name_end]
        if encoded[-1:] != b'\0' or b'\0' in encoded[:-1]:
            raise ValueError('Invalid extras member name')
        name = encoded[:-1].decode('utf-8')
        if name.startswith('./'):
            name = name[2:]
        if not name or any(part in ('', '.', '..') for part in name.split('/')):
            raise ValueError('Unsafe extras member name')
        if name in names:
            raise ValueError('Duplicate extras member: ' + name)
        names.add(name)
        start = (name_end + 3) & ~3
        end = start + size
        if end > len(archive):
            raise ValueError('Truncated extras member')
        offset = (end + 3) & ~3
        if offset > len(archive):
            raise ValueError('Truncated extras padding')
        if name == 'TRAILER!!!':
            if size or any(archive[offset:]):
                raise ValueError('Invalid extras trailer or trailing data')
            return members
        if mode & 0o170000 != 0o040000:
            body = archive[start:end]
            members['/' + name] = {'bytes': size, 'sha256': hashlib.sha256(body).hexdigest()}
    raise ValueError('Extras archive lacks a complete trailer')

def package_existing_archive(source, manifest_path, output):
    """Create a fresh gzip bundle without rebuilding or changing any raw member."""
    source, manifest_path, output = Path(source), Path(manifest_path), Path(output)
    if source.is_symlink() or manifest_path.is_symlink() or not source.is_file() or not manifest_path.is_file():
        raise ValueError('Existing archive and manifest must be regular files')
    targets = [output, Path(str(output) + '.gz'), Path(str(output) + '.json')]
    if any(path.exists() or path.is_symlink() for path in targets):
        raise ValueError('Existing-archive mode requires fresh output files')
    if not output.parent.is_dir():
        raise ValueError('Output parent must already exist')
    if any(path.resolve() in (source.resolve(), manifest_path.resolve()) for path in targets):
        raise ValueError('Existing archive inputs and outputs must not overlap')
    if manifest_path.stat().st_size > 2 * 1024**2:
        raise ValueError('Existing extras manifest is too large')
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if (not isinstance(manifest, dict) or type(manifest.get('schema')) is not int
            or manifest.get('schema') != 1 or type(manifest.get('bytes')) is not int
            or not 1 <= manifest['bytes'] <= 64 * 1024**2
            or source.stat().st_size != manifest['bytes']):
        raise ValueError('Invalid existing extras size or schema')
    archive = source.read_bytes()
    digest = hashlib.sha256(archive).hexdigest()
    if len(archive) != manifest['bytes'] or digest != manifest.get('sha256'):
        raise ValueError('Existing extras archive hash/size mismatch')
    declared = manifest.get('members')
    if not isinstance(declared, list):
        raise ValueError('Existing extras member inventory missing')
    bindings = {}
    for row in declared:
        if (not isinstance(row, dict) or not isinstance(row.get('path'), str)
                or row['path'] in bindings or type(row.get('bytes')) is not int):
            raise ValueError('Invalid or duplicate extras member declaration')
        bindings[row['path']] = {'bytes': row['bytes'], 'sha256': row.get('sha256')}
    if bindings != existing_archive_members(archive):
        raise ValueError('Existing extras member inventory does not match raw bytes')
    # Input bytes and all non-gzip metadata are retained; only the companion is new.
    return write_archive(output, archive, declared, manifest=manifest)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    inputs = p.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--build', type=Path)
    inputs.add_argument('--existing-archive', type=Path, help='Preserve a verified raw archive and add its gzip companion')
    p.add_argument('--manifest', type=Path, help='Existing archive manifest; defaults to ARCHIVE.json')
    p.add_argument('--output', type=Path)
    p.add_argument('--glmark2-source', type=Path, default=BENCH / 'glmark2')
    p.add_argument('--vkmark-source', type=Path, default=BENCH / 'vkmark')
    a = p.parse_args()
    if a.existing_archive is not None:
        if a.output is None:
            p.error('--existing-archive requires an explicit fresh --output')
        manifest = package_existing_archive(a.existing_archive, a.manifest or Path(str(a.existing_archive) + '.json'), a.output)
        print(json.dumps(manifest, indent=2))
        return
    if a.manifest is not None:
        p.error('--manifest requires --existing-archive')
    a.output = a.output or ROOT / 'web/linux/desktop-extras.cpio'
    archive = bytearray()
    members = []
    dirs = set()
    def add(path, mode, data):
        parts = path.split('/')
        for i in range(1, len(parts)):
            if '/'.join(parts[:i]) not in dirs:
                dirs.add('/'.join(parts[:i])); archive.extend(newc_entry(len(dirs) + len(members) + 1, '/'.join(parts[:i]), 0o40755, b''))
        archive.extend(newc_entry(len(dirs) + len(members) + 1, path, mode, data))
        members.append({'path':'/' + path, 'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    def wasm(name):
        data = (a.build / (name + '.wasm')).read_bytes()
        if data[:4] != b'\0asm': raise ValueError('not Wasm: ' + name)
        return data
    for name in ['clipboard-bridge','xclip','glgears','vkgears','vkmark']:
        add('bin/' + name, 0o100755, wasm(name))
    # vkmark lists *.so names in its plugin directory; the XCB plugin is linked
    # into the binary and its dlopen wrapper resolves this name to it.
    add('usr/lib/vkmark/xcb.so', 0o100644, b'vkmark XCB window system: statically linked into /bin/vkmark\n')
    add('usr/libexec/glmark2/glmark2', 0o100755, wasm('glmark2'))
    add('bin/glmark2', 0o100755, GLMARK2)
    for bench, source in [('glmark2', a.glmark2_source), ('vkmark', a.vkmark_source)]:
        for kind in ['models', 'shaders', 'textures']:
            for path in sorted((source / 'data' / kind).rglob('*')):
                if path.is_file(): add(f'usr/share/{bench}/{kind}/' + path.relative_to(source / 'data' / kind).as_posix(), 0o100644, path.read_bytes())
    for name in ['COPYING', 'UPSTREAM']:
        add('usr/share/doc/xclip/' + name, 0o100644, (ROOT / 'tools/guest-rootfs/xclip' / name).read_bytes())
    for name in ['COPYING', 'COPYING.SGI']:
        add('usr/share/doc/glmark2/' + name, 0o100644, (a.glmark2_source / name).read_bytes())
    add('usr/share/doc/vkmark/COPYING-LGPL2.1', 0o100644, (a.vkmark_source / 'COPYING-LGPL2.1').read_bytes())
    archive.extend(newc_entry(0,'TRAILER!!!',0,b'')); archive.extend(b'\0' * (-len(archive)%512))
    manifest = write_archive(a.output, archive, members)
    print(json.dumps(manifest,indent=2))
if __name__ == '__main__': main()
