#!/usr/bin/env python3
"""Independently compile bounded coordinate and sampling SPIR-V fixtures."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

TASK = Path('/mnt/p6/build/guest-vulkan-webgl-20260926')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def disk(path):
    path = path.resolve()
    if not path.is_relative_to(TASK):
        raise ValueError('fixture outputs/scratch must be below ' + str(TASK))
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields, info = line.split(' - ', 1)
        mount = Path(fields.split()[4].replace('\\040', ' '))
        if path == mount or path.is_relative_to(mount):
            mounts.append((len(str(mount)), info.split()[0]))
    if not mounts or max(mounts)[1] in ('tmpfs', 'ramfs'):
        raise ValueError('persistent disk required')
    parent = path
    while not parent.exists():
        parent = parent.parent
    stat = os.statvfs(parent)
    if stat.f_bavail * stat.f_frsize < 64 * 1024 * 1024:
        raise ValueError('insufficient fixture disk capacity')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    out = parser.parse_args().output.resolve()
    disk(out)
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ[key])
        if not scratch.is_dir():
            raise ValueError('missing scratch directory')
        disk(scratch)
    out.mkdir(parents=True, exist_ok=False)
    here = Path(__file__).resolve().parent
    (out / 'prepare-fixtures.py').write_bytes(Path(__file__).read_bytes())
    tools = {name: shutil.which(name) for name in ('glslangValidator', 'spirv-val')}
    if not all(tools.values()):
        raise ValueError('independent SPIR-V tools unavailable')
    commands = []

    def run(name, argv):
        commands.append(argv)
        (out / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        with (out / (name + '.log')).open('w') as log:
            subprocess.run(argv, check=True, stdout=log, stderr=subprocess.STDOUT, timeout=60)

    for name, executable in tools.items():
        run(name + '-version', [executable, '--version'])
    sources = {path.name: path.read_bytes() for path in sorted((here / 'translator/fixtures').glob('*.vert'))}
    # Real independent compiler inputs exercise direct and member decorations.
    for qualifier in ('centroid', 'sample'):
        for block in (False, True):
            declaration = (f'layout(location=0) in Inputs {{ {qualifier} vec3 color; }} data;'
                           if block else f'layout(location=0) {qualifier} in vec3 color;')
            expression = 'data.color' if block else 'color'
            name = qualifier + ('-member' if block else '-direct') + '.frag'
            sources[name] = (f'#version 450\n{declaration}\nlayout(location=0) out vec4 result;\n'
                             f'void main() {{ result = vec4({expression}, 1.0); }}\n').encode()
    fixtures = {}
    for name, source in sources.items():
        source_path, binary_path = out / name, out / (name + '.spv')
        source_path.write_bytes(source)
        stage = 'vert' if name.endswith('.vert') else 'frag'
        run(name + '.compile', [tools['glslangValidator'], '-V', '--target-env', 'vulkan1.0',
                               '-S', stage, str(source_path), '-o', str(binary_path)])
        run(name + '.validate', [tools['spirv-val'], '--target-env', 'vulkan1.0', str(binary_path)])
        data = binary_path.read_bytes()
        fixtures[name] = {'file': binary_path.name, 'sourceSha256': sha(source),
                          'sha256': sha(data), 'bytes': len(data), 'stage': stage,
                          'reject': 'sampling' if stage == 'frag' else
                                    'linear' if name.startswith('unsupported-linear') else None}
    report = {'pass': True, 'scriptSha256': sha(Path(__file__).read_bytes()),
              'tools': {name: {'path': path, 'sha256': sha(Path(path).read_bytes())}
                        for name, path in tools.items()}, 'fixtures': fixtures,
              'scope': 'Independent GLSL to SPIR-V compilation and spirv-val; no GPU claim'}
    (out / 'fixtures.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'fixtures': len(fixtures), 'output': str(out)}))


if __name__ == '__main__':
    main()
