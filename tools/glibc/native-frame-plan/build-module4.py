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
    parser.add_argument('--packet', default='module4-proposal-9')
    parser.add_argument('--reviewed-patch', help='exact root-reviewed patch SHA256; absent means print recipe only')
    parser.add_argument('--reuse-target-machine', action='store_true',
                        help='reuse immutable source16 TargetMachine object after exact source equality')
    parser.add_argument('--reuse-lower-sjlj', action='store_true',
                        help='reuse immutable source18 LowerSjLj object after exact source equality')
    parser.add_argument('--reuse-lower-sjlj-20', action='store_true',
                        help='reuse immutable source20 LowerSjLj object after exact source equality')
    parser.add_argument('--reuse-lower-sjlj-23', action='store_true',
                        help='reuse immutable source23 LowerSjLj object after exact source equality')
    parser.add_argument('--reuse-gnu-frames', action='store_true',
                        help='reuse immutable source18 GNUFrames object after exact source equality')
    parser.add_argument('--reuse-gnu-frames-27', action='store_true',
                        help='reuse immutable coherent27 GNUFrames object after exact source equality')
    parser.add_argument('--reuse-frame-lowering-25', action='store_true',
                        help='reuse immutable source25 FrameLowering object after exact source equality')
    args = parser.parse_args()
    assert args.packet.startswith('module4-proposal-') and args.packet.removeprefix('module4-proposal-').isdigit()
    task = T/args.packet
    prepared = json.loads((task/'prepared.json').read_text())
    assert sha(task/'compiler.patch') == prepared['patchSha256']
    changes = prepared['sourcePairs']
    for row in changes.values():
        assert sha(row['path']) == row['ownedSha256']
        if 'basis' in row:
            assert sha(row['basis']) == row['basisSha256']
            assert sha(row['basisSnapshot']) == row['basisSha256']

    for name in ['frame-abi.h', 'module4-runtime.c', 'jump-abi-v2.h', 'jump-delivery-v2.c', 'jump-helpers-v2.c']:
        assert sha(task/name) == sha(R/name), 'changed source after review: '+name
    units = ['WebAssemblyTargetMachine.cpp', 'WebAssemblyLowerEmscriptenEHSjLj.cpp', 'WebAssemblyGNUFrames.cpp']
    if 'llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp' in changes:
        units.append('WebAssemblyFrameLowering.cpp')
    archive_units = [u for u in units if u != 'WebAssemblyGNUFrames.cpp']
    frozen = T/'records-patch-7/objects/compiler/libLLVMWebAssemblyCodeGen.a'
    recipe = {'sourcePlanOnly': not bool(args.reviewed_patch), 'patchSha256': prepared['patchSha256'],
              'compileUnits': units, 'archiveBase': str(frozen),
              'replacedMembers': archive_units, 'newObjectOutsideArchive': units[2],
              'classLayoutsChanged': False, 'timeoutSecondsPerStage': 300, 'parallelCompiles': 1,
              'capBytes': 2*1024**3, 'expectedBytesLessThan': 1024**3,
              'runtimeAcceptance': False}
    recipe['reuseTargetMachine16'] = args.reuse_target_machine
    recipe['reuseLowerSjLj18'] = args.reuse_lower_sjlj
    recipe['reuseLowerSjLj20'] = args.reuse_lower_sjlj_20
    recipe['reuseLowerSjLj23'] = args.reuse_lower_sjlj_23
    recipe['reuseGNUFrames18'] = args.reuse_gnu_frames
    recipe['reuseGNUFrames27'] = args.reuse_gnu_frames_27
    recipe['reuseFrameLowering25'] = args.reuse_frame_lowering_25
    if not args.reviewed_patch:
        print(json.dumps(recipe, indent=2)); return
    assert args.reviewed_patch == prepared['patchSha256']
    budget(True)
    import os, resource
    os.environ.update(PYTHONDONTWRITEBYTECODE='1', TMPDIR=str(T/'tmp'), TMP=str(T/'tmp'), TEMP=str(T/'tmp'), XDG_CACHE_HOME=str(T/'cache'))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    O = task/'objects/compiler'; O.mkdir(parents=True, exist_ok=False)
    logs = task/'logs'; logs.mkdir()
    stages = []
    def run(name, argv):
        budget(True)
        assert not (logs/(name+'.json')).exists()
        with (logs/(name+'.log')).open('wb') as log:
            start = time.monotonic()
            row = {'name': name, 'argv': [str(a) for a in argv], 'cwd': str(T),
                   'status': 'launching'}
            proc = subprocess.Popen([str(a) for a in argv], cwd=T, stdout=log,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            try:
                row.update(pid=proc.pid, pgid=proc.pid, status='running')
                (logs/(name+'.json')).write_text(json.dumps(row, indent=2)+'\n')
                print(json.dumps(row), flush=True)
                while proc.poll() is None:
                    budget()
                    if time.monotonic() - start > 300:
                        raise TimeoutError('bounded compile stage timeout')
                    try: proc.wait(timeout=1)
                    except subprocess.TimeoutExpired: pass
                code = proc.returncode
            finally:
                # Cleanup also covers command-record and output failures after
                # Popen, not only timeout inside wait. Only this owned group.
                if proc.poll() is None or group(proc.pid):
                    try: os.killpg(proc.pid, signal.SIGTERM)
                    except ProcessLookupError: pass
                    until = time.monotonic()+2
                    while time.monotonic() < until and group(proc.pid): time.sleep(.05)
                    if group(proc.pid):
                        try: os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError: pass
                proc.wait(timeout=10)
                until = time.monotonic()+10
                while group(proc.pid) and time.monotonic()<until: time.sleep(.05)
                row.update(status='terminal', exit=proc.returncode,
                           seconds=time.monotonic()-start, members=group(proc.pid))
                (logs/(name+'.json')).write_text(json.dumps(row, indent=2)+'\n')
                assert not row['members'], row
            row['storage'] = budget()
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
        if ((args.reuse_target_machine and unit == 'WebAssemblyTargetMachine.cpp') or
                ((args.reuse_lower_sjlj or args.reuse_lower_sjlj_20 or args.reuse_lower_sjlj_23) and unit == 'WebAssemblyLowerEmscriptenEHSjLj.cpp') or
                ((args.reuse_gnu_frames or args.reuse_gnu_frames_27) and unit == 'WebAssemblyGNUFrames.cpp') or
                (args.reuse_frame_lowering_25 and unit == 'WebAssemblyFrameLowering.cpp')):
            prior = T/('module4-proposal-16' if unit == 'WebAssemblyTargetMachine.cpp'
                       else 'module4-proposal-25' if unit == 'WebAssemblyFrameLowering.cpp'
                       else 'module4-proposal-27' if unit == 'WebAssemblyGNUFrames.cpp' and args.reuse_gnu_frames_27
                       else (('module4-proposal-23' if args.reuse_lower_sjlj_23 else 'module4-proposal-20')
                             if (args.reuse_lower_sjlj_20 or args.reuse_lower_sjlj_23) and
                             unit == 'WebAssemblyLowerEmscriptenEHSjLj.cpp' else 'module4-proposal-18'))
            assert sha(prior/'source'/rel) == sha(changes[rel]['path'])
            reused = prior/'objects/compiler'/(unit+'.o')
            reused_sha = sha(reused)
            shutil.copyfile(reused, O/(unit+'.o'))
            assert sha(reused) == sha(O/(unit+'.o')) == reused_sha
            (logs/('reused-'+unit+'.json')).write_text(json.dumps({
                'source': str(prior/'source'/rel), 'sourceSha256': sha(prior/'source'/rel),
                'object': str(reused), 'objectSha256': reused_sha,
                'owned': str(O/(unit+'.o'))}, indent=2)+'\n')
            continue
        source = S/rel if (S/rel).exists() else changes[rel]['path']
        run('compile-'+unit, ['/usr/bin/clang++', *flags, '-MD', '-MF', logs/(unit+'.d'),
                             '-c', source, '-o', O/(unit+'.o')])
    spec = importlib.util.spec_from_file_location('ordered_ar', R.parent/'c-cleanup/archive-audit.py')
    ar = importlib.util.module_from_spec(spec); spec.loader.exec_module(ar)
    base = frozen; archive = O/base.name
    original = ar.members(base); shutil.copyfile(base, archive)
    run('replace-backend-members', [L/'bin/llvm-ar', 'r', archive, *[O/(u+'.o') for u in archive_units]])
    owned = ar.members(archive)
    assert [m['name'] for m in owned] == [m['name'] for m in original]
    indices = [i for i, (a, b) in enumerate(zip(original, owned)) if a != b]
    assert sorted(original[i]['name'] for i in indices) == sorted(u+'.o' for u in archive_units)
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
