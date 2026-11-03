#!/usr/bin/env python3
import importlib.util,pathlib,unittest
s=importlib.util.spec_from_file_location('apk_package',pathlib.Path(__file__).with_name('package-apk.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class InputChecks(unittest.TestCase):
 def spec(self):return {'name':'hello','version':'1.0-r0','description':'Hello','url':'https://example.invalid','license':'MIT','files':{'usr/bin/hello':{'path':'unused'}}}
 def test_valid(self):m.validate_spec(self.spec(),'linuxonweb-dev.rsa.pub')
 def test_absolute_and_traversal(self):
  for name in ('/usr/bin/x','../x','a/../../x','a//x','','.','a\\b','a\0b','a/'):
   with self.subTest(name=name):
    spec=self.spec();spec['files']={name:{'path':'unused'}}
    with self.assertRaises(ValueError):m.validate_spec(spec,'key.pub')
 def test_metadata_line_injection(self):
  for field in ('name','version','description','url','license','origin'):
   for bad in ('first\narch = x86_64','first\rsecond','a\0b'):
    with self.subTest(field=field,bad=bad):
     spec=self.spec();spec[field]=bad
     with self.assertRaises(ValueError):m.validate_spec(spec,'key.pub')
 def test_dependency_line_injection(self):
  spec=self.spec();spec['depends']=['busybox\npkgname = other']
  with self.assertRaises(ValueError):m.validate_spec(spec,'key.pub')
 def test_key_basename(self):
  for key in ('../key.pub','/key.pub','key/pub','key\\pub','key\nname','','..'):
   with self.subTest(key=key):
    with self.assertRaises(ValueError):m.validate_spec(self.spec(),key)
 def test_generated_directory_paths(self):self.assertEqual(m.valid_member('usr/bin/'),'usr/bin/')
if __name__=='__main__':unittest.main()
