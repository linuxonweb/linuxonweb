#!/usr/bin/env python3
"""Boundary tests for final159 preflight; run inside bounded.py disk-backed TMPDIR."""
import copy
import errno
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('preflight',HERE/'rebuild-preflight.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
spec=importlib.util.spec_from_file_location('host',HERE/'run-host.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

class PreflightBoundaryTests(unittest.TestCase):
    def test_literal_environment_rejects_shell_and_duplicate_exports(self):
        self.assertEqual(p.parse_environment("export CXX='a b'\n# comment\n"),{'CXX':'a b'})
        for text in ('export X=$(touch marker)', 'export X=`id`', 'echo hello',
                     'export X=a\nexport X=b', 'export X=a; uname'):
            with self.subTest(text=text), self.assertRaises(ValueError): p.parse_environment(text)

    def test_relocation_keeps_path_boundaries_and_flags(self):
        rules={'/old/task':'/owned/deps','/old/task/recipe':'/owned/recipe'}
        self.assertEqual(p.relocate('-I/old/task/recipe/shim',rules),'-I/owned/recipe/shim')
        self.assertEqual(p.relocate('@/old/task/link.args',rules),'@/owned/deps/link.args')
        self.assertEqual(p.relocate('/old/task-other/x',rules),'/old/task-other/x')
        self.assertEqual(p.relocate("export X='/old/task/recipe'",rules),"export X='/owned/recipe'")

    def test_probe_distinguishes_missing_denied_type_and_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); f=root/'input';f.write_bytes(b'current')
            self.assertEqual(p.probe(root/'missing')['status'],'missing')
            self.assertEqual(p.probe(root)['status'],'wrong-type')
            self.assertEqual(p.probe(f,{'sha256':'0'*64})['status'],'hash-mismatch')
            self.assertEqual(p.probe(f,p.pin(f))['status'],'available')
            with patch.object(Path,'stat',side_effect=PermissionError(errno.EACCES,'permission denied')):
                denied=p.probe(f)
                self.assertEqual((denied['status'],denied['errno']),('inaccessible',13))

    def test_output_refuses_existing_protected_and_memory_filesystem(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); protected=root/'source';protected.mkdir()
            with self.assertRaises(ValueError):p.safe_output(protected,[])
            with self.assertRaises(ValueError):p.safe_output(protected/'new',[protected])
            with patch.object(p.subprocess,'check_output',return_value='{"filesystems":[{"fstype":"tmpfs"}]}'):
                with self.assertRaises(ValueError):p.safe_output(root/'new',[])

    def test_lock_requires_each_evidence_file_and_unique_contained_paths(self):
        lock=json.loads((HERE/'final159-rebuild-lock.json').read_text())
        p.validate_lock(lock)
        removed=copy.deepcopy(lock); removed['files']=[r for r in removed['files'] if r['path']!='pbl/src/PblIc.inc']
        with self.assertRaises(ValueError):p.validate_lock(removed)
        duplicate=copy.deepcopy(lock);duplicate['files'].append(duplicate['files'][0])
        with self.assertRaises(ValueError):p.validate_lock(duplicate)
        escaped=copy.deepcopy(lock);escaped['files'].append({'root':'source','path':'../outside','bytes':0,'sha256':'0'*64})
        with self.assertRaises(ValueError):p.validate_lock(escaped)

    def test_adapter_rejects_stale_or_already_adapted_generator(self):
        source='!Watchtower::watchesPropertyModification(&n)\n'+p.ABI_ANCHOR
        adapted=p.adapt_generator(source)
        self.assertIn('watchesPropertyValueChange',adapted)
        self.assertIn('sizeof(void*) == 4',adapted)
        self.assertIn('defined(__wasi__)',adapted)
        for text in (adapted,source+source,source.replace(p.ABI_ANCHOR,'')):
            with self.assertRaises(ValueError):p.adapt_generator(text)

    @staticmethod
    def member(name,data):
        header=(f'{name+"/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n').encode()
        assert len(header)==60
        return header+data+(b'\n' if len(data)%2 else b'')

    def test_archive_requires_both_unique_real_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            f=Path(directory)/'lib.a'; a=self.member('PblJit.o',b'jit'); b=self.member('PBI.o',b'pbi')
            f.write_bytes(b'!<arch>\n'+a+b)
            self.assertEqual(p.archive_members(f,('PblJit.o','PBI.o'))['PblJit.o']['sha256'],hashlib.sha256(b'jit').hexdigest())
            empty=self.member('ignored',b'')
            negative=empty[:48]+b'-1'.ljust(10)+empty[58:]
            oversized=empty[:48]+b'99'.ljust(10)+empty[58:]
            bsd=b'#1/8'.ljust(16)+self.member('ignored',b'abc')[16:]
            gnu=b'/4'.ljust(16)+empty[16:]
            for content in (b'!<arch>\n'+a,b'!<arch>\n'+a+a+b,b'!<thin>\n'+a+b,
                            b'!<arch>\n'+a+b[:-3],b'!<arch>\n'+a+b+negative,
                            b'!<arch>\n'+a+b+oversized,b'!<arch>\n'+a+b+bsd,
                            b'!<arch>\n'+a+b+gnu,
                            b'!<arch>\n'+a+b+self.member('ignored',b'x')[:-1]):
                f.write_bytes(content)
                with self.subTest(size=len(content)),self.assertRaises(ValueError):p.archive_members(f,('PblJit.o','PBI.o'))

    def test_host_mock_preserves_semantics_and_requires_complete_opcode_parse(self):
        template=('// fixture semantics\n#define PBLJIT_OPS(X) X(Old, 0, 1)\n'
                  'enum class JSOp { Old };\nstruct JSScript { int trynotes; };\n')
        lines=[f'MACRO(Op{i}, op{i}, NULL, {1+i%3}, 0, 0, JOF_BYTE)' for i in range(221)]
        header='\n'.join(lines)
        adapted,ops=p.adapt_host_mock(template,header)
        self.assertEqual(len(ops),221)
        self.assertEqual(ops[-1],{'name':'Op220','number':220,'length':2})
        self.assertIn('X(Op220, 220, 2)',adapted)
        self.assertTrue(adapted.startswith('// fixture semantics\n'))
        self.assertTrue(adapted.endswith('struct JSScript { int trynotes; };\n'))
        for bad_header in ('\n'.join(lines[:-1]),header+'\n'+lines[0],
                           header.replace('Op2, op2, NULL, 3','Op2, op2, NULL, variable')):
            with self.subTest(header=bad_header[-80:]),self.assertRaises(ValueError):
                p.adapt_host_mock(template,bad_header)
        for bad_template in (template.replace('enum class JSOp','enum JSOp'),template+template):
            with self.assertRaises(ValueError):p.adapt_host_mock(bad_template,header)

    def test_incomplete_receipt_stops_before_chain_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for stem in ('compile-PblJit','compile-PortableBaselineInterpret','link'):
                (root/(stem+'.command.json')).write_text(json.dumps({'argv':['cxx','input']}))
                (root/(stem+'.receipt.json')).write_text(json.dumps({'argv':['cxx','input'],'returncode':0,'remainingGroup':[123]}))
            with self.assertRaisesRegex(ValueError,'did not finish cleanly'):p.check_receipt_chain(root,root,{})

class HostPacketIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.packet=self.root/'packet'
        self.files=['overlay/PblJit.cpp','overlay/host-test/mock.h']+[
            'fixtures/'+name for name in p.HOST_FIXTURE_FILES]
        for name in self.files:
            path=self.packet/name;path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text('reviewed fixture: '+name+'\n')
        self.source=self.root/'source.cpp';self.source.write_text('canonical source\n')
        self.manifest={'pass':True,'coverage':'broad','hostFixtures':'fixtures',
                       'hostFixtureFiles':list(p.HOST_FIXTURE_FILES),'hostRunners':copy.deepcopy(p.HOST_RUNNERS),
                       'files':[dict(p.pin(self.packet/name),path=name) for name in self.files],
                       'inputs':[p.pin(self.source)]}
        self.save_manifest()

    def save_manifest(self):
        (self.packet/'manifest.json').write_text(json.dumps(self.manifest))

    def test_complete_packet_requires_both_separate_runners(self):
        _,fixtures,assets,runners=h.verify_packet(self.packet)
        self.assertEqual(fixtures,self.packet/'fixtures')
        self.assertEqual(set(assets),{'emit.cpp','run.mjs','nested-fixtures.h','run-nested.mjs'})
        self.assertEqual(runners,[{'name':'baseline','file':'run.mjs'},
                                  {'name':'nested','file':'run-nested.mjs'}])

    def test_missing_or_tampered_nested_assets_stop_before_compilation(self):
        for name in ('nested-fixtures.h','run-nested.mjs'):
            path=self.packet/'fixtures'/name;original=path.read_bytes()
            for mutation in ('missing','tampered'):
                with self.subTest(asset=name,mutation=mutation):
                    if mutation=='missing':path.unlink()
                    else:path.write_bytes(original+b'unreviewed')
                    with patch.object(h.subprocess,'run',side_effect=AssertionError('must not compile')):
                        report=h.run(self.packet,self.root/(name+'-'+mutation))
                    self.assertFalse(report['pass'])
                    self.assertEqual(report['commands'],[])
                    self.assertIn('pinned',report['error'])
                    path.write_bytes(original)

    def test_unpinned_nested_assets_are_rejected_even_if_present(self):
        original=copy.deepcopy(self.manifest['files'])
        for name in ('nested-fixtures.h','run-nested.mjs'):
            self.manifest['files']=[r for r in original if r['path']!='fixtures/'+name]
            self.save_manifest()
            with self.subTest(asset=name),self.assertRaisesRegex(ValueError,'un-pinned host fixture'):
                h.verify_packet(self.packet)

    def test_runner_downgrades_and_unknown_runner_are_rejected(self):
        for runners in (None,[],[{'name':'baseline','file':'run.mjs'}],
                        [{'name':'baseline','file':'run.mjs'},{'name':'nested','file':'unexpected.mjs'}]):
            self.manifest['hostRunners']=runners;self.save_manifest()
            with self.subTest(runners=runners),self.assertRaisesRegex(ValueError,'runner contract'):
                h.verify_packet(self.packet)

    def test_unpinned_overlay_and_source_drift_are_rejected(self):
        added=self.packet/'overlay/host-test/injected.h';added.write_text('unreviewed')
        with self.assertRaisesRegex(ValueError,'un-pinned overlay'):h.verify_packet(self.packet)
        added.unlink();self.source.write_text('changed canonical source')
        with self.assertRaisesRegex(ValueError,'pinned hash mismatch'):h.verify_packet(self.packet)

    def test_zero_exit_without_real_passing_runner_result_is_not_acceptance(self):
        for output in ('','{}','{"pass":true,"checks":0,"failures":0}',
                       '{"pass":false,"checks":5,"failures":1}'):
            with self.subTest(output=output),self.assertRaises(ValueError):h.suite_result(output)
        self.assertEqual(h.suite_result('diagnostic\n{"pass":true,"checks":5,"failures":0}')['checks'],5)

if __name__=='__main__': unittest.main(verbosity=2)
