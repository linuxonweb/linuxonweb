#!/usr/bin/env python3
"""Rebuild the pinned headless Mesa EGL archive in a new owned directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, help='New output directory outside the checkout; never reused or deleted.')
    parser.add_argument('--download-cache', type=Path, help='Optional readable directory with both pinned source tarballs.')
    parser.add_argument('--preflight', type=Path, help='Optional readable final159 inventory for direct symbol closure.')
    parser.add_argument('--check-inputs', action='store_true', help='Check pinned repository inputs without creating outputs or building.')
    args = parser.parse_args()
    pins = json.loads((HERE / 'pins.json').read_text())
    for relative, expected in pins['recipe_inputs_sha256'].items():
        actual = sha256(REPO / relative)
        if actual != expected:
            raise SystemExit(f'Pinned recipe input changed: {relative}: {actual} != {expected}')
    if sys.version_info[:2] != (3, 12) or platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('This wheel lock requires CPython 3.12 on Linux x86_64.')
    if args.check_inputs:
        print(json.dumps({'status': 'pass', 'repository_inputs': len(pins['recipe_inputs_sha256']), 'host': pins['python_host']}))
        return
    if args.out is None:
        parser.error('--out is required unless --check-inputs is used')
    output = args.out.resolve()
    if output == REPO or REPO in output.parents:
        raise SystemExit('Build outputs must be outside this checkout.')
    if output.exists():
        raise SystemExit(f'Refusing to reuse an existing output directory: {output}')
    cache = args.download_cache.resolve() if args.download_cache else None
    if cache is not None:
        for filename, expected in (
            ('mesa-26.2.3.tar.xz', pins['source']['mesa_sha256']),
            ('libdrm-2.4.133.tar.xz', pins['source']['libdrm_sha256']),
        ):
            if sha256(cache / filename) != expected:
                raise SystemExit(f'Cached source does not match its pin: {filename}')
    preflight = args.preflight.resolve() if args.preflight else None
    if preflight is not None:
        json.loads(preflight.read_text())
    output.mkdir(parents=False, exist_ok=False)
    for name in ('downloads', 'tmp', 'cache', 'evidence', 'cross', 'build', 'logs'):
        (output / name).mkdir()
    env = os.environ.copy()
    env.pop('LD_LIBRARY_PATH', None)
    env.update(TMPDIR=str(output / 'tmp'), TMP=str(output / 'tmp'), TEMP=str(output / 'tmp'),
               XDG_CACHE_HOME=str(output / 'cache'), PIP_CACHE_DIR=str(output / 'cache/pip'))
    provenance = {
        'repo': str(REPO), 'output': str(output), 'python': sys.version,
        'pins': pins, 'preflight': str(preflight) if preflight else None,
        'helper_sha256': {p.name: sha256(p) for p in sorted(HERE.iterdir()) if p.is_file()},
        'source_patches_for_egl': [],
    }
    (output / 'evidence/recipe-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    phases = [
        ('extract', 'prepare-source.py', 120, [str(cache)] if cache else []),
        ('bootstrap', 'bootstrap.py', 150, [str(cache)] if cache else []),
        ('configure', 'configure.py', 270, []),
        ('build', 'build-egl.py', 180, []),
    ]
    if preflight is not None:
        phases.append(('symbol-check', 'symbol-check.py', 90, [str(preflight)]))
    for name, script, seconds, extra in phases:
        command = [sys.executable, str(REPO / 'tools/guest-packages/bounded.py'),
                   '--cwd', str(output), '--out', str(output / 'logs' / name),
                   '--seconds', str(seconds), '--', sys.executable, str(HERE / script), *extra]
        print(json.dumps({'phase': name, 'deadline_seconds': seconds}), flush=True)
        subprocess.run(command, env=env, check=True)
    artifact = json.loads((output / 'evidence/egl-artifact.json').read_text())
    print(json.dumps({'status': 'pass', 'archive': artifact['archive'], 'sha256': artifact['sha256'],
                      'bytes': artifact['bytes'], 'objects': artifact['object_count'],
                      'symbol_closure_checked': preflight is not None}, indent=2))


if __name__ == '__main__':
    main()
