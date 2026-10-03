#!/usr/bin/env python3
"""Read back legacy guest evidence without changing its historical reports."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def group(pgid):
    rows = []
    for directory in Path('/proc').iterdir():
        if not directory.name.isdecimal():
            continue
        try:
            text = (directory / 'stat').read_text()
            tail = text[text.rfind(')') + 2:].split()
            if int(tail[2]) == pgid:
                rows.append({'pid': int(directory.name), 'state': tail[0]})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--task', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build')
    output = args.output.resolve()
    assert output.is_relative_to(task) and not output.exists()
    preparation = task / 'preparation.json'
    data = json.loads(preparation.read_text())
    pins, mappings = [], []
    for row in data['inputs']:
        path = Path(row['snapshot'])
        if path == task / 'source/worker.js':
            retained = task / 'source/worker-v1-original.js'
            assert sha(retained) == row['sha256']
            mappings.append({'historicalSnapshot': str(path), 'retainedSnapshot': str(retained),
                             'sha256': row['sha256'], 'reason': 'installer renamed original before serving rendered worker'})
            path = retained
        if path == task / 'runners/run-guest.mjs':
            retained = task / 'runners/run-guest-original.mjs'
            assert sha(retained) == row['sha256']
            mappings.append({'historicalSnapshot': str(path), 'retainedSnapshot': str(retained),
                             'sha256': row['sha256'], 'reason': 'original retained before additive owned routing'})
            path = retained
        assert sha(path) == row['sha256'] and path.stat().st_size == row['bytes']
        pins.append({**row, 'actualSnapshot': str(path)})
    worker_proof = task / 'worker1/proof.json'
    worker = json.loads(worker_proof.read_text())
    for row in worker['inputs']:
        assert sha(Path(row['snapshot'])) == row['sha256']
    for row in worker['outputs']:
        assert sha(Path(row['path'])) == row['sha256']
    assert (task / 'source/worker.js').read_bytes() == (task / 'worker1/worker.js').read_bytes()
    manifest_original = json.loads((task / 'source/boot-manifest-original.json').read_text())
    manifest = json.loads((task / 'source/boot-manifest.json').read_text())
    kernel = task / 'source/vmlinux.wasm'
    assert manifest['assets']['kernel']['bytes'] == kernel.stat().st_size
    assert manifest['assets']['kernel']['sha256'] == sha(kernel)
    manifest['assets']['kernel'] = manifest_original['assets']['kernel']
    assert manifest == manifest_original
    original_index = (task / 'source/index-original.js').read_text()
    addition = ('\n                // Main boot instance cannot execute user callbacks.\n'
                '                call_signal_handler_v3: unavailable,\n'
                '                signal_return_policy_v3: unavailable,')
    index = (task / 'source/index.js').read_text()
    assert index.count(addition) == 1 and index.replace(addition, '') == original_index
    runner = (task / 'runners/run-guest.mjs').read_text()
    runner_original = (task / 'runners/run-guest-original.mjs').read_text()
    begin = runner.index('// Owned kernel/worker routing only; original acceptance assertions remain.')
    end = runner.index("const mime = { '.html': 'text/html'", begin)
    assert runner[:begin] + runner[end:] == runner_original
    routes = json.loads((task / 'routes.json').read_text())
    for row in routes:
        assert sha(Path(row['path'])) == row['sha256']
    reports, groups = [], []
    for name in ('native-run1', 'fpcast-run1'):
        directory = task / name
        base = json.loads((directory / 'result.json').read_text())
        assert base['pass'] and base['browserExit'] == {'code': 0, 'signal': None} and base['serverClosed']
        assert base['jit']['failures'] == 0 and base['jit']['exitStatus'] == 0
        for path in sorted(directory.glob('*result.json')):
            result = json.loads(path.read_text())
            assert result['pass'], path
            reports.append({'path': str(path), 'sha256': sha(path)})
        for input_name, digest in base['inputs'].items():
            path = Path(input_name)
            assert sha(path) == digest, path
        groups.append({'pgid': base['browserPid'], 'members': group(base['browserPid'])})
    for name in ('native1', 'fpcast1'):
        path = task / 'supervision' / name / 'result.json'
        result = json.loads(path.read_text())
        assert result['exit'] == 0 and not result['terminalMembers']
        groups.append({'pgid': result['pgid'], 'members': group(result['pgid'])})
    assert not any(row['members'] for row in groups)
    proof = {'pass': True, 'scope': 'legacy GNU native/FPCAST on candidate kernel; no admitted cancellation/frame runtime',
             'historicalPreparation': {'path': str(preparation), 'sha256': sha(preparation)},
             'historicalPathMappings': mappings, 'inputs': pins, 'routes': routes,
             'reports': reports, 'groups': groups, 'kernel': {'path': str(kernel), 'sha256': sha(kernel)},
             'runnerAssertionsUnchanged': True, 'bootstrapDelta': 'two additive unavailable v3 imports',
             'manifestDelta': 'only kernel bytes and SHA256', 'runtimeCancellation': False}
    output.write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'pass': True, 'path': str(output), 'sha256': sha(output)}))


if __name__ == '__main__':
    main()
