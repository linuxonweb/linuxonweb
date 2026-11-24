#!/usr/bin/env python3
"""Fresh reviewed kernel source/config build with storage and owned PGID bounds."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import traceback

CAP = 6 * 1024**3
RESERVE = 8 * 1024**3
STOP = 5 * 1024**3

# Exact retained source-tree files; these are not configured target headers.
BASELINE_GENERATED_SOURCES = {'drivers/net/wireguard/generated/netlink.c': 'c7f7cc1b3fe195a9102f5827f6205c50e3c649eb4a736439444d756ebe836531', 'drivers/net/wireguard/generated/netlink.h': '79cf0b77ca9013fb3d94c79af1bfdd4a00d09d6de1adcbe69c40d4b6be59e029', 'tools/include/generated/asm-offsets.h': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'tools/include/generated/asm/cpucap-defs.h': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'tools/include/generated/asm/sysreg-defs.h': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'tools/net/ynl/generated/.gitignore': '9699de99d70309e8ba460f2d8275248b94970ef46afd3c44a7ffd4f831bd27df', 'tools/net/ynl/generated/Makefile': '6a02fac23c79a71697f2d14668e79eaf29a147b8d7c1097fd026b70d9b6e529a', 'tools/virtio/generated/autoconf.h': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def size(path):
    return int(subprocess.check_output(['du', '-sb', str(path)], text=True).split()[0])


def members(pgid):
    result = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                result.append({'pid': int(path.parent.name), 'state': fields[0]})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return result


def terminate_group(pgid, sig):
    try:
        os.killpg(pgid, sig)
    except ProcessLookupError:
        pass


def config(path):
    values = {}
    for line in path.read_text().splitlines():
        if line.startswith('CONFIG_'):
            key, value = line.split('=', 1)
            values[key] = value
        elif line.startswith('# CONFIG_') and line.endswith(' is not set'):
            values[line[2:-11]] = 'n'
    return values


def copy_source(args):
    assert not args.destination.exists()
    rows = []
    original = args.original.resolve()

    def copied(source, target):
        source, target = Path(source), Path(target)
        assert not source.name.endswith(('.o', '.a', '.cmd')) and source.name != '.config', source
        relative = str(source.relative_to(original))
        digest = sha(source)
        if 'generated' in source.relative_to(original).parts:
            assert BASELINE_GENERATED_SOURCES.get(relative) == digest, source
        shutil.copy2(source, target)
        target.chmod(target.stat().st_mode | 0o200)
        assert sha(target) == digest
        rows.append({'relative': str(source.relative_to(original)), 'sha256': digest, 'bytes': source.stat().st_size})
        return str(target)

    shutil.copytree(original, args.destination, symlinks=True, copy_function=copied)
    links = []
    for directory, dirs, files in os.walk(args.destination):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                assert path.resolve().is_relative_to(args.destination.resolve()), path
                links.append({'relative': str(path.relative_to(args.destination)), 'target': os.readlink(path)})
        Path(directory).chmod(Path(directory).stat().st_mode | 0o700)
    write(args.proof, {'scope': 'fresh exact source copy; no objects/configured target headers',
                      'baselineGeneratedSourceFiles': [row for row in rows if row['relative'] in BASELINE_GENERATED_SOURCES],
                      'original': str(original), 'sourceFiles': rows, 'symlinks': links})


def verify_source(args):
    source = args.original.resolve()
    assert source == Path('/mnt/p6/build/glibc-cancel-kernel-whole-run2-20261002/source/linux')
    previous = source.parents[1] / 'source-copy.json'
    copied = json.loads(previous.read_text())
    recipe = json.loads(args.recipe.read_text())
    assert sha(previous) == recipe['sourceReuse']['originalProofSha256']
    replacements = {row['relative']: row for row in recipe['overlay']}
    expected_files = {row['relative'] for row in copied['sourceFiles']} | set(replacements)
    expected_links = {row['relative'] for row in copied['symlinks']}
    actual_files, actual_links = set(), set()
    for directory, dirs, files in os.walk(source):
        for name in dirs + files:
            path = Path(directory) / name
            relative = str(path.relative_to(source))
            if path.is_symlink():
                actual_links.add(relative)
            elif name in files:
                assert path.is_file(), path
                assert not path.name.endswith(('.o', '.a', '.cmd')) and path.name != '.config', path
                if 'generated' in path.relative_to(source).parts:
                    assert BASELINE_GENERATED_SOURCES.get(relative) == sha(path), path
                actual_files.add(relative)
    assert actual_files == expected_files, {'unexpectedFiles': sorted(actual_files - expected_files),
                                           'missingFiles': sorted(expected_files - actual_files)}
    assert actual_links == expected_links, {'unexpectedSymlinks': sorted(actual_links - expected_links),
                                           'missingSymlinks': sorted(expected_links - actual_links)}
    verified = []
    for row in copied['sourceFiles']:
        expected = replacements.get(row['relative'], row)
        path = source / row['relative']
        assert path.stat().st_size == expected['bytes'] and sha(path) == expected['sha256'], path
        verified.append({'relative': row['relative'], 'sha256': expected['sha256'], 'bytes': expected['bytes']})
    for row in copied['symlinks']:
        path = source / row['relative']
        assert path.is_symlink() and os.readlink(path) == row['target']
        assert path.resolve().is_relative_to(source)
    for row in recipe['overlay']:
        path = source / row['relative']
        assert path.stat().st_size == row['bytes'] and sha(path) == row['sha256'], path
    write(args.proof, {'scope': 'verified reuse of independent source only; no old objects/configured target headers',
                      'source': str(source), 'originalSourceCopyProof': str(previous),
                      'originalSourceCopyProofSha256': sha(previous), 'verifiedFiles': verified,
                      'overlay': recipe['overlay'], 'sourceBytes': size(source),
                      'completeMembership': {'regularFiles': len(actual_files), 'symlinks': len(actual_links),
                                             'unexpectedOrMissing': False}})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--copy-source', action='store_true')
    ap.add_argument('--verify-source', action='store_true')
    for name in ('original', 'destination', 'proof', 'task', 'recipe'):
        ap.add_argument('--' + name, type=Path)
    args = ap.parse_args()
    if args.copy_source:
        copy_source(args)
        return
    if args.verify_source:
        verify_source(args)
        return
    assert os.environ.get('GLIBC_CANCEL_WHOLE_BUILD_AUTHORIZED') == '1'
    task = args.task.resolve()
    assert str(task) == '/mnt/p6/build/glibc-cancel-kernel-whole-run4-20261002'
    assert not task.exists(), 'fresh destination required'
    assert shutil.disk_usage(task.parent).free >= RESERVE
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    for name in ('tmp', 'cache', 'logs', 'source', 'objects'):
        (task / name).mkdir()
    environment = os.environ.copy()
    for name in ('TMPDIR', 'TMP', 'TEMP'): environment[name] = str(task / 'tmp')
    environment['XDG_CACHE_HOME'] = str(task / 'cache')
    recipe_path = args.recipe.resolve()
    recipe = json.loads(recipe_path.read_text())
    assert recipe['supervision']['taskCapBytes'] == CAP
    assert recipe['copiedObjects'] is False and recipe['copiedGeneratedHeaders'] is False
    write(task / 'recipe.json', recipe)
    shutil.copyfile(Path(__file__), task / 'logs/build-whole-kernel.executed.py')
    for row in recipe['pins']:
        path = Path(row['path'])
        assert path.stat().st_size == row['bytes'] and sha(path) == row['sha256'], path
    for row in recipe['overlay']:
        path = recipe_path.parent / 'overlay' / row['relative']
        assert path.stat().st_size == row['bytes'] and sha(path) == row['sha256'], path
    reused_source = Path('/mnt/p6/build/glibc-cancel-kernel-whole-run2-20261002/source/linux')
    assert reused_source.is_dir()
    def owned_bytes():
        # Include the reused owned source in this attempt's six-GiB budget.
        return size(task) + size(reused_source)
    stages = []

    def run(label, argv, seconds):
        assert shutil.disk_usage(task).free >= RESERVE
        output = task / 'logs' / label
        output.mkdir()
        start = time.monotonic()
        reason = None
        error = None
        code = None
        observations = []
        with (output / 'output.log').open('wb') as stream:
            child = subprocess.Popen(argv, stdout=stream, stderr=subprocess.STDOUT,
                                     env=environment, start_new_session=True)
            try:
                write(output / 'live.json', {'pid': child.pid, 'pgid': child.pid, 'argv': argv,
                                            'cwd': os.getcwd(), 'deadlineSeconds': seconds})
                print(json.dumps({'stage': label, 'pid': child.pid, 'pgid': child.pid}), flush=True)
                next_storage = 0
                while child.poll() is None:
                    elapsed = time.monotonic() - start
                    free = shutil.disk_usage(task).free
                    if elapsed >= next_storage:
                        used = owned_bytes()
                        observations.append({'elapsed': elapsed, 'bytes': used, 'freeBytes': free})
                        write(output / 'storage.json', observations)
                        next_storage = elapsed + 5
                        if used > CAP: reason = 'task cap exceeded'
                    if free < STOP: reason = 'free-space hard stop'
                    if elapsed > seconds: reason = 'deadline'
                    if reason:
                        break
                    time.sleep(0.25)
            except BaseException:
                error = traceback.format_exc()
            finally:
                # Cleanup also covers storage/log/proc errors and interruption.
                # Only this child's independently created group is signalled.
                try:
                    if child.poll() is None or reason or error:
                        terminate_group(child.pid, signal.SIGTERM)
                    try: code = child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        terminate_group(child.pid, signal.SIGKILL)
                        code = child.wait(timeout=2)
                finally:
                    terminate_group(child.pid, signal.SIGKILL)
                    limit = time.monotonic() + 3
                    while members(child.pid) and time.monotonic() < limit:
                        time.sleep(0.05)
        result = {'label': label, 'argv': argv, 'cwd': os.getcwd(), 'exit': code,
                  'pid': child.pid, 'pgid': child.pid, 'seconds': time.monotonic() - start,
                  'stopReason': reason, 'terminalMembers': members(child.pid),
                  'supervisorError': error,
                  'taskBytes': owned_bytes(), 'freeBytes': shutil.disk_usage(task).free}
        write(output / 'result.json', result)
        stages.append(result)
        write(task / 'stages.json', stages)
        assert not result['terminalMembers']
        assert not reason and not error and result['taskBytes'] <= CAP and result['freeBytes'] >= STOP
        return code

    source = reused_source
    assert run('source-reuse', [sys.executable, str(Path(__file__).resolve()), '--verify-source',
               '--original', str(source), '--recipe', str(recipe_path),
               '--proof', str(task / 'source-reuse.json')], 180) == 0
    original_config = Path(recipe['config'])
    shutil.copyfile(original_config, task / 'original.config')
    shutil.copyfile(original_config, task / 'objects/.config')
    (task / 'objects/tools/wasm').mkdir(parents=True)
    code = run('olddefconfig', recipe['commands'][0], 180)
    assert code == 0
    before, after = config(task / 'original.config'), config(task / 'objects/.config')
    difference = {key: {'before': before.get(key), 'after': after.get(key)}
                  for key in sorted(before.keys() | after.keys()) if before.get(key) != after.get(key)}
    allowed = {'CONFIG_CC_VERSION_TEXT', 'CONFIG_CLANG_VERSION', 'CONFIG_AS_VERSION',
               'CONFIG_LLD_VERSION', 'CONFIG_RUSTC_VERSION', 'CONFIG_RUSTC_LLVM_VERSION',
               'CONFIG_RUSTC_LLVM_MAJOR_VERSION'}
    rust_unavailable_for_target = all(values.get(key, 'n') == 'n'
                                     for values in (before, after)
                                     for key in ('CONFIG_RUST', 'CONFIG_HAVE_RUST'))
    disabled_rust_availability_only = (
        rust_unavailable_for_target and
        difference.get('CONFIG_RUST_IS_AVAILABLE') == {'before': None, 'after': 'y'})
    if disabled_rust_availability_only:
        # GNU Kconfig's host availability probe cannot enable Rust on this
        # architecture: RUST also requires HAVE_RUST, absent in both configs.
        # All other nonmetadata configuration remains under the strict gate.
        allowed.add('CONFIG_RUST_IS_AVAILABLE')
    config_proof = {'differences': difference, 'allowedCompilerMetadata': sorted(allowed),
                    'disabledRustAvailabilityOnly': disabled_rust_availability_only,
                    'targetRustAndHaveRustDisabled': rust_unavailable_for_target,
                    'pass': set(difference) <= allowed, 'originalSha256': sha(task / 'original.config'),
                    'generatedSha256': sha(task / 'objects/.config')}
    write(task / 'config-comparison.json', config_proof)
    assert config_proof['pass'], 'functional config change requires review; no build launched'
    assert run('prepare', recipe['commands'][1], 180) == 0
    code = run('kernel-build', recipe['commands'][2], 1800)
    write(task / 'build-result.json', {'scope': 'fresh whole-kernel compilation only, no runtime acceptance',
          'exit': code, 'stages': stages, 'recipeSha256': sha(recipe_path), 'taskBytes': owned_bytes(),
          'freeBytes': shutil.disk_usage(task).free, 'runtimeAcceptance': False})
    raise SystemExit(code)


if __name__ == '__main__':
    main()
