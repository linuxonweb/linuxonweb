#!/usr/bin/env python3
"""Compose reviewed consumer12 with one coherent query/CXX/frame producer."""
import sys
sys.dont_write_bytecode = True
import argparse
import importlib.util
import json
from pathlib import Path
import shlex
import shutil
import subprocess
from common import T, R, S, L, pin, run, storage

PEER = None  # --peer must name the actual complete immutable producer packet
PLAN = T/'logs/consumer-coherent1-build-plan.json'
OWN = T/'objects/compiler-consumer-coherent1'
SOURCES = {
    'libLLVMCodeGen.a': ('llvm/lib/CodeGen/WasmEHPrepare.cpp', 'WasmEHPrepare.cpp.o'),
    'libLLVMWebAssemblyCodeGen.a': ('llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp',
                                  'WebAssemblyCFGStackify.cpp.o'),
}

def prepare():
    assert not PLAN.exists(), 'preserve prepared plan; create a new version'
    planroot = T/'source/consumer-coherent1-build-plan'
    planroot.mkdir()
    peer = json.loads((PEER/'build-result.json').read_text())
    assert peer['compiled'] and not peer['runtimeAcceptance']
    assert pin(peer['compiler'])['sha256'] == peer['sha256']
    link = next(s['argv'] for s in peer['stages'] if s['name'] == 'link-owned-driver')
    link[link.index('-o')+1] = str(OWN/'clang')
    bases = {}
    for archive in SOURCES:
        positions = [i for i,p in enumerate(link) if Path(p).name == archive]
        assert len(positions) == 1
        index = positions[0]
        bases[archive] = link[index]
        link[index] = str(OWN/archive)
    flags = shlex.split(subprocess.check_output([str(L/'bin/llvm-config'), '--cxxflags']).decode())
    flags += ['-DNDEBUG', '-O1', '-g0', '-ivfsoverlay', str(PEER/'overlay.json'),
              '-I'+str(T.parent/'glibc-cancel-compiler-20261002/objects/generated'),
              '-I'+str(S/'llvm/lib/Target/WebAssembly')]
    commands = []
    paths = {Path(p) for p in link if Path(p).is_file()}
    paths.update(Path(p) for p in bases.values())
    paths.update([Path(peer['compiler']), L/'bin/llvm-config', L/'bin/llvm-ar',
                  Path('/usr/bin/clang++'), Path('/usr/bin/g++'), Path('/usr/bin/ld.lld'),
                  PEER/'overlay.json', PEER/'prepared.json', PEER/'build-result.json',
                  PEER/'compiler.patch', T/'logs/compiler-attempt12.patch'])
    paths.update(p for p in R.iterdir() if p.is_file())
    paths.add(R.parent/'c-cleanup/archive-audit.py')
    for rel,row in json.loads((PEER/'prepared.json').read_text())['sourcePairs'].items():
        paths.update(Path(row[k]) for k in ['path','basis','basisSnapshot'] if k in row)
    for archive,(rel,obj) in SOURCES.items():
        source = T/'source/compiler-attempt12'/rel
        paths.update([source, T/'source'/('basis-'+Path(rel).name)])
        commands.append({'stage': 'consumer-coherent1-compile-'+obj,
                         'argv': ['/usr/bin/clang++', *flags, '-MD', '-MF', str(OWN/(obj+'.d')),
                                  '-c', str(source), '-o', str(OWN/obj)]})
    # Generated target headers and installed LLVM headers are direct compiler
    # dependencies. Pin their actual bytes before build, not just include roots.
    for directory in [L/'include', T.parent/'glibc-cancel-compiler-20261002/objects/generated']:
        paths.update(p for p in directory.rglob('*') if p.is_file())
    rows = []
    for i,path in enumerate(sorted(paths)):
        row = {'path': str(path), **pin(path)}
        if path.stat().st_size < 8388608 and path.suffix in {'.cpp','.py','.h','.inc','.json','.patch','.td'}:
            snapshot = planroot/f'{i}-{path.name}'
            shutil.copyfile(path,snapshot)
            row['snapshot'] = str(snapshot)
        rows.append(row)
    plan = {'status': 'UNEXECUTED_REVIEWABLE_SPARSE_PLAN',
            'patch': str(T/'logs/compiler-attempt12.patch'),
            'patchSha256': pin(T/'logs/compiler-attempt12.patch')['sha256'],
            'peerCompiler': peer['compiler'], 'peerCompilerSha256': peer['sha256'],
            'archiveBases': bases, 'replacements': {a:[v[1]] for a,v in SOURCES.items()},
            'extraGNUFramesObject': str(PEER/'objects/compiler/WebAssemblyGNUFrames.cpp.o'),
            'compileCommands': commands, 'linkCommand': link,
            'pins': rows, 'timeoutSecondsPerStage':300, 'capBytes':3221225472,
            'launchReserveBytes':8589934592,'hardStopReserveBytes':5368709120,
            'runtimeAcceptance':False, 'afterAdapterLTO':False,
            'requiresCoherentGNUFramesQueryAndCXXObject':True,
            'requiresDominatingActualCallerSP':True}
    PLAN.write_text(json.dumps(plan,indent=2)+'\n')
    print(json.dumps({'plan':str(PLAN),**pin(PLAN),'pins':len(rows)},indent=2))

