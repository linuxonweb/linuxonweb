#!/usr/bin/env python3
"""Prepare a fresh owned final159 source/build tree without compiling or accepting it."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / 'tools/nightly-jit-safety'))
from owned_paths import task_root
sys.path.insert(0, str(HERE))
from input_closure import VerifiedClosure, read_pinned, identity

SPEC = importlib.util.spec_from_file_location('rebuild_preflight', HERE / 'rebuild-preflight.py')
PREFLIGHT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREFLIGHT)
PACKET_SHA = '1c28693371cc897123e31a02c010a4af27b397b0f5e30e604642061ebf18ea01'
SOURCE_HEAD = '525176a870d4ec4329e7decdb2ef7fdd5b87fb22'
HOST_PACKET_SHA = 'ecfdf31d835d06979884908250f643b77796ff070e0f5d56d69861dc7d2db3f0'
EGL_SHA = 'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8'
INPUT_CLOSURE = HERE / 'final159-preparation-inputs-20261110.json'
INPUT_CLOSURE_SHA = 'b0f250c47e5938dbf3d4728a2ba43541207eda270b7be4f23779cda3092d0d49'


def need(ok, message):
    if not ok:
        raise ValueError(message)


def git(source, *args):
    return subprocess.check_output(['git', '--no-pager', '-C', str(source), *args], text=True, timeout=60).strip()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def verify_inputs(packet, dependencies, egl):
    closure = VerifiedClosure(INPUT_CLOSURE, INPUT_CLOSURE_SHA, {
        'packet': packet, 'dependencies': dependencies, 'egl': egl.parent,
        'repository': REPO}).verify()
    data = closure.json('packet', 'preflight.json')
    need(closure.pin('packet', 'preflight.json')['sha256'] == PACKET_SHA,
         'preflight identity changed')
    need(closure.pin('packet', 'host-packet/manifest.json')['sha256'] == HOST_PACKET_SHA,
         'host packet identity changed')
    need(data['passEvidence'] is True and data['hostPacketReady'] is True,
         'preflight evidence incomplete')
    need(data['output'] == closure.manifest['historicalPacketRoot'] and
         data['sourceGitHead'] == SOURCE_HEAD == closure.manifest['sourceHead'],
         'closure does not name the pinned final159 packet/source')
    need(closure.pin('repository', 'tools/pbl-jit/PblJit.cpp')['sha256'] == data['candidate']['sha256'],
         'candidate changed: prepare and review a new packet')
    need(closure.pin('egl', egl.name)['sha256'] == EGL_SHA and
         closure.pin('egl', egl.name)['bytes'] == 152038, 'owned EGL archive identity differs')
    host = closure.json('packet', 'host-packet/manifest.json')
    expected_host = {p.removeprefix('host-packet/') for group, p in closure.rows
                     if group == 'packet' and p.startswith('host-packet/') and p != 'host-packet/manifest.json'}
    need({r['path'] for r in host['files']} == expected_host and len(host['files']) == len(expected_host),
         'host manifest file set incomplete')
    for row in host['files']:
        pinned = closure.pin('packet', 'host-packet/' + row['path'])
        need(all(pinned[k] == row[k] for k in ('bytes', 'sha256')), 'host manifest pin changed')
    declared_packet = Path(closure.manifest['historicalPacketRoot'])
    native_names = set()
    for row in data['compilerSourceBinding']:
        original = Path(row['path'])
        need(original.parent == declared_packet / 'native-src', 'unexpected overlay source')
        need(original.name not in native_names, 'duplicate compiler source binding')
        native_names.add(original.name)
        pinned = closure.pin('packet', 'native-src/' + original.name)
        need(all(pinned[k] == row[k] for k in ('bytes', 'sha256')), 'native overlay pin changed')
    need(native_names == set(PREFLIGHT.NATIVE_FILES) | {'PblJit.cpp'}, 'compiler source set incomplete')
    need(closure.bytes('packet', 'native-src/host-test/mock.h') ==
         closure.bytes('packet', 'host-packet/overlay/host-test/mock.h'), 'native mock differs from host mock')
    validation = closure.json('dependencies', 'validation.json')
    declared_dependencies = Path(closure.manifest['historicalDependenciesRoot'])
    expected = closure.manifest['originalDependencySet']
    actual = [str(Path(r['path']).relative_to(declared_dependencies)) for r in validation['artifacts']]
    need(sorted(actual) == expected['present'] and len(actual) == 5,
         'original dependency archive set incomplete')
    need(validation['presentArtifactValidation'] is True and validation['passArtifactValidation'] is False,
         'dependency validation scope changed')
    need(validation['missingArtifacts'] == [str(declared_dependencies / p) for p in expected['missing']],
         'missing dependency archive set changed')
    for row, name in zip(validation['artifacts'], actual):
        pinned = closure.pin('dependencies', name)
        need(all(pinned[k] == row[k] for k in ('bytes', 'sha256')), 'dependency artifact pin changed')
    for key in ['sourceClosure', 'inputs', 'replacementPaths']:
        row = validation[key]
        pinned = closure.pin('dependencies', str(Path(row['path']).relative_to(declared_dependencies)))
        need(all(pinned[k] == row[k] for k in ('bytes', 'sha256')), 'dependency metadata pin changed')
    return closure, data, validation


def probe(path, closure, directory=False):
    p = Path(path)
    record = {'path': str(p), 'directory': directory}
    if directory:
        try:
            if p.is_symlink():
                record['resolvedPath'] = str(p.resolve(strict=True))
            need(p.is_dir(), 'directory missing')
            next(p.iterdir(), None)
            return dict(record, status='available')
        except (OSError, ValueError) as error:
            return dict(record, status='unavailable', error=type(error).__name__)
    # Regular files are never accepted by fresh, post-hoc hashing. Every file
    # actually consumed or named by this preparation has an independent pin.
    for group, name in closure.rows:
        if closure.path_for(group, name) == p:
            return dict(record, **{k: v for k, v in closure.pin(group, name).items() if k != 'path'}, status='available')
    for row in closure.manifest['missing']:
        if closure.path_for(row['root'], row['path']) == p:
            return dict(record, status='unavailable', error='FileNotFoundError')
    raise ValueError('unrecorded preparation file input: ' + str(p))


def prepare(args):
    packet = task_root(args.packet.resolve(strict=True))
    dependencies = task_root(args.dependencies.resolve(strict=True))
    egl = Path(os.path.abspath(args.egl))
    need(egl.resolve(strict=True) == egl, 'EGL input must not be a symlink')
    # This is the first payload operation. Neither source Git commands nor any
    # output/source write occurs before the complete fixed closure verifies.
    closure, data, dependency_validation = verify_inputs(packet, dependencies, egl)
    if getattr(args, 'verify_only', False):
        print(json.dumps({'inputClosureVerified': True, 'readOnly': True, 'compiled': False,
                          'inputClosure': closure.manifest_pin,
                          'verifiedFiles': len(closure.rows), 'nativeIntegrationReady': False}, indent=2))
        return
    source = task_root(args.source.resolve(strict=True))
    need(source != Path(data['source']), 'use a separate source checkout')
    need(git(source, 'rev-parse', 'HEAD') == SOURCE_HEAD, 'source HEAD differs from the pinned final159 tree')
    need(git(source, 'status', '--porcelain', '--untracked-files=all') == '', 'source checkout must be pristine')
    out, storage = PREFLIGHT.safe_output(args.output, [source, packet, dependencies, REPO, egl.parent])
    need(out.parent == source.parent, 'build and source roots must share the approved disk parent')
    source_files = git(source, 'ls-files').splitlines()
    original_bytes, source_identities, source_before = {}, {}, {}
    for row in closure.manifest['sourceDestinations']:
        target = source / row['path']
        need(target.parent.resolve(strict=True) == target.parent and target.parent.is_relative_to(source),
             'source destination parent escaped checkout')
        if row['before'] is None:
            need(not target.exists() and not target.is_symlink(), 'source destination must be absent: ' + row['path'])
            source_before[target] = None
        else:
            payload, observed = read_pinned(target, dict(row['before'], owned=True))
            original_bytes[row['path']] = payload
            source_identities[target] = observed
            source_before[target] = dict(row['before'], path=str(target))
    verified = [closure.pin('dependencies', str(Path(r['path']).relative_to(closure.manifest['historicalDependenciesRoot'])))
                for r in dependency_validation['artifacts']]
    overlay = [('native-src/' + Path(r['path']).name, source / 'js/src/vm' / Path(r['path']).name)
               for r in data['compilerSourceBinding']]
    declared_packet = closure.manifest['historicalPacketRoot']
    declared_dependencies = closure.manifest['historicalDependenciesRoot']
    mappings = {declared_packet: str(out), declared_packet + '/deps': str(dependencies),
                declared_dependencies: str(dependencies), data['source']: str(source)}
    for name in ['replacement-paths.json', 'header-replacement-paths.json']:
        mappings.update({key: PREFLIGHT.relocate(value, {declared_dependencies: str(dependencies)})
                         for key, value in closure.json('dependencies', name).items()})
    for old, intermediate in data['pathMappings'].items():
        mappings[old] = PREFLIGHT.relocate(intermediate, mappings)
    denied_egl = [row['path'] for row in data['inputs'] if row.get('family') == 'mesa-egl-gpu' and row['path'].endswith('/libEGL_mesa.a')]
    need(len(set(denied_egl)) == 1, 'one declared EGL archive required')
    mappings[denied_egl[0]] = str(egl)
    env = {key: PREFLIGHT.relocate(value, mappings) for key, value in PREFLIGHT.parse_environment(closure.text('packet', 'recipe/environment.sh')).items()}
    removed_environment = {}
    if 'LD_LIBRARY_PATH' in env:
        need(all(not Path(p).exists() for p in env['LD_LIBRARY_PATH'].split(':')), 'review the changed host library search path')
        removed_environment['LD_LIBRARY_PATH'] = env.pop('LD_LIBRARY_PATH')
    for key, sub in [('TMPDIR','tmp'), ('TMP','tmp'), ('TEMP','tmp'), ('XDG_CACHE_HOME','cache'), ('CCACHE_DIR','cache/ccache'), ('SCCACHE_DIR','cache/sccache'), ('CARGO_HOME','cargo-home'), ('MOZBUILD_STATE_PATH','mozbuild')]:
        env[key] = str(out / sub)
    env.update(MOZCONFIG=str(out / '.mozconfig'), MOZ_OBJDIR=str(out / 'obj'), PYTHONDONTWRITEBYTECODE='1')
    need('HOME' not in env, 'do not replace the user HOME')
    env_text = '# Literal owned-child environment; no host/global mutation.\n' + '\n'.join('export ' + k + '=' + shlex.quote(v) for k, v in sorted(env.items())) + '\n'
    mozconfig = PREFLIGHT.relocate(closure.text('packet', '.mozconfig'), mappings)
    for flag in ['--target=wasm32-unknown-linux-musl', '--disable-jit', '--enable-portable-baseline-interp', '--disable-debug-symbols']:
        need(flag in mozconfig.split(), 'required target option changed: ' + flag)
    root_defs = PREFLIGHT.relocate(original_bytes['defs.mk'].decode('utf-8'), mappings)
    adapter_defs = PREFLIGHT.relocate(original_bytes['linuxonweb-build/adapters/defs.mk'].decode('utf-8'), mappings)
    commands = closure.json('packet', 'compile-commands.json')
    for command in commands:
        command['argv'] = [PREFLIGHT.relocate(a, mappings) for a in command['argv']]
        command['cwd'] = PREFLIGHT.relocate(command['cwd'], mappings)
    link_args = [PREFLIGHT.relocate(a, mappings) for a in shlex.split(closure.text('packet', 'link/link.args'))]
    required = []
    for (path, directory), roles in sorted(PREFLIGHT.environment_inputs(env).items()):
        if Path(path).is_relative_to(out):
            continue
        required.append(dict(probe(path, closure, directory), family='environment', roles=roles))
    for row in data['inputs']:
        if row.get('requiredBy') == 'final159-link':
            path = PREFLIGHT.relocate(row['path'], mappings)
            if not Path(path).is_relative_to(out):
                required.append(dict(probe(path, closure), family=row['family'], historicalPath=row.get('historicalPath')))
    unwrapped = dependencies / 'native-mapping-link/libnightly-native-mapping.a'
    required.append(dict(probe(unwrapped, closure), family='generated-graph-helper-mapping', reason='unwrapped helpers in source defs.mk'))
    missing = [row for row in required if row['status'] != 'available']
    python = shutil.which('python3', path=env['PATH'])
    need(python is not None, 'pinned environment has no Python')
    destinations = [target for original, target in overlay] + [source / '.mozconfig', source / 'defs.mk', source / 'linuxonweb-build/adapters/defs.mk']
    need(set(destinations) == set(source_before), 'source mutation set differs from reviewed closure')
    closure.assert_unchanged()
    for target, (original, observed) in source_identities.items():
        need(target.resolve(strict=True) == original and identity(original.lstat()) == observed,
             'source changed after validation: ' + str(target))
    for target, before in source_before.items():
        if before is None:
            need(not target.exists() and not target.is_symlink(), 'absent source destination appeared')
    out.mkdir(mode=0o700)
    for name in ['tmp','cache/ccache','cache/sccache','cargo-home','mozbuild','obj','lib','link','native-obj','native-deps','logs','profiles']:
        (out / name).mkdir(mode=0o700, parents=True, exist_ok=True)
    closure.copy_tree('packet', 'recipe', out / 'recipe')
    closure.copy_tree('packet', 'native-src', out / 'native-src')
    (out / 'recipe/environment.sh').write_text(env_text)
    for name in ['cargo','rustc']:
        (out / 'recipe' / name).write_text(PREFLIGHT.relocate(closure.text('packet', 'recipe/' + name), mappings))
    (out / '.mozconfig').write_text(mozconfig)
    (out / 'link/link.args').write_text('\n'.join(shlex.quote(a) for a in link_args) + '\n')
    write(out / 'native-compile-commands.json', commands)
    modified = []
    for original, target in overlay:
        before = source_before[target]
        target.write_bytes(closure.bytes('packet', original))
        modified.append({'before': before, 'after': PREFLIGHT.pin(target), 'input': closure.pin('packet', original)})
    for target, text in [(source / '.mozconfig', mozconfig), (source / 'defs.mk', root_defs), (source / 'linuxonweb-build/adapters/defs.mk', adapter_defs)]:
        before = source_before[target]
        target.write_text(text)
        modified.append({'before': before, 'after': PREFLIGHT.pin(target), 'kind':'owned-path-relocation'})
    generated_header_inputs = [closure.pin('dependencies', path) for group, path in closure.rows
                               if group == 'dependencies' and any(Path(path).is_relative_to(name) for name in
                               ['native-unwind/include', 'native-unwind/runtimes-build/include/c++/v1'])]
    write(out / 'dependency-headers.json', generated_header_inputs)
    write(out / 'source-changes.json', modified)
    write(out / 'relocation-map.json', mappings)
    write(out / 'missing-inputs.json', missing)
    phases = {'configure':['configure'], 'pre-export':['build','pre-export','-j1'], 'export':['build','export','-j1'], 'build':['build','-j1']}
    write(out / 'phase-commands.json', {name:{'argv':[python,str(source / 'mach'),*args], 'cwd':str(source), 'environment':str(out / 'recipe/environment.sh'), 'executeOnlyUnderUnchangedBoundedOwner':True, 'requiresStableProcessRoute':True} for name,args in phases.items()})
    record = {'kind':'owned-final159-build-preparation-v2', 'inputClosure':closure.manifest_pin, 'inputClosureFiles':len(closure.rows), 'inputClosureVerifiedBeforeMutation':True, 'preparationComplete':True, 'compiled':False, 'nativeIntegrationReady':False, 'fullBuildReady':False, 'guestRuntimeAcceptance':False, 'source':str(source), 'sourceHead':SOURCE_HEAD, 'trackedSourceFiles':len(source_files), 'output':str(out), 'packet':closure.pin('packet', 'preflight.json'), 'hostPacket':closure.pin('packet', 'host-packet/manifest.json'), 'candidate':closure.pin('repository', 'tools/pbl-jit/PblJit.cpp'), 'recipe':PREFLIGHT.pin(Path(__file__)), 'preparationModules':[PREFLIGHT.pin(p) for p in [HERE / 'input_closure.py', HERE / 'rebuild-preflight.py', REPO / 'tools/nightly-jit-safety/owned_paths.py']], 'storage':storage, 'dependencyArchives':verified, 'egl':closure.pin('egl', egl.name), 'dependencyHeaders':PREFLIGHT.pin(out / 'dependency-headers.json'), 'sourceChanges':PREFLIGHT.pin(out / 'source-changes.json'), 'environment':PREFLIGHT.pin(out / 'recipe/environment.sh'), 'removedOwnedChildEnvironment':removed_environment, 'nativeCompileCommands':PREFLIGHT.pin(out / 'native-compile-commands.json'), 'linkArguments':PREFLIGHT.pin(out / 'link/link.args'), 'phaseCommands':PREFLIGHT.pin(out / 'phase-commands.json'), 'requiredExternalInputs':required, 'missingInputs':missing, 'missingConfiguredObjects':sum(row['family'] == 'configured-firefox-object' and row['status'] == 'missing' for row in data['inputs']), 'configuredHeadersAndBackendMustBeGenerated':sum(row['family'] == 'configured-header-or-backend' for row in data['inputs']), 'processRouteBlocker':'name-based host policy changes live compiler leaf membership; strict owner must remain unchanged', 'remainingSteps':['resolve a supported stable inherited process route','complete and verify libc++; retain the separately verified exact helper archive','configure and regenerate the exact owned graph and headers','build all native Firefox inputs','compile both recorded native translation units and replace exactly those JS archive members','final link, complete O2 and fpcast ABI pass, Wasm validation and native-only package','independent exact source/build binding and real guest safety/performance acceptance']}
    write(out / 'preparation.json', record)
    print(json.dumps({key:record[key] for key in ['preparationComplete','compiled','sourceHead','trackedSourceFiles','output','nativeIntegrationReady','fullBuildReady','missingInputs']}, indent=2))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['packet','source','dependencies','egl','output']:
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--verify-only', action='store_true', help='verify the fixed input closure without source/output mutation')
    args=p.parse_args()
    try:
        prepare(args)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({'preparationComplete':False,'compiled':False,'error':str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
