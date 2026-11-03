import gzip
import hashlib
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('package-extension-budget.py')
SPEC = importlib.util.spec_from_file_location('script_budget', SCRIPT)
PACKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKER)


def newc(inode, name, mode, body):
    encoded = name.encode() + b'\0'
    fields = [inode, mode, 0, 0, 1, 0, len(body), 0, 0, 0, 0, len(encoded), 0]
    header = b'070701' + b''.join(f'{value:08x}'.encode() for value in fields)
    return header + encoded + bytes(-(len(header) + len(encoded)) % 4) + body + bytes(-len(body) % 4)


def records(raw):
    found = {}
    offset = 0
    while True:
        header = raw[offset:offset + 110]
        fields = [int(header[index:index + 8], 16) for index in range(6, 110, 8)]
        size, namesize = fields[6], fields[11]
        name = raw[offset + 110:offset + 110 + namesize - 1].decode()
        start = (offset + 110 + namesize + 3) & ~3
        end = (start + size + 3) & ~3
        found[name] = {'encoded': raw[offset:end], 'body': raw[start:start + size], 'fields': fields}
        offset = end
        if name == 'TRAILER!!!':
            return found, raw[offset:]


class ScriptBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='script-budget-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def fixture(self, preference=b'pref("fixture.original", true);\n'):
        entries = [
            ('opt/firefox/firefox', 0o100755, b'\0asm\x01\0\0\0native fixture'),
            ('bin/firefox', 0o120777, b'/opt/firefox/firefox'),
            (PACKER.MEMBER, 0o100644, preference),
            ('home/admin/.profile', 0o100644, b'preserve this home file\n'),
        ]
        raw = b''.join(newc(index + 1, name, mode, body)
                       for index, (name, mode, body) in enumerate(entries))
        raw += newc(0, 'TRAILER!!!', 0, b'')
        raw += bytes(-len(raw) % 512)
        source = self.root / 'original.cpio.gz'
        source.write_bytes(gzip.compress(raw, mtime=0))
        return source, raw

    def assert_only_preference_changed(self, before, destination):
        old, old_tail = records(before)
        new, new_tail = records(gzip.decompress(destination.read_bytes()))
        self.assertEqual(list(new), list(old))
        self.assertEqual(new_tail, old_tail)
        for name in old:
            if name != PACKER.MEMBER:
                self.assertEqual(new[name]['encoded'], old[name]['encoded'], name)
        expected = old[PACKER.MEMBER]['fields'].copy()
        expected[6] = len(new[PACKER.MEMBER]['body'])
        self.assertEqual(new[PACKER.MEMBER]['fields'], expected)

    def test_default_remains_extension_content_and_matches_explicit_choice(self):
        source, raw = self.fixture()
        before = source.read_bytes()
        default = self.root / 'default.gz'
        explicit = self.root / 'explicit.gz'
        old, new = PACKER.rewrite(source, default)
        PACKER.rewrite(source, explicit, 'extension-content')
        self.assertEqual(default.read_bytes(), explicit.read_bytes())
        self.assertTrue(new.startswith(old))
        self.assertIn(b'pref("dom.max_ext_content_script_run_time", 60);\n', new)
        self.assertNotIn(b'pref("dom.max_script_run_time", 60);', new)
        self.assertIn(b'ExpandedPrincipal', new)
        self.assert_only_preference_changed(raw, default)
        self.assertEqual(source.read_bytes(), before)

    def test_content_changes_only_its_watchdog_and_preserves_other_budget(self):
        original = b'pref("dom.max_ext_content_script_run_time", 5);\n'
        source, raw = self.fixture(original)
        destination = self.root / 'content.gz'
        old, new = PACKER.rewrite(source, destination, 'content')
        self.assertEqual(old, original)
        self.assertTrue(new.startswith(original))
        self.assertIn(b'pref("dom.max_script_run_time", 60);\n', new)
        self.assertNotIn(b'pref("dom.max_ext_content_script_run_time", 60);', new)
        self.assertIn(b'ContentPrincipal', new)
        self.assert_only_preference_changed(raw, destination)

    def test_selected_preference_cannot_be_overridden_twice(self):
        for context, preference in [
            ('extension-content', 'dom.max_ext_content_script_run_time'),
            ('content', 'dom.max_script_run_time'),
        ]:
            with self.subTest(context=context):
                source, _ = self.fixture(f'pref("{preference}", 60);\n'.encode())
                original = hashlib.sha256(source.read_bytes()).hexdigest()
                with self.assertRaisesRegex(ValueError, re.escape(preference)):
                    PACKER.rewrite(source, self.root / (context + '.gz'), context)
                self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)

    def test_invalid_cli_context_is_rejected_before_output_creation(self):
        output = self.root / 'must-not-exist'
        result = subprocess.run([
            sys.executable, '-B', str(SCRIPT), str(self.root / 'absent-base'), str(output),
            '--expected-native-sha256', '0' * 64, '--script-context', 'system',
        ], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn('invalid choice', result.stderr)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
