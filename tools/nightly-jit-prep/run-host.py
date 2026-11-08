#!/usr/bin/env python3
"""Run pinned baseline and nested emitter checks; host-only evidence.

Use the monitored, disk-backed tools/guest-packages/bounded.py owner. A packet
with explicit fixtures must declare its complete reviewed assets and runners.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
BASELINE_ASSETS = ('emit.cpp', 'run.mjs')
BROAD_ASSETS = BASELINE_ASSETS + ('nested-fixtures.h', 'run-nested.mjs')
BASELINE_RUNNERS = [{'name': 'baseline', 'file': 'run.mjs'}]
BROAD_RUNNERS = BASELINE_RUNNERS + [{'name': 'nested', 'file': 'run-nested.mjs'}]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def relative_path(value):
    path = Path(value)
    require(not path.is_absolute() and '..' not in path.parts and
            path != Path('.') and str(path) == value, 'invalid packet path: ' + value)
    return path


def check_pin(path, record):
    require(path.is_file(), 'missing pinned file: ' + str(path))
    require(digest(path) == record['sha256'], 'pinned hash mismatch: ' + str(path))
    require('bytes' not in record or path.stat().st_size == record['bytes'],
            'pinned size mismatch: ' + str(path))


def verify_packet(packet):
    manifest = json.loads((packet / 'manifest.json').read_text())
    require(manifest.get('pass') is True, 'packet did not pass preparation')
    coverage = manifest.get('coverage', 'integer')
    require(coverage in ('integer', 'broad'), 'unknown host coverage')
    pinned = set()
    for record in manifest['files']:
        relative = relative_path(record['path'])
        require(str(relative) not in pinned, 'duplicate packet pin: ' + str(relative))
        path = packet / relative
        require(path.resolve().is_relative_to(packet.resolve()), 'packet file escapes root')
        check_pin(path, record)
        pinned.add(str(relative))
    for record in manifest['inputs']:
        check_pin(Path(record['path']), record)
    for name in ('overlay/PblJit.cpp', 'overlay/host-test/mock.h'):
        require(name in pinned, 'un-pinned compiler input: ' + name)
    for path in (packet / 'overlay').rglob('*'):
        if path.is_file():
            require(str(path.relative_to(packet)) in pinned, 'un-pinned overlay file: ' + str(path))
    assets = BROAD_ASSETS if coverage == 'broad' else BASELINE_ASSETS
    runners = BROAD_RUNNERS if coverage == 'broad' else BASELINE_RUNNERS
    if 'hostFixtures' in manifest:
        relative = relative_path(manifest['hostFixtures'])
        require(manifest.get('hostFixtureFiles') == list(assets),
                'incomplete host fixture contract; regenerate packet')
        require(manifest.get('hostRunners') == runners,
                'incomplete or changed host runner contract; regenerate packet')
        fixtures = packet / relative
        for name in assets:
            require(str(relative / name) in pinned, 'un-pinned host fixture: ' + name)
    else:
        # Older prepare.py packets use reviewed repository fixtures. Broad current
        # fixtures still require the nested header and runner; never silently skip.
        fixtures = HERE if coverage == 'integer' else HERE.parent / 'pbl-jit/host-test'
    for name in assets:
        require((fixtures / name).is_file(), 'missing host fixture: ' + name)
    return manifest, fixtures, assets, runners


def suite_result(text):
    lines = text.splitlines()
    require(bool(lines), 'host runner emitted no result')
    result = json.loads(lines[-1])
    require(isinstance(result, dict) and result.get('pass') is True and
            result.get('failures') == 0 and isinstance(result.get('checks'), int) and
            result['checks'] > 0, 'host runner did not report passing checks')
    return result


def run(packet, out, cxx='c++'):
    packet, out = packet.resolve(), out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {'pass': False, 'scope': 'host emitter correctness/fallback checks; no native Firefox ABI or guest acceptance',
              'nativeIntegrationReady': False, 'fullBuildReady': False,
              'guestRuntimeAcceptance': False, 'commands': [], 'test_results': {}}
    try:
        manifest, fixtures, assets, runners = verify_packet(packet)
        report.update(coverage=manifest.get('coverage', 'integer'),
                      packet_manifest_sha256=digest(packet / 'manifest.json'),
                      hostRunners=runners, integrityChecked=True,
                      helper_inputs=[{'path': str(path), 'sha256': digest(path)} for path in
                                     [fixtures / name for name in assets] + [Path(__file__).resolve()]])
        shutil.copytree(packet / 'overlay', out / 'adapter')
        for name in assets:
            if name.endswith(('.cpp', '.h')):
                shutil.copyfile(fixtures / name, out / 'adapter/host-test' / name)
        for name in ('fixtures', 'tmp', 'cache'):
            (out / name).mkdir()
        env = os.environ.copy()
        env.update({key: str(out / 'tmp') for key in ('TMPDIR', 'TMP', 'TEMP')})
        env.update(XDG_CACHE_HOME=str(out / 'cache'),
                   ASAN_OPTIONS='detect_leaks=1:abort_on_error=1',
                   UBSAN_OPTIONS='halt_on_error=1:print_stacktrace=1')
        report.update(task_tmp=str(out / 'tmp'), task_cache=str(out / 'cache'),
                      sanitizers={key: env[key] for key in ('ASAN_OPTIONS', 'UBSAN_OPTIONS')})
        commands = [('compile', [cxx, '-std=c++17', '-O1', '-g', '-fsanitize=address,undefined',
                                '-fno-omit-frame-pointer', str(out / 'adapter/host-test/emit.cpp'),
                                '-o', str(out / 'emit')], 180),
                    ('emit', [str(out / 'emit'), str(out / 'fixtures')], 30)]
        commands += [(runner['name'], ['node', str(fixtures / runner['file']),
                                      str(out / 'fixtures')], 30) for runner in runners]
        for index, (name, argv, timeout) in enumerate(commands):
            command = {'name': name, 'argv': argv, 'timeoutSeconds': timeout,
                       'stdout': f'command{index}.stdout', 'stderr': f'command{index}.stderr'}
            report['commands'].append(command)
            try:
                completed = subprocess.run(argv, env=env, text=True, capture_output=True,
                                           timeout=timeout)
                stdout, stderr = completed.stdout, completed.stderr
                command['exit_code'] = completed.returncode
            except subprocess.TimeoutExpired as error:
                def decoded(data):
                    return data.decode(errors='replace') if isinstance(data, bytes) else (data or '')
                stdout, stderr = decoded(error.stdout), decoded(error.stderr)
                command.update(exit_code=None, timedOut=True)
            (out / command['stdout']).write_text(stdout)
            (out / command['stderr']).write_text(stderr)
            require(command['exit_code'] == 0, 'host command failed: ' + name)
            if name not in ('compile', 'emit'):
                report['test_results'][name] = suite_result(stdout)
        require(set(report['test_results']) == {runner['name'] for runner in runners},
                'a declared host runner did not finish')
        # Preserve the former baseline result field for existing result consumers.
        report['test_result'] = report['test_results']['baseline']
        report['pass'] = True
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        report['error'] = str(error)
    (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packet', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cxx', default='c++')
    args = parser.parse_args()
    report = run(args.packet, args.output, args.cxx)
    print(json.dumps(report, indent=2))
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
