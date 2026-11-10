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

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / 'tools/nightly-jit-safety'))
from owned_paths import task_root

SPEC = importlib.util.spec_from_file_location('rebuild_preflight', HERE / 'rebuild-preflight.py')
PREFLIGHT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREFLIGHT)
PACKET_SHA = '1c28693371cc897123e31a02c010a4af27b397b0f5e30e604642061ebf18ea01'
SOURCE_HEAD = '525176a870d4ec4329e7decdb2ef7fdd5b87fb22'
HOST_PACKET_SHA = 'ecfdf31d835d06979884908250f643b77796ff070e0f5d56d69861dc7d2db3f0'
EGL_SHA = 'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8'


def need(ok, message):
    if not ok:
        raise ValueError(message)


def git(source, *args):
    return subprocess.check_output(['git', '--no-pager', '-C', str(source), *args], text=True, timeout=60).strip()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def probe(path, directory=False):
    p = Path(path)
    record = {'path': str(p), 'directory': directory}
    try:
        if p.is_symlink():
            record['resolvedPath'] = str(p.resolve(strict=True))
        if directory:
            need(p.is_dir(), 'directory missing')
            next(p.iterdir(), None)
        else:
            record.update(PREFLIGHT.pin(p))
        record['status'] = 'available'
    except (OSError, ValueError) as error:
        record.update(status='unavailable', error=type(error).__name__)
    return record


