#!/usr/bin/env python3
"""Build the default desktop extras overlay without replacing a frozen base rootfs."""
import argparse
import hashlib
import json
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

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--build', type=Path, required=True)
    p.add_argument('--output', type=Path, default=ROOT / 'web/linux/desktop-extras.cpio')
    p.add_argument('--glmark2-source', type=Path, default=BENCH / 'glmark2')
    p.add_argument('--vkmark-source', type=Path, default=BENCH / 'vkmark')
    a = p.parse_args()
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
    a.output.write_bytes(archive)
    manifest = {'schema':1,'bytes':len(archive),'sha256':hashlib.sha256(archive).hexdigest(),'members':members}
    Path(str(a.output)+'.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))
if __name__ == '__main__': main()