def execute(expected):
    assert pin(PLAN)['sha256'] == expected, 'exact reviewed manifest required'
    plan = json.loads(PLAN.read_text())
    for row in plan['pins']:
        assert pin(row['path'])['sha256'] == row['sha256'], row['path']
        if 'snapshot' in row: assert pin(row['snapshot'])['sha256'] == row['sha256']
    storage()
    OWN.mkdir(exist_ok=False)
    for row in plan['compileCommands']: run(row['stage'],row['argv'])
    spec=importlib.util.spec_from_file_location('ordered_ar',R.parent/'c-cleanup/archive-audit.py')
    ar=importlib.util.module_from_spec(spec); spec.loader.exec_module(ar)
    proofs=[]
    for archive,base in plan['archiveBases'].items():
        original=ar.members(Path(base))
        shutil.copyfile(base,OWN/archive)
        replacements=[OWN/n for n in plan['replacements'][archive]]
        run('consumer-coherent1-replace-'+archive,[L/'bin/llvm-ar','r',OWN/archive,*replacements])
        actual=ar.members(OWN/archive)
        assert [m['name'] for m in original] == [m['name'] for m in actual]
        changed=[i for i,(a,b) in enumerate(zip(original,actual)) if a!=b]
        assert sorted(original[i]['name'] for i in changed) == sorted(plan['replacements'][archive])
        proofs.append({'base':base,'baseSha256':pin(base)['sha256'],
                       'owned':str(OWN/archive),**pin(OWN/archive),
                       'before':original,'after':actual,'changedIndices':changed})
    (T/'logs/consumer-coherent1-archive-proof.json').write_text(json.dumps(proofs,indent=2)+'\n')
    run('consumer-coherent1-link-owned-driver',plan['linkCommand'])
    run('consumer-coherent1-driver-version',[OWN/'clang','--version'])
    assert all(pin(row['path'])['sha256']==row['sha256'] for row in plan['pins'])
    (T/'logs/consumer-coherent1-build-result.json').write_text(json.dumps({
        'planSha256':expected,'compiled':True,'compiler':str(OWN/'clang'),
        **pin(OWN/'clang'),'runtimeAcceptance':False},indent=2)+'\n')

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--execute-reviewed-plan')
    parser.add_argument('--peer', required=True)
    args=parser.parse_args()
    PEER=Path(args.peer).resolve()
    assert PEER.is_relative_to(T.parent/'glibc-native-frame-plan-20261002')
    if args.execute_reviewed_plan: execute(args.execute_reviewed_plan)
    else: prepare()
