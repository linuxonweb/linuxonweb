#!/usr/bin/env python3
"""Freeze already-built translator/compiled SPIR-V and browser fixture hashes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
sys.dont_write_bytecode = True
from build import check_storage

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--shader-a', type=Path, required=True)
    parser.add_argument('--shader-b', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    storage = check_storage(out)
    import os
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        if not os.environ.get(name): raise ValueError(name + ' required')
        check_storage(Path(os.environ[name]))
    out.mkdir(parents=True, exist_ok=False)
    digest = lambda data: hashlib.sha256(data).hexdigest()
    record = json.loads((args.build / 'build.json').read_text())
    artifact = args.build / 'translator.wasm'
    if not record['pass'] or digest(artifact.read_bytes()) != record['sha256']:
        raise ValueError('translator build changed')
    shutil.copyfile(artifact, out / 'translator.wasm')
    report = {'testOnly': True, 'translator': record, 'shaders': [], 'sources': {}, 'storage': storage}
    for i, source in enumerate((args.shader_a, args.shader_b)):
        data = source.read_bytes()
        if len(data) < 20 or len(data) > 65536 or len(data) % 4 or data[:4] != b'\x03\x02\x23\x07':
            raise ValueError('invalid SPIR-V envelope')
        (out / f'formula-{i}.spv').write_bytes(data)
        report['shaders'].append({'source': str(source.resolve()), 'bytes': len(data), 'sha256': digest(data)})
    here = Path(__file__).resolve().parent
    for name in ('index.mjs', 'worker.mjs', 'qa.mjs', 'qa.html'):
        data = (here / name).read_bytes()
        report['sources'][name] = digest(data)
        (out / ('source-' + name)).write_bytes(data)
    manifest = out / 'qa-inputs.json'
    manifest.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'output': str(out), 'manifestSha256': digest(manifest.read_bytes())}))

if __name__ == '__main__': main()
