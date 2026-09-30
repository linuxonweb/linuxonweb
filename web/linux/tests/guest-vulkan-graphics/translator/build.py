#!/usr/bin/env python3
"""Build graphics ABI from the frozen compute gate's exact offline closure."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
TASKS = (Path('/mnt/p6/build/guest-vulkan-a4-20260929'), Path('/mnt/p6/build/guest-vulkan-a3-20260928'), Path('/mnt/p6/build/guest-vulkan-graphics-20260926'))
LOCK_SHA = '5ccf7efcd90cacfefc6fda26986d4d2e9d48f774ba31ad26a4d91c4a925727d9'
COMPUTE_SHA = 'e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def storage(path, output=False):
    path = path.resolve()
    if output and not any(path.is_relative_to(task) and path != task for task in TASKS):
        raise ValueError('outputs and scratch must be below one of ' + ', '.join(map(str, TASKS)))
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields, info = line.split(' - ', 1)
        mount = Path(fields.split()[4].replace('\\040', ' '))
        if path == mount or path.is_relative_to(mount):
            mounts.append((len(str(mount)), str(mount), info.split()[0]))
    if not mounts or max(mounts)[2] in ('tmpfs', 'ramfs'):
        raise ValueError('disk-backed path required: ' + str(path))
    parent = path
    while not parent.exists():
        parent = parent.parent
    stat = os.statvfs(parent)
    free = stat.f_bavail * stat.f_frsize
    if output and free < 1024 ** 3:
        raise ValueError('less than 1 GiB free')
    return {'path': str(path), 'filesystem': max(mounts)[2], 'freeBytes': free}

def copy_verified(source, target, expected):
    if source.is_symlink() or not source.is_file():
        raise ValueError('expected regular source: ' + str(source))
    data = source.read_bytes()
    if digest(data) != expected:
        raise ValueError('source hash mismatch: ' + str(source))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accepted', type=Path, default=Path('/mnt/p6/build/guest-vulkan-compute-20260926/translator-build-run4'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--toolchain', type=Path, default=Path('/home/a/.rustup/toolchains/stable-x86_64-unknown-linux-gnu'))
    args = parser.parse_args()
    out, accepted = args.output.resolve(), args.accepted.resolve()
    output_storage = storage(out, True)
    storage(accepted)
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        if not os.environ.get(name) or not Path(os.environ[name]).is_dir():
            raise ValueError(name + ' must name existing disk scratch')
        storage(Path(os.environ[name]), True)
    closure_bytes = (accepted / 'source-lock.json').read_bytes()
    if digest(closure_bytes) != LOCK_SHA:
        raise ValueError('accepted source closure hash mismatch')
    if digest((accepted / 'translator.wasm').read_bytes()) != COMPUTE_SHA:
        raise ValueError('accepted compute artifact changed')
    closure = json.loads(closure_bytes)
    here = Path(__file__).resolve().parent
    compute_provenance = here.parents[1] / 'guest-vulkan-compute/translator/provenance'
    cargo_lock = (compute_provenance / 'Cargo.lock').read_bytes()
    if cargo_lock != (accepted / 'Cargo.lock').read_bytes() or cargo_lock != (accepted / 'crate/Cargo.lock').read_bytes():
        raise ValueError('accepted Cargo.lock differs from committed provenance')
    if (compute_provenance / 'source-lock.json').read_bytes() != closure_bytes:
        raise ValueError('committed source closure differs')
    out.mkdir(parents=True, exist_ok=False)
    work = out / 'crate'
    work.mkdir()
    inputs = {}
    for name in ('Cargo.toml', 'src/lib.rs', 'build.py', 'abi.mjs', 'worker.mjs', 'index.mjs'):
        relative = Path(name)
        source = here / relative
        if not source.is_file() or source.is_symlink():
            raise ValueError('build input must be a regular file: ' + str(source))
        data = source.read_bytes()
        target = work / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        inputs[str(relative)] = digest(data)
    extras = []
    copied_packages = {}
    for name, package in closure['packages'].items():
        if name == 'naga':
            source, target = accepted / 'crate/vendor/naga', work / 'vendor/naga'
        elif 'archiveSha256' in package:
            source, target = accepted / 'extra-crates' / name, out / 'extra-crates' / name
            extras.append((name.rsplit('-', 1)[0], target))
        else:
            source, target = accepted / 'vendor' / name, out / 'vendor' / name
        target.mkdir(parents=True, exist_ok=False)
        files = {}
        for relative, identity in package['files'].items():
            path = Path(relative)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('invalid locked source path')
            expected = identity if isinstance(identity, str) else identity['sha256']
            if name == 'naga' and relative == 'Cargo.toml':
                expected = package['manifestPort']['afterSha256']
            copy_verified(source / path, target / path, expected)
            files[relative] = expected
        if 'checksumManifestSha256' in package:
            expected = package.get('manifestPort', {}).get('portedChecksumManifestSha256', package['checksumManifestSha256'])
            copy_verified(source / '.cargo-checksum.json', target / '.cargo-checksum.json', expected)
        copied_packages[name] = files
    manifest = work / 'Cargo.toml'
    manifest.write_text(manifest.read_text() + '\n[patch.crates-io]\n' + '\n'.join(
        f'{name} = {{ path = {json.dumps(str(path))} }}' for name, path in extras) + '\n')
    (work / 'Cargo.lock').write_bytes(cargo_lock)
    (out / 'Cargo.lock').write_bytes(cargo_lock)
    config = work / '.cargo/config.toml'
    config.parent.mkdir(exist_ok=True)
    config.write_text('[source.crates-io]\nreplace-with = "frozen"\n[source.frozen]\ndirectory = ' + json.dumps(str(out / 'vendor')) + '\n')
    env = os.environ.copy()
    env.update(CARGO_HOME=str(out / 'cargo-home'), CARGO_TARGET_DIR=str(out / 'target'),
               RUSTC=str(args.toolchain / 'bin/rustc'), CARGO_NET_OFFLINE='true',
               RUSTFLAGS='-C link-arg=--max-memory=134217728 -C link-arg=-zstack-size=1048576')
    def run(name, command, timeout=600):
        (out / (name + '.command.json')).write_text(json.dumps(command) + '\n')
        with (out / (name + '.log')).open('w') as log:
            subprocess.run(command, cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=timeout)
    record = {'acceptedClosureSha256': LOCK_SHA, 'acceptedComputeSha256': COMPUTE_SHA,
              'cargoLockSha256': digest(cargo_lock), 'inputs': inputs, 'packages': copied_packages,
              'nagaRevision': closure['nagaRevision']}
    (out / 'source-lock.json').write_text(json.dumps(record, indent=2) + '\n')
    run('rustc-version', [str(args.toolchain / 'bin/rustc'), '-vV'])
    run('build', [str(args.toolchain / 'bin/cargo'), 'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown'])
    if (work / 'Cargo.lock').read_bytes() != cargo_lock:
        raise ValueError('Cargo.lock changed')
    artifact = out / 'translator.wasm'
    shutil.copyfile(out / 'target/wasm32-unknown-unknown/release/guest_spirv_translator.wasm', artifact)
    run('wasm-validate', ['wasm-validate', '--enable-all', str(artifact)])
    run('wasm-abi', ['wasm-objdump', '-x', str(artifact)])
    if digest((accepted / 'translator.wasm').read_bytes()) != COMPUTE_SHA:
        raise ValueError('accepted compute artifact changed during build')
    report = {'pass': True, 'artifact': str(artifact), 'bytes': artifact.stat().st_size,
              'sha256': digest(artifact.read_bytes()), 'storage': output_storage,
              'sourceLockSha256': digest((out / 'source-lock.json').read_bytes()),
              'scope': 'Compile-only independent graphics translator; runtime and GPU gates remain required'}
    (out / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
