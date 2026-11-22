#!/usr/bin/env python3
"""Prepare exact coherent kernel overlay and recipe, without a kernel rebuild."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'retained', 'configured', 'prepared', 'preflight', 'toolchain'):
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--label', required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert str(task).startswith('/mnt/p6/build/')
    output = task / args.label
    output.mkdir()
    overlay = output / 'overlay'
    snapshots = output / 'snapshots'
    snapshots.mkdir()
    pins = []

    def pin(path):
        path = path.resolve()
        target = snapshots / (sha(path) + '-' + path.name)
        if target.exists(): assert target.read_bytes() == path.read_bytes()
        else: target.write_bytes(path.read_bytes())
        pins.append({'path': str(path), 'snapshot': str(target), 'sha256': sha(path), 'bytes': path.stat().st_size})

    p = json.loads(args.preflight.read_text())
    pin(args.preflight)
    changes = ['arch/wasm/Makefile', 'arch/wasm/drivers/Kconfig', 'arch/wasm/drivers/virtio_wasm.c',
               'arch/wasm/include/asm/wasm_imports.h']
    assert p['changed'] == changes and p['retainedOnly'] == []
    for name in changes:
        for index, root in enumerate((args.retained, args.configured)):
            path = root / name
            assert sha(path) == p['rows'][index][name]['sha256']
            pin(path)
    configured_addition = 'arch/wasm/drivers/fbdev_wasm.c'
    assert sha(args.configured / configured_addition) == p['rows'][1][configured_addition]['sha256']
    for name in changes + [configured_addition]:
        target = overlay / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((args.configured / name).read_bytes())
        pin(args.configured / name)
    # All changed thread_info consumers rebuild; no old .o/header is copied.
    replacements = ['arch/wasm/kernel/signal.c', 'arch/wasm/kernel/process.c',
                    'arch/wasm/include/asm/thread_info.h', 'arch/wasm/include/asm/user_signal_boundary.h']
    for name in replacements:
        path = args.prepared / 'kernel' / name
        pin(path)
        target = overlay / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
    imported = 'arch/wasm/include/asm/wasm_imports.h'
    old = (args.retained / imported).read_text()
    new = (args.prepared / 'kernel' / imported).read_text()
    pin(args.prepared / 'kernel' / imported)
    start = new.index('struct wasm_signal_boundary_v3;')
    end = new.index('void wasm_import(user, halt_signal_handler)', start)
    block = new[start:end]
    assert new.replace(block, '', 1) == old
    merged = (args.configured / imported).read_text()
    marker = 'void wasm_import(user, halt_signal_handler)'
    assert merged.count(marker) == 1
    (overlay / imported).write_text(merged.replace(marker, block + marker))
    assert (overlay / imported).read_text().replace(block, '', 1) == (args.configured / imported).read_text()
    pin(args.configured / '.config')
    tools = [args.toolchain / 'bin' / name for name in
             ('clang', 'ld.lld', 'wasm-ld', 'llvm-ar', 'llvm-nm', 'llvm-objcopy', 'llvm-readelf', 'llvm-strip')]
    tools += [Path(shutil.which(name)) for name in ('make', 'wasm2wat', 'perl', 'flex', 'bison')]
    for path in tools: pin(path)
    pin(HERE / 'plan-whole-kernel.py')
    future = Path('/mnt/p6/build/glibc-cancel-kernel-whole-20261002')
    source = future / 'source/linux'
    objects = future / 'objects'
    common = ['make', '-C', str(source), 'O=' + str(objects), 'ARCH=wasm',
              'LLVM=' + str(args.toolchain / 'bin') + '/', 'LLVM_IAS=1',
              'HOSTCC=' + str(args.toolchain / 'bin/clang'), 'HOSTCXX=' + str(args.toolchain / 'bin/clang++'),
              'V=1', '-j2']
    recipe = {'scope': 'reviewable fresh whole-kernel build recipe, not executed',
              'sourceBase': str(args.retained), 'overlayOrder': ['exact configured four-file delta plus real fbdev provider',
              'reviewed sparse v3 signal/process/thread_info/header', 'merge only v3 import declarations preserving configured FB/virtio imports'],
              'config': str(args.configured / '.config'), 'copiedObjects': False, 'copiedGeneratedHeaders': False,
              'commands': [common + ['olddefconfig'], common + ['prepare'], common + ['tools/wasm/vmlinux.wasm']],
              'supervision': {'sourceCopySeconds': 180, 'metadataSeconds': 180, 'buildSeconds': 1800,
                              'taskCapBytes': 6 * 1024**3, 'launchReserveBytes': 8 * 1024**3,
                              'hardStopBytes': 5 * 1024**3, 'jobs': 2},
              'toolVersionChange': 'saved configured clang22.1.6 -> pinned clang22.1.8; retain regenerated config diff',
              'configComparison': 'reject unexplained functional CONFIG changes; compiler metadata may change with measured tool version',
              'postBuildRequired': ['all descendant PGIDs terminal', 'actual complete object sizes/magic/hash and .cmd/.d provenance',
              'actual vmlinux Wasm validation and import delta limited to v3 pair',
              'section metadata sizes/offsets + exact .linux.initramfs provenance',
              'fresh isolated unchanged-v1 GNU regression guest before genuine helper/frame bridge gate'],
              'sourceToExistingLiveKernelIdentityClaim': False,
              'blockedForRuntime': ['canonical real native-frame bridge providers are not yet linked',
                                   'genuine GNU forced unwind/cancellation lifecycle not established'],
              'pins': pins, 'overlay': [{'relative': str(path.relative_to(overlay)), 'sha256': sha(path), 'bytes': path.stat().st_size}
                                        for path in sorted(overlay.rglob('*')) if path.is_file()],
              'runtimeAcceptance': False, 'buildAuthorized': False}
    (output / 'recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'pass': True, 'overlayFiles': len(recipe['overlay']), 'recipe': str(output / 'recipe.json')}))


if __name__ == '__main__':
    main()
