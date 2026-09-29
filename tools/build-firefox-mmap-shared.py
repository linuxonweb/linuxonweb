#!/usr/bin/env python3
"""Relink the deployed Firefox wasm with the coherent MAP_SHARED mmap shim.

Only the mmap shim object changes.  Every other link input is the exact
command, response file and unwind stub that produced the deployed
firefox-nss.wasm (SHA-256 644ab48f...), which is opt/firefox/firefox in the
promoted b21b2cac65a3 rootfs.  `--control` relinks with the original shim
object instead, to prove the pipeline reproduces the deployed binary
(modulo the random --build-id=uuid payload, which is masked when compared).

Usage: build-firefox-mmap-shared.py OUT [--control]
OUT must not exist and must be on disk-backed storage (never /tmp).
"""
import argparse, hashlib, json, os, shlex, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path('/mnt/p6/project/linux/.cache')
ALIGNED = CACHE / 'reliability-performance-20260926/firefox-mmap-aligned'
RESUME = Path('/mnt/p6/build/firefox-tls-20260926/resume-build-run1')
OBJ = CACHE / 'firefox-fresh-obj-20260924-071600'
PINS = {
    ALIGNED / 'compile-mmap-alignment-command.txt': None,
    ALIGNED / 'mmap-shim.o': '67280507c69b8a87901e293f625aa9ea95a03d2d97b627ce139babac39ecbad1',
    RESUME / 'link-command.json': None,
    RESUME / 'firefox-nss.list': None,
    RESUME / 'unwind-stubs.o': 'dc4cb55ed3f5e88c24a7c40f1c73455996efda89217ccd326f7109d052613175',
    RESUME / 'firefox-nss.wasm': '644ab48f01a8a588706d1ec1c3a97006469964c705edc0f5d599286c890c610f',
}
OLD_OBJECT = str(ALIGNED / 'mmap-shim.o')


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def leb(data, pos):
    value = shift = 0
    while True:
        byte = data[pos]; pos += 1
        value |= (byte & 0x7f) << shift; shift += 7
        if not byte & 0x80:
            return value, pos


def masked_digest(path):
    """SHA-256 with the payload of the custom `build_id` section zeroed."""
    data = bytearray(Path(path).read_bytes())
    pos, masked = 8, 0
    while pos < len(data):
        sid = data[pos]; size, body = leb(data, pos + 1)
        if sid == 0:
            nlen, npos = leb(data, body)
            if bytes(data[npos:npos + nlen]) == b'build_id':
                start = npos + nlen
                data[start:body + size] = bytes(body + size - start)
                masked += 1
        pos = body + size
    return hashlib.sha256(data).hexdigest(), masked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--control', action='store_true')
    args = ap.parse_args()
    out = Path(args.out).resolve()
    tmp = os.environ.get('TMPDIR', '')
    if not tmp or tmp.startswith(('/tmp', '/dev/shm')) or str(out).startswith(('/tmp', '/dev/shm')):
        sys.exit('TMPDIR and OUT must be disk-backed (not /tmp or /dev/shm)')
    out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    report = {'pass': False, 'mode': 'control' if args.control else 'candidate', 'inputs': {}}
    logs = {}

    def run(cmd, name, cwd, limit):
        (out / f'{name}-command.json').write_text(json.dumps({'cwd': str(cwd), 'argv': cmd}, indent=1) + '\n')
        with open(out / f'{name}.log', 'wb') as log:
            t = time.monotonic()
            p = subprocess.run(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, timeout=limit)
            logs[name] = {'exit': p.returncode, 'seconds': round(time.monotonic() - t, 2)}
        if p.returncode:
            raise RuntimeError(f'{name} failed ({p.returncode}); see {out / (name + ".log")}')

    try:
        for path, want in PINS.items():
            got = digest(path)
            report['inputs'][str(path)] = got
            if want and got != want:
                raise RuntimeError(f'pinned input changed: {path} {got}')
        if args.control:
            shim_object = OLD_OBJECT
        else:
            src = out / 'mmap-source'
            (src / 'sys').mkdir(parents=True)
            shutil.copy2(ROOT / 'web/linux/firefox-shims/mmap-shim.c', src / 'mmap-shim.c')
            shutil.copy2(ALIGNED / 'mmap-source/sys/mman.h', src / 'sys/mman.h')
            report['shimSourceSha256'] = digest(src / 'mmap-shim.c')
            report['shimHeaderSha256'] = digest(src / 'sys/mman.h')
            cmd = shlex.split((ALIGNED / 'compile-mmap-alignment-command.txt').read_text())
            old_src = str(ALIGNED / 'mmap-source')
            if cmd[1] != '-I' + old_src or cmd.count('-o') != 1 or not cmd[-1].endswith('mmap-shim.c'):
                raise RuntimeError('unexpected shim compile command layout')
            cmd[1] = '-I' + str(src)
            cmd[cmd.index('-o') + 1] = str(out / 'mmap-shim.o')
            cmd = [a for a in cmd if a != '-I/tmp/firefox-mmap-shim']
            cmd[-1] = str(src / 'mmap-shim.c')
            if any('/tmp' == a[:4] or '-I/tmp' in a for a in cmd):
                raise RuntimeError('compile command still references /tmp')
            run(cmd, 'compile-shim', OBJ / 'browser/app', 300)
            shim_object = str(out / 'mmap-shim.o')
            report['shimObjectSha256'] = digest(shim_object)
        link = json.loads((RESUME / 'link-command.json').read_text())
        if link.count(OLD_OBJECT) != 1 or link.count('-o') != 1:
            raise RuntimeError('unexpected link command layout')
        link[link.index(OLD_OBJECT)] = shim_object
        raw = out / 'firefox-raw.wasm'
        link[link.index('-o') + 1] = str(raw)
        run(link, 'link', OBJ / 'browser/app', 1200)
        final = out / 'firefox.wasm'
        run(['wasm-opt', '--all-features', '--disable-compact-imports', '--pass-arg=max-func-params@23',
             '--fpcast-emu', str(raw), '-o', str(final)], 'fpcast', out, 1800)
        run(['wasm-validate', '--enable-all', str(final)], 'validate', out, 600)
        raw.unlink()  # 198 MB intermediate; command and log are kept
        report.update({'candidate': str(final), 'sha256': digest(final), 'bytes': final.stat().st_size})
        masked, count = masked_digest(final)
        ref_masked, ref_count = masked_digest(RESUME / 'firefox-nss.wasm')
        report['maskedBuildIdSha256'] = masked
        report['deployedMaskedBuildIdSha256'] = ref_masked
        report['buildIdSections'] = [count, ref_count]
        report['matchesDeployedModuloBuildId'] = masked == ref_masked
        if args.control and masked != ref_masked:
            raise RuntimeError('control relink does not reproduce the deployed binary')
        report['pass'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        report['steps'] = logs
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=1))
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
