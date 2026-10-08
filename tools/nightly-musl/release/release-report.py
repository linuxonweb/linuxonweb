#!/usr/bin/env python3
"""Write OUT/report.json for package-firefox-native-gpu.py --build.

Starts from the a38 GPU build report (unchanged plugin-container, gfxtest and
recipe records) and points the firefox artifact at OUT/obj/firefox.fpcast.wasm.

usage: release-report.py OUT_DIR
"""
import hashlib
import json
import os
import sys

TEMPLATE = '/mnt/p3/codex-build/opus-ffgpu/a38/report.json'
HERE = os.path.dirname(os.path.abspath(__file__))


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(1 << 24):
            h.update(chunk)
    return h.hexdigest()


def artifact(path):
    return {'path': path, 'bytes': os.path.getsize(path), 'sha256': sha(path)}


out = os.path.abspath(sys.argv[1])
report = json.load(open(TEMPLATE))
report['schema'] = 'opus-release-build-1'
report['note'] = ('Release: Nightly 159 wasm32 musl with PBL JIT (PBLIC + PBLBC), '
                  'wasm-opt -O2 then --fpcast-emu, no debug info.')
report['artifacts']['firefox']['raw'] = artifact(f'{out}/obj/firefox.preoptimizer.wasm')
report['artifacts']['firefox']['optimized'] = artifact(f'{out}/obj/firefox.optimized.wasm')
report['artifacts']['firefox']['final'] = artifact(f'{out}/obj/firefox.fpcast.wasm')
pbl = os.path.join(HERE, '..', 'pbl-jit')
report['pblic'] = {
    'object': artifact(f'{out}/pbl/obj/PortableBaselineInterpret.o'),
    'sources': {name: sha(os.path.join(pbl, name)) for name in
                ['PortableBaselineInterpret.patch', 'PblIc.inc', 'PblIcOps.h', 'PblMethod.inc']},
}
json.dump(report, open(f'{out}/report.json', 'w'), indent=1)
print(f'{out}/report.json')
