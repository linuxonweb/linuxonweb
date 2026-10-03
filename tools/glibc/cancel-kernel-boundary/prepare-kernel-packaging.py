#!/usr/bin/env python3
"""Prepare actual GNU architecture packaging rules for an independently linked kernel."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def pin(path):
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'bytes': path.stat().st_size}


def main():
    ap = argparse.ArgumentParser()
    for key in ('whole-task', 'task', 'toolchain'):
        ap.add_argument('--' + key, type=Path, required=True)
    args = ap.parse_args()
    whole, task, toolchain = args.whole_task.resolve(), args.task.resolve(), args.toolchain.resolve()
    assert task == Path('/mnt/p6/build/glibc-cancel-kernel-packaging1-20261002') and not task.exists()
    stages = json.loads((whole / 'stages.json').read_text())
    assert stages[-1]['label'] == 'kernel-build' and stages[-1]['exit'] == 2
    assert all(not row['terminalMembers'] for row in stages)
    source = Path(json.loads((whole / 'recipe.json').read_text())['sourceReuse']['path'])
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('tmp', 'cache', 'objects/arch/wasm', 'objects/usr', 'objects/tools/wasm', 'sources'):
        (task / name).mkdir(parents=True, exist_ok=True)
    rows = []

    def copy(path, destination):
        row = pin(path)
        shutil.copy2(path, destination)
        assert pin(destination)['sha256'] == row['sha256']
        rows.append(dict(row, snapshot=str(destination)))

    copy(whole / 'objects/vmlinux.o', task / 'objects/vmlinux.o')
    copy(whole / 'objects/usr/initramfs_inc_data', task / 'objects/usr/initramfs_inc_data')
    copy(source / 'arch/wasm/Makefile', task / 'sources/Makefile-original')
    copy(source / 'scripts/Kbuild.include', task / 'sources/Kbuild.include')
    copy(source / 'arch/wasm/scripts/sections.pl', task / 'sources/sections.pl')
    text = (task / 'sources/Makefile-original').read_text()
    needle = 'arch/wasm/scripts/sections.pl'
    assert text.count(needle) == 2
    patched = text.replace(needle, '$(srctree)/' + needle)
    (task / 'sources/Makefile-architecture').write_text(patched)
    wrapper = f'''srctree := {source}
objtree := .
LLVM_PREFIX := {toolchain}/bin/
PERL := /usr/bin/perl
OBJCOPY := {toolchain}/bin/llvm-objcopy
PHONY := FORCE
targets := arch/wasm/vmlinux.wat arch/wasm/sections.json tools/wasm/vmlinux.wasm
include {task}/sources/Kbuild.include
include {task}/sources/Makefile-architecture
.PHONY: FORCE
FORCE:
'''
    (task / 'objects/Makefile').write_text(wrapper)
    rows.extend(pin(path.resolve()) for path in
                (Path('/usr/bin/make'), Path('/usr/bin/perl'), Path('/usr/bin/wasm2wat'),
                 toolchain / 'bin/llvm-objcopy', Path(__file__)))
    proof = {'scope': 'packaging only, copied genuine run4 linked input; original whole-build remains exit2',
             'wholeTask': str(whole), 'wholeStages': stages, 'source': str(source), 'inputs': rows,
             'changedRule': pin(task / 'sources/Makefile-architecture'),
             'wrapper': pin(task / 'objects/Makefile'),
             'command': ['make', '-C', str(task / 'objects'), '-j2', 'tools/wasm/vmlinux.wasm']}
    (task / 'preparation.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'prepared': True, 'task': str(task)}))


if __name__ == '__main__':
    main()
