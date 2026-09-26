#!/usr/bin/env python3
"""Preserve the deployed CPIO, overlay only its init, and emit a boot manifest.

Inputs require an explicit SHA-256; never replace the source archive in place.
The transformation is intentionally independent of the generic init.sh so all
previous Firefox, font, certificate, picker, PTY and display fixes survive.
"""
import argparse
import gzip
import hashlib
import json
import os
from contextlib import nullcontext
from pathlib import Path
import tempfile

MOUNT = '''# Durable home is a separate browser-backed virtio-fs volume.
# sync/dirsync keeps guest writes out of a delayed writeback cache; the host
# acknowledges each operation only after its IndexedDB transaction commits.
if grep -qw 'home.persistent=1' /proc/cmdline; then
  mkdir -p /home
  if ! mount -t virtiofs -o rw,sync,dirsync home /home; then
    echo 'home: FAILED to mount persistent storage; desktop startup stopped' >&2
    exec setsid cttyhack sh
  fi
  echo 'home: persistent storage mounted' >&2
fi

'''


def transform_init(data):
    text = data.decode()
    if 'home: persistent storage mounted' in text:
        raise ValueError('persistent home overlay already present')
    anchor = '# Give the guest desktop account access'
    if text.count(anchor) != 1:
        raise ValueError('unknown init device setup')
    text = text.replace(anchor, MOUNT + anchor)
    start = text.index('echo "hello from aurora-wm on wasm"')
    end_anchor = 'chown 1000:1000 /home/admin/Documents/* /home/admin/Downloads/* 2>/dev/null || true'
    end = text.index(end_anchor, start) + len(end_anchor)
    seed = text[start:end]
    text = text[:start] + 'if [ ! -e /home/admin/.linuxonweb-seeded ]; then\n' + seed + '\ntouch /home/admin/.linuxonweb-seeded\nchown 1000:1000 /home/admin/.linuxonweb-seeded\nfi' + text[end:]
    # Avoid walking an arbitrarily large saved home on every boot.
    text = text.replace('chown -R 1000:1000 /home/admin\n', 'chown 1000:1000 /home/admin /home/admin/Desktop /home/admin/Documents /home/admin/Downloads\n')
    text = text.replace('chown -R 1000:1000 /home/admin /home/firefox', 'chown 1000:1000 /home/admin /home/admin/.mozilla /home/admin/.cache /home/firefox /home/firefox/.mozilla /home/firefox/.cache')
    if "<<'LOWLAND_HTTP1_PREFS'" in text:
        text = text.replace("  cat > /home/admin/.mozilla/firefox/http1-profile/user.js <<'LOWLAND_HTTP1_PREFS'", "  if [ ! -e /home/admin/.mozilla/firefox/http1-profile/user.js ]; then\n  cat > /home/admin/.mozilla/firefox/http1-profile/user.js <<'LOWLAND_HTTP1_PREFS'")
        text = text.replace('\nLOWLAND_HTTP1_PREFS\n', '\nLOWLAND_HTTP1_PREFS\n  fi\n')
        old = '  cp /nss-ca-profile/cert9.db /nss-ca-profile/key4.db /nss-ca-profile/pkcs11.txt /home/admin/.mozilla/firefox/http1-profile/'
        if text.count(old) != 1:
            raise ValueError('unknown NSS profile initialization')
        text = text.replace(old, '''  for profile_file in cert9.db key4.db pkcs11.txt; do
    if [ ! -e "/home/admin/.mozilla/firefox/http1-profile/$profile_file" ]; then
      cp "/nss-ca-profile/$profile_file" /home/admin/.mozilla/firefox/http1-profile/
    fi
  done''')
        text = text.replace('  cp /lowland-userChrome.css /home/admin/.mozilla/firefox/http1-profile/chrome/userChrome.css', '  [ -e /home/admin/.mozilla/firefox/http1-profile/chrome/userChrome.css ] || cp /lowland-userChrome.css /home/admin/.mozilla/firefox/http1-profile/chrome/userChrome.css')
        text = text.replace('chown -R 1000:1000 /opt/firefox/fonts /home/admin/.mozilla/firefox/http1-profile', 'chown -R 1000:1000 /opt/firefox/fonts\n  chown 1000:1000 /home/admin/.mozilla/firefox /home/admin/.mozilla/firefox/http1-profile /home/admin/.mozilla/firefox/http1-profile/chrome /home/admin/.mozilla/firefox/http1-profile/user.js /home/admin/.mozilla/firefox/http1-profile/cert9.db /home/admin/.mozilla/firefox/http1-profile/key4.db /home/admin/.mozilla/firefox/http1-profile/pkcs11.txt /home/admin/.mozilla/firefox/http1-profile/chrome/userChrome.css')
    console_anchor = 'if [ -r /etc/fonts/fonts.conf ]; then'
    if text.count(console_anchor) != 1:
        raise ValueError('unknown font setup')
    text = text.replace(console_anchor, "if grep -qw 'demo.mode=console' /proc/cmdline; then\n  cd /home/admin\n  exec setsid cttyhack sh\nfi\n\n" + console_anchor)
    return text.encode()


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def exact(stream, size):
    data = stream.read(size)
    if len(data) != size:
        raise ValueError('truncated newc archive')
    return data


