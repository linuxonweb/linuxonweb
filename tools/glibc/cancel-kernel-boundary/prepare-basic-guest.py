#!/usr/bin/env python3
"""Prepare isolated legacy-GNU regression inputs for a newly audited kernel."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for key in ('task', 'memory-packet', 'whole-task', 'repo'):
        ap.add_argument('--' + key, type=Path, required=True)
    ap.add_argument('--audit-proof', type=Path, required=True)
    args = ap.parse_args()
    task, memory, whole, repo = (getattr(args, key).resolve()
                                 for key in ('task', 'memory_packet', 'whole_task', 'repo'))
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    assert re.fullmatch(r'glibc-cancel-kernel-basic[0-9]+-20261002', task.name)
    assert sha(memory / 'manifest.json') == '2604aa26fae2ae073c2326b5741752ac013cdf4a83878c81950fc943adcff2c4'
    manifest = json.loads((memory / 'manifest.json').read_text())['files']
    audit = args.audit_proof.resolve()
    assert audit.is_relative_to(whole)
    audited = json.loads(audit.read_text())
    image = audited['finalImage']
    assert audited['readiness']['pass'], audited['readiness']
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free > 8 * 1024**3
    for directory in ('tmp', 'cache', 'source', 'native-package', 'fpcast-package'):
        (task / directory).mkdir()
    environment = dict(os.environ, TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'),
                       TEMP=str(task / 'tmp'), XDG_CACHE_HOME=str(task / 'cache'))
    pins = []

    def copy_verified(source, destination):
        row = manifest[str(source)]
        assert sha(source) == row['sha256'] and source.stat().st_size == row['bytes'], source
        destination.parent.mkdir(parents=True, exist_ok=True)
        assert not destination.exists()
        destination.write_bytes(source.read_bytes())
        pins.append({'path': str(source), 'snapshot': str(destination), **row})

    for name in ('index.html', 'worker.js'):
        copy_verified(memory / 'source' / name, task / 'source' / name)
    for original, destination in (('native-package4', 'native-package'), ('fpcast-package4', 'fpcast-package')):
        for name in ('build.json', 'initramfs.cpio'):
            copy_verified(memory / original / name, task / destination / name)
    for path in sorted(manifest):
        source = Path(path)
        if source.is_relative_to(repo / 'tools/glibc') and source.name == 'run-guest.mjs':
            copy_verified(source, task / 'runners' / source.relative_to(repo / 'tools/glibc'))
    kernel = Path(image['module']['path'])
    assert sha(kernel) == image['module']['sha256']
    (task / 'source/vmlinux.wasm').write_bytes(kernel.read_bytes())
    pins.append({'path': str(kernel), 'snapshot': str(task / 'source/vmlinux.wasm'),
                 'sha256': sha(kernel), 'bytes': kernel.stat().st_size})
    here = Path(__file__).resolve().parent
    installer = here / 'install-worker.py'
    command = ['python3', str(installer), '--task', str(task), '--label', 'worker1',
               '--worker', str(task / 'source/worker.js'), '--wasm', str(repo / 'web/linux/dist/wasm.js')]
    # Installer retains its exact source and original worker/wasm inputs.
    result = subprocess.run(command, env=environment, capture_output=True, text=True)
    (task / 'install.log').write_text(result.stdout + result.stderr)
    assert result.returncode == 0
    original_worker = task / 'source/worker.js'
    original_worker.rename(task / 'source/worker-v1-original.js')
    for row in pins:
        if row['snapshot'] == str(original_worker):
            row['snapshot'] = str(task / 'source/worker-v1-original.js')
    shutil.copyfile(task / 'worker1/worker.js', original_worker)
    original_manifest = task / 'source/boot-manifest-original.json'
    copy_verified(repo / 'web/linux/boot-manifest.json', original_manifest)
    boot_manifest = json.loads(original_manifest.read_text())
    original_kernel = dict(boot_manifest['assets']['kernel'])
    boot_manifest['assets']['kernel']['bytes'] = kernel.stat().st_size
    boot_manifest['assets']['kernel']['sha256'] = sha(kernel)
    owned_manifest = task / 'source/boot-manifest.json'
    owned_manifest.write_text(json.dumps(boot_manifest, indent=2) + '\n')
    check_manifest = json.loads(owned_manifest.read_text())
    check_manifest['assets']['kernel'] = original_kernel
    assert check_manifest == json.loads(original_manifest.read_text())
    original_index = task / 'source/index-original.js'
    copy_verified(repo / 'web/linux/dist/index.js', original_index)
    index_source = original_index.read_text()
    index_needle = '                call_siginfo_handler: unavailable,'
    assert index_source.count(index_needle) == 1
    owned_index = task / 'source/index.js'
    owned_index.write_text(index_source.replace(index_needle, index_needle +
        '\n                // Main boot instance cannot execute user callbacks.\n'
        '                call_signal_handler_v3: unavailable,\n'
        '                signal_return_policy_v3: unavailable,'))
    checked_index = subprocess.run(['node', '--check', str(owned_index)], env=environment,
                                   capture_output=True, text=True)
    assert checked_index.returncode == 0, checked_index.stderr
    routes = [('/linux/dist/index.js', owned_index),
              ('/linux/boot-manifest.json', owned_manifest),
              ('/linux/vmlinux.wasm', task / 'source/vmlinux.wasm'),
              ('/linux/dist/wasm.js', task / 'worker1/wasm.js'),
              ('/linux/dist/worker-boundary.mjs', task / 'worker1/worker-boundary.mjs')]
    route_rows = [{'route': route, 'path': str(path), 'sha256': sha(path)} for route, path in routes]
    (task / 'routes.json').write_text(json.dumps(route_rows, indent=2) + '\n')
    base = task / 'runners/run-guest.mjs'
    original = base.read_text()
    needle = "const mime = { '.html': 'text/html'"
    assert original.count(needle) == 1
    addition = """// Owned kernel/worker routing only; original acceptance assertions remain.
const routeRows = JSON.parse((await freeze(path.join(task, 'routes.json'))).toString());
for (const row of routeRows) {
  const source = path.resolve(row.path);
  if (!source.startsWith(task + '/') || !row.route.startsWith('/linux/')) throw Error('owned route bounds');
  const bytes = await freeze(source);
  if (hash(bytes) !== row.sha256 || routes.has(row.route)) throw Error('owned route identity');
  routes.set(row.route, bytes);
}
"""
    (task / 'runners/run-guest-original.mjs').write_text(original)
    for row in pins:
        if row['snapshot'] == str(base):
            row['snapshot'] = str(task / 'runners/run-guest-original.mjs')
    base.write_text(original.replace(needle, addition + needle))
    checked = subprocess.run(['node', '--check', str(base)], env=environment,
                             capture_output=True, text=True)
    assert checked.returncode == 0, checked.stderr
    proof = {'scope': 'prepared legacy GNU runtime regression on candidate kernel; no admitted frame/cancellation helpers',
             'inputs': pins, 'kernelAudit': {'path': str(audit), 'sha256': sha(audit)},
             'installer': {'argv': command, 'exit': result.returncode, 'sha256': sha(installer)},
             'runner': {'path': str(base), 'sha256': sha(base), 'originalSha256': hashlib.sha256(original.encode()).hexdigest()},
             'routes': route_rows, 'syntaxExit': checked.returncode,
             'runtimeAcceptance': False}
    (task / 'preparation.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'task': str(task), 'prepared': True}))


if __name__ == '__main__':
    main()
