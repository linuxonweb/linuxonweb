#!/usr/bin/env python3
"""Relink immutable consumer21 objects against the reviewed peer23 producer."""
import sys
sys.dont_write_bytecode = True
import argparse, importlib.util, json, shutil
from pathlib import Path
from common import T, R, L, pin, run, storage

PEER = T.parent/'glibc-native-frame-plan-20261002/module4-proposal-23'
OLD = T/'objects/compiler-consumer21'
OWN = T/'objects/compiler-consumer23'
PLAN = T/'logs/consumer23-compose-plan.json'

def prepare():
    assert not PLAN.exists()
    snap = T/'source/consumer23-compose-plan'; snap.mkdir()
    peer = json.loads((PEER/'build-result.json').read_text())
    assert peer['compiled'] and not peer['runtimeAcceptance']
    assert pin(peer['compiler'])['sha256'] == peer['sha256']
    link = list(next(s['argv'] for s in peer['stages'] if s['name'] == 'link-owned-driver'))
    link[link.index('-o')+1] = str(OWN/'clang')
    archives = {}
    for name in ['libLLVMCodeGen.a','libLLVMWebAssemblyCodeGen.a']:
        indices = [i for i,p in enumerate(link) if Path(p).name == name]
        assert len(indices) == 1
        i = indices[0]
        archives[name] = link[i]
        link[i] = str(OWN/name)
    paths = {Path(p) for p in link if Path(p).is_file()}
    paths.update(Path(p) for p in archives.values())
    paths.update([OLD/'libLLVMCodeGen.a', OLD/'WasmEHPrepare.cpp.o',
                  OLD/'WebAssemblyCFGStackify.cpp.o',
                  T/'logs/consumer21-build-result.json', T/'logs/consumer21-build-plan.json',
                  T/'logs/consumer21-archive-proof.json', T/'logs/compiler-attempt11.patch',
                  PEER/'build-result.json', PEER/'prepared.json', PEER/'compiler.patch',
                  PEER/'overlay.json', R/'compose-consumer23.py', R/'common.py',
                  R.parent/'c-cleanup/archive-audit.py', L/'bin/llvm-ar'])
    for row in json.loads((PEER/'prepared.json').read_text())['sourcePairs'].values():
        paths.update(Path(row[k]) for k in ['path','basis','basisSnapshot'] if k in row)
    for rel in ['llvm/lib/CodeGen/WasmEHPrepare.cpp',
                'llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp']:
        paths.add(T/'source/compiler-attempt11'/rel)
        paths.add(T/'source'/('basis-'+Path(rel).name))
    rows = []
    for i,p in enumerate(sorted(paths)):
        row = {'path':str(p),**pin(p)}
        if p.stat().st_size < 8388608:
            copy = snap/(str(i)+'-'+p.name); shutil.copyfile(p,copy)
            row['snapshot'] = str(copy)
        rows.append(row)
    plan = {
        'status':'UNEXECUTED_REVIEWABLE_REL_LINK_PLAN',
        'peerCompiler':peer['compiler'],'peerCompilerSha256':peer['sha256'],
        'sourcePatch':str(T/'logs/compiler-attempt11.patch'),
        'consumerSemanticChanges':False, 'recompileSources':False,
        'archiveBases':archives,
        'codeGenSourceArchive':str(OLD/'libLLVMCodeGen.a'),
        'replacementCFGObject':str(OLD/'WebAssemblyCFGStackify.cpp.o'),
        'extraGNUFramesObject':str(PEER/'objects/compiler/WebAssemblyGNUFrames.cpp.o'),
        'linkCommand':link,'pins':rows,
        'timeoutSecondsPerStage':300,'capBytes':3221225472,
        'launchReserveBytes':8589934592,'hardStopReserveBytes':5368709120,
        'afterAdapterLTO':False,'runtimeAcceptance':False,
    }
    PLAN.write_text(json.dumps(plan,indent=2)+'\n')
    print(json.dumps({'plan':str(PLAN),**pin(PLAN),'pins':len(rows)},indent=2))

def execute(expected):
    assert pin(PLAN)['sha256'] == expected
    plan = json.loads(PLAN.read_text())
    for row in plan['pins']:
        assert pin(row['path'])['sha256'] == row['sha256'],row['path']
        if 'snapshot' in row:
            assert pin(row['snapshot'])['sha256'] == row['sha256']
    storage(); OWN.mkdir()
    spec = importlib.util.spec_from_file_location('ordered_ar',R.parent/'c-cleanup/archive-audit.py')
    ar = importlib.util.module_from_spec(spec);spec.loader.exec_module(ar)
    proofs = []
    for name,base in plan['archiveBases'].items():
        original = ar.members(Path(base))
        if name == 'libLLVMCodeGen.a':
            shutil.copyfile(plan['codeGenSourceArchive'],OWN/name)
            expected_member = 'WasmEHPrepare.cpp.o'
        else:
            shutil.copyfile(base,OWN/name)
            run('consumer23-replace-'+name,[L/'bin/llvm-ar','r',OWN/name,
                                            plan['replacementCFGObject']])
            expected_member = 'WebAssemblyCFGStackify.cpp.o'
        actual = ar.members(OWN/name)
        assert [m['name'] for m in original] == [m['name'] for m in actual]
        changed = [i for i,(a,b) in enumerate(zip(original,actual)) if a != b]
        assert len(changed) == 1 and original[changed[0]]['name'] == expected_member
        proofs.append({'base':base,'baseSha256':pin(base)['sha256'],
                       'owned':str(OWN/name),**pin(OWN/name),
                       'before':original,'after':actual,'changedIndices':changed})
    (T/'logs/consumer23-archive-proof.json').write_text(json.dumps(proofs,indent=2)+'\n')
    run('consumer23-link-owned-driver',plan['linkCommand'])
    run('consumer23-driver-version',[OWN/'clang','--version'])
    assert all(pin(row['path'])['sha256'] == row['sha256'] for row in plan['pins'])
    (T/'logs/consumer23-build-result.json').write_text(json.dumps({
        'planSha256':expected,'compiled':True,'compiler':str(OWN/'clang'),
        **pin(OWN/'clang'),'runtimeAcceptance':False},indent=2)+'\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser();parser.add_argument('--execute-reviewed-plan')
    args = parser.parse_args()
    if args.execute_reviewed_plan:execute(args.execute_reviewed_plan)
    else:prepare()
