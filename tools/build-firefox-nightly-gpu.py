#!/usr/bin/env python3
"""Isolated current Nightly159 EGL/Zink link; never a GPU acceptance claim."""
import argparse
import hashlib
import json
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
ATOMIC = Path('/mnt/p6/build/firefox-atomic-observer-package-20261004/transform')
MESA = Path('/mnt/p6/build/glgears-zink-20261001/link/egl2')
MESA_SOURCE = Path('/mnt/p6/build/zink-b3-20260930/mesa-26.2.3')
HEADERS = Path('/mnt/p6/build/gpu-host-p1-20261001/graphics-build-run1/headers-source/include')
CC = '/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
GIB = 1024**3
LIB_PINS = {
 'libEGL_mesa.a': 'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8',
 'libGLESv2_mesa.a': '77d10b095649bc5c24cb89cee6e5990e3cf6b4a7fee23bae62a531d51b0e4cba',
 'libgallium_zink.a': 'c7216add6a70a2a3d94ccae7eefbbd9e7884e1cb2af2c4d257536de15a6b88aa',
}

def sha(p):
 with Path(p).open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()

def pin(p):
 p=Path(p).resolve(strict=True)
 return {'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)}

def members(pgid):
 rows=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit(): continue
  try:
   s=(p/'stat').read_text().rsplit(')',1)[1].split()
   if int(s[2])==pgid: rows.append({'pid':int(p.name),'start':int(s[19]),'state':s[0],'rss':int(s[21])*os.sysconf('SC_PAGE_SIZE')})
  except (OSError,ValueError,IndexError): pass
 return rows

def available():
 return int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024

def finalize_candidate(source,out,manifests,report,record,run):
 source=source.resolve(strict=True)
 if not source.is_relative_to(TASK) or source==out:raise RuntimeError('isolated existing source required')
 source_report=source/'report.json';record(source_report);old=json.loads(source_report.read_text())
 if any(s.get('executed') and (not s.get('reaped') or s.get('remainingGroup')) for s in old['steps']):raise RuntimeError('source build is not terminal/reaped')
 source_inputs=old['inputs'];source_raws=old.get('rawArtifacts',{})
 if source.name not in ('build4','finalize1'):raise RuntimeError('unrecognized authenticated reuse source')
 if source.name=='finalize1':
  frozen_final=TASK/'finalize1-script-frozen.py';record(frozen_final,source_inputs[str(Path(__file__).resolve())]['sha256'])
  base=TASK/'build4'/'report.json';record(base,source_inputs[str(base)]['sha256']);old=json.loads(base.read_text())
  report['reusedFinalization']={'report':pin(source_report),'recipe':pin(frozen_final),'rawArtifacts':source_raws,'priorFailure':json.loads(source_report.read_text())['error']}
 for p,row in source_inputs.items():
  if p!=str(Path(__file__).resolve()):record(p,row['sha256'])
 stopfile=TASK/'build4-optimizer-stop-receipt.json';record(stopfile);stop=json.loads(stopfile.read_text())
 if not stop['validated']:raise RuntimeError('unvalidated reuse source')
 frozen=TASK/'build4-script-frozen.py';oldscript=old['inputs'][str(Path(__file__).resolve())]
 record(frozen,oldscript['sha256'])
 for p,row in old['inputs'].items():
  if p!=str(Path(__file__).resolve()):record(p,row['sha256'])
 report['reusedBuild']={'report':pin(TASK/'build4'/'report.json'),'originalRecipe':pin(frozen),'optimizerCorrection':True,'rebuiltNativeObjects':False,'repeatedNativeLinks':False}
 objects=[]
 for name in ('zink-egl-static','zink_static_vk','guest-icd','gpu-transport'):
  step=next(s for s in old['steps'] if s['name']=='compile-'+name)
  if step['exit']!=0:raise RuntimeError('source compile failed')
  obj=Path(step['argv'][step['argv'].index('-o')+1]);record(obj);objects.append(str(obj))
 native=old['mesaNativeCxx'];archive=native['archive'];record(archive['path'],archive['sha256'])
 if len(native['members'])!=61:raise RuntimeError('native Mesa closure changed')
 for entry in native['members']:
  record(entry['object']['path'],entry['object']['sha256'])
  if Path(entry['recipeSource']['path']).name=='builtin_functions.cpp':builtin=entry['object']['path']
 objects.append(builtin);libs=[str(MESA/'lib/libEGL_mesa.a'),archive['path']]
 for lib in libs:record(lib)
 raws={}
 for name,d in manifests.items():
  raw=out/(name+'.preoptimizer.wasm')
  if name in source_raws or name=='firefox':
   prior=source_raws[name] if name in source_raws else stop['raw'];record(prior['path'],prior['sha256']);shutil.copyfile(prior['path'],raw)
   if name in source_raws:
    validation=next(s for s in json.loads(source_report.read_text())['steps'] if s['name']=='validate-raw-'+name)
    if validation['exit']!=0:raise RuntimeError('prior raw validation failed')
   report['reusedBuild'][name+'Raw']=prior
  else:
   controlfile=ATOMIC/(name+'-direct-link')/'fatal-control-command.json';record(controlfile)
   control=json.loads(controlfile.read_text())
   if control['exactInputManifestSHA256']!=sha(ATOMIC/(name+'-direct-link')/'command-and-inputs.json'):raise RuntimeError('link input parent changed')
   if sorted(r['arguments'][1] for r in control['removedKnownInertZPairs'])!=sorted(['noexecstack','text','relro','now','nocopyreloc']):raise RuntimeError('unknown baseline normalization')
   resolution={r['option']:r['selectedPath'] for r in d['libraryResolution']}
   argv=[resolution.get(x,x) for x in control['argv']];argv[argv.index('-o')+1]=str(raw)
   anchor=next(i for i,x in enumerate(argv) if x.endswith('/native-unwind/runtimes-build/lib/libc++.a'))
   argv[anchor:anchor]=objects+libs;argv+=['--fatal-warnings','--error-limit=0','-Map='+str(out/(name+'.map'))]
   run('link-'+name,argv,Path(d['cwd']))
  run('validate-raw-'+name,['/usr/bin/wasm-validate','--enable-all',str(raw)],limit=180);raws[name]=raw
  report.setdefault('rawArtifacts',{})[name]=pin(raw)
 for name,d in manifests.items():
  original=d['originalDriverArgv'];run('trace-original-optimizer-'+name,[original[0],'-###',*original[1:]],Path(d['cwd']),limit=30)
  rows=[shlex.split(line) for line in (out/('trace-original-optimizer-'+name+'.log')).read_text().splitlines() if line.startswith(' "')]
  opt=next(row for row in rows if Path(row[0]).name=='wasm-opt');driverout=original[original.index('-o')+1]
  if opt[1:]!=[driverout,'-O2','-o',driverout]:raise RuntimeError('original optimizer unexpectedly changed')
  record(opt[0]);optimized=out/(name+'.optimized.wasm');shutil.copyfile(raws[name],optimized)
  run('optimize-'+name,[opt[0],str(optimized),'-O2','-o',str(optimized)])
  fpfile=ATOMIC/'status'/('fpcast-'+name+'.json');record(fpfile);fp=json.loads(fpfile.read_text())['argv']
  fp[fp.index('-o')-1]=str(optimized);final=out/(name+'.fpcast.wasm');fp[fp.index('-o')+1]=str(final);record(fp[0])
  run('fpcast-'+name,fp);run('validate-final-'+name,['/usr/bin/wasm-validate','--enable-all',str(final)],limit=180)
  report.setdefault('artifacts',{})[name]={'raw':pin(raws[name]),'optimized':pin(optimized),'final':pin(final)}

def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--output',type=Path,required=True)
 ap.add_argument('--finalize-existing',type=Path,help='Reuse authenticated terminal raw link and native Mesa objects; apply exact original optimizer')
 ap.add_argument('--phase-wall',type=int,default=900)
 ap.add_argument('--total-wall',type=int,default=3600)
 ap.add_argument('--binaryen-cores',type=int,default=1)
 ap.add_argument('--with-gles',action='store_true',help='Include GLES archive for a separate diagnostic comparison')
 ap.add_argument('--rebuild-mesa-cxx',action='store_true',help='Recompile every retained Gallium C++ member for the current native ABI')
 a=ap.parse_args(); out=a.output.resolve()
 affinity=len(os.sched_getaffinity(0));quotaRows=[];effective=float(affinity)
 cgline=next(x for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'));cg=Path('/sys/fs/cgroup')/cgline[3:].lstrip('/')
 for folder in [cg,*cg.parents]:
  q=folder/'cpu.max'
  if q.exists():
   values=q.read_text().split();quota=None if values[0]=='max' else int(values[0])/int(values[1]);quotaRows.append({'path':str(q),'value':values,'quotaCpus':quota})
   if quota is not None:effective=min(effective,quota)
 if not(1<=a.binaryen_cores<=int(effective)) or not(1<=a.phase_wall<=1800 and a.phase_wall<=a.total_wall<=4800):ap.error('finite authorized bounds and cores within actual quota required')
 if out==TASK or not out.is_relative_to(TASK) or out.exists(): ap.error('fresh p3 task child required')
 if TASK.resolve()!=TASK or shutil.disk_usage(TASK.parent).free<20*GIB: ap.error('persistent canonical task root and20GiB reserve required')
 out.mkdir(parents=True); (out/'tmp').mkdir(); (out/'obj').mkdir(); (out/'sources').mkdir()
 env={**os.environ,'TMPDIR':str(out/'tmp'),'TMP':str(out/'tmp'),'TEMP':str(out/'tmp'),'BINARYEN_CORES':str(a.binaryen_cores),'OMP_NUM_THREADS':'1','PYTHONDONTWRITEBYTECODE':'1'}
 report={'passBuild':False,'candidateOnly':True,'gpuAcceptance':False,'guestAcceptance':False,'inputs':{},'steps':[],'withGlesArchive':a.with_gles,'limits':{'phaseWallSeconds':a.phase_wall,'totalWallSeconds':a.total_wall,'ASBytes':16*GIB,'groupRSSBytes':12*GIB,'taskDiskBytes':8*GIB,'diskReserveBytes':20*GIB,'hostAvailableFloorBytes':4*GIB}}
 report['limits']['diskCapScope']=str(out)
 report['limits']['retainedInputsCountedAgainstDiskCap']=False
 report['executionEnvironment']={'BINARYEN_CORES':a.binaryen_cores,'OMP_NUM_THREADS':1,'inheritedBINARYEN_CORES':os.environ.get('BINARYEN_CORES'),'affinityCount':affinity,'cgroup':cgline,'cpuMaxAncestors':quotaRows,'effectiveBuildCpus':effective}
 started=time.monotonic(); checked={}
 def record(p,expected=None):
  p=Path(p).resolve(strict=True)
  if str(p) not in checked: checked[str(p)]=pin(p)
  row=checked[str(p)]
  if expected is not None and row['sha256']!=expected: raise RuntimeError('input hash changed: '+str(p))
  report['inputs'][str(p)]=row
  return row
 def persist(): (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 def guards():
  resource.setrlimit(resource.RLIMIT_AS,(16*GIB,16*GIB));resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(4*GIB,4*GIB))
  Path('/proc/self/oom_score_adj').write_text('1000')
 def run(name,argv,cwd=ROOT,limit=None):
  if limit is None:limit=a.phase_wall
  if available()<4*GIB: raise RuntimeError('host RAM floor before '+name)
  step={'name':name,'argv':list(map(str,argv)),'cwd':str(cwd),'timeoutSeconds':limit,'executed':False}
  report['steps'].append(step); persist(); began=time.monotonic();reason=None;peak=0
  with (out/(name+'.log')).open('xb') as log:
   p=subprocess.Popen(step['argv'],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=guards)
   own=next(r for r in members(p.pid) if r['pid']==p.pid);step.update(pid=p.pid,pgid=p.pid,start=own['start'],executed=True);persist(); lastdisk=0
   try:
    while p.poll() is None:
     rows=members(p.pid);rss=sum(r['rss'] for r in rows);peak=max(peak,rss);now=time.monotonic()
     if now-began>limit: reason='phaseWall'
     elif now-started>a.total_wall: reason='totalWall'
     elif rss>12*GIB: reason='groupRSS'
     elif available()<4*GIB: reason='hostRAM'
     elif shutil.disk_usage(out).free<20*GIB: reason='freeReserve'
     if now-lastdisk>20:
      size=int(subprocess.check_output(['du','-sx','--block-size=1',str(out)],env=env,timeout=30).split()[0]);lastdisk=now
      if size>8*GIB: reason='taskDisk'
     if reason: raise RuntimeError(name+' bound: '+reason)
     time.sleep(.25)
   finally:
    if p.poll() is None:
     current=next((r for r in members(p.pid) if r['pid']==p.pid),None)
     if current and current['start']==own['start']: os.killpg(p.pid,signal.SIGTERM)
     try:p.wait(timeout=5)
     except subprocess.TimeoutExpired:
      current=next((r for r in members(p.pid) if r['pid']==p.pid),None)
      if current and current['start']==own['start']: os.killpg(p.pid,signal.SIGKILL)
      p.wait(timeout=5)
    else:p.wait()
    step.update(exit=p.returncode,elapsedSeconds=time.monotonic()-began,peakPolledGroupRSSBytes=peak,stopReason=reason,reaped=True,remainingGroup=members(p.pid),log=pin(out/(name+'.log')));persist()
   if p.returncode or step['remainingGroup']: raise RuntimeError(name+' failed; see retained log')
 try:
  record(Path(__file__))
  manifests={}
  for name in ('firefox','plugin-container'):
   p=ATOMIC/(name+'-direct-link')/'command-and-inputs.json'; record(p)
   d=json.loads(p.read_text());manifests[name]=d
   if d['suppressorOptions']: raise RuntimeError('baseline has suppressed link warnings')
   for row in d['inputs']: record(row['path'],row['sha256'])
   record(d['linker']['path'],d['linker']['sha256'])
  if a.finalize_existing:
   finalize_candidate(a.finalize_existing,out,manifests,report,record,run)
  else:
   libs=[]
   for name,h in LIB_PINS.items():
    record(MESA/'lib'/name,h)
    if name!='libGLESv2_mesa.a' or a.with_gles: libs.append(str(MESA/'lib'/name))
   flags=['-O2','-g0','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-Wall','-Wextra','-Werror','-std=c11','-I'+str(HEADERS),'-I'+str(MESA_SOURCE/'include')]
   objects=[]
   sources={'zink-egl-static':ROOT/'web/linux/firefox-shims/zink-egl-static.c','zink_static_vk':ROOT/'tools/zink/shims/zink_static_vk.c','guest-icd':ROOT/'web/linux/tests/guest-vulkan/icd.c','gpu-transport':ROOT/'web/linux/tests/guest-gpu/guest-gpu.c'}
   for name,source in sources.items():
    record(source);copy=out/'sources'/(name+'.c');shutil.copyfile(source,copy);obj=out/'obj'/(name+'.o')
    run('compile-'+name,[CC,*flags,'-I'+str(source.parent),'-DGUEST_VK_ZINK=1','-MMD','-MF',str(out/'obj'/(name+'.d')),'-c',str(copy),'-o',str(obj)],limit=300);objects.append(str(obj))
   for dep in (out/'obj').glob('*.d'):
    for token in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):record(token)
   # All Mesa C++ members need the same native constructor/destructor ABI as Nightly.
   # Rebuild every C++ member, retaining original immutable C members and compile flags.
   override=MESA/'obj/ovr-builtin_functions.o';record(override);record(MESA/'override/builtin_functions/builtin_functions.cpp')
   if a.rebuild_mesa_cxx:
    ar=Path(manifests['firefox']['linker']['path']).parent/'llvm-ar';record(ar)
    dbpath=Path('/mnt/p6/build/zink-b3-20260930/build/h2/compile_commands.json');record(dbpath)
    db=json.loads(dbpath.read_text());original=MESA/'lib/libgallium_zink.a'
    run('mesa-member-list',[ar,'t',original],limit=120)
    cpp=[s for s in (out/'mesa-member-list.log').read_text().splitlines() if s.endswith(('.cpp.o','.cc.o','.cxx.o'))]
    if len(cpp)!=61 or len(set(cpp))!=61:raise RuntimeError('unexpected retained Mesa C++ member closure')
    native=[]; mapping=[]
    for index,member in enumerate(cpp):
     found=[r for r in db if r['output'].endswith('/'+member)]
     if len(found)!=1:raise RuntimeError('ambiguous Mesa member compile recipe: '+member)
     r=found[0];cwd=Path(r['directory']);source=(cwd/r['file']).resolve(strict=True);record(source)
     if source.name=='builtin_functions.cpp':source=MESA/'override/builtin_functions/builtin_functions.cpp'
     argv=shlex.split(r['command']);clean=[];i=0
     while i<len(argv):
      if argv[i] in ('-MD','-MMD'):i+=1
      elif argv[i] in ('-MQ','-MF','-o','-c'):i+=2
      else:clean.append(argv[i]);i+=1
     obj=out/'obj'/('mesa-'+str(index)+'.o');dep=out/'obj'/('mesa-'+str(index)+'.d')
     clean+=['-g0','-fwasm-exceptions','-Xclang','-fc++-abi=webassembly','-MMD','-MF',str(dep),'-c',str(source),'-o',str(obj)]
     run('mesa-cxx-'+str(index),clean,cwd,limit=300);native.append(str(obj));mapping.append({'member':member,'recipeSource':record(source),'object':pin(obj)})
     if source.name=='builtin_functions.cpp':override=obj
    copied=out/'libgallium_zink.native-cxx.a';shutil.copyfile(original,copied)
    run('mesa-remove-old-cxx',[ar,'d',copied,*cpp],limit=180)
    run('mesa-add-native-cxx',[ar,'q',copied,*native],limit=180)
    run('mesa-index-native-cxx',[ar,'s',copied],limit=180)
    libs[libs.index(str(original))]=str(copied)
    report['mesaNativeCxx']={'members':mapping,'archive':pin(copied),'flagAdded':'-Xclang -fc++-abi=webassembly','originalOptimization':'-O3'}
    for dep in (out/'obj').glob('mesa-*.d'):
     for token in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):record((Path('/mnt/p6/build/zink-b3-20260930/build/h2')/token).resolve())
   objects.append(str(override))
   for name,d in manifests.items():
    fatalpath=ATOMIC/(name+'-direct-link')/'fatal-control-command.json';record(fatalpath)
    control=json.loads(fatalpath.read_text())
    if control['exactInputManifestSHA256']!=sha(ATOMIC/(name+'-direct-link')/'command-and-inputs.json'):raise RuntimeError('fatal-control parent manifest mismatch')
    if sorted(r['arguments'][1] for r in control['removedKnownInertZPairs'])!=sorted(['noexecstack','text','relro','now','nocopyreloc']):raise RuntimeError('unknown baseline normalization')
    argv=control['argv'][:]; cwd=Path(d['cwd']);raw=out/(name+'.preoptimizer.wasm')
    # Resolve -l only through the exact baseline's recorded selections.
    resolution={r['option']:r['selectedPath'] for r in d['libraryResolution']}
    argv=[resolution.get(x,x) for x in argv]
    argv[argv.index('-o')+1]=str(raw)
    anchor=next(i for i,x in enumerate(argv) if x.endswith('/native-unwind/runtimes-build/lib/libc++.a'))
    argv[anchor:anchor]=objects+libs
    argv+=['--fatal-warnings','--error-limit=0','-Map='+str(out/(name+'.map'))]
    run('link-'+name,argv,cwd)
    run('validate-raw-'+name,['/usr/bin/wasm-validate','--enable-all',str(raw)],limit=180)
    optimized=out/(name+'.optimized.wasm')
    # Compiler wrapper's original automatic Binaryen O2, followed by exact accepted fpcast flags.
    shutil.copyfile(raw,optimized)
    run('optimize-'+name,['/usr/bin/wasm-opt',str(optimized),'-O2','-o',str(optimized)])
    fp=json.loads((ATOMIC/'status'/('fpcast-'+name+'.json')).read_text())['argv'];record(ATOMIC/'status'/('fpcast-'+name+'.json'))
    fp[fp.index('-o')-1]=str(optimized);final=out/(name+'.fpcast.wasm');fp[fp.index('-o')+1]=str(final)
    run('fpcast-'+name,fp)
    run('validate-final-'+name,['/usr/bin/wasm-validate','--enable-all',str(final)],limit=180)
    report.setdefault('artifacts',{})[name]={'raw':pin(raw),'optimized':pin(optimized),'final':pin(final)}
  # Verify originals stayed frozen after all children finished.
  for p,row in checked.items():
   if sha(p)!=row['sha256']:raise RuntimeError('input changed during candidate build: '+p)
  report['passBuild']=True
 except Exception as e: report['error']=str(e)
 finally:
  report['elapsedSeconds']=time.monotonic()-started;persist()
 print(json.dumps({k:report.get(k) for k in ('passBuild','candidateOnly','gpuAcceptance','error','elapsedSeconds')}))
 return 0 if report['passBuild'] else 1

if __name__=='__main__':raise SystemExit(main())
