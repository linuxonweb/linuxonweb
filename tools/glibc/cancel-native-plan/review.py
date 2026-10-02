#!/usr/bin/env python3
"""Independent readback of this plan's actual evidence and repository scope."""
import hashlib
import json
from pathlib import Path
import signal
import os

TASK = Path('/mnt/p6/build/glibc-cancel-native-plan-20261002')
REPO = Path('/mnt/p6/project/linux/linuxonweb')
LOADER = Path('/mnt/p6/build/glibc-native-static-loader-20261002')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pin(path):
    data = path.read_bytes()
    sha = digest(data)
    copy = TASK/'source-snapshots'/(sha+'-'+path.name)
    if copy.exists():
        assert copy.read_bytes() == data
    else:
        copy.write_bytes(data)
    assert digest(path.read_bytes()) == digest(copy.read_bytes()) == sha
    return {'path':str(path), 'snapshot':str(copy), 'sha256':sha, 'bytes':len(data)}


def main():
    evidence = TASK/'evidence-attempt-2.json'
    proof = json.loads(evidence.read_text())
    assert proof['runtimeAcceptance'] is False
    for row in [*proof['inputs'].values(), *proof['compileOutputs'].values()]:
        assert digest(Path(row['path']).read_bytes()) == digest(Path(row['snapshot']).read_bytes()) == row['sha256']
    terminal = []
    for command in proof['commands']:
        assert command['exit'] == 0
        try:
            os.killpg(command['pgid'], 0)
            empty = False
        except ProcessLookupError:
            empty = True
        assert empty
        terminal.append({'pid':command['pid'], 'pgid':command['pgid'], 'empty':empty})
    scope = sorted((REPO/'tools/glibc/cancel-native-plan').glob('*'))
    scope.append(REPO/'docs/glibc-cancel-native-plan-20261002.md')
    repository = [pin(path) for path in scope if path.is_file()]
    routes = [pin(LOADER/path) for path in ['logs/routes-results.json',
              'objects/routes.ll','objects/routes.adapted.ll',
              'objects/routes.native.s','objects/routes.o','objects/routes.wasm']]
    route_summary = json.loads((LOADER/'logs/routes-results.json').read_text())
    report = {'scope':'completed source/compile-only cancellation plan for root review; not frozen runtime acceptance',
              'runtimeAcceptance':False, 'gnuCancellationImplemented':False,
              'evidence':pin(evidence), 'predecessorOriginalSnapshotPairs':len(proof['inputs']),
              'compileOutputPairs':len(proof['compileOutputs']), 'rereadDifferences':[],
              'repository':repository, 'loaderRouteEvidence':routes,
              'routeSummary':route_summary, 'terminalGroups':terminal}
    dst=TASK/'review.json'
    assert not dst.exists(), 'retain previous review; select a new attempt path'
    dst.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'review':str(dst),'sha256':digest(dst.read_bytes()),
                      'repositoryPaths':len(repository),'runtimeAcceptance':False}))


if __name__ == '__main__':
    main()
