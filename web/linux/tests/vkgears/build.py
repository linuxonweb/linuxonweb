#!/usr/bin/env python3
"""V1 vkgears: build vkgears (static Khronos loader + guest ICD + Xlib) for wasm32.

Modelled on gputest-demo/build.py (hash-locked loader sources, static port,
public-only client symbol contract, import audit). The guest ICD, transport and
loader port sources are read from a frozen `git archive` snapshot (--snapshot,
default the V1 task's icd-snapshot of f9c1ce7) so concurrent ICD work does not
change this build. Output must be a new directory under the V1 task root on
disk-backed storage.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
TESTS = HERE.parent
DEFAULT_SNAPSHOT = Path('/mnt/p6/build/vkgears-v1-20261001/icd-snapshot/web/linux/tests')
TASK_ROOTS = (Path('/mnt/p6/build/vkgears-v1-20261001'),)
CC = '/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
X11 = {'x11': 'gqaysz4gcpwh3hjpj55k8j9mf7lya7xs-libX11-static-wasm32-unknown-linux-musl-1.8.13',
       'proto': '7fl11iw0s4srx2300pnb28wwpibky6wh-xorgproto-static-wasm32-unknown-linux-musl-2024.1',
       'xcb': 'wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0',
       'xau': 'r79l4jh7kmlcz6vmfiv02gw1p1iqb4m5-libXau-static-wasm32-unknown-linux-musl-1.0.12'}


def digest(data): return hashlib.sha256(data).hexdigest()


def filesystem(path):
    path = Path(path).resolve()
    entries = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields, fs = line.split(' - ', 1)
        mount = Path(fields.split()[4].replace('\\040', ' '))
        if path == mount or path.is_relative_to(mount):
            entries.append((len(str(mount)), str(mount), fs.split()[0]))
    _, mount, kind = max(entries)
    if kind in ('tmpfs', 'ramfs'): raise ValueError('memory filesystem prohibited: ' + str(path))
    ancestor = path
    while not ancestor.exists(): ancestor = ancestor.parent
    st = os.statvfs(ancestor)
    free = st.f_bavail * st.f_frsize
    if free < 1024**3: raise ValueError('less than 1 GiB free')
    return {'mount': mount, 'type': kind, 'availableBytes': free}


def checked_storage(output):
    output = Path(output).resolve()
    task = next((r for r in TASK_ROOTS if output.is_relative_to(r) and output != r), None)
    if task is None: raise ValueError('output must be a new child of ' + str(TASK_ROOTS))
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        value = os.environ.get(name)
        if not value or not Path(value).resolve().is_relative_to(task) or not Path(value).is_dir():
            raise ValueError(name + ' must be exported to a directory under ' + str(task))
        filesystem(value); scratch[name] = str(Path(value).resolve())
    return output, {'output': str(output), 'filesystem': filesystem(output), 'scratch': scratch}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-audit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--snapshot', type=Path, default=DEFAULT_SNAPSHOT, help='tests/ directory of a frozen git archive with the ICD sources')
    args = parser.parse_args()
    snap = args.snapshot.resolve()
    sys.path.insert(0, str(snap / 'guest-vulkan-loader'))
    from port import apply_port  # noqa: E402
    out, storage = checked_storage(args.output); out.mkdir(parents=True, exist_ok=False)

    def run(name, cmd):
        (out / (name + '.command.txt')).write_text(shlex.join(cmd) + '\n')
        with (out / (name + '.log')).open('w') as log:
            subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, env=os.environ.copy(), check=True, timeout=180)

    lock = json.loads((snap / 'guest-vulkan-loader/source-lock.json').read_text())
    for entry in lock['files']:
        data = (args.source_audit / entry['group'] / entry['path']).read_bytes()
        if digest(data) != entry['sha256'] or len(data) != entry['bytes']: raise ValueError('upstream source changed: ' + entry['path'])
        target = out / entry['group'] / entry['path']; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
    sources = {}
    snapshot_head = (snap.parent.parent.parent / 'HEAD.txt')
    own = ('vkgears/vkgears.c', 'vkgears/build.py', 'vkgears/shaders/gears.vert', 'vkgears/shaders/gears.frag')
    frozen = ('guest-vulkan-loader/unknown-disabled.c', 'guest-vulkan-loader/static-provider.inc', 'guest-vulkan-loader/port.py',
              'guest-vulkan-loader/source-lock.json', 'guest-vulkan/icd.c', 'guest-vulkan/icd.h', 'guest-vulkan/transfer.inc',
              'guest-vulkan/compute.inc', 'guest-vulkan/graphics.inc', 'guest-vulkan/graphics-commands.inc', 'guest-vulkan/uniform.inc',
              'guest-vulkan/texture.inc', 'guest-vulkan/wsi.inc', 'guest-vulkan/zink.inc', 'guest-vulkan/zink-ext.h',
              'guest-vulkan/clear-test.inc', 'guest-vulkan/exhaustion-test.inc', 'guest-gpu/guest-gpu.c', 'guest-gpu/guest-gpu.h')
    for base, relatives in ((TESTS, own), (snap, frozen)):
        for relative in relatives:
            data = (base / relative).read_bytes(); target = out / 'frozen' / relative
            target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
            sources[relative] = digest(data)

    # Shaders: compile + validate, embed as shader_gears_vert / shader_gears_frag.
    shaders = {}; generated = []
    for tag in ('gears.vert', 'gears.frag'):
        spv = out / 'frozen/vkgears' / (tag + '.spv')
        run('glslang-' + tag, ['glslangValidator', '-V', '--target-env', 'vulkan1.0', str(out / 'frozen/vkgears/shaders' / tag), '-o', str(spv)])
        run('spirv-val-' + tag, ['spirv-val', '--target-env', 'vulkan1.0', str(spv)])
        data = spv.read_bytes()
        if len(data) < 20 or len(data) > 65536 or len(data) % 4: raise ValueError('bad SPIR-V size: ' + tag)
        shaders[tag] = {'sha256': digest(data), 'bytes': len(data)}
        generated.append('static const unsigned char shader_' + tag.replace('.', '_') + '[] = {' + ','.join(str(n) for n in data) + '};')
    (out / 'frozen/vkgears/shaders.h').write_text('\n'.join(generated) + '\n')

    x11_inputs = {}; x11_libs = []; x11_flags = []
    for key in ('x11', 'proto'):
        include = Path('/nix/store') / X11[key] / 'include'
        dest = out / 'x11-inputs' / key / 'include'
        shutil.copytree(include, dest)
        for f in sorted(dest.rglob('*')):
            if f.is_file(): x11_inputs[str(include / f.relative_to(dest))] = digest(f.read_bytes())
        x11_flags.append('-I' + str(dest))
    for key, name in (('x11', 'libX11.a'), ('xcb', 'libxcb.a'), ('xau', 'libXau.a')):
        source = Path('/nix/store') / X11[key] / 'lib' / name; data = source.read_bytes(); target = out / 'x11-inputs' / name
        target.write_bytes(data); x11_inputs[str(source)] = digest(data); x11_libs.append(str(target))

    fixture = out / 'frozen/guest-vulkan-loader'
    apply_port(out / 'loader-source', fixture, out)
    flags = ['-std=c11', '-O2', '-ffile-prefix-map=' + str(out) + '=/vkgears-build', '-Wall', '-Wextra', '-Werror', '-pthread', '-matomics', '-mbulk-memory',
             '-ffunction-sections', '-fdata-sections', '-I' + str(out / 'headers-source/include')]
    loader_flags = flags + ['-I' + str(out / 'loader-source/loader'), '-I' + str(out / 'loader-source/loader/generated'),
        '-D_GNU_SOURCE', '-DHAVE_ALLOCA_H', '-DHAVE_SECURE_GETENV', '-DAPI_NAME="Vulkan"', '-DVK_ENABLE_BETA_EXTENSIONS',
        '-DFALLBACK_CONFIG_DIRS="/etc/xdg"', '-DFALLBACK_DATA_DIRS="/usr/local/share:/usr/share"', '-DSYSCONFDIR="/etc"',
        '-fno-strict-aliasing', '-fno-builtin-memcmp', '-Wno-unused-parameter', '-Wno-unused-function', '-Wno-missing-field-initializers']
    obj = out / 'objects'; obj.mkdir()
    names = ['allocation', 'cJSON', 'debug_utils', 'extension_manual', 'get_environment', 'gpa_helper', 'loader', 'log', 'terminator', 'trampoline', 'wsi']
    objects = []
    for name in names:
        t = obj / (name + '.o'); run('compile-' + name, [CC, *loader_flags, '-c', str(out / 'loader-source/loader' / (name + '.c')), '-o', str(t)]); objects.append(t)
    t = obj / 'unknown-disabled.o'; run('compile-unknown-disabled', [CC, *loader_flags, '-c', str(fixture / 'unknown-disabled.c'), '-o', str(t)]); objects.append(t)
    archive = out / 'libvulkan-guest-static.a'
    run('archive', ['llvm-ar', 'rcs', str(archive), *map(str, objects)])
    for name, relative, extra in (('client', 'vkgears/vkgears.c', x11_flags), ('icd', 'guest-vulkan/icd.c', []), ('transport', 'guest-gpu/guest-gpu.c', [])):
        run('compile-' + name, [CC, *flags, *extra, '-c', str(out / 'frozen' / relative), '-o', str(obj / (name + '.o'))])
    run('client-symbols', ['llvm-nm', '--undefined-only', str(obj / 'client.o')])
    client_symbols = (out / 'client-symbols.log').read_text()
    public = re.findall(r'\bU (vk\w+)$', client_symbols, re.M)
    if len(public) < 25 or re.search(r'\bU (?:guest_vk|gpu_|vk_icd)', client_symbols):
        raise ValueError('client does not meet public-only symbol contract')
    run('archive-symbols', ['llvm-nm', '--defined-only', str(archive)])
    symbols = (out / 'archive-symbols.log').read_text()
    for name in public:
        if not re.search(r'\bT ' + re.escape(name) + r'$', symbols, re.M): raise ValueError('public symbol absent from loader archive: ' + name)
    artifact = out / 'vkgears.wasm'
    run('link', [CC, '-pthread', '-matomics', '-mbulk-memory', '-static', str(obj / 'client.o'), str(archive), str(obj / 'icd.o'), str(obj / 'transport.o'),
                 *x11_libs, '-lm', '-Wl,--gc-sections,--import-memory,--export-table,--shared-memory',
                 '-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144', '-Wl,-Map=' + str(out / 'link.map'), '-o', str(artifact)])
    run('validate', ['wasm-validate', '--enable-all', str(artifact)])
    run('abi', ['wasm-objdump', '-x', str(artifact)])
    imports = re.findall(r' <- (\S+)', (out / 'abi.log').read_text())
    if 'env.memory' not in imports or set(imports) - {'env.memory', 'linux.syscall', 'linux.get_thread_area', 'linux.copy_siginfo'}:
        raise ValueError('unexpected imports: ' + repr(imports))
    data = artifact.read_bytes()
    report = {'pass': True, 'artifact': str(artifact), 'bytes': len(data), 'sha256': digest(data),
              'scope': 'V1 vkgears: glxgears geometry on the public Vulkan API + static loader + experimental guest ICD + Xlib CPU-copy presenter',
              'snapshot': str(snap), 'snapshotHead': snapshot_head.read_text().strip() if snapshot_head.exists() else None,
              'shaders': shaders, 'sources': sources, 'x11Inputs': x11_inputs, 'upstream': lock, 'storage': storage, 'imports': imports,
              'publicClientSymbols': public, 'portPatchSha256': digest((out / 'static-loader-port.patch').read_bytes())}
    (out / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'artifact': str(artifact), 'bytes': len(data), 'sha256': digest(data)}))


if __name__ == '__main__':
    main()
