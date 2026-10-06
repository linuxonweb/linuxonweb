#!/usr/bin/env python3
"""Prepare or execute an isolated current159 relink after two reviewed GPU gates.

Default is read-only preflight. --execute is an explicit owner action; this tool
never launches Firefox/browser, rebuilds Mesa/Rust, changes a package or accepts
Firefox GPU. Gate JSON is a trust boundary: root must review its exact hash and
both independent actual runtime reviews before passing the CLI pins.
"""
import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
TASK = Path('/mnt/p3/codex-build/firefox-gpu-oct06')
PLAN = TASK/'phase2-plan1/plan.json'
PLAN_SHA = 'cdae4b5164c2e8d3c43222f763cb4adf5e79f26e01ca5eb0bd77a0af285f6bdc'
REBIND = TASK/'pipeline-phase1/oracle-rebind1/rebind.json'
REBIND_SHA = '2d6f1fb2e39ea72b33e82d9f9f1404d73df18d38314bbe628c0a458f8265910d'
ADMIT = ROOT/'tools/guest-rootfs/admit-firefox-gpu-pipeline.mjs'
CHECKER = ROOT/'tools/guest-rootfs/check-guest-gpu-pipeline.mjs'
GIB = 1024**3

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def pin(value):
    p = Path(value).resolve(strict=True)
    require(p.is_file(), 'regular input required: '+str(p))
    with p.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    return dict(path=str(p), bytes=p.stat().st_size, sha256=digest)

def authenticate(row):
    actual = pin(row['path'])
    require(all(actual[k] == row[k] for k in ('bytes','sha256')), 'input changed: '+row['path'])
    return actual

def identity(pid):
    try:
        fields=(Path('/proc')/str(pid)/'stat').read_text().rsplit(')',1)[1].split()
        return dict(pid=pid,ppid=int(fields[1]),pgid=int(fields[2]),sid=int(fields[3]),
                    start=int(fields[19]),state=fields[0],rss=int(fields[21])*os.sysconf('SC_PAGE_SIZE'))
    except (FileNotFoundError,ProcessLookupError):
        return None

def members(group):
    rows=[]
    for path in Path('/proc').iterdir():
        if path.name.isdigit():
            row=identity(int(path.name))
            if row is not None and row['pgid']==group:
                rows.append(row)
    return rows

def enable_subreaper():
    # Reap this owner's orphaned descendants after a command leader exits first.
    libc=ctypes.CDLL(None,use_errno=True)
    require(libc.prctl(36,1,0,0,0)==0, 'Linux child-subreaper setup failed')
    value=ctypes.c_int()
    require(libc.prctl(37,ctypes.byref(value),0,0,0)==0 and value.value==1,
            'Linux child-subreaper verification failed')
    return True

def available():
    return int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024

