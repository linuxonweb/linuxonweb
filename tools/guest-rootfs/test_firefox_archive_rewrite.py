import gzip
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('rewrite', Path(__file__).with_name('rewrite-firefox-archive.py'))
REWRITE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REWRITE)


def record(name, body=b'', mode=0o100644, inode=1):
    encoded = name.encode() + b'\0'
    fields = [inode, mode, 41, 42, 1, 1234, len(body), 0, 0, 0, 0, len(encoded), 0]
    header = b'070701' + ''.join(f'{value:08x}' for value in fields).encode()
    prefix = header + encoded
    return prefix + bytes(-len(prefix) % 4) + body + bytes(-len(body) % 4)


def records(raw):
    stream = io.BytesIO(raw)
    result = {}
    while True:
        start = stream.tell()
        header = stream.read(110)
        fields = [int(header[offset:offset + 8], 16) for offset in range(6, 110, 8)]
        name = stream.read(fields[11])[:-1].decode()
        stream.read(-(110 + fields[11]) % 4)
        body = stream.read(fields[6])
        stream.read(-fields[6] % 4)
        result[name] = (body, fields, raw[start:stream.tell()])
        if name == 'TRAILER!!!':
            return result


class FirefoxArchiveRewriteTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source.gz'
        self.destination = self.root / 'candidate.gz'
        self.native = b'\0asm\x01\0\0\0unchanged native'
        self.raw = b''.join([
            record('opt', mode=0o40755), record('opt/firefox', mode=0o40755),
            record('opt/firefox/modules', mode=0o40755),
            record('opt/firefox/firefox', self.native, 0o100755, 8),
            record('opt/firefox/firefox-bin', b'firefox', 0o120777, 9),
            record('opt/firefox/modules/test.mjs', b'export const value = 42;', inode=10),
            record('init', b'#!/bin/sh\nkeep init\n', 0o100755, 11),
            record('home/admin/keep.txt', b'preserve user file', inode=12),
            record('TRAILER!!!', mode=0, inode=13),
        ]) + bytes(64)
        self.source.write_bytes(gzip.compress(self.raw, mtime=0))
        self.jar = self.root / 'omni.ja'
        self.jar.write_bytes(b'jar bytes already verified by resource packager')

    def rewrite(self, changes):
        return REWRITE.replace_firefox_files(self.source, self.destination, changes)

    def test_selected_resources_replaced_and_all_other_records_byte_identical(self):
        self.rewrite({'opt/firefox/modules/test.mjs': None, 'opt/firefox/omni.ja': self.jar})
        before = records(self.raw)
        after = records(gzip.decompress(self.destination.read_bytes()))
        self.assertNotIn('opt/firefox/modules/test.mjs', after)
        self.assertEqual(after['opt/firefox/omni.ja'][0], self.jar.read_bytes())
        for name in before.keys() - {'opt/firefox/modules/test.mjs'}:
            self.assertEqual(after[name][2], before[name][2], name)
        self.assertEqual(gzip.decompress(self.source.read_bytes()), self.raw)

    def test_changed_or_removed_native_is_rejected_before_output(self):
        for value in [None, self.jar]:
            with self.assertRaises(ValueError):
                self.rewrite({'opt/firefox/firefox': value})
            self.assertFalse(self.destination.exists())

    def test_non_firefox_changes_and_nonregular_overwrites_are_rejected(self):
        for name in ['init', 'home/admin/keep.txt', 'opt/firefox/../other',
                     'opt/firefox/firefox-bin', 'opt/firefox/modules']:
            with self.assertRaises(ValueError):
                self.rewrite({name: self.jar})
            self.assertFalse(self.destination.exists())

    def test_missing_removal_and_missing_parent_are_rejected(self):
        for changes in [{'opt/firefox/missing': None}, {'opt/firefox/missing/omni.ja': self.jar}]:
            with self.assertRaises(ValueError):
                self.rewrite(changes)
            self.assertFalse(self.destination.exists())

    def test_duplicate_unsafe_and_truncated_archives_are_rejected(self):
        for raw in [record('../escape') + self.raw, record('init') + self.raw, self.raw[:145]]:
            self.source.write_bytes(gzip.compress(raw, mtime=0))
            with self.assertRaises(ValueError):
                self.rewrite({})
            self.assertFalse(self.destination.exists())

    def test_existing_destination_and_symlink_replacement_are_rejected(self):
        self.destination.write_bytes(b'keep rollback')
        with self.assertRaises(ValueError):
            self.rewrite({})
        self.assertEqual(self.destination.read_bytes(), b'keep rollback')
        self.destination.unlink()
        link = self.root / 'link'
        link.symlink_to(self.jar)
        with self.assertRaises(ValueError):
            self.rewrite({'opt/firefox/omni.ja': link})
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
