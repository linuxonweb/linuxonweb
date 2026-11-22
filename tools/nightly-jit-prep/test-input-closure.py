#!/usr/bin/env python3
"""Regression checks for preparation pins and helper linkage receipt binding.

Run only inside the unchanged bounded.py owner. Fixtures are fresh direct
children of the approved disk build parent. Historical inputs are read only.
No native compiler, archiver, validator, browser, or guest is executed.
"""
import argparse
from contextlib import contextmanager, redirect_stdout
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time
from types import SimpleNamespace
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PREP = load('tested_owned_preparation', HERE / 'prepare-owned-build.py')
HELPER = load('tested_helper_reconstruction', REPO / 'tools/nightly-musl/recipe/reconstruct-helper-mapping.py')
CLOSURE = sys.modules['input_closure']


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pin(path):
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': sha(data)}


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def snapshot(root):
    """Independent source/output observation, including modes and symlinks."""
    if not root.exists() and not root.is_symlink():
        return None
    rows = []
    pending = [root]
    while pending:
        path = pending.pop()
        st = path.lstat()
        relative = '.' if path == root else path.relative_to(root).as_posix()
        row = {'path': relative, 'mode': stat.S_IMODE(st.st_mode)}
        if stat.S_ISLNK(st.st_mode):
            row.update(kind='symlink', target=os.readlink(path))
        elif stat.S_ISDIR(st.st_mode):
            row['kind'] = 'directory'
            pending.extend(sorted(path.iterdir(), reverse=True))
        elif stat.S_ISREG(st.st_mode):
            data = path.read_bytes()
            row.update(kind='file', bytes=len(data), sha256=sha(data))
        else:
            row['kind'] = 'other'
        rows.append(row)
    return rows


@contextmanager
def altered(path, data=None, mode=None, absent=False, symlink=None):
    original = path.read_bytes()
    original_mode = stat.S_IMODE(path.stat().st_mode)
    if absent or symlink is not None:
        path.unlink()
    if symlink is not None:
        path.symlink_to(symlink)
    elif not absent:
        # Writable setup applies only to this fresh owned fixture copy.
        path.chmod(original_mode | 0o200)
        path.write_bytes(original if data is None else data)
        path.chmod(original_mode if mode is None else mode)
    try:
        yield
    finally:
        if path.is_symlink():
            path.unlink()
        if path.exists():
            path.chmod(original_mode | 0o200)
        path.write_bytes(original)
        path.chmod(original_mode)


@contextmanager
def added(path, directory=False, symlink=None):
    require(not path.exists() and not path.is_symlink(), 'fixture addition already exists')
    if directory:
        path.mkdir(mode=0o700)
    elif symlink is not None:
        path.symlink_to(symlink)
    else:
        path.write_bytes(b'unreviewed test member\n')
    try:
        yield
    finally:
        if directory:
            path.rmdir()
        else:
            path.unlink()


def flip(data):
    require(bool(data), 'cannot alter an empty fixture')
    return bytes([data[0] ^ 1]) + data[1:]


def json_edit(data, edit):
    value = json.loads(data)
    edit(value)
    return encoded(value)


