#!/usr/bin/env python3
"""Compile the A5 depth-attachment GLSL shaders to validated SPIR-V (no GPU claim)."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'guest-vulkan-graphics'))
from storage import checked_storage

SHADERS = ('depth.vert', 'depth.frag')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out, storage = checked_storage(args.output)
    out.mkdir(parents=True, exist_ok=False)
    here = Path(__file__).resolve().parent
    digest = lambda b: hashlib.sha256(b).hexdigest()
    def run(label, command):
        (out / (label + '.command.json')).write_text(json.dumps(command) + '\n')
        with (out / (label + '.log')).open('w') as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
    run('compiler-version', ['glslangValidator', '--version'])
    fixtures = {}
    for name in SHADERS:
        data = (here / 'shaders' / name).read_bytes()
        (out / name).write_bytes(data)
        artifact = out / (name + '.spv')
        run(name + '-compile', ['glslangValidator', '-V', '--target-env', 'vulkan1.0', '-o', str(artifact), str(out / name)])
        run(name + '-validate', ['spirv-val', '--target-env', 'vulkan1.0', str(artifact)])
        run(name + '-disassemble', ['spirv-dis', str(artifact)])
        spv = artifact.read_bytes()
        fixtures[name] = {'file': artifact.name, 'stage': 'vertex' if name.endswith('.vert') else 'fragment',
                          'sourceSha256': digest(data), 'sha256': digest(spv), 'bytes': len(spv)}
    record = {'pass': True, 'storage': storage, 'fixtures': fixtures,
              'scope': 'Independently compiled depth-test SPIR-V; no translation or GPU claim'}
    (out / 'fixtures.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'pass': True, 'output': str(out)}))

if __name__ == '__main__':
    main()
