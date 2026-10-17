import gzip
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('candidate_package', Path(__file__).with_name('gpt6-codex-package.py'))
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def record(name, body, mode=stat.S_IFREG | 0o755, links=1):
    encoded_name = name.encode() + b'\0'
    fields = [13, mode, 1000, 1000, links, 123456, len(body), 0, 0, 0, 0, len(encoded_name), 0]
    header = b'070701' + b''.join(f'{value:08x}'.encode() for value in fields)
    return header + encoded_name + b'\0' * (-(110 + len(encoded_name)) % 4) + body + b'\0' * (-len(body) % 4)


class PackageTest(unittest.TestCase):
    def setUp(self):
        scratch = Path(os.environ['TMPDIR']).resolve()
        self.assertTrue(str(scratch).startswith('/mnt/'))
        self.root = Path(tempfile.mkdtemp(prefix='package-', dir=scratch))
        self.old = b'\0asm\x01\0\0\0old'
        self.new = b'\0asm\x01\0\0\0candidate-body'
        self.binary = self.root / 'firefox.wasm'
        self.binary.write_bytes(self.new)
        self.source = self.root / 'source.gz'
        self.output = self.root / 'candidate.gz'
        self.before = record('init', b'original init')
        self.after = record('home/admin/settings', b'keep settings') + record('opt/firefox/firefox-bin', b'firefox', stat.S_IFLNK | 0o777)
        self.trailer = record('TRAILER!!!', b'') + b'\0' * 16

    def write_source(self, middle=None):
        body = self.before + (middle if middle is not None else record('opt/firefox/firefox', self.old)) + self.after + self.trailer
        self.source.write_bytes(gzip.compress(body, mtime=0))
        return digest(self.source.read_bytes())

    def package(self, source_sha=None, old_sha=None, binary_sha=None):
        return PACKAGE.package(self.source, self.output, source_sha or digest(self.source.read_bytes()), self.binary,
                               old_sha or digest(self.old), binary_sha or digest(self.new))

    def test_only_native_body_and_size_change(self):
        self.write_source()
        result = self.package()
        expected = self.before + record('opt/firefox/firefox', self.new) + self.after + self.trailer
        self.assertEqual(gzip.decompress(self.output.read_bytes()), expected)
        self.assertEqual(result['changed'], ['opt/firefox/firefox'])
        self.assertFalse(result['runtimeAcceptance'])

    def test_pins_reject_wrong_source_old_or_candidate(self):
        self.write_source()
        for name in ['source_sha', 'old_sha', 'binary_sha']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.package(**{name: '0' * 64})
            self.assertFalse(self.output.exists())

    def test_existing_output_and_source_are_preserved(self):
        self.write_source()
        before = self.source.read_bytes()
        self.output.write_bytes(b'existing user data')
        with self.assertRaises(FileExistsError):
            self.package()
        self.assertEqual(self.output.read_bytes(), b'existing user data')
        self.assertEqual(self.source.read_bytes(), before)

    def test_missing_duplicate_symlink_or_hardlinked_native_rejected(self):
        for middle in [b'', record('opt/firefox/firefox', self.old) * 2,
                       record('opt/firefox/firefox', self.old, stat.S_IFLNK | 0o777),
                       record('opt/firefox/firefox', self.old, links=2)]:
            with self.subTest(middle=middle[:20]):
                self.write_source(middle)
                with self.assertRaises(ValueError):
                    self.package()
                self.assertFalse(self.output.exists())

    def test_unsafe_names_and_truncation_rejected(self):
        for middle in [record('../escape', b'bad'), record('bad//path', b'bad'), b'broken']:
            self.write_source(middle)
            with self.assertRaises(ValueError):
                self.package()
            self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