class Suite:
    def __init__(self, args):
        self.args = args
        self.cases = []
        self.started = utc()
        self.start = time.monotonic()
        self.manifest = json.loads(PREP.INPUT_CLOSURE.read_bytes())
        prefix = args.fixture_prefix.resolve()
        require(prefix.parent == REPO.parent, 'fixture prefix must use the integration disk parent')
        self.roots = {name: prefix.with_name(prefix.name + '-' + name)
                      for name in ['packet', 'dependencies', 'source', 'work', 'helper-build', 'helper-source', 'helper-dependencies']}
        self.output = prefix.with_name(prefix.name + '-output')
        for root in [*self.roots.values(), self.output]:
            require(not root.exists() and not root.is_symlink(), 'preserve existing fixture: ' + str(root))
        for root in self.roots.values():
            root.mkdir(mode=0o700)
        self.work = self.roots['work']
        self.result = self.work / 'result.json'
        self.source = self.roots['source']
        (self.source / 'keep.txt').write_bytes(b'owned source sentinel; never replace\n')
        (self.source / 'defs.mk').write_bytes(b'owned source definitions sentinel\n')
        self.original = {'packet': args.packet.resolve(strict=True),
                         'dependencies': args.dependencies.resolve(strict=True),
                         'egl': args.egl.resolve(strict=True).parent,
                         'repository': REPO}
        self.recipes = [pin(Path(__file__)), pin(Path(PREP.__file__)), pin(Path(HELPER.__file__)), pin(Path(CLOSURE.__file__)), pin(PREP.INPUT_CLOSURE)]
        self.cloned = dict(self.original)
        self.cloned.update(packet=self.roots['packet'], dependencies=self.roots['dependencies'], egl=self.work / 'egl')
        self.cloned['egl'].mkdir(mode=0o700)
        self.prepare_args = SimpleNamespace(packet=self.cloned['packet'], dependencies=self.cloned['dependencies'],
                                           egl=self.cloned['egl'] / args.egl.name, source=self.source,
                                           output=self.output, verify_only=False)

    def run_case(self, name, function):
        started = time.monotonic()
        row = {'name': name}
        try:
            details = function()
            row.update(passTest=True, **(details or {}))
        except Exception as error:
            row.update(passTest=False, error=type(error).__name__ + ': ' + str(error))
            raise
        finally:
            row['durationSeconds'] = round(time.monotonic() - started, 6)
            self.cases.append(row)
            print(json.dumps(row), flush=True)

    def rejected(self, operation, reasons, source=None, output=None):
        source = self.source if source is None else source
        output = self.output if output is None else output
        before_source, before_output = snapshot(source), snapshot(output)
        caught = None
        try:
            with redirect_stdout(io.StringIO()):
                operation()
        except (OSError, ValueError, KeyError) as error:
            caught = error
        require(snapshot(source) == before_source, 'rejected operation changed source contents, modes, or membership')
        require(snapshot(output) == before_output, 'rejected operation changed output')
        require(before_output is None, 'rejection output was not initially absent')
        require(caught is not None, 'unreviewed input was accepted')
        require(any(reason in str(caught) for reason in reasons), 'wrong rejection boundary: ' + repr(caught))
        return {'rejectedBy': type(caught).__name__ + ': ' + str(caught),
                'sourceUnchanged': True, 'outputAbsent': True}

    def reject_prepare(self, reasons=None):
        reasons = reasons or ['input digest changed', 'input size changed', 'input mode changed',
                              'closure tree membership changed', 'nonregular closure tree member',
                              'input path is a symlink', 'declared missing input now exists',
                              'No such file or directory']
        return self.rejected(lambda: PREP.prepare(self.prepare_args), reasons)

    def verify_only(self, original=False):
        args = SimpleNamespace(**vars(self.prepare_args))
        if original:
            args.packet, args.dependencies, args.egl = self.original['packet'], self.original['dependencies'], self.args.egl.resolve()
        args.verify_only = True
        before = snapshot(self.source)
        output = io.StringIO()
        with redirect_stdout(output):
            PREP.prepare(args)
        result = json.loads(output.getvalue())
        require(result['inputClosureVerified'] is True and result['readOnly'] is True, 'positive verification did not pass')
        require(result['compiled'] is False, 'preparation must not imply compilation')
        require(result['verifiedFiles'] == sum(len(rows) for rows in self.manifest['files'].values()), 'verified closure count differs')
        require(snapshot(self.source) == before and snapshot(self.output) is None, 'read-only verification mutated source or output')
        return {'verifiedFiles': result['verifiedFiles'], 'sourceUnchanged': True, 'outputAbsent': True}

    def clone_inputs(self):
        for group in ['packet', 'dependencies', 'egl']:
            root = self.cloned[group]
            for tree in self.manifest['trees']:
                if tree['root'] == group:
                    for relative in tree['directories']:
                        (root / tree['path'] / relative).mkdir(mode=0o700, parents=True, exist_ok=True)
            for row in self.manifest['files'][group]:
                target = root / row['path']
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copy2(self.original[group] / row['path'], target)
                require(stat.S_IMODE(target.stat().st_mode) == row['mode'], 'fixture lost original mode')

    def packet_cases(self):
        for row in self.manifest['files']['packet']:
            name = row['path']
            path = self.cloned['packet'] / name
            raw = path.read_bytes()
            if name == '.mozconfig':
                mutated = raw + b'\nac_add_options --enable-debug\n'
                for flag in [b'--target=wasm32-unknown-linux-musl', b'--disable-jit', b'--enable-portable-baseline-interp', b'--disable-debug-symbols']:
                    require(flag in mutated.split(), 'test removed a required flag')
            elif name == 'compile-commands.json':
                mutated = json_edit(raw, lambda value: value[0]['argv'].append('-DUNREVIEWED_PREPARATION_TEST=1'))
            elif name == 'link/link.args':
                mutated = raw + b'\n--export=unreviewed_preparation_test\n'
            elif name == 'recipe/environment.sh':
                mutated = raw + b'\nexport RUSTC_WRAPPER=/usr/bin/false\n'
            elif name in ['recipe/cargo', 'recipe/rustc']:
                mutated = raw + b'\nexit 99\n'
            elif name == 'host-packet/manifest.json':
                mutated = json_edit(raw, lambda value: value['files'].pop())
            else:
                mutated = flip(raw)
            with altered(path, mutated):
                self.run_case('packet-content:' + name, self.reject_prepare)
        fixture = self.cloned['packet'] / 'host-packet/fixtures/emit.cpp'
        manifest = self.cloned['packet'] / 'host-packet/manifest.json'
        forged_fixture = fixture.read_bytes() + b'\n// unreviewed fixture with self-updated manifest\n'
        claim = json.loads(manifest.read_bytes())
        for row in claim['files']:
            if row['path'] == 'fixtures/emit.cpp':
                row.update(bytes=len(forged_fixture), sha256=sha(forged_fixture))
        with altered(fixture, forged_fixture), altered(manifest, encoded(claim)):
            self.run_case('host-fixture-and-self-updated-manifest', self.reject_prepare)

    def dependency_cases(self):
        trees = [tree['path'] for tree in self.manifest['trees'] if tree['root'] == 'dependencies']
        rows = self.manifest['files']['dependencies']
        selected = [row for row in rows if not any(Path(row['path']).is_relative_to(tree) for tree in trees)]
        selected += [next(row for row in rows if Path(row['path']).is_relative_to(tree)) for tree in trees]
        for row in selected:
            name = row['path']
            path = self.cloned['dependencies'] / name
            raw = path.read_bytes()
            if name == 'validation.json':
                mutated = json_edit(raw, lambda value: value['artifacts'].clear())
            elif name in ['replacement-paths.json', 'header-replacement-paths.json']:
                mutated = json_edit(raw, lambda value: value.pop(next(iter(value))))
            else:
                mutated = flip(raw)
            with altered(path, mutated):
                self.run_case('dependency-content:' + name, self.reject_prepare)
        with altered(self.prepare_args.egl, flip(self.prepare_args.egl.read_bytes())):
            self.run_case('egl-archive-content', self.reject_prepare)
        for missing in self.manifest['missing']:
            with added(self.cloned[missing['root']] / missing['path']):
                self.run_case('previously-missing:' + missing['path'], self.reject_prepare)

    def membership_cases(self):
        for tree in self.manifest['trees']:
            root = self.cloned[tree['root']] / tree['path']
            with added(root / 'unreviewed-member'):
                self.run_case('extra-tree-file:' + tree['root'] + ':' + tree['path'], self.reject_prepare)
        recipe = self.cloned['packet'] / 'recipe'
        with added(recipe / 'unreviewed-directory', directory=True):
            self.run_case('extra-empty-directory', self.reject_prepare)
        cargo = recipe / 'cargo'
        with altered(cargo, absent=True):
            self.run_case('missing-tree-member', self.reject_prepare)
        with altered(cargo, symlink=self.original['packet'] / 'recipe/cargo'):
            self.run_case('symlink-member-to-identical-original', self.reject_prepare)
        with altered(cargo, mode=0o600):
            self.run_case('executable-wrapper-mode-changed', self.reject_prepare)
        with added(recipe / 'unreviewed-alias', symlink=recipe / 'rust-target'):
            self.run_case('symlink-directory-member', self.reject_prepare)
        loose = self.cloned['packet'] / 'compile-commands.json'
        with altered(loose, absent=True):
            self.run_case('missing-standalone-pinned-file', self.reject_prepare)
        with altered(loose, symlink=self.original['packet'] / 'compile-commands.json'):
            self.run_case('symlink-standalone-to-identical-original', self.reject_prepare)
        forged = self.work / 'forged-closure.json'
        manifest = json.loads(PREP.INPUT_CLOSURE.read_bytes())
        manifest['files']['packet'][0]['sha256'] = '0' * 64
        forged.write_bytes(encoded(manifest))
        with patch.object(PREP, 'INPUT_CLOSURE', forged):
            self.run_case('self-updated-closure-manifest-still-needs-reviewed-digest', self.reject_prepare)

    def cached_copy_case(self):
        closure, _, _ = PREP.verify_inputs(self.prepare_args.packet, self.prepare_args.dependencies, self.prepare_args.egl)
        cargo = self.cloned['packet'] / 'recipe/cargo'
        original = cargo.read_bytes()
        destination = self.work / 'cached-recipe-copy'
        with altered(cargo, flip(original)):
            require(closure.bytes('packet', 'recipe/cargo') == original, 'cached read consumed changed input')
            closure.copy_tree('packet', 'recipe', destination)
            require((destination / 'cargo').read_bytes() == original, 'copy reread the changed wrapper')
            for name in ['cargo', 'rustc']:
                require(stat.S_IMODE((destination / name).stat().st_mode) == 0o755, 'cached wrapper lost executable mode')
            try:
                closure.assert_unchanged()
            except ValueError as error:
                require('verified input changed before preparation' in str(error), 'wrong cache recheck failure')
            else:
                raise AssertionError('changed cached source passed the final recheck')
        return {'cachedBytesUsed': True, 'wrapperModes': '0755', 'changedInputRecheckRejected': True}

    def external_cases(self):
        root = self.work / 'external-fixture'
        root.mkdir(mode=0o700)
        first, second, alias = root / 'tool-a', root / 'tool-b', root / 'tool-alias'
        for path in [first, second]:
            path.write_bytes(b'owned external identity fixture\n')
            path.chmod(0o700)
        alias.symlink_to(first)
        row = dict(pin(first), path=str(alias), resolvedPath=str(first), mode=0o700, owned=True, retain=True)
        manifest = {'schema': 'reviewed-final159-preparation-inputs-v1', 'files': {'external': [row]}, 'trees': [], 'missing': []}
        authority = root / 'reviewed.json'
        authority.write_bytes(encoded(manifest))
        expected = sha(authority.read_bytes())
        verify = lambda: CLOSURE.VerifiedClosure(authority, expected, {}).verify()
        self.run_case('owned-external-alias-positive', lambda: {'verifiedFiles': len(verify().rows)})
        alias.unlink()
        alias.symlink_to(second)
        self.run_case('external-alias-retargeted-to-identical-bytes', lambda: self.rejected(verify, ['input path is a symlink or changed target']))
        alias.unlink()
        alias.symlink_to(first)
        with altered(first, flip(first.read_bytes())):
            self.run_case('external-target-content-changed', lambda: self.rejected(verify, ['input digest changed']))
        with altered(first, mode=0o600):
            self.run_case('external-target-mode-changed', lambda: self.rejected(verify, ['input mode changed']))

    def repository_mode_cases(self):
        root = self.work / 'repository-fixture'
        root.mkdir(mode=0o700)
        for row in self.manifest['files']['repository']:
            target = root / row['path']
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copy2(self.original['repository'] / row['path'], target)
            target.chmod(0o644)
        roots = dict(self.cloned, repository=root)
        verify = lambda: CLOSURE.VerifiedClosure(PREP.INPUT_CLOSURE, PREP.INPUT_CLOSURE_SHA, roots).verify()
        self.run_case('git-style-repository-provenance-mode-0644-positive',
                      lambda: {'verifiedFiles': len(verify().rows), 'repositoryFileModes': '0644'})
        provenance = next(row for row in self.manifest['files']['repository'] if row['path'].endswith('review.txt'))
        target = root / provenance['path']
        with altered(target, flip(target.read_bytes())):
            self.run_case('git-style-repository-provenance-byte-tamper',
                          lambda: self.rejected(verify, ['input digest changed']))

    def source_absence_case(self):
        # A tiny source fixture uses actual pinned original bytes. Only the Git
        # metadata witness is simulated; closure, safe_output, destination pins,
        # ownership, and absent-file rejection are the production functions.
        source_repo = json.loads((self.original['packet'] / 'preflight.json').read_bytes())['source']
        for row in self.manifest['sourceDestinations']:
            path = self.source / row['path']
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if row['before'] is not None:
                data = subprocess.check_output(['git', '-C', source_repo, 'show', PREP.SOURCE_HEAD + ':' + row['path']], timeout=30)
                require(len(data) == row['before']['bytes'] and sha(data) == row['before']['sha256'], 'Git fixture does not match reviewed original')
                path.write_bytes(data)
        (self.source / '.mozconfig').write_bytes(b'# pre-existing ignored configuration must survive\n')
        def git_witness(source, *arguments):
            require(source == self.source, 'unexpected Git fixture root')
            if arguments == ('rev-parse', 'HEAD'):
                return PREP.SOURCE_HEAD
            if arguments == ('status', '--porcelain', '--untracked-files=all'):
                return ''
            if arguments == ('ls-files',):
                return '\n'.join(row['path'] for row in self.manifest['sourceDestinations'] if row['before'] is not None)
            raise AssertionError('unexpected Git witness request')
        with patch.object(PREP, 'git', git_witness):
            result = self.reject_prepare(['source destination must be absent: .mozconfig'])
        return dict(result, simulatedGitMetadataOnly=True, originalsReadFromPinnedGitHead=True)

    def helper_cases(self):
        original_build = self.args.prepared_build.resolve(strict=True)
        old = json.loads((original_build / 'preparation.json').read_bytes())
        original_source = Path(old['source'])
        deps = self.original['dependencies']
        unwrapped = deps / 'native-mapping-link/libnightly-native-mapping.a'
        wrapped = deps / 'native-mapping-wrapped-shm/libnightly-native-mapping.a'
        def original_positive():
            before = [pin(original_build / 'preparation.json'), pin(original_build / 'source-changes.json'), pin(original_source / 'defs.mk'), pin(original_source / 'linuxonweb-build/adapters/defs.mk')]
            files, binding = HELPER.verify_prepared_linkage(original_build, unwrapped, wrapped)
            require(len(files) == 2 and binding['preparation']['sha256'] == HELPER.PREPARATION_SHA, 'reviewed real linkage did not verify')
            require(before == [pin(Path(row['path'])) for row in before], 'read-only helper verification changed an original')
            return {'reviewedPreparation': binding['preparation'], 'defsFilesVerified': 2, 'readOnly': True}
        self.run_case('helper-reviewed-original-positive', original_positive)
        build, source, helper_deps = (self.roots[name] for name in ['helper-build', 'helper-source', 'helper-dependencies'])
        changes = json.loads((original_build / 'source-changes.json').read_bytes())
        for relative in ['defs.mk', 'linuxonweb-build/adapters/defs.mk']:
            target = source / relative
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes((original_source / relative).read_bytes().replace(str(deps).encode(), str(helper_deps).encode()))
            matches = [row for row in changes if row['after']['path'] == str(original_source / relative)]
            require(len(matches) == 1, 'original linkage row is not unique')
            matches[0]['after'] = pin(target)
        changes_path = build / 'source-changes.json'
        changes_path.write_bytes(encoded(changes))
        old.update(source=str(source), output=str(build), sourceChanges=pin(changes_path))
        receipt = build / 'preparation.json'
        receipt.write_bytes(encoded(old))
        expected = sha(receipt.read_bytes())
        helper_out = helper_deps / 'native-mapping-link'
        fixture_unwrapped = helper_out / 'libnightly-native-mapping.a'
        fixture_wrapped = helper_deps / 'native-mapping-wrapped-shm/libnightly-native-mapping.a'
        verify = lambda: HELPER.verify_prepared_linkage(build, fixture_unwrapped, fixture_wrapped, expected_sha=expected)
        self.run_case('helper-owned-fixture-positive', lambda: {'defsFilesVerified': len(verify()[0]), 'explicitFixtureAuthority': expected})
        self.run_case('helper-fixture-cannot-self-authorize-default-receipt', lambda: self.rejected(
            lambda: HELPER.verify_prepared_linkage(build, fixture_unwrapped, fixture_wrapped),
            ['input digest changed'], source, helper_out))
        original_verify = HELPER.verify_prepared_linkage
        native_calls = []
        def forbidden_native(*arguments, **keywords):
            native_calls.append(str(arguments))
            raise AssertionError('helper invoked a native tool before binding validation')
        def invoke_main():
            argv = ['reconstruct-helper-mapping.py', '--dependencies', str(helper_deps), '--prepared-build', str(build),
                    '--historical-receipt', str(self.work / 'must-not-be-read.json')]
            # Only the fixture authority is substituted; main and the entire
            # production linkage validator run unchanged. Native calls are traps.
            with patch.object(sys, 'argv', argv), patch.object(HELPER, 'verify_prepared_linkage',
                    lambda b, u, w: original_verify(b, u, w, expected_sha=expected)), patch.object(HELPER, 'subprocess',
                    SimpleNamespace(run=forbidden_native, SubprocessError=subprocess.SubprocessError)):
                HELPER.main()
        def reject_helper(reasons):
            result = self.rejected(invoke_main, reasons, source, helper_out)
            require(not native_calls, 'native tool was invoked')
            return dict(result, nativeToolInvocations=0, productionMainExercised=True)
        for relative in ['defs.mk', 'linuxonweb-build/adapters/defs.mk']:
            target = source / relative
            original = target.read_bytes()
            # Every prior required substring survives; the added outer OS_LIBS
            # line makes the helper-only conclusion invalid without byte binding.
            with altered(target, original + ('\nOS_LIBS += ' + str(fixture_unwrapped) + '\n').encode()):
                self.run_case('helper-defs-appended-after-guard:' + relative, lambda: reject_helper(['input size changed', 'input digest changed']))
        with altered(source / 'defs.mk', symlink=original_source / 'defs.mk'):
            self.run_case('helper-defs-symlink-rejected', lambda: reject_helper(['input path is a symlink']))
        with altered(changes_path, json_edit(changes_path.read_bytes(), lambda value: value.pop())):
            self.run_case('helper-source-changes-incomplete', lambda: reject_helper(['input size changed', 'input digest changed']))
        forged_defs = (source / 'defs.mk').read_bytes() + ('\nOS_LIBS += ' + str(fixture_unwrapped) + '\n').encode()
        with altered(source / 'defs.mk', forged_defs):
            forged_changes = json.loads(changes_path.read_bytes())
            for row in forged_changes:
                if row['after']['path'] == str(source / 'defs.mk'):
                    row['after'] = pin(source / 'defs.mk')
            with altered(changes_path, encoded(forged_changes)):
                forged_receipt = json.loads(receipt.read_bytes())
                forged_receipt['sourceChanges'] = pin(changes_path)
                with altered(receipt, encoded(forged_receipt)):
                    self.run_case('helper-self-updated-defs-changes-and-preparation', lambda: reject_helper(['input size changed', 'input digest changed']))
        require(sha(receipt.read_bytes()) == expected, 'helper fixture receipt was not restored')

    def execute(self):
        self.run_case('reviewed-original-closure-positive', lambda: self.verify_only(original=True))
        self.clone_inputs()
        self.run_case('cloned-valid-closure-positive', self.verify_only)
        self.packet_cases()
        self.dependency_cases()
        self.membership_cases()
        self.run_case('verified-copy-does-not-reread-mutated-wrapper', self.cached_copy_case)
        self.external_cases()
        self.repository_mode_cases()
        self.run_case('existing-ignored-source-config-before-null', self.source_absence_case)
        self.helper_cases()
        require(self.recipes == [pin(Path(row['path'])) for row in self.recipes], 'production recipe changed during tests')

    def save(self, success, error=None):
        report = {'kind': 'preparation-input-closure-regressions-v1', 'startedUtc': self.started, 'finishedUtc': utc(),
                  'durationSeconds': round(time.monotonic() - self.start, 6), 'pass': success,
                  'testsPassed': sum(row['passTest'] for row in self.cases), 'testsRun': len(self.cases),
                  'productionRecipes': self.recipes, 'fixtures': {name: str(path) for name, path in self.roots.items()},
                  'nativeCompilerInvoked': False, 'guestRuntimeAcceptance': False, 'fullJitAcceptance': False,
                  'scope': 'Input rejection before mutation, verified cached copies, and static helper receipt binding only.',
                  'cases': self.cases}
        if error:
            report['error'] = error
        self.result.write_bytes(encoded(report))
        print(json.dumps({key: report[key] for key in ['pass', 'testsPassed', 'testsRun', 'durationSeconds']}), flush=True)
        print('receipt=' + str(self.result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['packet', 'dependencies', 'egl', 'prepared-build', 'fixture-prefix']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    suite = Suite(args)
    try:
        suite.execute()
    except Exception as error:
        suite.save(False, type(error).__name__ + ': ' + str(error))
        raise
    suite.save(True)


if __name__ == '__main__':
    main()
