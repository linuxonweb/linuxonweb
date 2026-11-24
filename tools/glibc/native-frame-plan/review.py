#!/usr/bin/env python3
"""Read-only independent rereread of the finished plan and finite stages."""
import json
from pathlib import Path
from evidence import T, R, REPO, sha, group, budget

def main():
    candidates = sorted(T.glob('evidence-attempt-*.json'), key=lambda p: int(p.stem.rsplit('-',1)[1]))
    assert candidates
    p = candidates[-1]
    evidence = json.loads(p.read_text())
    assert evidence['sourcePlanOnly'] and not evidence['compilerBuild'] and not evidence['runtimeAcceptance']
    differences = []
    for name, row in {**evidence['inputs'], **evidence['outputs']}.items():
        if sha(row['path']) != row['sha256']: differences.append(name+' original')
        if 'snapshot' in row and sha(row['snapshot']) != row['sha256']: differences.append(name+' snapshot')
    assert not differences, differences
    for row in evidence['commands']:
        assert row['exit'] == 0 and not row['members'] and not group(row['pgid'])
    history = []
    for previous in candidates[:-1]:
        old = json.loads(previous.read_text())
        for row in old['inputs'].values():
            if 'snapshot' in row: assert sha(row['snapshot']) == row['sha256']
        for row in old['outputs'].values():
            assert sha(row['path']) == row['sha256'] and sha(row['snapshot']) == row['sha256']
        for row in old['commands']:
            assert row['exit'] == 0 and not row['members'] and not group(row['pgid'])
        history.append({'path': str(previous), 'sha256': sha(previous), 'layout': old['layoutValues'],
                        'commands': old['commands'], 'scope': 'superseded proposed shape/source bytes retained as snapshots; no runtime acceptance'})
    repo = {str(p): sha(p) for p in R.iterdir() if p.is_file()}
    doc = REPO/'docs/glibc-native-frame-plan-20261002.md'
    repo[str(doc)] = sha(doc)
    review = {'sourceAndLayoutPlanPass': True, 'runtimeAcceptance': False,
              'compilerBuild': False, 'evidence': str(p), 'evidenceSha256': sha(p),
              'pins': len(evidence['inputs']), 'sourcePairs': evidence['sourcePairs'],
              'findings': len(evidence['findings']), 'commands': evidence['commands'],
              'repository': repo, 'rereadDifferences': differences, 'storage': budget(),
              'retainedHistory': history,
              'nextHeavyBuildRequiresExactPatchReview': True}
    attempt = len(list(T.glob('review-attempt-*.json')))+1
    out = T/f'review-attempt-{attempt}.json'
    out.write_text(json.dumps(review, indent=2)+'\n')
    print(json.dumps({'review': str(out), 'sha256': sha(out), 'pins': len(evidence['inputs']), 'repositoryPaths': len(repo), 'runtimeAcceptance': False}))

if __name__ == '__main__': main()
