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

    def test_gzip_is_one_member_without_name_or_timestamp(self):
        # Chromium DecompressionStream rejects concatenated members, while
        # Python gzip.decompress accepts them, so check the stream structure.
        import zlib
        payload = os.urandom(4096) + b'compressible tail' * 4096
        target = self.root / 'single.cpio'
        PACKER.write_archive(target, payload, [])
        compressed = Path(str(target) + '.gz').read_bytes()
        self.assertEqual(compressed[:4], b'\x1f\x8b\x08\x00')  # deflate, no FNAME/FEXTRA/FCOMMENT
        self.assertEqual(compressed[4:8], b'\0\0\0\0')  # mtime 0
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        self.assertEqual(decoder.decompress(compressed) + decoder.flush(), payload)
        self.assertTrue(decoder.eof)
        self.assertEqual(decoder.unused_data, b'')

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


    def existing_fixture(self):
        content = b'\0asm\x01\0\0\0'
        link = b'app'
        entries = [
            ('bin', 0o40755, b''),
            ('bin/app', 0o100755, content),
            ('bin/alias', 0o120777, link),
        ]
        raw = b''.join(PACKER.newc_entry(index + 1, name, mode, data)
                       for index, (name, mode, data) in enumerate(entries))
        raw += PACKER.newc_entry(0, 'TRAILER!!!', 0, b'')
        raw += b'\0' * (-len(raw) % 512)
        members = [{'path': '/' + name, 'bytes': len(data),
                    'sha256': hashlib.sha256(data).hexdigest()}
                   for name, mode, data in entries if mode != 0o40755]
        manifest = {'schema': 1, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                    'members': members, 'provenance': {'fixture': 'preserve this metadata'}}
        source = self.root / 'original.cpio'
        source.write_bytes(raw)
        metadata = Path(str(source) + '.json')
        metadata.write_text(json.dumps(manifest) + '\n')
        return source, metadata, raw, manifest

    def test_existing_cli_preserves_archive_aliases_and_original_metadata(self):
        source, metadata, raw, manifest = self.existing_fixture()
        original_metadata = metadata.read_bytes()
        output = self.root / 'desktop-extras.cpio'
        completed = subprocess.run([
            sys.executable, '-B', str(SCRIPT), '--existing-archive', str(source),
            '--output', str(output),
        ], capture_output=True, timeout=15, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr.decode())
        actual = json.loads(Path(str(output) + '.json').read_text())
        self.assertEqual({key: value for key, value in actual.items() if key != 'gzip'}, manifest)
        self.assertEqual(output.read_bytes(), raw)
        self.assertEqual(gzip.decompress(Path(str(output) + '.gz').read_bytes()), raw)
        self.assertEqual(source.read_bytes(), raw)
        self.assertEqual(metadata.read_bytes(), original_metadata)
        self.assertEqual(actual['gzip']['sha256'],
                         hashlib.sha256(Path(str(output) + '.gz').read_bytes()).hexdigest())

    def test_existing_archive_rejects_false_hash_or_member_inventory_without_output(self):
        source, metadata, raw, manifest = self.existing_fixture()
        for label, change in [
            ('archive-hash', lambda item: item.update(sha256='0' * 64)),
            ('member-hash', lambda item: item['members'][0].update(sha256='0' * 64)),
            ('missing-member', lambda item: item['members'].pop()),
            ('duplicate-member', lambda item: item['members'].append(item['members'][0])),
        ]:
            with self.subTest(label=label):
                changed = json.loads(json.dumps(manifest))
                change(changed)
                metadata.write_text(json.dumps(changed))
                output = self.root / (label + '.cpio')
                with self.assertRaises(ValueError):
                    PACKER.package_existing_archive(source, metadata, output)
                self.assertFalse(output.exists())
                self.assertFalse(Path(str(output) + '.gz').exists())
                self.assertFalse(Path(str(output) + '.json').exists())
        self.assertEqual(source.read_bytes(), raw)

    def test_existing_archive_requires_fresh_outputs_and_regular_inputs(self):
        source, metadata, raw, manifest = self.existing_fixture()
        output = self.root / 'occupied.cpio'
        output.write_bytes(b'preserve previous output')
        with self.assertRaisesRegex(ValueError, 'fresh output'):
            PACKER.package_existing_archive(source, metadata, output)
        self.assertEqual(output.read_bytes(), b'preserve previous output')
        link = self.root / 'source-link.cpio'
        link.symlink_to(source)
        with self.assertRaisesRegex(ValueError, 'regular files'):
            PACKER.package_existing_archive(link, metadata, self.root / 'unwritten.cpio')

    def test_existing_archive_rejects_truncated_cpio_even_with_matching_outer_hash(self):
        source, metadata, raw, manifest = self.existing_fixture()
        truncated = raw[:100]
        source.write_bytes(truncated)
        manifest.update(bytes=len(truncated), sha256=hashlib.sha256(truncated).hexdigest())
        metadata.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'complete trailer'):
            PACKER.package_existing_archive(source, metadata, self.root / 'truncated.cpio')


if __name__ == '__main__':
    unittest.main()
