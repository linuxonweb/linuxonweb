import ast
import hashlib
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source = Path(sys.argv.pop(1))
tree = ast.parse(source.read_text())
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)], type_ignores=[])
namespace = dict(hashlib=hashlib, Path=Path, os=os)
exec(compile(definitions, str(source), 'exec'), namespace)
pin = namespace['pin']


class PinTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(os.environ.get('TMPDIR', '').startswith('/mnt/'))
        self.directory = tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'])
        self.addCleanup(self.directory.cleanup)
        self.file = Path(self.directory.name) / 'input'
        self.file.write_bytes(b'fixed input\n')
        self.actual = self.file.stat()

    def record(self, **changes):
        values = {name: getattr(self.actual, name) for name in dir(self.actual) if name.startswith('st_')}
        return SimpleNamespace(**(values | changes))

    def test_atime_only_change_does_not_invalidate_input(self):
        with patch.object(Path, 'stat', side_effect=[self.record(), self.record(st_atime_ns=self.actual.st_atime_ns + 1)]):
            result = pin(self.file)
        self.assertEqual(result['sha256'], hashlib.sha256(b'fixed input\n').hexdigest())
        self.assertEqual(result['bytes'], 12)

    def test_real_metadata_changes_fail_closed(self):
        for field in ['st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_ino', 'st_dev', 'st_mode', 'st_uid', 'st_gid', 'st_nlink']:
            with self.subTest(field=field):
                with patch.object(Path, 'stat', side_effect=[self.record(), self.record(**{field: getattr(self.actual, field) + 1})]):
                    with self.assertRaises(AssertionError):
                        pin(self.file)

    def test_stable_file_pins_are_repeatable(self):
        self.assertEqual(pin(self.file), pin(self.file))


unittest.main()
