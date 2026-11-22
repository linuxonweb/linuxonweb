#!/usr/bin/env python3
"""Reproduce the pinned Firefox native configuration in an owned directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import stat
import subprocess
import time


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def inventory(root, path):
    count = size = 0
    h = hashlib.sha256()
    with path.open('wb') as out:
        for directory, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not (Path(directory) == root and d == '.git'))
            for name in sorted(dirs + files):
                p = Path(directory) / name
                s = p.lstat()
                item = {'path': str(p.relative_to(root)), 'mode': stat.S_IMODE(s.st_mode)}
                if p.is_symlink():
                    item.update(kind='symlink', target=os.readlink(p))
                elif p.is_file():
                    item.update(kind='file', bytes=s.st_size, sha256=sha(p))
                    size += s.st_size
                    count += 1
                elif p.is_dir():
                    item['kind'] = 'directory'
                else:
                    raise RuntimeError('Unsupported source entry ' + str(p))
                line = (json.dumps(item, sort_keys=True) + '\n').encode()
                out.write(line)
                h.update(line)
    return {'files': count, 'bytes': size, 'sha256': h.hexdigest()}


def relocate(text, mappings):
    for old, new in mappings:
        text = text.replace(old, new)
    return text


def bootstrap(args):
    packet, source, root, egl = (Path(x).resolve() for x in (args.packet, args.source, args.out, args.egl))
    assert not root.exists(), 'Refusing to overwrite an owned build'
    assert sha(egl) == 'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8'
    assert shutil.disk_usage(source).free > 30 * 1024**3
    root.mkdir()
    for name in ('status', 'logs', 'tmp', 'cache', 'cargo-home', 'mozbuild', 'obj', 'native-obj', 'native-deps', 'link/t', 'deps', 'smoke'):
        (root / name).mkdir(parents=True, exist_ok=True)
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    assert head == '525176a870d4ec4329e7decdb2ef7fdd5b87fb22'
    status = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain=v1', '--untracked-files=all'], text=True)
    (root / 'status/original-git-status.txt').write_text(status)
    before = inventory(source, root / 'status/original-source.jsonl')
    (root / 'source').mkdir()
    subprocess.run(['cp', '-a', '--reflink=always', str(source) + '/.', str(root / 'source')], check=True, timeout=300)
    after = inventory(root / 'source', root / 'status/copied-source.jsonl')
    assert before == after, 'Full working-tree copy differs'
    old_egl = '/mnt/p6/build/glgears-zink-20261001/link/egl2/lib/libEGL_mesa.a'
    mappings = [(str(packet), str(root)), (str(source), str(root / 'source')), (old_egl, str(egl))]
    shutil.copytree(packet / 'recipe', root / 'recipe')
    shutil.copytree(packet / 'native-src', root / 'native-src')
    shutil.copytree(packet / 'source-overlay', root / 'source-overlay')
    changed = []
    for p in sorted((root / 'recipe').rglob('*')):
        if p.is_file() and not p.is_symlink():
            raw = p.read_text()
            new = relocate(raw, mappings)
            if p.name == 'environment.sh':
                lines = new.splitlines()
                removed = [line for line in lines if re.match(r'export LD_LIBRARY_PATH=', line)]
                new = '\n'.join(line for line in lines if not re.match(r'export LD_LIBRARY_PATH=', line)) + '\nunset LD_LIBRARY_PATH\n'
                save(root / 'status/environment-sanitization.json', {'removed': removed, 'reason': 'Historical Nix host library is unavailable; use wrapper runtime search paths', 'scope': 'owned child process'})
            p.write_text(new)
    for name in ('.mozconfig', 'adapter-defs.mk', 'compile-commands.json', 'link-command.json'):
        p = packet / name
        if p.is_file():
            (root / name).write_text(relocate(p.read_text(), mappings))
    shutil.copy2(root / '.mozconfig', root / 'source/.mozconfig')
    for p in sorted((root / 'source-overlay').rglob('*')):
        if p.is_file():
            q = root / 'source' / p.relative_to(root / 'source-overlay')
            previous = sha(q) if q.is_file() else None
            q.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, q)
            changed.append({'path': str(q.relative_to(root / 'source')), 'before': previous, 'after': sha(q)})
    adapter = root / 'source/linuxonweb-build/adapters/defs.mk'
    if (root / 'adapter-defs.mk').is_file():
        shutil.copy2(root / 'adapter-defs.mk', adapter)
    for p in (root / 'recipe/environment.sh', root / 'adapter-defs.mk', root / 'source/linuxonweb-build/adapters/defs.mk'):
        if p.exists():
            data = p.read_text()
            data, n = re.subn(r'/mnt/p[36]/[^\s\x27\x22;]+/libEGL_mesa\.a', str(egl), data)
            p.write_text(data)
    native_hashes = {p.name: sha(p) for p in sorted((root / 'native-src').glob('*')) if p.is_file()}
    assert native_hashes['PblJit.cpp'] == '2f8c8d36f7a367f65f932050507317a960d3b41747c422ba278b8df63bdb957f'
    assert native_hashes['PortableBaselineInterpret.cpp'] == 'd77dbdf8d019c5249658469ceafda3a142f613ea8911a8dd4db2ef3d18f67e4b'
    save(root / 'status/bootstrap.json', {'source': str(source), 'sourceGitHead': head, 'completeCopy': True, 'copyMethod': 'cp -a --reflink=always, including all Git/ignored/untracked entries', 'workingTreeInventoryExcludes': ['.git metadata'], 'original': before, 'copy': after, 'overlay': changed, 'nativeHashes': native_hashes, 'mappings': mappings, 'egl': {'path': str(egl), 'sha256': sha(egl)}, 'environmentSha256': sha(root / 'recipe/environment.sh')})
    print(json.dumps({'stage': 'bootstrap', 'pass': True, 'root': str(root), 'sourceFiles': before['files'], 'sourceBytes': before['bytes'], 'sourceManifestSha256': before['sha256']}, sort_keys=True), flush=True)



def bind_link(args):
    root, packet, egl = (Path(x).resolve() for x in (args.out, args.packet, args.egl))
    receipt = root / 'status' / ('bind-link-' + args.run + '.json')
    assert not receipt.exists()
    assert sha(egl) == 'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8'
    mappings = [(str(packet), str(root)), ('/mnt/p6/build/glgears-zink-20261001/link/egl2/lib/libEGL_mesa.a', str(egl))]
    changes = []
    for name in ('link-command.json', 'link/link.args'):
        source = packet / name
        dest = root / name
        prior = sha(dest) if dest.exists() else None
        dest.write_text(relocate(source.read_text(), mappings))
        changes.append({'path': name, 'before': prior, 'after': sha(dest), 'sourceSha256': sha(source)})
    assert json.loads((root / 'link-command.json').read_text())['executable'] is False
    save(receipt, {'changes': changes, 'mappings': mappings, 'fullLinkReady': False})
    print(json.dumps({'stage': 'bind-link', 'pass': True, 'receipt': str(receipt)}))


def bind_runtime(args):
    root, src = (Path(x).resolve() for x in (args.out, args.runtime_dir))
    receipt = root / 'status' / ('bind-runtime-' + args.run + '.json')
    assert not receipt.exists()
    dest = root / 'deps/native-unwind/runtimes-build/lib'
    dest.mkdir(parents=True, exist_ok=True)
    records = []
    for name in ('libc++.a', 'libc++abi.a', 'libunwind.a'):
        p, q = src / name, dest / name
        assert p.open('rb').read(8) == b'!<arch>\n', str(p)
        if not q.exists():
            subprocess.run(['cp', '-a', '--reflink=auto', str(p), str(q)], check=True, timeout=30)
        assert sha(p) == sha(q)
        records.append({'source': str(p), 'path': str(q), 'sha256': sha(q), 'bytes': q.stat().st_size})
    save(receipt, records)
    print(json.dumps({'stage': 'bind-runtime', 'pass': True, 'receipt': str(receipt)}))

def environment(root):
    raw = subprocess.check_output(['bash', '-c', 'set -eu; source "$1"; env -0', 'owned-native', str(root / 'recipe/environment.sh')])
    env = dict(item.decode().split('=', 1) for item in raw.split(b'\0') if b'=' in item)
    assert 'LD_LIBRARY_PATH' not in env
    for key in ('TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'CARGO_HOME', 'MOZBUILD_STATE_PATH', 'MOZ_OBJDIR'):
        assert Path(env[key]).is_relative_to(root), key
    env.update(NIGHTLY_JOBS='2', CMAKE_BUILD_PARALLEL_LEVEL='2', MAKEFLAGS='-j2')
    return env


def launch(root, name, argv, env, cwd, seconds=720):
    result = root / 'status' / (name + '.json')
    log = root / 'logs' / (name + '.log')
    assert not result.exists() and not log.exists(), 'Use a new --run for retry evidence'
    assert shutil.disk_usage(root).free > 20 * 1024**3
    started = time.time()
    meta = {'stage': name, 'argv': argv, 'argvSha256': hashlib.sha256(json.dumps(argv).encode()).hexdigest(), 'cwd': str(cwd), 'environmentSha256': sha(root / 'recipe/environment.sh'), 'driverSha256': sha(Path(__file__)), 'started': started, 'timeoutSeconds': seconds, 'log': str(log)}
    save(result, meta)
    print(json.dumps(meta), flush=True)
    with log.open('w') as output:
        try:
            proc = subprocess.run(argv, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=seconds)
            meta['exitCode'] = proc.returncode
        except subprocess.TimeoutExpired:
            meta['exitCode'] = 124
    meta.update(finished=time.time(), logSha256=sha(log), passStage=meta['exitCode'] == 0)
    save(result, meta)
    print(json.dumps(meta), flush=True)
    if meta['exitCode']:
        raise SystemExit(meta['exitCode'])


def bind_dependencies(args):
    root, source = (Path(x).resolve() for x in (args.out, args.dependency_root))
    receipt = root / 'status' / ('bind-dependencies-' + args.run + '.json')
    assert not receipt.exists()
    validation_path = source / 'validation.json'
    validation = json.loads(validation_path.read_text())
    assert validation['presentArtifactValidation']
    records = []
    for artifact in validation['artifacts']:
        path = Path(artifact['path'])
        relative = path.relative_to(source)
        assert all(member['wasmValidated'] for member in artifact['members'])
        assert sha(path) == artifact['sha256']
        dest = root / 'deps' / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            subprocess.run(['cp', '-a', '--reflink=auto', str(path), str(dest)], check=True, timeout=30)
        assert sha(dest) == artifact['sha256']
        records.append({'source': str(path), 'path': str(dest), 'sha256': sha(dest), 'bytes': dest.stat().st_size})
    headers = []
    for relative in ('native-unwind/include', 'native-unwind/runtimes-build/include/c++/v1'):
        path, dest = source / relative, root / 'deps' / relative
        name = relative.replace('/', '-')
        before_path = root / 'status' / ('bind-dependencies-' + args.run + '-' + name + '-source.jsonl')
        after_path = root / 'status' / ('bind-dependencies-' + args.run + '-' + name + '-owned.jsonl')
        assert path.is_dir()
        before = inventory(path, before_path)
        if not dest.exists():
            dest.mkdir(parents=True)
            subprocess.run(['cp', '-a', '--reflink=auto', str(path) + '/.', str(dest)], check=True, timeout=60)
        after = inventory(dest, after_path)
        assert before == after
        headers.append({'source': str(path), 'path': str(dest), 'manifest': str(after_path), **after})
    missing = [str(root / 'deps' / Path(path).relative_to(source)) for path in validation['missingArtifacts']]
    save(receipt, {'validation': str(validation_path), 'validationSha256': sha(validation_path), 'artifacts': records,
                   'headers': headers, 'missingArtifacts': missing, 'complete': not missing})
    print(json.dumps({'stage': 'bind-dependencies', 'receipt': str(receipt), 'complete': not missing, 'missingArtifacts': missing}))


def stages(args):
    root = Path(args.out).resolve()
    env = environment(root)
    phase = args.phase
    name = phase + '-' + args.run
    if phase in ('smoke', 'host-smoke', 'target-smoke'):
        src = root / 'smoke/test.cpp'
        src.write_text('#include <vector>\n#include <cstdio>\nint main(){std::vector<int> a{2,3}; std::printf("%d\\n",a[0]+a[1]);return a[0]+a[1]==5?0:1;}\n')
        if phase != 'target-smoke':
            launch(root, name + '-host-link', [env['HOST_CXX'], str(src), '-o', str(root / 'smoke/host')], env, root, 60)
            launch(root, name + '-host-run', [str(root / 'smoke/host')], env, root, 15)
        if phase == 'host-smoke':
            return
        launch(root, name + '-target-link', [env['CXX'], '-pthread', '-fwasm-exceptions', '-Xclang', '-fc++-abi=webassembly', str(src), '-o', str(root / 'smoke/target.wasm')], env, root, 60)
        artifact = root / 'smoke/target.wasm'
        assert artifact.read_bytes()[:8] == b'\0asm\x01\0\0\0'
        save(root / 'status' / (name + '-artifacts.json'), {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size} for p in (src, root / 'smoke/host', artifact)})
    elif phase in ('configure', 'pre-export', 'export'):
        argv = ['/nix/store/28wlfb25i3q4wq06ap0n9gb04qkjdjyn-python3-3.11.15/bin/python3', './mach']
        argv += ['configure'] if phase == 'configure' else ['build', phase, '-j2']
        launch(root, name, argv, env, root / 'source')
    elif phase == 'headers':
        obj = root / 'obj'
        required = [obj / 'mozilla-config.h', obj / 'dist/include', obj / 'dist/stl_wrappers', obj / 'dist/system_wrappers']
        assert all(path.exists() for path in required), [str(path) for path in required if not path.exists()]
        manifests = []
        for folder in required[1:]:
            records = []
            for directory, dirs, files in os.walk(folder):
                dirs.sort()
                for filename in sorted(files):
                    path = Path(directory) / filename
                    records.append({'path': str(path), 'target': str(path.resolve()), 'bytes': path.stat().st_size, 'sha256': sha(path)})
            assert records, str(folder)
            manifest = root / 'status' / (name + '-' + folder.name + '.json')
            assert not manifest.exists()
            save(manifest, records)
            manifests.append({'path': str(manifest), 'sha256': sha(manifest), 'files': len(records)})
        header = required[0]
        save(root / 'status' / (name + '.json'), {'mozillaConfig': {'path': str(header), 'sha256': sha(header), 'bytes': header.stat().st_size}, 'manifests': manifests, 'configuredHeadersOnly': True})
    elif phase == 'compile':
        result = []
        commands = json.loads((root / 'compile-commands.json').read_text())
        if args.tu:
            commands = [command for command in commands if command['name'] == args.tu]
        assert commands
        for command in commands:
            launch(root, name + '-' + command['name'], command['argv'], env, Path(command['cwd']))
            artifact = root / 'native-obj' / (command['name'] + '.o')
            assert artifact.read_bytes()[:8] == b'\0asm\x01\0\0\0'
            depfile = root / 'native-deps' / (command['name'] + '.o.pp')
            rule = depfile.read_text().replace('\\\n', ' ').splitlines()[0]
            dependencies = []
            for token in shlex.split(rule.split(':', 1)[1]):
                dependency = Path(token)
                if not dependency.is_absolute():
                    dependency = Path(command['cwd']) / dependency
                dependencies.append({'path': str(dependency), 'sha256': sha(dependency), 'bytes': dependency.stat().st_size})
            manifest = root / 'status' / (name + '-' + command['name'] + '-dependencies.json')
            save(manifest, dependencies)
            source = Path(command['argv'][-1])
            result.append({'name': command['name'], 'path': str(artifact), 'sha256': sha(artifact), 'bytes': artifact.stat().st_size, 'source': str(source), 'sourceSha256': sha(source), 'dependencyManifest': str(manifest), 'dependencyManifestSha256': sha(manifest), 'dependencyCount': len(dependencies)})
            save(root / 'status' / (name + '-artifacts.json'), result)
    else:
        raise SystemExit('Unknown phase')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase')
    parser.add_argument('--out', required=True)
    parser.add_argument('--source')
    parser.add_argument('--packet')
    parser.add_argument('--egl')
    parser.add_argument('--runtime-dir')
    parser.add_argument('--dependency-root')
    parser.add_argument('--run', default='1')
    parser.add_argument('--tu', choices=['PblJit', 'PortableBaselineInterpret'])
    args = parser.parse_args()
    if args.phase == 'bootstrap':
        bootstrap(args)
        bind_link(args)
    elif args.phase == 'bind-link':
        bind_link(args)
    elif args.phase == 'bind-runtime':
        bind_runtime(args)
    elif args.phase == 'bind-dependencies':
        bind_dependencies(args)
    else:
        stages(args)
