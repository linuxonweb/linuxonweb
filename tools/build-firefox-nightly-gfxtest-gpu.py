#!/usr/bin/env python3
"""Build a genuine current159 gfxtest candidate; this is not GPU acceptance."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import shlex
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
TASK = Path('/mnt/p3/codex-build/firefox-gpu-oct06')
PLAN = TASK / 'gfxtest-plan1'
OBJ = Path('/mnt/p6/build/firefox-nightly-musl-jit-full-20261002/obj-nightly')
CWD = OBJ / 'toolkit/xre/gfxtest'
ATOMIC = Path('/mnt/p6/build/firefox-atomic-observer-package-20261004/transform')
MESA = Path('/mnt/p6/build/glgears-zink-20261001/link/egl2')
GIB = 1024**3

def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def pin(p):
    p = Path(p).resolve(strict=True)
    return dict(path=str(p), bytes=p.stat().st_size, sha256=sha(p))

def members(pgid):
    rows = []
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():
            continue
        try:
            s = (p / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(s[2]) == pgid:
                rows.append(dict(pid=int(p.name), start=int(s[19]),
                                 rss=int(s[21]) * os.sysconf('SC_PAGE_SIZE')))
        except (OSError, ValueError, IndexError):
            pass
    return rows

def available():
    return int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines()
                    if x.startswith('MemAvailable:'))) * 1024

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output', required=True, type=Path)
    ap.add_argument('--prepare-only', action='store_true')
    a = ap.parse_args()
    out = a.output.resolve()
    if not out.is_relative_to(TASK) or out.exists():
        raise RuntimeError('fresh owned p3 output required')
    out.mkdir()
    for d in ('sources', 'obj', 'scratch'):
        (out / d).mkdir()
    started = time.monotonic()
    report = dict(passBuild=False, prepared=False, candidateOnly=True,
                  gpuAcceptance=False, guestAcceptance=False, inputs={}, steps=[],
                  limits=dict(totalWallSeconds=1800, compileLinkWallSeconds=600,
                              optimizerWallSeconds=1200, ASBytes=16*GIB,
                              groupRSSBytes=12*GIB, taskDiskBytes=8*GIB,
                              diskCapScope=str(out), retainedInputsCountedAgainstDiskCap=False,
                              diskReserveBytes=20*GIB, hostAvailableFloorBytes=4*GIB))
    env = os.environ.copy()
    env.update(TMPDIR=str(out/'scratch'), TMP=str(out/'scratch'), TEMP=str(out/'scratch'),
               XDG_CACHE_HOME=str(out/'scratch'), BINARYEN_CORES='4', OMP_NUM_THREADS='1',
               PYTHONDONTWRITEBYTECODE='1')
    checked = {}
    def record(p, expected=None):
        p = Path(p).resolve(strict=True)
        if str(p) not in checked:
            checked[str(p)] = pin(p)
        row = checked[str(p)]
        if expected is not None and row['sha256'] != expected:
            raise RuntimeError('changed input: '+str(p))
        report['inputs'][str(p)] = row
        return row
    def persist():
        (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    def guards():
        resource.setrlimit(resource.RLIMIT_AS, (16*GIB, 16*GIB))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (4*GIB, 4*GIB))
        resource.setrlimit(resource.RLIMIT_CPU, (6000, 6000))
        Path('/proc/self/oom_score_adj').write_text('1000')
    def run(name, argv, cwd=out, limit=600):
        if available() < 4*GIB or shutil.disk_usage(out).free < 20*GIB:
            raise RuntimeError('RAM/disk floor before '+name)
        step = dict(name=name, argv=list(map(str, argv)), cwd=str(cwd),
                    timeoutSeconds=limit, executed=False)
        report['steps'].append(step)
        persist()
        began=time.monotonic(); reason=None; peak=0
        with (out/(name+'.log')).open('xb') as log:
            p=subprocess.Popen(step['argv'], cwd=cwd, env=env, stdout=log,
                               stderr=subprocess.STDOUT, start_new_session=True, preexec_fn=guards)
            own=next(r for r in members(p.pid) if r['pid']==p.pid)
            step.update(pid=p.pid, pgid=p.pid, start=own['start'], executed=True)
            persist(); lastdisk=0
            try:
                while p.poll() is None:
                    now=time.monotonic(); rows=members(p.pid)
                    rss=sum(r['rss'] for r in rows); peak=max(peak,rss)
                    if now-began>limit: reason='phaseWall'
                    elif now-started>1800: reason='totalWall'
                    elif rss>12*GIB: reason='groupRSS'
                    elif available()<4*GIB: reason='hostRAM'
                    elif shutil.disk_usage(out).free<20*GIB: reason='freeReserve'
                    if now-lastdisk>20:
                        size=sum(f.stat().st_size for f in out.rglob('*') if f.is_file())
                        lastdisk=now
                        if size>8*GIB: reason='taskDisk'
                    if reason: raise RuntimeError(name+' bound: '+reason)
                    time.sleep(.25)
            finally:
                if p.poll() is None:
                    current=next((r for r in members(p.pid) if r['pid']==p.pid),None)
                    if current and current['start']==own['start']: os.killpg(p.pid, signal.SIGTERM)
                    try: p.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        current=next((r for r in members(p.pid) if r['pid']==p.pid),None)
                        if current and current['start']==own['start']: os.killpg(p.pid, signal.SIGKILL)
                        p.wait(timeout=5)
                else: p.wait()
                step.update(exit=p.returncode, elapsedSeconds=time.monotonic()-began,
                            peakPolledGroupRSSBytes=peak, stopReason=reason, reaped=True,
                            remainingGroup=members(p.pid), log=pin(out/(name+'.log')))
                persist()
            if p.returncode or step['remainingGroup']:
                raise RuntimeError(name+' failed; retained actual log')
    try:
        record(__file__)
        cgline=next(x for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'))
        cg=Path('/sys/fs/cgroup')/cgline[3:].lstrip('/')
        quotas=[]; counts=[len(os.sched_getaffinity(0))]; fractions=[float(counts[0])]
        while cg.is_relative_to('/sys/fs/cgroup'):
            if (cg/'cpu.max').exists():
                q,period=(cg/'cpu.max').read_text().split()
                quotas.append(dict(path=str(cg/'cpu.max'),value=q+' '+period))
                if q!='max':
                    counts.append(int(q)//int(period)); fractions.append(int(q)/int(period))
            if cg==Path('/sys/fs/cgroup'): break
            cg=cg.parent
        effective=min(counts)
        report['executionEnvironment']=dict(cgroup=cgline, cpuMaxAncestors=quotas,
                                            affinityCount=counts[0], conservativeBuildCpuFloor=effective,
                                            effectiveQuotaCpuFraction=min(fractions),
                                            projectRuntimeCpuSelection=math.ceil(min(fractions)),
                                            BINARYEN_CORES=4)
        if effective<4: raise RuntimeError('four build cores exceed actual quota')
        cmds=json.loads((PLAN/'original-commands.json').read_text())
        original=json.loads((PLAN/'original-actual-linker.json').read_text())
        optimizer=json.loads((PLAN/'original-actual-optimizer.json').read_text())
        for p in PLAN.iterdir():
            if p.is_file(): record(p)
        if optimizer!=['/usr/bin/wasm-opt','../../../dist/bin/gfxtest','-O2','-o','../../../dist/bin/gfxtest']:
            raise RuntimeError('unexpected original optimizer')
        record(optimizer[0]); record(original[0])
        record(TASK/'finalize2/report.json', 'f4edfb3ac3bc91a2bc4d404db1bbc3581660cd62a264369baa5c5da0a8591ed5')
        final=json.loads((TASK/'finalize2/report.json').read_text())
        if not final['passBuild']: raise RuntimeError('accepted native build missing')
        record(TASK/'build4/report.json',final['inputs'][str(TASK/'build4/report.json')]['sha256'])
        native=json.loads((TASK/'build4/report.json').read_text())
        reused=[]
        for name in ('zink_static_vk','guest-icd','gpu-transport'):
            step=next(s for s in native['steps'] if s['name']=='compile-'+name)
            if step['exit'] or not step['reaped']: raise RuntimeError('nonterminal source object')
            obj=Path(step['argv'][step['argv'].index('-o')+1])
            record(obj,final['inputs'][str(obj)]['sha256']); reused.append(str(obj))
        archive=native['mesaNativeCxx']['archive']; record(archive['path'],archive['sha256'])
        builtin=next(r['object'] for r in native['mesaNativeCxx']['members']
                     if Path(r['recipeSource']['path']).name=='builtin_functions.cpp')
        record(builtin['path'],builtin['sha256']); reused.append(builtin['path'])
        egl=MESA/'lib/libEGL_mesa.a'; record(egl,'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8')
        xheaders=[]
        for libname in ('Xrandr','Xfixes'):
            dirs=[Path(x[2:]) for x in original if x.startswith('-L')]
            lib=next(d/('lib'+libname+'.a') for d in dirs if (d/('lib'+libname+'.a')).exists())
            include=lib.parent.parent/'include'
            header=include/'X11/extensions'/('Xrandr.h' if libname=='Xrandr' else 'Xfixes.h')
            record(lib); record(header); xheaders.append(str(include))
        commands=[]; objects=[]
        for argv0 in cmds['compile']:
            argv=argv0[:]; source=Path(argv[-1]); record(source); record(argv[0])
            copy=out/'sources'/source.name; shutil.copyfile(source,copy)
            obj=out/'obj'/(source.stem+'.o'); dep=out/'obj'/(source.stem+'.d')
            argv[argv.index('-o')+1]=str(obj); argv[argv.index('-MF')+1]=str(dep)
            argv[-1]=str(copy); argv+=['-g0']
            # Recovered make commands omit the old implicit C++ header paths.
            # Use exactly the musl paths in authenticated native Mesa recipes.
            for inc in ('/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/wasm32-linux-musl/c++/v1',
                        '/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/c++/v1'):
                if not any(inc in s['argv'] for s in native['steps'] if s['name'].startswith('mesa-cxx-')):
                    raise RuntimeError('header recovery absent from authenticated native recipe')
                header=Path(inc)/('__config_site' if 'wasm32-linux-musl' in inc else 'cstdio')
                record(header)
                argv+=['-isystem',inc]
            for inc in xheaders: argv+=['-I'+inc]
            commands.append(('compile-'+source.stem,argv,CWD,600)); objects.append(str(obj))
            if '-Xclang' not in argv or '-fc++-abi=webassembly' not in argv or '-O2' not in argv:
                raise RuntimeError('missing original native C++ ABI/O2')
        mozva=OBJ/'media/mozva/mozva.o'; record(mozva); objects.append(str(mozva))
        original_list=CWD/'gfxtest.list'; record(original_list)
        if original_list.read_text().splitlines()!=['gfxtest.o','glxtest.o','vaapitest.o','vulkantest.o','../../../media/mozva/mozva.o']:
            raise RuntimeError('unexpected original object closure')
        response=out/'gfxtest.list'; response.write_text('\n'.join(objects)+'\n')
        shim=ROOT/'tools/firefox-gfxtest-static-egl.c'; record(shim)
        copy=out/'sources'/shim.name; shutil.copyfile(shim,copy)
        shimobj=out/'obj/static-egl.o'
        cc=cmds['compile'][0][0].removesuffix('++'); record(cc)
        shimargv=[cc,'-O2','-g0','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections',
                  '-Wall','-Wextra','-Werror','-std=c11','-I'+str(Path('/mnt/p6/build/zink-b3-20260930/mesa-26.2.3/include')),
                  '-MMD','-MF',str(out/'obj/static-egl.d'),'-c',str(copy),'-o',str(shimobj)]
        commands.append(('compile-static-egl',shimargv,out,600))
        baseline=ATOMIC/'firefox-direct-link/command-and-inputs.json'
        record(baseline,final['inputs'][str(baseline)]['sha256'])
        ff=json.loads(baseline.read_text()); selected={r['option']:r['selectedPath'] for r in ff['libraryResolution']}
        accepted_pins={str(Path(r['path']).resolve()):r['sha256'] for r in ff['inputs']}
        runtimes=[x for x in ff['argv'] if '/native-unwind/runtimes-build/lib/lib' in x]
        if len(runtimes)!=3: raise RuntimeError('unexpected native runtime closure')
        dirs=[Path(x[2:]) for x in original if x.startswith('-L')]
        argv=[]; replacements=[]; removed=[];i=0
        while i<len(original):
            x=original[i]
            if x=='-z':
                if original[i+1] not in ('noexecstack','text','relro','now','nocopyreloc'):
                    raise RuntimeError('unrecognized inert -z pair')
                removed.append(original[i:i+2]); i+=2; continue
            if x.startswith('@'): argv.append('@'+str(response))
            elif x=='-lstdc++':
                for lib in runtimes: record(lib,accepted_pins[str(Path(lib).resolve())])
                argv+=runtimes; replacements.append(dict(option=x, paths=runtimes, reason='current159 native C++ runtime; emitted library absent'))
            elif x.startswith('-l'):
                choices=[d/('lib'+x[2:]+'.a') for d in dirs if (d/('lib'+x[2:]+'.a')).exists()]
                if not choices:
                    if x!='-lXau': raise RuntimeError('unresolved original library: '+x)
                    q=Path(selected[x]); record(q,accepted_pins[str(q.resolve())])
                    replacements.append(dict(option=x,paths=[str(q)],reason='same current159 atomic selection; emitted library absent'))
                else: q=choices[0]
                argv.append(record(q)['path'])
            elif x.endswith(('.o','.a')): argv.append(record(CWD/x)['path'])
            else: argv.append(x)
            i+=1
        raw=out/'gfxtest.raw.wasm'; argv[argv.index('-o')+1]=str(raw)
        anchor=argv.index(runtimes[0])
        argv[anchor:anchor]=[str(shimobj),*reused,str(egl),archive['path']]
        argv+=['--wrap=dlopen','--wrap=dlsym','--wrap=dlclose','--strip-debug',
               '--fatal-warnings','--error-limit=0','-Map='+str(out/'gfxtest.map')]
        report['linkChanges']=dict(removedKnownInertZPairs=removed, libraryRecovery=replacements,
                                  loaderWrapper=['dlopen','dlsym','dlclose'], stripDebug=True,
                                  copiedGeckoSourcesChanged=False, originalMemoryTableFlagsRetained=True,
                                  reusedObjects=reused, reusedNativeMesa=archive)
        report['compileRecovery']=dict(originalMissingHeaderFailure=str(TASK/'gfxtest-build1/compile-gfxtest.log'),
            addedSystemIncludeDirs=['/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/wasm32-linux-musl/c++/v1',
                                    '/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/c++/v1'],
            addedXHeaderDirs=xheaders, missingXrandrFailure=str(TASK/'gfxtest-build3/compile-glxtest.log'),
            source='authenticated current native Mesa C++ recipe and current original selected Xrandr/Xfixes libraries', changedOptimization=False,
            historicalHeaderBytePinsAvailable=False,
            headerPinLimit='Prior -MMD excludes system headers; current read-only sysroot bytes pinned now, selected paths authenticated by prior native compile argv')
        commands.append(('link-gfxtest',argv,CWD,600))
        validator='/usr/bin/wasm-validate'; record(validator)
        commands.append(('validate-raw',[validator,'--enable-all',str(raw)],out,180))
        optimized=out/'gfxtest.optimized.wasm'; finalout=out/'gfxtest.fpcast.wasm'
        opt=[optimizer[0],str(optimized),'-O2','-o',str(optimized)]
        fpfile=ATOMIC/'status/fpcast-firefox.json';record(fpfile)
        fp=json.loads(fpfile.read_text())['argv'];fp[fp.index('-o')-1]=str(optimized);fp[fp.index('-o')+1]=str(finalout)
        report['commands']=[dict(name=n,argv=list(map(str,v)),cwd=str(c),timeoutSeconds=l) for n,v,c,l in commands]
        report['commands']+=[dict(name='optimize-gfxtest',argv=opt,cwd=str(out),timeoutSeconds=1200),
                            dict(name='fpcast-gfxtest',argv=fp,cwd=str(out),timeoutSeconds=1200),
                            dict(name='validate-final',argv=[validator,'--enable-all',str(finalout)],cwd=str(out),timeoutSeconds=180)]
        report['prepared']=True;persist()
        if a.prepare_only: return
        for n,v,c,l in commands: run(n,v,c,l)
        for dep in (out/'obj').glob('*.d'):
            # Drop Make's -MP phony lines. First logical line is the real closure.
            line=dep.read_text().replace('\\\n',' ').splitlines()[0]
            for token in shlex.split(line.split(':',1)[1]): record(CWD/token)
        report['rawArtifact']=pin(raw);persist()
        shutil.copyfile(raw,optimized); run('optimize-gfxtest',opt,limit=1200)
        run('fpcast-gfxtest',fp,limit=1200)
        run('validate-final',[validator,'--enable-all',str(finalout)],limit=180)
        report['artifacts']=dict(raw=pin(raw),optimized=pin(optimized),final=pin(finalout))
        for p,row in report['inputs'].items():
            if sha(p)!=row['sha256']: raise RuntimeError('input changed during build: '+p)
        report['passBuild']=True
    except BaseException as e:
        report['error']=type(e).__name__+': '+str(e)
        raise
    finally:
        report['elapsedSeconds']=time.monotonic()-started;persist()

if __name__=='__main__':
    main()
