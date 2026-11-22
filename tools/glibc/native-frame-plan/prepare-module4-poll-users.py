#!/usr/bin/env python3
"""Exact capture-user correction over frozen18; keep provider19 separate."""
import difflib
import json
from evidence import T, R, sha, budget


def main():
    budget(True)
    base = T/'module4-proposal-18'
    out = T/'module4-proposal-20'
    assert not out.exists()
    out.mkdir()
    pairs, chunks = {}, []
    for old in sorted((base/'source').rglob('*')):
        if not old.is_file():
            continue
        rel = old.relative_to(base/'source')
        text = old.read_text()
        new = text
        if old.name == 'WebAssemblyLowerEmscriptenEHSjLj.cpp':
            start = text.index('// Consumed only by the separately reviewed module4 producer overlay.')
            end = text.index('static bool canLongjmp', start)
            new = text[:start] + (R/'module4-sjlj-operations.cpp').read_text() + '\n' + text[end:]
        dest = out/'source'/rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(new)
        snap = out/'basis'/rel
        snap.parent.mkdir(parents=True, exist_ok=True)
        snap.write_bytes(old.read_bytes())
        pairs[str(rel)] = {'basis': str(old), 'basisSha256': sha(old), 'basisSnapshot': str(snap),
                          'path': str(dest), 'ownedSha256': sha(dest)}
        if text != new:
            chunks.append(''.join(difflib.unified_diff(text.splitlines(True), new.splitlines(True),
                          fromfile='a/'+str(rel), tofile='b/'+str(rel))))
    patch = out/'compiler.patch'
    patch.write_text(''.join(chunks))
    for name in ['module4-call-audit.cpp', 'module4-final-ir.cpp', 'jump-abi-v2.h',
                 'frame-abi.h', 'module4-runtime.c', 'jump-delivery-v2.c', 'jump-helpers-v2.c']:
        (out/name).write_bytes((base/name).read_bytes())
    proof = {'compiled': False, 'runtimeAcceptance': False, 'basis': str(base),
             'sourcePairs': pairs, 'patchSha256': sha(patch), 'reviewRequiredBeforeBuild': True,
             'scope': 'actual capture users include authenticated early polls; polls remain longjmpable',
             'storage': budget()}
    (out/'prepared.json').write_text(json.dumps(proof, indent=2)+'\n')
    print(json.dumps({'prepared': str(out/'prepared.json'), 'sha256': sha(out/'prepared.json'),
                      'patchSha256': sha(patch)}))


if __name__ == '__main__':
    main()
