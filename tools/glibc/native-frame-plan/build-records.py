#!/usr/bin/env python3
"""Finite sparse recipe. Requires exact reviewed patch hash; never edits bases."""
import argparse
import importlib.util
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import signal
import time
from evidence import T, S, P, L, R, sha, budget, group

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--packet', default='records-patch-1')
    parser.add_argument('--reviewed-patch', help='exact root-reviewed patch SHA256; absent means print recipe only')
    args = parser.parse_args()
    assert args.packet.startswith('records-patch-') and args.packet.removeprefix('records-patch-').isdigit()
    task = T/args.packet
    prepared = json.loads((task/'prepared.json').read_text())
    assert sha(prepared['compilerPatch']) == prepared['patchSha256']
    changes = prepared['sourcePairs']
    for row in changes.values():
        assert sha(row['path']) == row['ownedSha256']
        if 'basis' in row:
            assert sha(row['basis']) == row['basisSha256']
            assert sha(row['basisSnapshot']) == row['basisSha256']
            assert sha(row['original']) == row['originalSha256']
    for path, h in prepared['runtimeSources'].items():
        if isinstance(h, str): assert sha(path) == h
        else: assert sha(path) == h['sha256'] and sha(h['snapshot']) == h['sha256']
    units = ['WebAssemblyFrameLowering.cpp', 'WebAssemblyTargetMachine.cpp', 'WebAssemblyGNUFrames.cpp']
    recipe = {'sourcePlanOnly': not bool(args.reviewed_patch), 'patchSha256': prepared['patchSha256'],
              'compileUnits': units, 'archiveBase': str(P/'objects/compiler/libLLVMWebAssemblyCodeGen.a'),
              'replacedMembers': units[:2], 'newObjectOutsideArchive': units[2],
              'classLayoutsChanged': False, 'timeoutSecondsPerStage': 300, 'parallelCompiles': 1,
              'capBytes': 2*1024**3, 'expectedBytesLessThan': 1024**3,
              'runtimeAcceptance': False}
    if not args.reviewed_patch:
        print(json.dumps(recipe, indent=2)); return
    assert args.reviewed_patch == prepared['patchSha256']
    budget(True)
    import os, resource
    os.environ.update(TMPDIR=str(T/'tmp'), TMP=str(T/'tmp'), TEMP=str(T/'tmp'), XDG_CACHE_HOME=str(T/'cache'))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    O = task/'objects/compiler'; O.mkdir(parents=True, exist_ok=False)
    logs = task/'logs'; logs.mkdir()
    stages = []
    def run(name, argv):
        budget(True)
        assert not (logs/(name+'.json')).exists()
        with (logs/(name+'.log')).open('wb') as log:
            start = time.monotonic()
            proc = subprocess.Popen([str(a) for a in argv], cwd=T, stdout=log,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            row = {'name': name, 'argv': [str(a) for a in argv], 'cwd': str(T),
                   'pid': proc.pid, 'pgid': proc.pid, 'status': 'running'}
            (logs/(name+'.json')).write_text(json.dumps(row, indent=2)+'\n')
            print(json.dumps(row), flush=True)
            try: code = proc.wait(timeout=300)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL); code = proc.wait()
            if group(proc.pid): os.killpg(proc.pid, signal.SIGKILL)
            row.update(status='terminal', exit=code, seconds=time.monotonic()-start,
                       members=group(proc.pid), storage=budget())
            (logs/(name+'.json')).write_text(json.dumps(row, indent=2)+'\n')
            stages.append(row)
        assert code == 0 and not row['members'], row
    overlay = {'version': 0, 'roots': [{'type': 'file', 'name': str(S/rel), 'external-contents': row['path']}
                                     for rel, row in changes.items()]}
    overlaypath = task/'overlay.json'; overlaypath.write_text(json.dumps(overlay, indent=2)+'\n')
    G = P/'objects/generated'
    flags = shlex.split(subprocess.check_output([str(L/'bin/llvm-config'), '--cxxflags']).decode())
    flags += ['-DNDEBUG', '-O1', '-g0', '-ivfsoverlay', str(overlaypath),
              '-I'+str(G), '-I'+str(S/'llvm/lib/Target/WebAssembly')]
    for unit in units:
        rel = 'llvm/lib/Target/WebAssembly/'+unit
        source = changes[rel]['path'] if changes[rel].get('newSource') else S/rel
        run('compile-'+unit, ['/usr/bin/clang++', *flags, '-MD', '-MF', logs/(unit+'.d'),
                             '-c', source, '-o', O/(unit+'.o')])
    spec = importlib.util.spec_from_file_location('ordered_ar', R.parent/'c-cleanup/archive-audit.py')
    ar = importlib.util.module_from_spec(spec); spec.loader.exec_module(ar)
    base = P/'objects/compiler/libLLVMWebAssemblyCodeGen.a'; archive = O/base.name
    original = ar.members(base); shutil.copyfile(base, archive)
    run('replace-backend-members', [L/'bin/llvm-ar', 'r', archive, *[O/(u+'.o') for u in units[:2]]])
    owned = ar.members(archive)
    assert [m['name'] for m in owned] == [m['name'] for m in original]
    indices = [i for i, (a, b) in enumerate(zip(original, owned)) if a != b]
    assert sorted(original[i]['name'] for i in indices) == sorted(u+'.o' for u in units[:2])
    proof = {'base': str(base), 'baseSha256': sha(base), 'owned': str(archive), 'ownedSha256': sha(archive),
             'before': original, 'after': owned, 'changedIndices': indices}
    (logs/'archive-proof.json').write_text(json.dumps(proof, indent=2)+'\n')
    D = Path('/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler')
    driver = [D/n for n in ['driver.cpp.o', 'cc1_main.cpp.o', 'cc1as_main.cpp.o', 'cc1gen_reproducer_main.cpp.o', 'main.cpp.o']]
    frontend = P/'objects/compiler/libclangCodeGen.a'
    clanglibs = [str(p) for p in sorted((L/'lib').glob('libclang*.a')) if p.name != frontend.name]
    llvmlibs = shlex.split(subprocess.check_output([str(L/'bin/llvm-config'), '--libfiles', 'all']).decode())
    llvmlibs = [str(archive) if Path(p).name == archive.name else p for p in llvmlibs]
    syslibs = shlex.split(subprocess.check_output([str(L/'bin/llvm-config'), '--system-libs']).decode())
    extra = O/'WebAssemblyGNUFrames.cpp.o'
    inputs = [*driver, frontend, extra, *map(Path, clanglibs+llvmlibs)]
    pins = {str(p): sha(p) for p in inputs}
    (logs/'link-inputs.json').write_text(json.dumps(pins, indent=2)+'\n')
    run('link-owned-driver', ['/usr/bin/g++', '-fuse-ld=lld', '-o', O/'clang', *driver,
                             extra, '-Wl,--start-group', frontend, *clanglibs, *llvmlibs,
                             '-Wl,--end-group', *syslibs, '-pthread'])
    assert all(sha(p) == h for p, h in pins.items())
    run('driver-version', [O/'clang', '--version'])
    (task/'build-result.json').write_text(json.dumps({'recipe': recipe, 'stages': stages,
        'compiler': str(O/'clang'), 'sha256': sha(O/'clang'), 'compiled': True,
        'runtimeAcceptance': False, 'storage': budget()}, indent=2)+'\n')

if __name__ == '__main__': main()
