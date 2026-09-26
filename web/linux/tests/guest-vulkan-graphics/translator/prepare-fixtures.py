#!/usr/bin/env python3
"""Compile genuine GLSL fixture programs, then change only OpEntryPoint names."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
sys.dont_write_bytecode = True
from build import storage

NAMES = {'pair-a.vert': 'vertex.main-a', 'pair-a.frag': 'fragment_a',
         'pair-b.vert': 'VertexPayload', 'pair-b.frag': 'if',
         'mismatch.frag': 'mismatch', 'resource.frag': 'resource'}

def rename_entry(data, name):
    """Preserve all instructions and interface IDs except the single entry string."""
    result = bytearray(data[:20])
    offset, entries = 20, 0
    while offset < len(data):
        word, = struct.unpack_from('<I', data, offset)
        count, opcode = word >> 16, word & 65535
        if not count or offset + count * 4 > len(data):
            raise ValueError('invalid compiled SPIR-V envelope')
        instruction = data[offset:offset + count * 4]
        if opcode == 15:
            entries += 1
            end = instruction.index(0, 12)
            suffix = (end + 4) // 4 * 4
            string = name.encode('utf-8') + b'\0'
            string += b'\0' * (-len(string) % 4)
            instruction = instruction[4:12] + string + instruction[suffix:]
            instruction = struct.pack('<I', ((len(instruction) // 4 + 1) << 16) | opcode) + instruction
        result.extend(instruction)
        offset += count * 4
    if entries != 1:
        raise ValueError('fixture must have exactly one entry')
    return bytes(result)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--compiler', default='glslangValidator')
    args = parser.parse_args()
    out = args.output.resolve()
    backing = storage(out, True)
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        if not os.environ.get(name) or not Path(os.environ[name]).is_dir():
            raise ValueError(name + ' must name existing disk scratch')
        storage(Path(os.environ[name]), True)
    out.mkdir(parents=True, exist_ok=False)
    here = Path(__file__).resolve().parent
    fixtures = {}
    digest = lambda b: hashlib.sha256(b).hexdigest()
    def run(label, command):
        (out / (label + '.command.json')).write_text(json.dumps(command) + '\n')
        with (out / (label + '.log')).open('w') as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
    run('compiler-version', [args.compiler, '--version'])
    for name, entry in NAMES.items():
        source = here / 'fixtures' / name
        data = source.read_bytes()
        (out / name).write_bytes(data)
        compiled = out / (name + '.original.spv')
        run(name + '-compile', [args.compiler, '-V', '--target-env', 'vulkan1.0', '-o', str(compiled), str(out / name)])
        supplied = rename_entry(compiled.read_bytes(), entry)
        artifact = out / (name + '.spv')
        artifact.write_bytes(supplied)
        run(name + '-validate', ['spirv-val', '--target-env', 'vulkan1.0', str(artifact)])
        fixtures[name] = {'file': artifact.name, 'entryPoint': entry, 'stage': 'vertex' if name.endswith('.vert') else 'fragment',
                          'sourceSha256': digest(data), 'originalSha256': digest(compiled.read_bytes()),
                          'sha256': digest(supplied), 'bytes': len(supplied)}
    record = {'pass': True, 'storage': backing, 'fixtures': fixtures,
              'scope': 'Independently compiled supplied SPIR-V; no runtime translation or GPU claim'}
    (out / 'fixtures.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'pass': True, 'output': str(out)}))

if __name__ == '__main__': main()
