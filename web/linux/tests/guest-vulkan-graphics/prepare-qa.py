#!/usr/bin/env python3
"""Freeze verified graphics translator, fixtures and the exact runnable QA sources."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / 'translator'))
from build import storage

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    backing = storage(out, True)
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        if not os.environ.get(name) or not Path(os.environ[name]).is_dir():
            raise ValueError(name + ' must name existing disk scratch')
        storage(Path(os.environ[name]), True)
    build, fixtures = args.build.resolve(), args.fixtures.resolve()
    storage(build); storage(fixtures)
    record = json.loads((build / 'build.json').read_bytes())
    wasm = (build / 'translator.wasm').read_bytes()
    if record.get('pass') is not True or sha(wasm) != record['sha256'] or len(wasm) != record['bytes']:
        raise ValueError('translator build artifact changed')
    lock_bytes = (build / 'source-lock.json').read_bytes()
    if sha(lock_bytes) != record['sourceLockSha256']:
        raise ValueError('translator source lock changed')
    lock = json.loads(lock_bytes)
    here = Path(__file__).resolve().parent
    for name, expected in lock['inputs'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('unsafe translator source path')
        if sha((here / 'translator' / name).read_bytes()) != expected:
            raise ValueError('current translator differs from tested build: ' + name)
    fixture_record = json.loads((fixtures / 'fixtures.json').read_bytes())
    if fixture_record.get('pass') is not True:
        raise ValueError('fixtures are not validated')
    out.mkdir(parents=True, exist_ok=False)
    def write(name, data):
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    sources = {}
    names = ['qa.html', 'qa.mjs', 'renderer.mjs', 'run-browser.mjs', 'prepare-qa.py',
             'translator/index.mjs', 'translator/worker.mjs', 'translator/abi.mjs',
             'translator/prepare-fixtures.py', 'translator/check.mjs']
    names += ['translator/' + name for name in lock['inputs']]
    names += ['translator/fixtures/' + name for name in fixture_record['fixtures']]
    for name in sorted(set(names)):
        data = (here / name).read_bytes()
        write(name, data)
        sources[name] = {'sha256': sha(data), 'bytes': len(data)}
    frozen = {}
    for name, item in fixture_record['fixtures'].items():
        if Path(name).name != name or Path(item['file']).name != item['file']:
            raise ValueError('unsafe fixture path')
        data = (fixtures / item['file']).read_bytes()
        if len(data) != item['bytes'] or sha(data) != item['sha256'] or data[:4] != b'\x03\x02\x23\x07':
            raise ValueError('SPIR-V fixture changed: ' + name)
        if sha((here / 'translator/fixtures' / name).read_bytes()) != item['sourceSha256']:
            raise ValueError('GLSL fixture changed: ' + name)
        write('shaders/' + item['file'], data)
        frozen[name] = {**item, 'url': 'shaders/' + item['file']}
    write('translator.wasm', wasm)
    write('build.json', (build / 'build.json').read_bytes())
    write('translator-source-lock.json', lock_bytes)
    write('fixtures.json', (fixtures / 'fixtures.json').read_bytes())
    manifest = {'schema': 1, 'testOnly': True, 'translator': record, 'fixtures': frozen,
                'sources': sources, 'storage': backing,
                'provenance': {name: sha((out / name).read_bytes()) for name in
                               ('build.json', 'translator-source-lock.json', 'fixtures.json')},
                'scope': 'Frozen browser graphics QA; no guest or physical GPU claim'}
    write('qa-inputs.json', (json.dumps(manifest, indent=2) + '\n').encode())
    print(json.dumps({'output': str(out), 'manifestSha256': sha((out / 'qa-inputs.json').read_bytes())}))

if __name__ == '__main__':
    main()
