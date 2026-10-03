#!/usr/bin/env python3
"""Bounded, locked Rust/browser build; never builds in RAM-backed /tmp."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import time

SOURCE = Path(__file__).resolve().parent
TASK = Path('/mnt/p6/project/build/guest-vulkan-wgpu-20261003')
GIB = 1024 ** 3


def identity(path):
    return {'path': str(path), 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def available_ram():
    rows = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    return int(rows['MemAvailable'].split()[0]) * 1024


def group_rss(pgid):
    total = 0
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            stat = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(stat[2]) == pgid:
                total += int((proc / 'statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE')
        except (OSError, ValueError, IndexError):
            continue
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--bindgen', type=Path, default=TASK / 'bindgen-cli/bin/wasm-bindgen')
    args = parser.parse_args()
    out = args.output.resolve()
    assert out.is_relative_to(TASK) and not out.exists(), 'fresh task output required'
    assert shutil.disk_usage(TASK).free >= 20 * GIB and available_ram() >= 4 * GIB
    out.mkdir(parents=True)
    (out / 'tmp').mkdir()
    env = dict(os.environ, CARGO_TARGET_DIR=str(TASK / 'target'),
               TMPDIR=str(out / 'tmp'), TMP=str(out / 'tmp'), TEMP=str(out / 'tmp'))
    inputs = [identity(SOURCE / name) for name in ['Cargo.toml', 'Cargo.lock', 'src/lib.rs']]
    commands = []

    def run(argv, name):
        cpus = sorted(os.sched_getaffinity(0))[:2]

        def guards():
            resource.setrlimit(resource.RLIMIT_AS, (4 * GIB, 4 * GIB))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            os.sched_setaffinity(0, cpus)

        start = time.monotonic()
        peak = 0
        with (out / (name + '.log')).open('wb') as log:
            process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT,
                                       env=env, start_new_session=True, preexec_fn=guards)
            error = None
            try:
                while process.poll() is None:
                    peak = max(peak, group_rss(process.pid))
                    if peak > 3 * GIB or available_ram() < 2 * GIB:
                        raise RuntimeError('build memory guard')
                    if shutil.disk_usage(TASK).free < 20 * GIB:
                        raise RuntimeError('build disk reserve guard')
                    if time.monotonic() - start > 900:
                        raise RuntimeError('build deadline')
                    time.sleep(.25)
            except BaseException as exc:
                error = str(exc)
            finally:
                # Reap descendants even if a compiler parent exited early.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            row = {'argv': list(map(str, argv)), 'exit': process.returncode,
                   'seconds': time.monotonic() - start, 'peakGroupRss': peak,
                   'assignedCpus': cpus, 'log': str(out / (name + '.log')), 'error': error}
            commands.append(row)
            assert process.returncode == 0 and error is None, row

    run([str(args.bindgen), '--version'], 'bindgen-version')
    assert (out / 'bindgen-version.log').read_text().strip() == 'wasm-bindgen 0.2.129'
    run(['rustc', '--version', '--verbose'], 'rustc-version')
    run(['cargo', 'build', '--offline', '--locked', '--manifest-path', str(SOURCE / 'Cargo.toml'),
         '--release', '--target', 'wasm32-unknown-unknown', '-j2'], 'cargo-build')
    raw = TASK / 'target/wasm32-unknown-unknown/release/guest_vulkan_wgpu_host.wasm'
    shutil.copyfile(raw, out / raw.name)
    run([str(args.bindgen), '--target', 'web', '--out-dir', str(out), str(out / raw.name)], 'bindgen')
    for name in [raw.name, 'guest_vulkan_wgpu_host_bg.wasm']:
        run(['wasm-objdump', '-h', str(out / name)], name + '-sections')
        assert '".debug' not in (out / (name + '-sections.log')).read_text(), 'unexpected DWARF'
    assert inputs == [identity(Path(row['path'])) for row in inputs], 'source changed during build'
    report = {'pass': True, 'testOnly': True, 'scope': 'Rust wgpu browser module, not Firefox acceptance',
              'inputs': inputs, 'commands': commands, 'profile': {'optLevel': 2, 'strip': 'debuginfo'},
              'artifacts': [identity(out / name) for name in [raw.name,
                            'guest_vulkan_wgpu_host.js', 'guest_vulkan_wgpu_host_bg.wasm']],
              'noDwarf': True, 'binaryenOptimization': False}
    (out / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'output': str(out), 'noDwarf': True}))


if __name__ == '__main__':
    main()
