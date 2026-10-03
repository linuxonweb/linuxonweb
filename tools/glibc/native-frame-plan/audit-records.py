#!/usr/bin/env python3
"""Read back the preserved normal-path prerequisite; never rerun or edit it."""
import importlib.util
import json
from pathlib import Path
from evidence import T, R, sha, group, budget


def main():
    out = T / 'normal-records-reread-1.json'
    assert not out.exists(), 'preserve proof; use a new named audit for corrections'
    build = T / 'records-patch-7'
    controls = T / 'records-controls-4'
    result = json.loads((controls / 'results.json').read_text())
    assert result['pass'] and result['packet'] == build.name
    pins = dict(result['pins'])
    pins[str(controls / 'results.json')] = sha(controls / 'results.json')
    for path, expected in pins.items():
        assert sha(path) == expected, path
    prepared = json.loads((build / 'prepared.json').read_text())
    assert sha(prepared['compilerPatch']) == prepared['patchSha256']
    for row in prepared['sourcePairs'].values():
        assert sha(row['path']) == row['ownedSha256']
        if 'basis' in row:
            assert sha(row['basis']) == sha(row['basisSnapshot']) == row['basisSha256']
            assert sha(row['original']) == row['originalSha256']
    for path, row in prepared['runtimeSources'].items():
        assert sha(path) == sha(row['snapshot']) == row['sha256']
    link = json.loads((build / 'logs/link-inputs.json').read_text())
    for path, expected in link.items():
        assert sha(path) == expected, path
    archive = json.loads((build / 'logs/archive-proof.json').read_text())
    spec = importlib.util.spec_from_file_location('ordered_ar', R.parent / 'c-cleanup/archive-audit.py')
    ar = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ar)
    assert ar.members(Path(archive['base'])) == archive['before']
    assert ar.members(Path(archive['owned'])) == archive['after']
    assert sha(archive['base']) == archive['baseSha256']
    assert sha(archive['owned']) == archive['ownedSha256']
    assert archive['changedIndices'] == [15, 41]
    stages = json.loads((build / 'build-result.json').read_text())['stages']
    stages += json.loads((controls / 'commands.json').read_text())
    for row in stages:
        assert row['status'] == 'terminal' and not row['members'] and not group(row['pgid'])
    retained = {}
    for name in ['records-patch-2', 'records-patch-3', 'records-patch-5',
                 'records-patch-6', 'records-controls-1', 'records-controls-2', 'records-controls-3']:
        directory = T / name
        retained[name] = {str(p): sha(p) for p in sorted(directory.rglob('*'))
                          if p.is_file() and (p.suffix in ['.json', '.log', '.patch'] or 'sources' in p.parts)}
    proof = {'pass': True, 'scope': 'normal native records with synthetic owner, not GNU forced unwind',
             'resultSha256': sha(controls / 'results.json'), 'checkedPins': len(pins),
             'linkInputs': len(link), 'archiveMembers': len(archive['before']),
             'changedIndices': archive['changedIndices'], 'terminalStages': len(stages),
             'retainedFailureAndPredecessorPins': retained, 'storage': budget()}
    out.write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'proof': str(out), 'sha256': sha(out), 'pass': True}))


if __name__ == '__main__':
    main()