def package(source, destination, expected):
    if source.resolve() == destination.resolve() or digest(source) != expected:
        raise ValueError('source must match expected SHA and differ from destination')
    with source.open('rb') as stream:
        compressed = stream.read(2) == b'\x1f\x8b'
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=destination.name + '.', dir=destination.parent)
    touched = 0
    try:
        with (gzip.open if compressed else open)(source, 'rb') as inp, os.fdopen(fd, 'wb') as raw:
            with (gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) if compressed else nullcontext(raw)) as out:
                while True:
                    header = exact(inp, 110)
                    if header[:6] != b'070701':
                        raise ValueError('expected newc archive')
                    size, namesize = int(header[54:62], 16), int(header[94:102], 16)
                    name = exact(inp, namesize)
                    padding = exact(inp, (-(110 + namesize)) % 4)
                    key = name.rstrip(b'\0').decode().removeprefix('./').lstrip('/')
                    if key == 'init':
                        data = exact(inp, size)
                        exact(inp, (-size) % 4)
                        data = transform_init(data)
                        out.write(header[:54] + f'{len(data):08x}'.encode() + header[62:] + name + padding)
                        out.write(data + b'\0' * ((-len(data)) % 4))
                        touched += 1
                    else:
                        out.write(header + name + padding)
                        remaining = size + (-size) % 4
                        while remaining:
                            chunk = exact(inp, min(remaining, 1024 * 1024))
                            out.write(chunk)
                            remaining -= len(chunk)
                    if key == 'TRAILER!!!':
                        out.write(inp.read())
                        break
        if touched != 1:
            raise ValueError('init must occur exactly once')
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(digest(destination), destination)


def manifest(directory):
    assets = {}
    for key, filename, label in [('kernel', 'vmlinux.wasm', 'Linux kernel'), ('plain', 'initramfs.cpio', 'Desktop system'), ('firefox', 'initramfs-firefox.cpio.gz', 'Firefox system')]:
        path = directory / filename
        assets[key] = {'url': './' + filename, 'bytes': path.stat().st_size, 'sha256': digest(path), 'label': label}
    version = hashlib.sha256(json.dumps(assets, sort_keys=True).encode()).hexdigest()[:12]
    (directory / 'boot-manifest.json').write_text(json.dumps({'schema': 1, 'version': version, 'assets': assets}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, nargs='?')
    parser.add_argument('destination', type=Path, nargs='?')
    parser.add_argument('--expected-sha256')
    parser.add_argument('--manifest', type=Path, help='write boot-manifest.json for finalized assets in this directory')
    args = parser.parse_args()
    if args.manifest:
        manifest(args.manifest)
    elif args.source and args.destination and args.expected_sha256:
        package(args.source, args.destination, args.expected_sha256)
    else:
        parser.error('provide source destination --expected-sha256, or --manifest DIRECTORY')
