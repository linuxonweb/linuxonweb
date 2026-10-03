#!/usr/bin/env python3
"""Compile the current native helper and test its POSIX body on the host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--packet', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
packet = args.packet.resolve()
output = args.output.resolve()
assert output.is_relative_to(Path('/mnt/p6/build'))
assert not output.exists(), 'Preserve prior diagnostic evidence'
output.mkdir(parents=True)
env = os.environ.copy()
for name in ('TMPDIR', 'TMP', 'TEMP'):
    env[name] = str(packet / 'tmp')
source = packet / 'source/firefox-159.0a1'
predicate = '#if !defined(__wasm__) || (defined(XP_LINUX) && !defined(__wasi__))'
for name in ('UniquePtrExtensions.h', 'UniquePtrExtensions.cpp'):
    text = (source / 'mfbt' / name).read_text()
    assert text.count(predicate) == 1
    (output / name).write_text(text)
for name in ('native-abi.cpp', 'host-semantics.cpp'):
    shutil.copy2(Path(__file__).resolve().parent / name, output / name)
template = json.loads((packet / 'wgpu-bindings-interop-preflight/cpp-argv.json').read_text())
results = {}


def run(name, argv):
    (output / (name + '-argv.json')).write_text(json.dumps(argv, indent=2) + '\n')
    with (output / (name + '.log')).open('w') as log:
        result = subprocess.run(argv, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=120)
    results[name] = result.returncode
    assert result.returncode == 0, name


for name in ('UniquePtrExtensions.cpp', 'native-abi.cpp'):
    argv = template.copy()
    argv[argv.index('-o') + 1] = str(output / (Path(name).stem + '.o'))
    argv[-1] = str(output / name)
    run('native-' + Path(name).stem, argv)
argv = template.copy()
argv[argv.index('-o') + 1] = str(output / 'native-body.ii')
argv[argv.index('-c')] = '-E'
argv[-1] = str(output / 'UniquePtrExtensions.cpp')
run('native-preprocess', argv)
assert 'fd = fcntl(aFile, 1030, 0);' in (output / 'native-body.ii').read_text()
run('host-compile', ['/usr/bin/g++', '-std=c++20', '-O2', '-DNDEBUG', '-DXP_UNIX',
                     '-DXP_LINUX', '-D__wasm__', '-I' + str(packet / 'obj-nightly/dist/include'),
                     str(output / 'UniquePtrExtensions.cpp'), str(output / 'host-semantics.cpp'),
                     '-o', str(output / 'host-semantics')])
run('host-semantics', [str(output / 'host-semantics'), str(output / 'semantics-fixture.bin')])
objects = {}
for name in ('UniquePtrExtensions.o', 'native-abi.o'):
    data = (output / name).read_bytes()
    assert data[:8] == b'\0asm\x01\0\0\0'
    objects[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
proof = {'scope': 'Native helper compile and actual host Linux POSIX diagnostic; no guest runtime acceptance',
         'results': results, 'objects': objects, 'source_mutated': False}
(output / 'result.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof, indent=2))
