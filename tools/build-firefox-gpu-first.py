#!/usr/bin/env python3
"""Private Firefox128 GPU relink preserving the accepted v10 JS archive.

Adds the reviewed W0/W1 objects and B2g Mesa/Zink/Vulkan inputs. It never
modifies their source trees or any Nightly build input. This is a diagnostic
candidate until actual guest rendering and release gates pass.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import shlex
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
TASK = Path('/mnt/p6/project/build/firefox-gpu-first-20261003')
ACCEPTED = Path('/mnt/p6/build/guest-jit-throws-20261002/build-cached-run1')
W1 = Path('/mnt/p6/build/firefox-webgpu-w1-20260929/relink-run1')
B2G = Path('/mnt/p6/build/glgears-zink-20261001/link/egl2')
CC = '/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
FLAGS = ['-O2', '-pthread', '-matomics', '-mbulk-memory', '-Wall', '-Wextra', '-Werror']
EXPECTED = 'f1b32608c447fd86bf0d7a9891b1de623c3609f3317e4ff6c4882d9841007d15'


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read_leb(data, offset):
    value, shift = 0, 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, offset
        shift += 7


def leb(value):
    out = bytearray()
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return out


def growable_table(data):
    offset = 8
    while offset < len(data):
        start = offset
        section = data[offset]
        size, payload = read_leb(data, offset + 1)
        offset = payload + size
        if section != 4:
            continue
        if data[payload:payload + 3] != b'\x01\x70\x01':
            raise ValueError('expected one bounded funcref table')
        minimum, cursor = read_leb(data, payload + 3)
        maximum, cursor = read_leb(data, cursor)
        if maximum != minimum or cursor != offset:
            raise ValueError('unexpected table limits')
        body = b'\x01\x70\x00' + leb(minimum)
        return data[:start] + b'\x04' + leb(len(body)) + body + data[offset:], minimum
    raise ValueError('missing table')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    if out.exists() or not out.is_relative_to(TASK) or out == TASK:
        parser.error('fresh task child required')
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ.get(key, '/tmp')).resolve()
        if not scratch.is_relative_to(TASK) or not scratch.is_dir():
            parser.error('disk-backed task scratch required')
    if shutil.disk_usage(TASK).free < 20 * 1024**3:
        parser.error('20 GiB reserve required')
    if sha(ACCEPTED / 'firefox-pbl-jit.wasm') != EXPECTED:
        parser.error('accepted v10 executable mismatch')
    out.mkdir()
    report = dict(passBuild=False, candidateOnly=True, acceptedFirefoxSHA256=EXPECTED,
                  addressSpaceGiB=16, residentLimitGiB=8, availableRAMFloorGiB=4,
                  inputs={}, steps={})

    def copy(source, name):
        target = out / name
        target.parent.mkdir(exist_ok=True, parents=True)
        shutil.copyfile(source, target)
        report['inputs'][str(source)] = {'sha256': sha(source), 'bytes': Path(source).stat().st_size, 'copy': str(target)}
        return str(target)

    def guards():
        resource.setrlimit(resource.RLIMIT_AS, (16 * 1024**3, 16 * 1024**3))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        Path('/proc/self/oom_score_adj').write_text('1000')

    def run(name, argv, cwd=ROOT, timeout=300):
        (out / (name + '.command.json')).write_text(json.dumps({'cwd': str(cwd), 'argv': argv}, indent=2) + '\n')
        started = time.monotonic()
        peak = 0
        with (out / (name + '.log')).open('wb') as log:
            process = subprocess.Popen(argv, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, preexec_fn=guards)
            try:
                while process.poll() is None:
                    rss = 0
                    for stat in Path('/proc').glob('[0-9]*/stat'):
                        try:
                            fields = stat.read_text().rsplit(')', 1)[1].split()
                            if int(fields[2]) == process.pid:
                                rss += int(fields[21]) * os.sysconf('SC_PAGE_SIZE')
                        except (OSError, ValueError, IndexError):
                            continue
                    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
                    peak = max(peak, rss)
                    if rss > 8 * 1024**3 or available < 4 * 1024**3 or time.monotonic() - started > timeout or shutil.disk_usage(TASK).free < 20 * 1024**3:
                        raise RuntimeError(name + ' resource bound reached')
                    time.sleep(0.25)
                if process.returncode:
                    raise RuntimeError(name + ' failed: ' + str(process.returncode))
            finally:
                try:
                    os.killpg(process.pid, 9)
                except ProcessLookupError:
                    pass
                process.wait()
                report['steps'][name] = dict(exit=process.returncode, seconds=time.monotonic() - started, peakPolledRSS=peak, pgid=process.pid, reaped=True)

    started = time.monotonic()
    try:
        base = shlex.split((ACCEPTED / 'link.command.txt').read_text())
        cwd = Path(json.loads((W1 / 'link-command.json').read_text())['cwd'])
        original_rsp = Path(next(a[1:] for a in base if a.startswith('@')))
        response = original_rsp.read_text().splitlines()
        replacements = {'../../gfx/thebes/gfxPlatform.o': W1 / 'gfxPlatform-patched.o',
                        '../../dom/webgpu/Unified_cpp_dom_webgpu0.o': W1 / 'webgpu0-patched.o'}
        for original, source in replacements.items():
            if response.count(original) != 1:
                raise ValueError('response anchor missing: ' + original)
            response[response.index(original)] = copy(source, 'objects/' + source.name)
        new_rsp = out / 'firefox-nss.list'
        new_rsp.write_text('\n'.join(response) + '\n')
        base[base.index('@' + str(original_rsp))] = '@' + str(new_rsp)
        js = str(ACCEPTED / 'libjs_static.a')
        base[base.index(js)] = copy(Path(js), 'lib/libjs_static.a')
        mmap = '/mnt/p6/project/linux/.cache/reliability-performance-20260926/firefox-mmap-aligned/mmap-shim.o'
        base[base.index(mmap)] = copy(Path('/mnt/p6/build/firefox-mmap-w0-20260929/relink-run1/mmap-shim.o'), 'objects/mmap-shim.o')
        for name in ('zink-egl-static', 'glxtest-egl'):
            source = copy(ROOT / ('web/linux/firefox-shims/' + name + '.c'), 'sources/' + name + '.c')
            extra = ['-I/mnt/p6/build/zink-b3-20260930/mesa-26.2.3/include']
            if name == 'glxtest-egl':
                extra += ['-static', '-Wl,--import-memory,--export-table,--shared-memory,--initial-memory=1048576,--max-memory=4294967296,-z,stack-size=65536']
                target = str(out / 'glxtest.wasm')
            else:
                extra += ['-c']
                target = str(out / 'objects/zink-egl-static.o')
            run('compile-' + name, [CC, *FLAGS, '-std=c11', *extra, source, '-o', target])
        vk = copy(B2G / 'obj/zink-static-vk.o', 'objects/zink-static-vk.o')
        override = copy(B2G / 'obj/ovr-builtin_functions.o', 'objects/ovr-builtin_functions.o')
        # Definitions before the archive retain the accepted Mesa C++ ABI override.
        additions = [str(out / 'objects/zink-egl-static.o'), vk, override]
        additions += [copy(B2G / ('lib/' + name), 'lib/' + name) for name in ('libEGL_mesa.a', 'libgallium_zink.a', 'libguest_vk_icd.a')]
        anchor = '/mnt/p6/project/linux/.cache/libcxxabi-wasm-abi-20260925/lib/libc++abi.a'
        index = base.index(anchor) + 1
        base[index:index] = additions
        raw, fpcast, final = out / 'firefox-raw.wasm', out / 'firefox-fpcast.wasm', out / 'firefox.wasm'
        base[base.index('-o') + 1] = str(raw)
        base += ['-Map=' + str(out / 'link.map')]
        run('link', base, cwd)
        run('fpcast', ['wasm-opt', '--all-features', '--disable-compact-imports', '--pass-arg=max-func-params@23', '--fpcast-emu', str(raw), '-o', str(fpcast)], timeout=600)
        data, minimum = growable_table(fpcast.read_bytes())
        final.write_bytes(data)
        run('validate', ['wasm-validate', '--enable-all', str(final)])
        report.update(passBuild=True, artifact=str(final), sha256=sha(final), bytes=final.stat().st_size, tableMinimum=minimum,
                      glxtest={'path':str(out / 'glxtest.wasm'), 'sha256':sha(out / 'glxtest.wasm')}, responseReplacementCount=2)
    except Exception as error:
        report['error'] = str(error)
    report['seconds'] = time.monotonic() - started
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key not in ('inputs', 'steps')}))
    return 0 if report['passBuild'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
