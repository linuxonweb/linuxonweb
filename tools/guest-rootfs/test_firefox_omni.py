import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import zipfile


SPEC = importlib.util.spec_from_file_location(
    'firefox_omni', Path(__file__).with_name('package-firefox-omni.py'))
PACKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKER)
MOZ_SOURCE = Path(os.environ['FIREFOX_SOURCE'])


class FirefoxOmniTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'flat'
        self.destination = self.root / 'packed'
        self.files = {
            '.lldbinit': b'preserve packaged diagnostic configuration\n',
            '.mkdir.done': b'',
            'firefox': b'\0asm\x01\0\0\0',
            'application.ini': b'[App]\nName=Firefox\n',
            'chrome.manifest': b'content global chrome/global/content/\n',
            'chrome/global/content/main.xhtml': b'<window/>',
            'chrome/icons/default/default16.png': b'icon outside jar',
            'modules/Test.sys.mjs': b'export const value = 42;\n',
            'defaults/pref/channel-prefs.js': b'pref("app.update.channel", "nightly");\n',
            'defaults/pref/mobile.js': b'pref("example.mobile", true);\n',
            'browser/chrome.manifest': b'content browser chrome/browser/content/\n',
            'browser/chrome/browser/content/browser.xhtml': b'<browser/>',
            'browser/modules/Browser.sys.mjs': b'export const browser = true;\n',
            'browser/defaults/preferences/custom.js': b'pref("example.custom", true);\n',
            'browser/features/example.xpi': b'keep packaged extension',
        }
        for name, body in self.files.items():
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
        (self.source / 'firefox').chmod(0o755)

    def pack(self):
        return PACKER.pack_resources(self.source, self.destination, MOZ_SOURCE)

    def test_toolkit_and_browser_resources_use_separate_real_omnijars(self):
        self.pack()
        for base, names in [('', ['chrome/global/content/main.xhtml', 'modules/Test.sys.mjs', 'defaults/pref/mobile.js']),
                            ('browser', ['chrome/browser/content/browser.xhtml', 'modules/Browser.sys.mjs', 'defaults/preferences/custom.js'])]:
            with zipfile.ZipFile(self.destination / base / 'omni.ja') as archive:
                self.assertIsNone(archive.testzip())
                self.assertIn('chrome.manifest', archive.namelist())
                for name in names:
                    original = '/'.join(part for part in [base, name] if part)
                    self.assertEqual(archive.read(name), self.files[original])
                    self.assertFalse((self.destination / original).exists())

    def test_native_binary_external_icons_and_channel_prefs_are_not_changed(self):
        self.pack()
        for name in ['firefox', 'application.ini', 'chrome/icons/default/default16.png',
                     'defaults/pref/channel-prefs.js', 'browser/features/example.xpi']:
            self.assertEqual((self.destination / name).read_bytes(), self.files[name])
        self.assertEqual((self.destination / 'firefox').stat().st_mode & 0o777, 0o755)

    def test_source_is_unchanged_and_no_resource_bytes_disappear(self):
        self.pack()
        for name, body in self.files.items():
            self.assertEqual((self.source / name).read_bytes(), body)
            if name.endswith('.manifest'):
                continue
            output = self.destination / name
            if output.is_file():
                actual = output.read_bytes()
            else:
                base, relative = ('browser', name[8:]) if name.startswith('browser/') else ('', name)
                with zipfile.ZipFile(self.destination / base / 'omni.ja') as archive:
                    actual = archive.read(relative)
            self.assertEqual(hashlib.sha256(actual).digest(), hashlib.sha256(body).digest())

    def test_root_dotfiles_are_preserved_even_when_not_runtime_resources(self):
        self.pack()
        for name in ['.lldbinit', '.mkdir.done']:
            self.assertEqual((self.destination / name).read_bytes(), self.files[name])

    def test_existing_destination_and_source_overlap_are_rejected(self):
        self.destination.mkdir()
        sentinel = self.destination / 'keep'
        sentinel.write_text('preserve')
        with self.assertRaises(ValueError):
            self.pack()
        self.assertEqual(sentinel.read_text(), 'preserve')
        with self.assertRaises(ValueError):
            PACKER.pack_resources(self.source, self.source / 'nested', MOZ_SOURCE)

    def test_external_symlink_is_not_followed(self):
        external = self.root / 'private'
        external.write_bytes(b'never package this')
        (self.source / 'modules/private.sys.mjs').symlink_to(external)
        with self.assertRaises(ValueError):
            self.pack()
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
