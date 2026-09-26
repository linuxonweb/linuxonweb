#!/usr/bin/env python3
"""Offline, frozen-source Naga translator build. Downloads are a separate gate."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tomllib

sys.dont_write_bytecode = True
TASK = Path('/mnt/p6/build/guest-vulkan-compute-20260926')
REVISION = 'c7458638d14921c7562e4197ddeefa17be413587'
EXTRAS = {
    'petgraph-0.6.5': 'b4c5cc86750666a3ed20bdaf5ca2a0344f9c67674cae0515bec2da16fbaa47db',
    'fixedbitset-0.4.2': '0ce7134b9999ecaf8bcd65542e436736ef32ddca1b3e06094cb6ec5755203b80',
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def check_storage(path):
    path = path.resolve()
    if not path.is_relative_to(TASK) or path == TASK:
        raise ValueError('build/scratch path must be below ' + str(TASK))
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields, info = line.split(' - ', 1)
        mount = Path(fields.split()[4].replace('\\040', ' '))
        if path == mount or path.is_relative_to(mount):
            mounts.append((len(str(mount)), str(mount), info.split()[0]))
    if not mounts or max(mounts)[2] in ('tmpfs', 'ramfs'):
        raise ValueError('disk-backed filesystem required')
    parent = path
    while not parent.exists():
        parent = parent.parent
    stat = os.statvfs(parent)
    if stat.f_bavail * stat.f_frsize < 1024 ** 3:
        raise ValueError('less than 1 GiB free')
    return {'path': str(path), 'filesystem': max(mounts)[2], 'freeBytes': stat.f_bavail * stat.f_frsize}

def freeze_package(source, target):
    """Reject altered vendor sources and copy only checksum-listed regular files."""
    checksum_file = source / '.cargo-checksum.json'
    checksums = json.loads(checksum_file.read_text())
    files = {}
    target.mkdir(parents=True, exist_ok=False)
    for relative, expected in sorted(checksums['files'].items()):
        path = Path(relative)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('invalid checksum path')
        original = source / path
        if original.is_symlink() or not original.is_file():
            raise ValueError('source must be regular file: ' + str(original))
        data = original.read_bytes()
        if digest(data) != expected:
            raise ValueError('archived source checksum mismatch: ' + str(original))
        copied = target / path
        copied.parent.mkdir(parents=True, exist_ok=True)
        copied.write_bytes(data)
        files[relative] = {'bytes': len(data), 'sha256': expected}
    shutil.copyfile(checksum_file, target / '.cargo-checksum.json')
    return {'source': str(source), 'packageChecksum': checksums['package'],
            'checksumManifestSha256': digest(checksum_file.read_bytes()), 'files': files}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firefox', required=True, type=Path)
    parser.add_argument('--archives', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--toolchain', type=Path, default=Path('/home/a/.rustup/toolchains/stable-x86_64-unknown-linux-gnu'))
    args = parser.parse_args()
    out = args.output.resolve()
    storage = check_storage(out)
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        if not os.environ.get(name) or not Path(os.environ[name]).is_dir():
            raise ValueError(name + ' must name existing task scratch')
        check_storage(Path(os.environ[name]))
    out.mkdir(parents=True, exist_ok=False)
    here = Path(__file__).resolve().parent
    vendor = args.firefox.resolve() / 'third_party/rust'
    firefox_lock = (args.firefox / 'Cargo.lock').read_bytes()
    lock = tomllib.loads(firefox_lock.decode())
    naga_pin = next(p for p in lock['package'] if p['name'] == 'naga')
    if naga_pin['version'] != '0.20.0' or naga_pin['source'].split('#')[-1] != REVISION:
        raise ValueError('unexpected archived Naga revision')
    work = out / 'crate'
    work.mkdir()
    inputs = {}
    for relative in ('Cargo.toml', 'src/lib.rs', 'index.mjs', 'worker.mjs', 'build.py'):
        data = (here / relative).read_bytes()
        target = work / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        inputs[relative] = digest(data)
    sources = {'naga': freeze_package(vendor / 'naga', work / 'vendor/naga')}
    # Firefox's archive omits upstream test-only path crates. Cargo loads their
    # manifests even when Naga is only a library dependency. Preserve the full
    # verified original and record this build-manifest-only port explicitly.
    naga_manifest = work / 'vendor/naga/Cargo.toml'
    original_manifest = naga_manifest.read_text()
    (out / 'naga-Cargo.toml.original').write_text(original_manifest)
    kept = []
    skip = False
    for line in original_manifest.splitlines(keepends=True):
        if line.startswith('['):
            skip = (line.startswith('[dev-dependencies]') or line.startswith('[dev-dependencies.') or
                    line.startswith('[dependencies.pp-rs]'))
        if not skip:
            kept.append(line)
    ported_manifest = ''.join(kept)
    if 'glsl-in = ["dep:pp-rs"]' not in ported_manifest:
        raise ValueError('unexpected archived GLSL feature declaration')
    ported_manifest = ported_manifest.replace('glsl-in = ["dep:pp-rs"]', 'glsl-in = []')
    naga_manifest.write_text(ported_manifest)
    manifest_patch = ''.join(difflib.unified_diff(original_manifest.splitlines(keepends=True),
        ported_manifest.splitlines(keepends=True), fromfile='naga/Cargo.toml.original', tofile='naga/Cargo.toml'))
    (out / 'naga-manifest.patch').write_text(manifest_patch)
    sources['naga']['manifestPort'] = {'reason': 'remove omitted test dependencies and inactive pp-rs GLSL frontend; only spv-in/wgsl-out are built',
        'beforeSha256': digest(original_manifest.encode()), 'afterSha256': digest(ported_manifest.encode()),
        'patchSha256': digest(manifest_patch.encode())}
    checksum_path = naga_manifest.with_name('.cargo-checksum.json')
    shutil.copyfile(checksum_path, out / 'naga-checksums.original.json')
    ported_checksums = json.loads(checksum_path.read_text())
    ported_checksums['files']['Cargo.toml'] = digest(ported_manifest.encode())
    checksum_path.write_text(json.dumps(ported_checksums, sort_keys=True) + '\n')
    sources['naga']['manifestPort']['portedChecksumManifestSha256'] = digest(checksum_path.read_bytes())
    extras = out / 'extra-crates'
    extras.mkdir()
    for name, expected in EXTRAS.items():
        archive = args.archives / (name + '.crate')
        data = archive.read_bytes()
        if digest(data) != expected:
            raise ValueError('dependency archive hash mismatch: ' + name)
        shutil.copyfile(archive, out / archive.name)
        with tarfile.open(archive) as tar:
            members = tar.getmembers()
            if len(members) > 2000 or sum(m.size for m in members) > 16 * 1024 ** 2:
                raise ValueError('crate extraction exceeds bounds')
            for member in members:
                path = Path(member.name)
                if path.is_absolute() or '..' in path.parts or path.parts[0] != name or not (member.isfile() or member.isdir()):
                    raise ValueError('unsafe crate archive member')
            tar.extractall(extras, filter='data')
        files = {str(p.relative_to(extras / name)): digest(p.read_bytes()) for p in sorted((extras / name).rglob('*')) if p.is_file()}
        sources[name] = {'archiveSha256': expected, 'files': files,
                         'url': f'https://static.crates.io/crates/{name.rsplit("-", 1)[0]}/{name}.crate'}
    manifest = work / 'Cargo.toml'
    manifest.write_text(manifest.read_text() + '\n[patch.crates-io]\n' + '\n'.join(
        f'{name.rsplit("-", 1)[0]} = {{ path = {json.dumps(str(extras / name))} }}' for name in EXTRAS) + '\n')
    config = work / '.cargo/config.toml'
    config.parent.mkdir()
    def set_vendor(path):
        config.write_text('[source.crates-io]\nreplace-with = "frozen"\n[source.frozen]\ndirectory = ' + json.dumps(str(path)) + '\n')
    set_vendor(vendor)
    env = os.environ.copy()
    env.update(CARGO_HOME=str(out / 'cargo-home'), CARGO_TARGET_DIR=str(out / 'target'),
               RUSTC=str(args.toolchain / 'bin/rustc'), CARGO_NET_OFFLINE='true',
               RUSTFLAGS='-C link-arg=--max-memory=134217728 -C link-arg=-zstack-size=1048576')
    cargo = str(args.toolchain / 'bin/cargo')
    def run(name, command, timeout=180, separate_stderr=False):
        (out / (name + '.command.json')).write_text(json.dumps(command) + '\n')
        with (out / (name + '.log')).open('w') as output:
            if separate_stderr:
                with (out / (name + '.stderr.log')).open('w') as errors:
                    subprocess.run(command, cwd=work, env=env, stdout=output, stderr=errors, check=True, timeout=timeout)
            else:
                subprocess.run(command, cwd=work, env=env, stdout=output, stderr=subprocess.STDOUT, check=True, timeout=timeout)
    run('rustc-version', [str(args.toolchain / 'bin/rustc'), '-vV'])
    run('metadata', [cargo, 'metadata', '--offline', '--format-version=1'], separate_stderr=True)
    metadata = json.loads((out / 'metadata.log').read_text())
    frozen_vendor = out / 'vendor'
    frozen_vendor.mkdir()
    for package in metadata['packages']:
        if package['source'] is None:
            continue
        original = Path(package['manifest_path']).parent
        if not original.is_relative_to(vendor):
            raise ValueError('unexpected resolved source: ' + str(original))
        name = package['name'] + '-' + package['version']
        sources[name] = freeze_package(original, frozen_vendor / name)
    set_vendor(frozen_vendor)
    closure = {'nagaRevision': REVISION, 'firefoxLockSha256': digest(firefox_lock),
               'inputs': inputs, 'packages': sources}
    (out / 'source-lock.json').write_text(json.dumps(closure, indent=2) + '\n')
    shutil.copyfile(work / 'Cargo.lock', out / 'Cargo.lock')
    run('build', [cargo, 'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown'], timeout=600)
    artifact = out / 'translator.wasm'
    shutil.copyfile(out / 'target/wasm32-unknown-unknown/release/guest_spirv_translator.wasm', artifact)
    run('wasm-validate', ['wasm-validate', '--enable-all', str(artifact)])
    run('wasm-abi', ['wasm-objdump', '-x', str(artifact)])
    report = {'pass': True, 'artifact': str(artifact), 'bytes': artifact.stat().st_size,
              'sha256': digest(artifact.read_bytes()), 'storage': storage,
              'sourceLockSha256': digest((out / 'source-lock.json').read_bytes()),
              'scope': 'Compile-only browser-side SPIR-V translator; runtime translation and GPU execution require separate gates'}
    (out / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
