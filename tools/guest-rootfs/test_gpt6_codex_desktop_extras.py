import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('package-desktop-extras.py')
SPEC = importlib.util.spec_from_file_location('desktop_extras', SCRIPT)
PACKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKER)


class DesktopExtrasPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='extras-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_raw_and_gzip_assets_have_bound_manifest_hashes(self):
        payload = bytearray(b'preserved bytes\0' * 1024)
        members = [{'path': '/bin/app', 'bytes': 8, 'sha256': 'a' * 64}]
        target = self.root / 'gpt6-codex-extras.cpio'
        PACKER.write_archive(target, payload, members)
        metadata = json.loads(Path(str(target) + '.json').read_text())
        compressed = Path(str(target) + '.gz').read_bytes()
        self.assertEqual(target.read_bytes(), payload)
        self.assertEqual(gzip.decompress(compressed), payload)
        self.assertEqual(metadata['schema'], 1)
        self.assertEqual(metadata['bytes'], len(payload))
        self.assertEqual(metadata['sha256'], hashlib.sha256(payload).hexdigest())
        self.assertEqual(metadata['members'], members)
        self.assertEqual(metadata['gzip'], {
            'bytes': len(compressed), 'sha256': hashlib.sha256(compressed).hexdigest()})

    def test_gzip_is_independent_of_output_name_and_wall_clock(self):
        payload = b'unchanged application content' * 100
        first = self.root / 'first.cpio'
        second = self.root / 'second.cpio'
        PACKER.write_archive(first, payload, [])
        PACKER.write_archive(second, payload, [])
        self.assertEqual(Path(str(first) + '.gz').read_bytes(), Path(str(second) + '.gz').read_bytes())
        self.assertEqual(Path(str(first) + '.json').read_bytes(), Path(str(second) + '.json').read_bytes())

    def test_cli_publishes_gzip_and_preserves_every_original_record(self):
        build = self.root / 'build'
        build.mkdir()
        wasm = b'\0asm\x01\0\0\0'
        for name in ['clipboard-bridge', 'xclip', 'glgears', 'vkgears', 'vkmark', 'glmark2']:
            (build / (name + '.wasm')).write_bytes(wasm)
        for name in ['glmark2', 'vkmark']:
            source = self.root / name
            source.mkdir()
            for license_name in ['COPYING', 'COPYING.SGI', 'COPYING-LGPL2.1']:
                (source / license_name).write_bytes(b'fixture license\n')
            (source / 'data' / 'shaders').mkdir(parents=True)
            (source / 'data' / 'shaders' / 'fixture.frag').write_bytes(b'void main() {}\n')
        output = self.root / 'gpt6-codex-cli.cpio'
        completed = subprocess.run([
            sys.executable, str(SCRIPT), '--build', str(build), '--output', str(output),
            '--glmark2-source', str(self.root / 'glmark2'), '--vkmark-source', str(self.root / 'vkmark'),
        ], env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, capture_output=True, timeout=15, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr.decode())
        metadata = json.loads(Path(str(output) + '.json').read_text())
        self.assertIn('gzip', metadata)
        archive = output.read_bytes()
        self.assertEqual(gzip.decompress(Path(str(output) + '.gz').read_bytes()), archive)
        records = {}
        offset = 0
        while archive[offset:offset + 6] == b'070701':
            header = archive[offset:offset + 110]
            size = int(header[54:62], 16)
            name_size = int(header[94:102], 16)
            name = archive[offset + 110:offset + 110 + name_size - 1].decode()
            start = (offset + 110 + name_size + 3) & ~3
            records['/' + name] = archive[start:start + size]
            offset = (start + size + 3) & ~3
        for member in metadata['members']:
            self.assertEqual(len(records[member['path']]), member['bytes'])
            self.assertEqual(hashlib.sha256(records[member['path']]).hexdigest(), member['sha256'])
        self.assertEqual(records['/bin/clipboard-bridge'], wasm)


if __name__ == '__main__':
    unittest.main()
