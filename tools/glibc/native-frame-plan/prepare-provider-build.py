#!/usr/bin/env python3
"""Combine reviewed provider3 source with frozen20; only GNUFrames needs compile."""
import json
from evidence import T, sha, budget


def main():
    budget(True)
    base = T/'module4-proposal-20'
    provider = T/'provider-proposal-3'
    expected = '5da6b3b1496fbf3755ac964cde657c6bca5e7667ad5c5cb27d6309c8f1d341f4'
    assert sha(provider/'compiler.patch') == expected
    out = T/'module4-proposal-21'
    assert not out.exists()
    out.mkdir()
    pairs = {}
    for basis in sorted((base/'source').rglob('*')):
        if not basis.is_file():
            continue
        rel = basis.relative_to(base/'source')
        candidate = provider/'source'/rel
        actual = candidate if candidate.exists() else basis
        dest = out/'source'/rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(actual.read_bytes())
        snap = out/'basis'/rel
        snap.parent.mkdir(parents=True, exist_ok=True)
        snap.write_bytes(basis.read_bytes())
        pairs[str(rel)] = {'basis': str(basis), 'basisSha256': sha(basis),
                          'basisSnapshot': str(snap), 'path': str(dest), 'ownedSha256': sha(dest)}
    for name in ['compiler.patch', 'prepared.json']:
        (out/('provider-'+name)).write_bytes((provider/name).read_bytes())
    (out/'compiler.patch').write_bytes((provider/'compiler.patch').read_bytes())
    for name in ['module4-call-audit.cpp', 'module4-final-ir.cpp', 'jump-abi-v2.h',
                 'frame-abi.h', 'module4-runtime.c', 'jump-delivery-v2.c', 'jump-helpers-v2.c']:
        (out/name).write_bytes((base/name).read_bytes())
    proof = {'compiled': False, 'runtimeAcceptance': False, 'patchSha256': expected,
             'sourcePairs': pairs, 'basis': str(base), 'provider': str(provider),
             'compileOnly': ['WebAssemblyGNUFrames.cpp'], 'reusedObjects': ['TargetMachine16', 'LowerSjLj20'],
             'storage': budget()}
    (out/'prepared.json').write_text(json.dumps(proof, indent=2)+'\n')
    print(json.dumps({'prepared': str(out/'prepared.json'), 'sha256': sha(out/'prepared.json')}))


if __name__ == '__main__':
    main()
