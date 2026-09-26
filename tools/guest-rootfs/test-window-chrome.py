#!/usr/bin/env python3
import gzip
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('window_package', Path(__file__).with_name('package-window-chrome.py'))
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


def record(name, content):
    name = name.encode() + b'\0'
    fields = [1, 0o100644, 1000, 1000, 1, 123, len(content), 0, 0, 0, 0, len(name), 0]
    header = b'070701' + b''.join(f'{value:08x}'.encode() for value in fields)
    return header + name + b'\0' * (-(110+len(name)) % 4) + content + b'\0' * (-len(content) % 4)


def members(raw):
    result = {}
    pos = 0
    while True:
        header = raw[pos:pos+110]
        size, namesize = int(header[54:62],16), int(header[94:102],16)
        name = raw[pos+110:pos+110+namesize].rstrip(b'\0').decode()
        pos = (pos+110+namesize+3)//4*4
        result[name] = (header[:54] + header[62:], raw[pos:pos+size])
        pos = (pos+size+3)//4*4
        if name == 'TRAILER!!!': return result


class PackageTests(unittest.TestCase):
    def test_exact_overlay_and_trace_opt_in(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)/'base.gz'; out = Path(folder)/'out.gz'
            wm = Path(folder)/'wm'; css = Path(folder)/'chrome'
            wm.write_bytes(b'\0asm\x01\0\0\0new'); css.write_bytes(b'opaque')
            init = b'launch_firefox() {\n export HOME=/home/admin' + package.TRACE_ENV + b'; exec firefox\n}\n'
            original = b''.join(record(n,c) for n,c in [('init',init),('bin/aurora-wm',b'old'),('lowland-userChrome.css',b'old css'),('unchanged',b'keep me'),('TRAILER!!!',b'')])
            base.write_bytes(gzip.compress(original))
            package.package(base,out,package.sha256(base),wm,css)
            before, after = members(original), members(gzip.decompress(out.read_bytes()))
            self.assertEqual(set(before),set(after))
            for key in before: self.assertEqual(before[key][0],after[key][0])
            self.assertEqual(before['unchanged'],after['unchanged'])
            self.assertEqual(after['bin/aurora-wm'][1],wm.read_bytes())
            self.assertIn(b"grep -qw 'firefox_trace=1'",after['init'][1])
            self.assertNotIn(b'XDG_CACHE_HOME'+package.TRACE_ENV,after['init'][1])
            self.assertNotIn(package.TRACE_ENV,after['init'][1].split(b'launch_firefox()')[1])
            again = Path(folder)/'again.gz'
            package.package(out,again,package.sha256(out),wm,css)
            self.assertEqual(gzip.decompress(out.read_bytes()),gzip.decompress(again.read_bytes()))
            with self.assertRaisesRegex(ValueError,'checksum'):
                package.package(base,out,'0'*64,wm,css)
            with self.assertRaisesRegex(ValueError,'separate'):
                package.package(base,base,package.sha256(base),wm,css)

if __name__ == '__main__': unittest.main()