def prepare(args):
    source = task_root(args.source.resolve(strict=True))
    packet = args.packet.resolve(strict=True)
    dependencies = args.dependencies.resolve(strict=True)
    egl = args.egl.resolve(strict=True)
    need(source != Path(json.loads((packet / 'preflight.json').read_text())['source']), 'use a separate source checkout')
    need(git(source, 'rev-parse', 'HEAD') == SOURCE_HEAD, 'source HEAD differs from the pinned final159 tree')
    need(git(source, 'status', '--porcelain', '--untracked-files=all') == '', 'source checkout must be pristine')
    need(PREFLIGHT.digest(packet / 'preflight.json') == PACKET_SHA, 'preflight identity changed')
    need(PREFLIGHT.digest(packet / 'host-packet/manifest.json') == HOST_PACKET_SHA, 'host packet identity changed')
    data = json.loads((packet / 'preflight.json').read_text())
    need(data['passEvidence'] is True and data['hostPacketReady'] is True, 'preflight evidence incomplete')
    need(PREFLIGHT.digest(REPO / 'tools/pbl-jit/PblJit.cpp') == data['candidate']['sha256'], 'candidate changed: prepare and review a new packet')
    need(PREFLIGHT.digest(egl) == EGL_SHA and egl.stat().st_size == 152038, 'owned EGL archive identity differs')
    out, storage = PREFLIGHT.safe_output(args.output, [source, packet, dependencies, REPO, egl.parent])
    need(out.parent == source.parent, 'build and source roots must share the approved disk parent')
    source_files = git(source, 'ls-files').splitlines()
    dependency_validation = json.loads((dependencies / 'validation.json').read_text())
    verified = []
    for record in dependency_validation['artifacts']:
        path = Path(record['path'])
        need(path.is_relative_to(dependencies), 'dependency artifact escaped its root')
        need(PREFLIGHT.digest(path) == record['sha256'] and path.stat().st_size == record['bytes'], 'rebuilt dependency identity changed')
        verified.append(PREFLIGHT.pin(path))
    overlay = []
    for record in data['compilerSourceBinding']:
        original = Path(record['path'])
        need(original.parent == packet / 'native-src', 'unexpected overlay source')
        need(PREFLIGHT.digest(original) == record['sha256'], 'native overlay identity changed')
        target = source / 'js/src/vm' / original.name
        need(not target.is_symlink(), 'overlay destination must not be a symlink')
        overlay.append((original, target))
    mappings = {str(packet): str(out), str(packet / 'deps'): str(dependencies), data['source']: str(source)}
    mappings.update(json.loads((dependencies / 'replacement-paths.json').read_text()))
    mappings.update(json.loads((dependencies / 'header-replacement-paths.json').read_text()))
    for old, intermediate in data['pathMappings'].items():
        mappings[old] = PREFLIGHT.relocate(intermediate, mappings)
    denied_egl = [row['path'] for row in data['inputs'] if row.get('family') == 'mesa-egl-gpu' and row['path'].endswith('/libEGL_mesa.a')]
    need(len(set(denied_egl)) == 1, 'one declared EGL archive required')
    mappings[denied_egl[0]] = str(egl)
    env = {key: PREFLIGHT.relocate(value, mappings) for key, value in PREFLIGHT.parse_environment((packet / 'recipe/environment.sh').read_text()).items()}
    removed_environment = {}
    if 'LD_LIBRARY_PATH' in env:
        need(all(not Path(p).exists() for p in env['LD_LIBRARY_PATH'].split(':')), 'review the changed host library search path')
        removed_environment['LD_LIBRARY_PATH'] = env.pop('LD_LIBRARY_PATH')
    for key, sub in [('TMPDIR','tmp'), ('TMP','tmp'), ('TEMP','tmp'), ('XDG_CACHE_HOME','cache'), ('CCACHE_DIR','cache/ccache'), ('SCCACHE_DIR','cache/sccache'), ('CARGO_HOME','cargo-home'), ('MOZBUILD_STATE_PATH','mozbuild')]:
        env[key] = str(out / sub)
    env.update(MOZCONFIG=str(out / '.mozconfig'), MOZ_OBJDIR=str(out / 'obj'), PYTHONDONTWRITEBYTECODE='1')
    need('HOME' not in env, 'do not replace the user HOME')
    env_text = '# Literal owned-child environment; no host/global mutation.\n' + '\n'.join('export ' + k + '=' + shlex.quote(v) for k, v in sorted(env.items())) + '\n'
    mozconfig = PREFLIGHT.relocate((packet / '.mozconfig').read_text(), mappings)
    for flag in ['--target=wasm32-unknown-linux-musl', '--disable-jit', '--enable-portable-baseline-interp', '--disable-debug-symbols']:
        need(flag in mozconfig.split(), 'required target option changed: ' + flag)
    root_defs = PREFLIGHT.relocate((source / 'defs.mk').read_text(), mappings)
    adapter_defs = PREFLIGHT.relocate((source / 'linuxonweb-build/adapters/defs.mk').read_text(), mappings)
    commands = json.loads((packet / 'compile-commands.json').read_text())
    for command in commands:
        command['argv'] = [PREFLIGHT.relocate(a, mappings) for a in command['argv']]
        command['cwd'] = PREFLIGHT.relocate(command['cwd'], mappings)
    link_args = [PREFLIGHT.relocate(a, mappings) for a in shlex.split((packet / 'link/link.args').read_text())]
    required = []
    for (path, directory), roles in sorted(PREFLIGHT.environment_inputs(env).items()):
        if Path(path).is_relative_to(out):
            continue
        required.append(dict(probe(path, directory), family='environment', roles=roles))
    for row in data['inputs']:
        if row.get('requiredBy') == 'final159-link':
            path = PREFLIGHT.relocate(row['path'], mappings)
            if not Path(path).is_relative_to(out):
                required.append(dict(probe(path), family=row['family'], historicalPath=row.get('historicalPath')))
    unwrapped = dependencies / 'native-mapping-link/libnightly-native-mapping.a'
    required.append(dict(probe(unwrapped), family='generated-graph-helper-mapping', reason='unwrapped helpers in source defs.mk'))
    missing = [row for row in required if row['status'] != 'available']
    python = shutil.which('python3', path=env['PATH'])
    need(python is not None, 'pinned environment has no Python')
    destinations = [target for original, target in overlay] + [source / '.mozconfig', source / 'defs.mk', source / 'linuxonweb-build/adapters/defs.mk']
    for target in destinations:
        need(target.parent.resolve(strict=True) == target.parent and target.parent.is_relative_to(source), 'source destination parent escaped checkout')
        need(not target.is_symlink(), 'source destination must not be a symlink')
        if target.exists():
            need(target.is_file() and target.stat().st_uid == os.getuid(), 'source destination is not an owned regular file')
    out.mkdir(mode=0o700)
    for name in ['tmp','cache/ccache','cache/sccache','cargo-home','mozbuild','obj','lib','link','native-obj','native-deps','logs','profiles']:
        (out / name).mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copytree(packet / 'recipe', out / 'recipe')
    shutil.copytree(packet / 'native-src', out / 'native-src')
    (out / 'recipe/environment.sh').write_text(env_text)
    for name in ['cargo','rustc']:
        (out / 'recipe' / name).write_text(PREFLIGHT.relocate((packet / 'recipe' / name).read_text(), mappings))
    (out / '.mozconfig').write_text(mozconfig)
    (out / 'link/link.args').write_text('\n'.join(shlex.quote(a) for a in link_args) + '\n')
    write(out / 'native-compile-commands.json', commands)
    modified = []
    for original, target in overlay:
        before = PREFLIGHT.pin(target) if target.exists() else None
        target.write_bytes(original.read_bytes())
        modified.append({'before': before, 'after': PREFLIGHT.pin(target), 'input': PREFLIGHT.pin(original)})
    for target, text in [(source / '.mozconfig', mozconfig), (source / 'defs.mk', root_defs), (source / 'linuxonweb-build/adapters/defs.mk', adapter_defs)]:
        before = PREFLIGHT.pin(target) if target.exists() else None
        target.write_text(text)
        modified.append({'before': before, 'after': PREFLIGHT.pin(target), 'kind':'owned-path-relocation'})
    generated_header_inputs = []
    for directory in [dependencies / 'native-unwind/include', dependencies / 'native-unwind/runtimes-build/include/c++/v1']:
        generated_header_inputs.extend(PREFLIGHT.pin(p) for p in sorted(directory.rglob('*')) if p.is_file())
    write(out / 'dependency-headers.json', generated_header_inputs)
    write(out / 'source-changes.json', modified)
    write(out / 'relocation-map.json', mappings)
    write(out / 'missing-inputs.json', missing)
    phases = {'configure':['configure'], 'pre-export':['build','pre-export','-j1'], 'export':['build','export','-j1'], 'build':['build','-j1']}
    write(out / 'phase-commands.json', {name:{'argv':[python,str(source / 'mach'),*args], 'cwd':str(source), 'environment':str(out / 'recipe/environment.sh'), 'executeOnlyUnderUnchangedBoundedOwner':True, 'requiresStableProcessRoute':True} for name,args in phases.items()})
    record = {'kind':'owned-final159-build-preparation-v1', 'preparationComplete':True, 'compiled':False, 'nativeIntegrationReady':False, 'fullBuildReady':False, 'guestRuntimeAcceptance':False, 'source':str(source), 'sourceHead':SOURCE_HEAD, 'trackedSourceFiles':len(source_files), 'output':str(out), 'packet':PREFLIGHT.pin(packet / 'preflight.json'), 'hostPacket':PREFLIGHT.pin(packet / 'host-packet/manifest.json'), 'candidate':PREFLIGHT.pin(REPO / 'tools/pbl-jit/PblJit.cpp'), 'recipe':PREFLIGHT.pin(Path(__file__)), 'storage':storage, 'dependencyArchives':verified, 'egl':PREFLIGHT.pin(egl), 'dependencyHeaders':PREFLIGHT.pin(out / 'dependency-headers.json'), 'sourceChanges':PREFLIGHT.pin(out / 'source-changes.json'), 'environment':PREFLIGHT.pin(out / 'recipe/environment.sh'), 'removedOwnedChildEnvironment':removed_environment, 'nativeCompileCommands':PREFLIGHT.pin(out / 'native-compile-commands.json'), 'linkArguments':PREFLIGHT.pin(out / 'link/link.args'), 'phaseCommands':PREFLIGHT.pin(out / 'phase-commands.json'), 'requiredExternalInputs':required, 'missingInputs':missing, 'missingConfiguredObjects':sum(row['family'] == 'configured-firefox-object' and row['status'] == 'missing' for row in data['inputs']), 'configuredHeadersAndBackendMustBeGenerated':sum(row['family'] == 'configured-header-or-backend' for row in data['inputs']), 'processRouteBlocker':'name-based host policy changes live compiler leaf membership; strict owner must remain unchanged', 'remainingSteps':['resolve a supported stable inherited process route','complete and verify libc++ and unwrapped helper mapping archives','configure and regenerate the exact owned graph and headers','build all native Firefox inputs','compile both recorded native translation units and replace exactly those JS archive members','final link, complete O2 and fpcast ABI pass, Wasm validation and native-only package','independent exact source/build binding and real guest safety/performance acceptance']}
    write(out / 'preparation.json', record)
    print(json.dumps({key:record[key] for key in ['preparationComplete','compiled','sourceHead','trackedSourceFiles','output','nativeIntegrationReady','fullBuildReady','missingInputs']}, indent=2))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['packet','source','dependencies','egl','output']:
        p.add_argument('--'+name, type=Path, required=True)
    args=p.parse_args()
    try:
        prepare(args)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({'preparationComplete':False,'compiled':False,'error':str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
