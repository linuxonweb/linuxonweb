#!/usr/bin/env python3
"""Measure retained kernel source discrepancies without building/copying a tree."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def selected(path):
    # Generated headers and .cmd/output files are separate config evidence.
    return (path.name.startswith(('Makefile', 'Kconfig')) or
            path.suffix in {'.c', '.h', '.S', '.rs', '.pl', '.py', '.sh', '.lds', '.dts', '.dtsi'})


def source_rows(root):
    rows = {}
    for directory, dirs, files in os.walk(root):
        rel = Path(directory).relative_to(root)
        dirs[:] = [name for name in dirs if name not in {'.git', 'generated'}]
        for name in files:
            path = Path(directory) / name
            if path.is_symlink() or not selected(path):
                continue
            relative = str(rel / name)
            rows[relative] = {'sha256': sha(path), 'bytes': path.stat().st_size}
    return rows


def tree_bytes(root):
    return int(subprocess.check_output(['du', '-sb', str(root)], text=True).split()[0])


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'retained', 'configured'):
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--label', required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert str(task).startswith('/mnt/p6/build/')
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free > 8 * 1024**3
    output = task / args.label
    output.mkdir()
    snapshots = output / 'snapshots'
    snapshots.mkdir()
    roots = [args.retained.resolve(), args.configured.resolve()]
    maps = [source_rows(root) for root in roots]
    changed = [name for name in sorted(maps[0].keys() & maps[1].keys()) if maps[0][name] != maps[1][name]]
    evidence = []
    required = ['.config', 'include/config/auto.conf', 'include/generated/autoconf.h',
                'arch/wasm/Makefile', 'arch/wasm/include/asm/wasm_imports.h',
                'arch/wasm/kernel/signal.c', 'arch/wasm/kernel/process.c',
                'arch/wasm/include/asm/thread_info.h', 'arch/wasm/scripts/sections.pl',
                'arch/wasm/.config', '.vmlinux.o.cmd']
    for index, root in enumerate(roots):
        for name in sorted(set(required + [name for name in changed if name.startswith('arch/wasm/')])):
            path = root / name
            if not path.is_file():
                continue
            data = path.read_bytes()
            target = snapshots / (str(index) + '-' + sha(path) + '-' + path.name)
            if target.exists(): assert target.read_bytes() == data
            else: target.write_bytes(data)
            evidence.append({'root': index, 'path': str(path), 'snapshot': str(target),
                             'sha256': sha(path), 'bytes': len(data)})
    result = {'scope': 'source/config reconciliation preflight, no kernel build or runtime acceptance',
              'roots': [str(root) for root in roots], 'sourceSelection': 'Makefile/Kconfig and listed source suffixes; excludes generated dirs/symlinks',
              'rows': maps, 'changed': changed,
              'retainedOnly': sorted(maps[0].keys() - maps[1].keys()),
              'configuredOnly': sorted(maps[1].keys() - maps[0].keys()),
              'treeBytes': [tree_bytes(root) for root in roots],
              'selectedSourceBytes': [sum(row['bytes'] for row in rows.values()) for rows in maps],
              'evidence': evidence, 'freeBytes': shutil.disk_usage(task).free,
              'proposedWholeKernelTaskCapBytes': 6 * 1024**3,
              'proposedBudget': {'cleanSourceUpperBoundBytes': tree_bytes(roots[1]),
                                 'freshOutputsAllowanceBytes': 2 * 1024**3,
                                 'logsSnapshotsAllowanceBytes': 512 * 1024**2},
              'buildAuthorized': False}
    (output / 'proof.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'changed': len(changed), 'changedWasm': [name for name in changed if name.startswith('arch/wasm/')],
                      'sourceCounts': [len(rows) for rows in maps], 'treeBytes': result['treeBytes'],
                      'proof': str(output / 'proof.json')}))


if __name__ == '__main__':
    main()