def quota():
    line = next(x for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'))
    here = Path('/sys/fs/cgroup')/line[3:].lstrip('/')
    affinity = len(os.sched_getaffinity(0)); fraction = float(affinity); rows = []
    while here.is_relative_to('/sys/fs/cgroup'):
        if (here/'cpu.max').exists():
            q, period = (here/'cpu.max').read_text().split()
            rows.append(dict(path=str(here/'cpu.max'), value=q+' '+period))
            if q != 'max':
                fraction = min(fraction, int(q)/int(period))
        if here == Path('/sys/fs/cgroup'):
            break
        here = here.parent
    return dict(cgroup=line, affinityCount=affinity, cpuMaxAncestors=rows,
                effectiveQuotaCpuFraction=fraction, projectRuntimeCpuSelection=math.ceil(fraction),
                conservativeBuildCpuFloor=math.floor(fraction), BINARYEN_CORES=4, OMP_NUM_THREADS=1)

def terminal(report, passing=False):
    require(not passing or report.get('passBuild') is True, 'passing native provenance required')
    require(all(not s.get('executed',True) or s.get('reaped') and not s.get('remainingGroup') for s in report['steps']),
            'nonterminal provenance')

def planned_commands(plan, output):
    result = {}
    base = Path(plan['resourcePlan']['output'])
    for name, row in plan['firefoxAndPlugin'].items():
        old = row['acceptedRawLinkArgv']; proposed = row['plannedRawLinkArgv']
        changed = [i for i,(a,b) in enumerate(zip(old,proposed)) if a != b]
        require(len(old)==len(proposed) and changed==row['changedArgvIndices'], 'unreviewed link argv change')
        require(len(changed)==3, 'only ICD, output and map may change')
        require(sum(a==plan['oldIcd']['path'] for a in old)==1 and
                sum(a==plan['replacementIcd']['path'] for a in proposed)==1, 'one actual ICD replacement required')
        require('--fatal-warnings' in proposed and '--error-limit=0' in proposed and '-O0' in proposed,
                'fatal warnings and original link optimization required')
        driver = row['originalDriverArgv']
        require('-O2' in driver and '-Wl,-O0' in driver and '-fc++-abi=webassembly' in driver and
                '--strip-debug' in ' '.join(driver) and 'linux-musl' in driver[0], 'original musl/release/native ABI driver required')
        argv = []
        for i, arg in enumerate(proposed):
            if i == proposed.index('-o')+1:
                require(arg==str(base/(name+'.preoptimizer.wasm')), 'unexpected raw output')
                arg = str(output/(name+'.preoptimizer.wasm'))
            elif arg.startswith('-Map='):
                require(arg=='-Map='+str(base/(name+'.map')), 'unexpected map output')
                arg = '-Map='+str(output/(name+'.map'))
            argv.append(arg)
        optimized = output/(name+'.optimized.wasm'); final = output/(name+'.fpcast.wasm')
        require(row['optimizerOriginal']==['/usr/bin/wasm-opt',driver[driver.index('-o')+1],'-O2','-o',driver[driver.index('-o')+1]],
                'original in-place optimizer required')
        fp = row['fpcastOriginal']
        require(len(fp)==8 and fp[:5]==['/usr/bin/wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23','--fpcast-emu'] and fp[6]=='-o',
                'original fpcast23 required')
        result[name] = dict(link=argv, cwd=row['cwd'], trace=[driver[0],'-###',*driver[1:]],
                            optimize=[row['optimizerOriginal'][0],str(optimized),'-O2','-o',str(optimized)],
                            fpcast=[*fp[:5],str(optimized),'-o',str(final)])
    require(set(result)=={'firefox','plugin-container'}, 'exact two native executables required')
    return result

def wasm_sections(value):
    # Read section framing, not arbitrary debug strings in code/data/name bytes.
    def uleb(f):
        result = 0
        for shift in range(0,35,7):
            b = f.read(1); require(bool(b), 'truncated wasm integer'); v = b[0]; result |= (v&127)<<shift
            if not v&128:
                return result
        raise RuntimeError('invalid wasm integer')
    sections = []
    with Path(value).open('rb') as f:
        require(f.read(8)==b'\0asm\1\0\0\0', 'valid core wasm required')
        while True:
            kind = f.read(1)
            if not kind:
                break
            length = uleb(f); end = f.tell()+length
            require(end<=Path(value).stat().st_size, 'truncated wasm section')
            if kind[0]==0:
                n = uleb(f); require(n<=length and n<4096, 'bounded custom section name required')
                name = f.read(n).decode('utf8'); require(not name.startswith('.debug'), 'DWARF forbidden')
                sections.append(name)
            f.seek(end)
    return sections

class Executor:
    def __init__(self, output, execute):
        self.out = output; self.execute = execute; self.began = time.monotonic(); self.gate_pins = []; self.stop_signal = None; self.old_handlers = {}
        subreaper=enable_subreaper()
        self.report = dict(schema=1,passBuild=False,passPreflight=False,candidateOnly=True,gpuAcceptance=False,
                           guestAcceptance=False,firefoxGpuAcceptance=False,inputs={},steps=[],artifacts={},
                           executionAuthorized=execute,childSubreaper=subreaper,limits=dict(totalWallSeconds=4800,linkWallSeconds=600,
                           perOriginalOptimizerWallSeconds=1800,ASBytes=16*GIB,groupRSSBytes=12*GIB,
                           taskDiskBytes=8*GIB,diskCapScope=str(output),retainedInputsCountedAgainstDiskCap=False,
                           diskReserveBytes=20*GIB,hostAvailableFloorBytes=4*GIB,binaryenWorkers=4))
        self.env = dict(os.environ,TMPDIR=str(output/'t'),TMP=str(output/'t'),TEMP=str(output/'t'),
                        XDG_CACHE_HOME=str(output/'t'),PYTHONDONTWRITEBYTECODE='1',BINARYEN_CORES='4',OMP_NUM_THREADS='1')
    def persist(self):
        (self.out/'report.json').write_text(json.dumps(self.report,indent=2)+'\n')
    def request_stop(self,signum,frame):
        # A flag cannot interrupt Popen identity capture, receipt writes or drain.
        self.stop_signal=signum
    def install_signal_handlers(self):
        for signum in (signal.SIGTERM,signal.SIGINT):
            self.old_handlers[signum]=signal.signal(signum,self.request_stop)
    def restore_signal_handlers(self):
        for signum,handler in self.old_handlers.items():
            signal.signal(signum,handler)
    def record(self,row):
        require(self.stop_signal is None,'owner stop requested: '+str(self.stop_signal))
        current = authenticate(row); self.report['inputs'][current['path']] = current
        return current
    def guard(self):
        require(self.stop_signal is None,'owner stop requested: '+str(self.stop_signal))
        require(time.monotonic()-self.began<4800, 'total wall bound')
        require(available()>=4*GIB, 'host available RAM floor')
        require(shutil.disk_usage(self.out).free>=20*GIB, 'disk reserve')
        size = sum(p.stat().st_size for p in self.out.rglob('*') if p.is_file())
        require(size<=8*GIB, 'fresh output disk bound'); self.report['outputBytes'] = size
    def gate_unchanged(self):
        require(self.report.get('pipelineAdmission') is not None, 'both actual gates must precede native execution')
        for row in self.gate_pins:
            self.record(row)
    def run(self,name,argv,cwd=ROOT,limit=180,native=False):
        if native:
            require(self.execute, 'native execution requires explicit --execute')
            self.gate_unchanged()
        self.guard();step=dict(name=name,argv=list(map(str,argv)),cwd=str(cwd),timeoutSeconds=limit,executed=False)
        self.report['steps'].append(step);self.persist();start=time.monotonic();known={};peak=0;reason=None;p=None
        cleanup=dict(signals=[],adoptedChildrenReaped=[],TERMGraceSeconds=3,KILLDrainSeconds=5)
        def snapshot():
            rows=members(p.pid)
            by_pid={row['pid']:row for row in rows}
            for row in rows:
                require(row['pgid']==p.pid and row['sid']==p.pid,'owned command PGID/SID changed')
                if row['pid'] in known:
                    require(all(row[k]==known[row['pid']][k] for k in ('pid','start','pgid','sid')),
                            'owned command PID/start/PGID/SID changed')
                else:
                    # Same live session/group plus a lineage to this owner or an
                    # authenticated member proves a newly observed descendant.
                    parent=row['ppid'];seen={row['pid']}
                    while parent not in known and parent!=os.getpid():
                        require(parent in by_pid and parent not in seen,'unowned command descendant')
                        seen.add(parent);parent=by_pid[parent]['ppid']
                    known[row['pid']]=row.copy()
            return rows
        def reap_adopted():
            for pid,prior in list(known.items()):
                if pid==p.pid:
                    continue
                current=identity(pid)
                if current is None:
                    continue
                require(all(current[k]==prior[k] for k in ('pid','start','pgid','sid')),'adopted child identity changed')
                try:
                    reaped,status=os.waitpid(pid,os.WNOHANG)
                except ChildProcessError:
                    continue
                if reaped:
                    cleanup['adoptedChildrenReaped'].append(dict(pid=pid,start=prior['start'],pgid=prior['pgid'],sid=prior['sid'],waitStatus=status))
        def signal_group(signum):
            rows=snapshot()
            if rows:
                # Snapshot verifies every member's PID/start/PGID/SID immediately
                # before signalling exactly the launched command's group.
                os.killpg(p.pid,signum)
                cleanup['signals'].append(dict(signal=signum,members=rows))
        def drain():
            if p is None:
                return
            if p.pid not in known:
                leader=identity(p.pid)
                require(leader is not None and leader['pgid']==p.pid and leader['sid']==p.pid and leader['ppid']==os.getpid(),
                        'recoverable launched leader identity required')
                known[p.pid]=leader.copy();step.update(pid=p.pid,pgid=leader['pgid'],sid=leader['sid'],start=leader['start'],executed=True,launchIdentityRecovered=True)
            snapshot();p.poll();reap_adopted()
            if p.returncode is not None and not snapshot():
                return
            signal_group(signal.SIGTERM)
            deadline=time.monotonic()+cleanup['TERMGraceSeconds']
            while time.monotonic()<deadline:
                snapshot();p.poll();reap_adopted()
                if p.returncode is not None and not snapshot():
                    return
                time.sleep(.05)
            # KILL is based on the remaining group, even when the leader was
            # already reaped and p.wait() would return immediately.
            signal_group(signal.SIGKILL)
            deadline=time.monotonic()+cleanup['KILLDrainSeconds']
            while time.monotonic()<deadline:
                snapshot();p.poll();reap_adopted()
                if p.returncode is not None and not snapshot():
                    return
                time.sleep(.05)
            require(p.returncode is not None and not snapshot(),'owned leader/group failed bounded drain')
        def guards():
            for k,v in [(resource.RLIMIT_AS,(16 if native else 2)*GIB),(resource.RLIMIT_CPU,6000 if native else 90),(resource.RLIMIT_FSIZE,4*GIB if native else 256*1024**2),(resource.RLIMIT_CORE,0)]:
                resource.setrlimit(k,(v,v))
        with (self.out/(name+'.log')).open('xb') as log:
            try:
                # Acquisition and persistence are protected too: any exception
                # after Popen returns still drains the owned command session.
                p=subprocess.Popen(step['argv'],cwd=cwd,env=self.env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=guards)
                step.update(pid=p.pid,executed=True)
                own=identity(p.pid)
                require(own is not None and own['ppid']==os.getpid() and own['pgid']==p.pid and own['sid']==p.pid,
                        'exact launched PID/start/PGID/SID required')
                known[p.pid]=own.copy();step.update(pid=p.pid,pgid=own['pgid'],sid=own['sid'],start=own['start'],executed=True);self.persist()
                while p.poll() is None:
                    rows=snapshot();rss=sum(x['rss'] for x in rows);peak=max(peak,rss)
                    require(time.monotonic()-start<limit,name+': step wall bound')
                    require(rss<=(12 if native else 2)*GIB,name+': group RSS bound');self.guard();time.sleep(.2)
            except BaseException as e:
                reason=repr(e);raise
            finally:
                try:
                    drain()
                finally:
                    rows=members(p.pid) if p is not None else []
                    step.update(exit=p.returncode if p is not None else None,reaped=p is not None and p.returncode is not None,
                                remainingGroup=rows,elapsedSeconds=time.monotonic()-start,peakGroupRSSBytes=peak,
                                stopReason=reason,ownerStopSignal=self.stop_signal,cleanup=cleanup,
                                authenticatedMemberIdentities=list(known.values()),log=pin(self.out/(name+'.log')))
                    self.persist()
        require(p.returncode==0 and not step['remainingGroup'] and reason is None and self.stop_signal is None and not cleanup['signals'],
                name+' failed or required forced cleanup; preserve fresh output')

    def admission(self,a,plan):
        require(re.fullmatch('[a-f0-9]{64}',a.gates_sha256) is not None,'exact reviewed gate hash required')
        evidence=pin(a.gates);require(evidence['sha256']==a.gates_sha256 and evidence['bytes']<=65536 and
            Path(evidence['path']).is_relative_to('/mnt/p3/codex-build/'), 'reviewed bounded disk gate evidence required')
        for file,digest in [(ADMIT,a.admission_sha256),(CHECKER,a.checker_sha256)]:
            current=pin(file);require(current['sha256']==digest,'reviewed admission/checker code changed');self.gate_pins.append(self.record(current))
        self.gate_pins.append(self.record(evidence))
        js="import {admitFirefoxGpuPipeline} from '"+ADMIT.as_uri()+"'; const value=await admitFirefoxGpuPipeline(process.argv[1]); console.log(JSON.stringify({review:value.review,pins:value.pins}));"
        self.record(pin(shutil.which('node')))
        self.run('admit-two-actual-pipeline-gates',['node','--max-old-space-size=256','--disable-wasm-trap-handler','--input-type=module','-e',js,evidence['path']],limit=120)
        accepted=json.loads((self.out/'admit-two-actual-pipeline-gates.log').read_text())
        review=accepted['review'];require(review['evidence']==evidence,'gate evidence identity changed')
        require(review['pipelineStateProfile']==1 and review['testOnly'] is True and review['firefoxGpuAcceptance'] is False and
                {r['backend'] for r in review['gates']}=={'webgpu','webgl'}, 'two actual distinct primitive gates required')
        pkgrow=self.record(review['package']);pkg=json.loads(Path(pkgrow['path']).read_text())
        require(pkg['candidateHostBuild']==plan['candidateHostReport'], 'gates must test exact replacement ICD/Rust build1')
        for row in pkg['stableV1Pins']:self.gate_pins.append(self.record(row))
        host=json.loads(Path(plan['candidateHostReport']['path']).read_text());artifacts={Path(r['path']).name:r for r in host['artifacts']}
        for name in ['bridge.mjs','graphics-renderer.mjs','guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm']:
            r=pkg['candidateRuntime']['files'][name];require(all(r[k]==artifacts[name][k] for k in ['bytes','sha256']),'gate runtime differs from candidate native build')
        for row in [review['package'],*[dict(path=r['path'],bytes=r['bytes'],sha256=r['sha256']) for r in review['gates']],*[r['review'] for r in review['gates']],
                    *[dict(path=r['source'],bytes=r['bytes'],sha256=r['sha256']) for r in accepted['pins']]]:
            self.gate_pins.append(self.record(row))
        self.report['pipelineAdmission']=accepted;self.persist()

    def source_inputs(self,plan):
        self.record(dict(path=str(PLAN),bytes=PLAN.stat().st_size,sha256=PLAN_SHA))
        prior=self.record(plan['finalizedNativeReport']);finalized=json.loads(Path(prior['path']).read_text());terminal(finalized,True)
        hostrow=self.record(plan['candidateHostReport']);host=json.loads(Path(hostrow['path']).read_text());terminal(host,True)
        require(len(plan['unchangedOriginalNativeInputs'])==2692 and len(plan['unchangedMesaNativeObjects'])==61 and
                plan['undefinedExternalSymbolsEqual'] is True,'exact authenticated native input closure required')
        old_sources={r['original']['path']:r for r in plan['sourceReplacementClosure']}
        for old in old_sources.values():
            self.record(old['originalRetained']);self.record(old['candidate'])
        # Historical native source rows bind to retained original bytes, while
        # the replacement object binds to its immutable candidate source build.
        for path,row in finalized['inputs'].items():
            if path in old_sources:
                old=old_sources[path];require(all(row[k]==old['original'][k] for k in ['bytes','sha256']),'unexpected historical ICD source')
                require(all(old['originalRetained'][k]==row[k] for k in ['bytes','sha256']),'old ICD source copy differs')
            else:self.record(row)
        build4row=plan['firefoxAndPlugin']['firefox']['acceptedRawLinkReport'];build4=json.loads(Path(self.record(build4row)['path']).read_text());terminal(build4)
        frozen=pin(TASK/'build4-script-frozen.py');recipe=build4['inputs'][str(ROOT/'tools/build-firefox-nightly-gpu.py')]
        require(all(frozen[k]==recipe[k] for k in ['bytes','sha256']),'historical build4 recipe differs');self.record(frozen)
        self.report['originalNativeRecipe']=frozen
        rebind=json.loads(Path(self.record(dict(path=str(REBIND),bytes=REBIND.stat().st_size,sha256=REBIND_SHA))['path']).read_text())
        require(rebind['hostBuild']==plan['candidateHostReport'],'fixture rebind host mismatch')
        test_control=str(ROOT/'web/linux/tests/guest-vulkan-pipeline/source-controls.mjs')
        allowed=next(r for r in rebind['deltas'] if r['original']['path']==test_control)
        self.record(allowed['historicalFrozen']);self.record(allowed['current'])
        require(all(allowed['historicalFrozen'][k]==allowed['original'][k] for k in ['bytes','sha256']),'historical test controls differ')
        for row in plan['candidateCompleteSourceInputs']:
            if row['path']==test_control:
                require(row==allowed['original'],'only exact reviewed old control pin may rebind')
            else:self.record(row)
        for row in host['artifacts']:
            self.record(row)
        for key in ['unchangedOriginalNativeInputs','unchangedMesaNativeObjects','unchangedCompatibilityObjects','undefinedSymbolReceipts']:
            for row in plan[key]:self.record(row)
        for key in ['oldIcd','replacementIcd','unchangedMesaArchive']:self.record(plan[key])
        self.report.update(sourceRebind=dict(manifest=pin(REBIND),historicalControl=allowed['original'],retainedControl=allowed['historicalFrozen'],currentControl=allowed['current']),
                           originalNativeInputUnion=2692,originalNativeInputUnionBytes=plan['originalNativeInputUnionBytes'],
                           mesaNativeCxx=dict(archive=plan['unchangedMesaArchive'],members=plan['unchangedMesaNativeObjects'],count=61,ABI='webassembly',originalOptimization='-O3',unchanged=True),
                           unchangedCompatibilityObjects=plan['unchangedCompatibilityObjects'],nativeReplacement=dict(original=plan['oldIcd'],candidate=plan['replacementIcd'],onlyNativeObjectReplaced=True),
                           reusedBuild=dict(report=build4row,finalizedNativeReport=prior,rebuiltNativeObjects=False,repeatedNativeLinks=True))
        self.guard();self.persist()

    def execute_links(self,plan,commands):
        for name,c in commands.items():
            authority=json.loads(Path(self.record(plan['firefoxAndPlugin'][name]['authority'])['path']).read_text())
            require(authority['originalDriverArgv']==plan['firefoxAndPlugin'][name]['originalDriverArgv'],'original driver changed')
            original=plan['firefoxAndPlugin'][name];receipt=json.loads(Path(self.record(original['acceptedRawLinkReport'])['path']).read_text())
            accepted=next(s for s in receipt['steps'] if s['name']=='link-'+name)
            require(accepted['argv']==original['acceptedRawLinkArgv'] and accepted['exit']==0 and accepted['reaped'] and not accepted['remainingGroup'],'accepted actual link differs')
            self.record(pin(c['link'][0]));self.record(pin(c['trace'][0]));self.record(pin(c['optimize'][0]));self.record(pin('/usr/bin/wasm-validate'));self.record(pin('/usr/bin/wasm-objdump'))
            fpfile=Path(original['authority']['path']).parents[1]/'status'/('fpcast-'+name+'.json')
            self.record(pin(fpfile));require(json.loads(fpfile.read_text())['argv']==original['fpcastOriginal'],'recorded fpcast differs')
            for row in original['unchangedNativeInputs']:self.record(row)
            self.run('trace-original-driver-'+name,c['trace'],Path(c['cwd']),30,native=True)
            trace=(self.out/('trace-original-driver-'+name+'.log')).read_text();expected=original['optimizerOriginal']
            import shlex
            rows=[shlex.split(line) for line in trace.splitlines() if line.startswith(' "')]
            require(expected in rows,'actual original automatic optimizer trace differs')
            self.run('link-'+name,c['link'],Path(c['cwd']),600,native=True)
            raw=self.out/(name+'.preoptimizer.wasm');self.run('validate-raw-'+name,['/usr/bin/wasm-validate','--enable-all',raw],limit=180,native=True)
            optimized=self.out/(name+'.optimized.wasm');shutil.copyfile(raw,optimized)
            self.run('optimize-'+name,c['optimize'],limit=1800,native=True)
            self.run('fpcast-'+name,c['fpcast'],limit=1800,native=True)
            final=self.out/(name+'.fpcast.wasm');self.run('validate-final-'+name,['/usr/bin/wasm-validate','--enable-all',final],limit=180,native=True)
            custom=wasm_sections(final)
            self.run('abi-imports-'+name,['/usr/bin/wasm-objdump','-x','-j','Import',final],limit=180,native=True)
            imports=re.findall(r' <- (\S+)',(self.out/('abi-imports-'+name+'.log')).read_text())
            require(set(imports)=={'env.memory','linux.syscall','linux.get_thread_area','linux.copy_siginfo'},'unexpected native imports')
            self.report['artifacts'][name]=dict(raw=pin(raw),optimized=pin(optimized),final=pin(final))
            self.report.setdefault('nativeAbi',{})[name]=dict(validated=True,imports=imports,customSections=custom,noDWARF=True,musl=True,fpcastMaxFuncParams=23,originalOptimizer=True)
            self.persist()
        # Confirm no admitted bytes or unchanged input changed while building.
        self.gate_unchanged()
        for row in list(self.report['inputs'].values()):authenticate(row)
        self.report['passBuild']=True

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--gates',type=Path,required=True,help='root-reviewed schema2 actual two-backend evidence')
    ap.add_argument('--gates-sha256',required=True)
    ap.add_argument('--admission-sha256',required=True,help='root-reviewed exact admit module hash')
    ap.add_argument('--checker-sha256',required=True,help='root-reviewed exact checker hash')
    ap.add_argument('--execute',action='store_true',help='explicit owner action after both actual gates pass')
    a=ap.parse_args();out=a.output.absolute()
    require(not out.exists() and not out.is_symlink() and out.parent==out.parent.resolve(strict=True) and out.parent.is_relative_to(TASK),
            'fresh output under canonical persistent task parent required')
    require(pin(PLAN)['sha256']==PLAN_SHA,'exact read-only phase2 plan required')
    out.mkdir();(out/'t').mkdir();x=Executor(out,a.execute);x.install_signal_handlers()
    try:
        x.report['inputs'][str(Path(__file__).resolve())]=pin(__file__)
        x.report['storage']=dict(filesystem=subprocess.check_output(['findmnt','-n','-o','SOURCE,FSTYPE','-T',out],text=True).strip(),freeBytes=shutil.disk_usage(out).free)
        require(not any(s in x.report['storage']['filesystem'] for s in ['tmpfs','ramfs']),'disk-backed output required')
        x.report['executionEnvironment']=quota();require(x.report['executionEnvironment']['effectiveQuotaCpuFraction']>=4,'four optimizer workers require actual quota')
        plan=json.loads(PLAN.read_text());commands=planned_commands(plan,out);x.report['plannedCommands']=commands;x.persist()
        x.admission(a,plan)  # Always first: no native trace, link or optimizer before admission.
        x.source_inputs(plan);x.report['passPreflight']=True;x.persist()
        if a.execute:x.execute_links(plan,commands)
    except BaseException as e:x.report['error']=repr(e)
    finally:
        x.report['elapsedSeconds']=time.monotonic()-x.began;x.report['ownerStopSignal']=x.stop_signal;x.persist();x.restore_signal_handlers()
    print(json.dumps(dict(report=pin(out/'report.json'),passPreflight=x.report['passPreflight'],passBuild=x.report['passBuild'],error=x.report.get('error'))))
    return 0 if (x.report['passBuild'] if a.execute else x.report['passPreflight']) else 1

if __name__=='__main__':
    raise SystemExit(main())
