#!/usr/bin/env python3
"""Compile real flat-varying and fragment-position inputs for backend parity."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from importlib.util import spec_from_file_location, module_from_spec

HERE = Path(__file__).resolve().parent
SPEC = spec_from_file_location('fixture_storage', HERE / 'prepare-fixtures.py')
STORAGE = module_from_spec(SPEC)
SPEC.loader.exec_module(STORAGE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    out = parser.parse_args().output.resolve()
    STORAGE.disk(out)
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ[key])
        if not scratch.is_dir():
            raise ValueError('existing scratch directory required')
        STORAGE.disk(scratch)
    out.mkdir(parents=True, exist_ok=False)
    sources = {
        'flat.vert': '#version 450\nlayout(location=0) in vec2 position;\nlayout(location=1) in vec3 color;\nlayout(location=0) flat out vec3 varying_color;\nout gl_PerVertex {vec4 gl_Position;};\nvoid main(){gl_Position=vec4(position,0.25,1.0);varying_color=color;}\n',
        'flat.frag': '#version 450\nlayout(location=0) flat in vec3 varying_color;\nlayout(location=0) out vec4 result;\nvoid main(){result=vec4(varying_color,1.0);}\n',
        'fragcoord.frag': '#version 450\nlayout(location=0) out vec4 result;\nvoid main(){result=vec4(gl_FragCoord.x/73.0,gl_FragCoord.y/51.0,gl_FragCoord.z,gl_FragCoord.w);}\n',
    }
    commands, fixtures = [], {}
    def run(label, args):
        commands.append(args)
        (out / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        with (out / (label + '.log')).open('w') as log:
            subprocess.run(args, check=True, stdout=log, stderr=subprocess.STDOUT, timeout=60)
    for tool in ('glslangValidator', 'spirv-val'):
        run(tool + '-version', [shutil.which(tool), '--version'])
    for name, source in sources.items():
        source_path, binary = out / name, out / (name + '.spv')
        source_path.write_text(source)
        run(name + '-compile', [shutil.which('glslangValidator'), '-V', '--target-env', 'vulkan1.0', '-S', name.rsplit('.', 1)[1], str(source_path), '-o', str(binary)])
        run(name + '-validate', [shutil.which('spirv-val'), '--target-env', 'vulkan1.0', str(binary)])
        fixtures[name] = {'file': binary.name, 'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
                          'sha256': hashlib.sha256(binary.read_bytes()).hexdigest()}
    script = Path(__file__).read_bytes()
    (out / 'prepare-renderer-fixtures.py').write_bytes(script)
    (out / 'fixtures.json').write_text(json.dumps({'pass': True, 'fixtures': fixtures,
        'scriptSha256': hashlib.sha256(script).hexdigest()}, indent=2) + '\n')
    print(json.dumps({'pass': True, 'fixtures': len(fixtures), 'output': str(out)}))


if __name__ == '__main__':
    main()
