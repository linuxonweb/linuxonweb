#!/usr/bin/env python3
"""Build the default desktop extras overlay without replacing a frozen base rootfs."""
import argparse
import hashlib
import json
from pathlib import Path
from importlib.machinery import SourceFileLoader
ROOT = Path(__file__).resolve().parents[2]
newc_entry = SourceFileLoader('gputest_package', str(ROOT / 'tools/guest-rootfs/package-gputest-glgears.py')).load_module().newc_entry

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--build', type=Path, required=True)
    p.add_argument('--output', type=Path, default=ROOT / 'web/linux/desktop-extras.cpio')
    a = p.parse_args()
    archive = bytearray()
    members = []
    for i,name in enumerate(['clipboard-bridge','xclip','glgears','vkgears'],1):
        data = (a.build / (name + '.wasm')).read_bytes()
        if data[:4] != b'\0asm': raise ValueError('not Wasm: ' + name)
        archive.extend(newc_entry(i, 'bin/' + name, 0o100755, data))
        members.append({'path':'/bin/' + name, 'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    for name in ['usr', 'usr/share', 'usr/share/doc', 'usr/share/doc/xclip']:
        archive.extend(newc_entry(5, name, 0o40755, b''))
    for name in ['COPYING', 'UPSTREAM']:
        archive.extend(newc_entry(5, 'usr/share/doc/xclip/' + name, 0o100644, (ROOT / 'tools/guest-rootfs/xclip' / name).read_bytes()))
    archive.extend(newc_entry(0,'TRAILER!!!',0,b'')); archive.extend(b'\0' * (-len(archive)%512))
    a.output.write_bytes(archive)
    manifest = {'schema':1,'bytes':len(archive),'sha256':hashlib.sha256(archive).hexdigest(),'members':members}
    Path(str(a.output)+'.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))
if __name__ == '__main__': main()
