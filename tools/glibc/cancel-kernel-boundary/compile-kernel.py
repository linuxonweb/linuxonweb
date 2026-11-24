#!/usr/bin/env python3
"""Compile two actual changed kernel units; no make, relink or replacement."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import time

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def members(pgid):
    rows = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                rows.append({'pid': int(path.parent.name), 'state': fields[0]})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return rows


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'kernel', 'configured', 'coherent'):
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--label', required=True)
    ap.add_argument('--prepared-label', default='prepared')
    args = ap.parse_args()
    task = args.task.resolve()
    assert str(task).startswith('/mnt/p6/build/')
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for var in ('TMPDIR', 'TMP', 'TEMP'):
        assert Path(os.environ[var]).resolve().is_relative_to(task)
    assert re.fullmatch(r'kernel-compile[0-9A-Za-z_-]+', args.label)
    output = task / args.label
    output.mkdir()
    snapshots = output / 'snapshots'
    snapshots.mkdir()
    pins = {}

    def pin(path):
        path = path.resolve()
        data = path.read_bytes()
        destination = snapshots / (sha(path) + '-' + path.name)
        if destination.exists():
            assert destination.read_bytes() == data
        else:
            destination.write_bytes(data)
        row = {'path': str(path), 'snapshot': str(destination),
               'sha256': sha(path), 'bytes': len(data)}
        pins[str(path)] = row
        return row

    for path in HERE.iterdir():
        if path.is_file(): pin(path)
    config = args.configured / '.config'
    assert sha(config) == '58a7183fed206cddffbc291c32ea0393d9c30f3dc6fa4b827873164a3737d485'
    pin(config)
    metadata = output / 'config'
    for relative in ['include/generated', 'include/config', 'arch/wasm/include/generated']:
        source = args.configured / relative
        assert source.is_dir()
        for path in source.rglob('*'):
            if path.is_file():
                pin(path)
                destination = metadata / path.relative_to(args.configured)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(path.read_bytes())
    manifest = args.coherent / 'manifest.json'
    assert sha(manifest) == '220d2e5f0e8f51bb5cab05eaff1c53782dc50d298594853d278eb9ab1dc27b97'
    compiler = args.coherent / 'objects/compiler/clang'
    row = json.loads(manifest.read_text())['files'][str(compiler.resolve())]
    assert sha(compiler) == row['sha256'] == '14e5a2bba14dbb867273e91628d3d27263cce1b13d6ca0bbe12b91d81f94dc7c'
    pin(compiler)
    assert re.fullmatch(r'prepared(?:-v3[0-9A-Za-z_-]*)?', args.prepared_label)
    prepared = task / args.prepared_label
    proof = json.loads((prepared / 'proof.json').read_text())
    patch_name = 'kernel-boundary.patch' if args.prepared_label == 'prepared' else 'v2-to-v3.patch'
    assert sha(prepared / patch_name) == proof['patchSha256']
    pin(prepared / patch_name)
    pin(prepared / 'proof.json')
    roots = []
    baseline_comparison = []
    for record in proof['outputs']:
        relative = record['relative']
        changed = prepared / 'kernel' / relative
        assert sha(changed) == record['sha256']
        pin(changed)
        roots.append({'type': 'file', 'name': str((args.kernel / relative).resolve()),
                      'external-contents': str(changed)})
        original = args.kernel / relative
        configured = args.configured / relative
        if original.exists():
            pin(original)
            if configured.exists():
                pin(configured)
                baseline_comparison.append({'relative': relative,
                    'same': original.read_bytes() == configured.read_bytes(),
                    'kernelSha256': sha(original), 'configuredSha256': sha(configured)})
    for relative in ('Makefile', 'arch/wasm/Makefile', 'include/generated/compile.h'):
        if (args.kernel / relative).exists(): pin(args.kernel / relative)
        pin(args.configured / relative)
    overlay = output / 'overlay.json'
    overlay.write_text(json.dumps({'version': 0, 'case-sensitive': 'true',
                                  'use-external-names': False, 'roots': roots}, indent=2) + '\n')
    pin(overlay)
    commands = []
    objects = []
    dependencies = {}
    for unit in ('signal', 'process'):
        cmdfile = args.configured / 'arch/wasm/kernel' / ('.' + unit + '.o.cmd')
        pin(cmdfile)
        saved = shlex.split(cmdfile.read_text().split('\n', 1)[0].split(':=', 1)[1])
        assert saved[0] == 'clang'
        assert saved[-1] == 'arch/wasm/kernel/' + unit + '.c'
        # Original kernel command retained. Only compiler/path/output/deps are
        # retargeted; no dropped warning, optimization, arch or language flags.
        argv = [str(compiler), '-no-canonical-prefixes', '-ivfsoverlay', str(overlay),
                '-I' + str(metadata / 'include')]
        i = 1
        while i < len(saved):
            token = saved[i]
            if token.startswith('-Wp,-MMD,'):
                i += 1
                continue
            if token == '-o':
                i += 2
                continue
            if token == '-I./arch/wasm/include/generated':
                token = '-I' + str(metadata / 'arch/wasm/include/generated')
            elif token == '-I./arch/wasm/include/generated/uapi':
                token = '-I' + str(metadata / 'arch/wasm/include/generated/uapi')
            elif token == '-I./include/generated/uapi':
                token = '-I' + str(metadata / 'include/generated/uapi')
            argv.append(token)
            i += 1
        object_path = output / (unit + '.o')
        dep_path = output / (unit + '.d')
        argv += ['-o', str(object_path), '-MD', '-MF', str(dep_path), '-MT', unit]
        started = time.monotonic()
        with (output / (unit + '.log')).open('wb') as log:
            process = subprocess.Popen(argv, cwd=args.kernel, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            timeout = False
            try:
                status = process.wait(timeout=60)
            except subprocess.TimeoutExpired:
                timeout = True
                os.killpg(process.pid, signal.SIGTERM)
                try: status = process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    status = process.wait(timeout=2)
            if members(process.pid):
                os.killpg(process.pid, signal.SIGKILL)
                time.sleep(0.05)
        record = {'unit': unit, 'argv': argv, 'cwd': str(args.kernel),
                  'pid': process.pid, 'pgid': process.pid, 'exit': status,
                  'timedOut': timeout, 'seconds': time.monotonic() - started,
                  'terminalMembers': members(process.pid)}
        commands.append(record)
        (output / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        assert status == 0 and not timeout and not record['terminalMembers'], record
        assert object_path.read_bytes()[:8] == b'\0asm\1\0\0\0'
        objects.append(pin(object_path))
        flat = dep_path.read_text().replace('\\\n', ' ')
        for word in shlex.split(flat.split(':', 1)[1]):
            path = Path(word)
            if not path.is_absolute(): path = args.kernel / path
            path = path.resolve()
            mapped = next((Path(r['external-contents']) for r in roots if r['name'] == str(path)), path)
            row = pin(mapped)
            dependencies[str(path)] = {**row, 'logical': str(path)}
        assert shutil.disk_usage(task).free > 5 * 1024**3
        assert sum(p.stat().st_size for p in task.rglob('*') if p.is_file()) < 2 * 1024**3
    result = {'pass': True, 'scope': 'actual two changed kernel units with original saved flags and real configured headers; no link/boot/cancellation acceptance',
              'preparedLabel': args.prepared_label, 'patchSha256': proof['patchSha256'],
              'commands': commands, 'objects': objects, 'dependencies': list(dependencies.values()),
              'sourcePins': list(pins.values()), 'configuredBaselineComparison': baseline_comparison,
              'configurationBuildToLiveBinaryProvenance': 'not established; compiled sources and metadata are explicitly pinned'}
    (output / 'proof.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'pass': True, 'units': 2, 'dependencies': len(dependencies),
                      'scope': result['scope']}))


if __name__ == '__main__':
    main()
