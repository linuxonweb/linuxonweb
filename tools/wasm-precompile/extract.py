#!/usr/bin/env python3
"""Extract the Firefox main wasm module from a (gzip) newc cpio guest image.

Usage: extract.py IMAGE.cpio[.gz] [OUT_DIR] [--member opt/firefox/firefox]
Writes OUT_DIR/<sha256>.wasm (default OUT_DIR: web/linux/precompile) and
prints the page URL for ?wasm-precompile=. Writes via a temp name + rename.
The port-3000 server serves /linux/initramfs-firefox.cpio.gz from
web/desktop/latest-build/ when present (read-only input), else web/linux/.
"""
import argparse, gzip, hashlib, os, sys

ap = argparse.ArgumentParser()
ap.add_argument('image')
ap.add_argument('out_dir', nargs='?', default=os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'linux', 'precompile'))
ap.add_argument('--member', default='opt/firefox/firefox')
args = ap.parse_args()

with open(args.image, 'rb') as probe:
    magic = probe.read(2)
f = gzip.open(args.image, 'rb') if magic == b'\x1f\x8b' else open(args.image, 'rb')

def rd(n):
    b = f.read(n)
    if len(b) != n:
        sys.exit('truncated cpio')
    return b

data = None
while True:
    h = rd(110)
    if h[:6] not in (b'070701', b'070702'):
        sys.exit('not a newc cpio archive')
    fld = [int(h[6 + 8 * i:14 + 8 * i], 16) for i in range(13)]
    size, namesize = fld[6], fld[11]
    name = rd(namesize)[:-1].decode()
    rd((-(110 + namesize)) % 4)
    if name == 'TRAILER!!!':
        break
    body = rd(size)
    rd((-size) % 4)
    if name.lstrip('./') == args.member:
        data = body  # last occurrence wins, as when unpacking
if data is None:
    sys.exit(f'{args.member} not found in {args.image}')
if data[:4] != b'\0asm':
    sys.exit(f'{args.member} is not a wasm module')
digest = hashlib.sha256(data).hexdigest()
os.makedirs(args.out_dir, exist_ok=True)
out = os.path.join(args.out_dir, f'{digest}.wasm')
if not (os.path.exists(out) and os.path.getsize(out) == len(data)):
    tmp = out + '.tmp'
    with open(tmp, 'wb') as w:
        w.write(data)
    os.replace(tmp, out)
print(f'{len(data)} {digest}')
print(f'wasm-precompile=/linux/precompile/{digest}.wasm')
