#!/usr/bin/env python3
"""Build isolated pipeline-profile candidate and source controls, never run a browser."""
import argparse, hashlib, json, math, os
from pathlib import Path
import resource, shutil, signal, subprocess, time
ROOT=Path(__file__).resolve().parents[1]
TASK=Path('/mnt/p3/codex-build/firefox-gpu-oct06/pipeline-phase1')
OLD=Path('/mnt/p6/project/build/guest-vulkan-wgpu-20261003')
GIB=1024**3

def pin(p):
 p=Path(p).resolve(strict=True)
 with p.open('rb') as f: h=hashlib.file_digest(f,'sha256').hexdigest()
 return dict(path=str(p),bytes=p.stat().st_size,sha256=h)
def members(pgid):
 rows=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   s=(p/'stat').read_text().rsplit(')',1)[1].split()
   if int(s[2])==pgid:rows.append(dict(pid=int(p.name),start=int(s[19]),rss=int(s[21])*os.sysconf('SC_PAGE_SIZE')))
  except (OSError,ValueError,IndexError):pass
 return rows
def available():
 return int(next(s.split()[1] for s in Path('/proc/meminfo').read_text().splitlines() if s.startswith('MemAvailable:')))*1024

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
 out=a.output.resolve();assert out.is_relative_to(TASK) and not out.exists();out.mkdir()
 (out/'t').mkdir();started=time.monotonic()
 report=dict(passBuild=False,candidateOnly=True,gpuAcceptance=False,inputs=[],steps=[],limits=dict(totalWallSeconds=1800,ASBytes=16*GIB,groupRSSBytes=12*GIB,taskDiskBytes=8*GIB,diskCapScope=str(out),diskReserveBytes=20*GIB,hostAvailableFloorBytes=4*GIB,sourceControlsWallSeconds=120,sourceControlsCPUSeconds=90,sourceControlsASBytes=2*GIB))
 env=dict(os.environ,TMPDIR=str(out/'t'),TMP=str(out/'t'),TEMP=str(out/'t'),XDG_CACHE_HOME=str(out/'t'),CARGO_TARGET_DIR=str(out/'cargo-target'),PYTHONDONTWRITEBYTECODE='1')
 def persist(): (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 def diskbytes():
  n=0
  for p in out.rglob('*'):
   try:
    if p.is_file():n+=p.stat().st_size
   except FileNotFoundError:pass # owned cargo atomic cache publication
  return n
 def run(name,argv,limit=600,small=False,cwd=out):
  assert available()>=4*GIB and shutil.disk_usage(out).free>=20*GIB
  step=dict(name=name,argv=list(map(str,argv)),cwd=str(cwd),wallBoundSeconds=limit,ASBytes=(2 if small else 16)*GIB,CPUSeconds=90 if small else 6000)
  report['steps'].append(step);persist()
  def guards():
   resource.setrlimit(resource.RLIMIT_AS,(step['ASBytes'],)*2);resource.setrlimit(resource.RLIMIT_CPU,(step['CPUSeconds'],)*2)
   resource.setrlimit(resource.RLIMIT_FSIZE,((256*1024**2 if small else 4*GIB),)*2);resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  began=time.monotonic();peak=0;reason=None;known={};lastdisk=0
  with (out/(name+'.log')).open('xb') as log:
   p=subprocess.Popen(step['argv'],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=guards)
   own=next(x for x in members(p.pid) if x['pid']==p.pid);step.update(pid=p.pid,pgid=p.pid,start=own['start']);persist()
   try:
    while p.poll() is None:
     rows=members(p.pid);known.update({x['pid']:x['start'] for x in rows});rss=sum(x['rss'] for x in rows);peak=max(peak,rss)
     now=time.monotonic()
     if now-began>limit or now-started>1800:reason='wall'
     elif rss>(2 if small else 12)*GIB:reason='groupRSS'
     elif available()<4*GIB:reason='hostRAM'
     elif shutil.disk_usage(out).free<20*GIB:reason='diskReserve'
     if now-lastdisk>10:
      report['polledOutputBytes']=diskbytes();lastdisk=now
      if report['polledOutputBytes']>8*GIB:reason='taskDisk'
     if reason:raise RuntimeError(name+': '+reason)
     time.sleep(.2)
   finally:
    rows=members(p.pid)
    if rows and all(x['start']==known.get(x['pid'],own['start'] if x['pid']==p.pid else None) for x in rows):
     if p.poll() is None or len(rows)>0:os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=5)
    except subprocess.TimeoutExpired:
     rows=members(p.pid)
     if rows and all(x['start']==known.get(x['pid']) for x in rows):os.killpg(p.pid,signal.SIGKILL)
     p.wait(timeout=5)
    step.update(exit=p.returncode,elapsedSeconds=time.monotonic()-began,peakGroupRSSBytes=peak,stopReason=reason,reaped=True,remainingGroup=members(p.pid),log=pin(out/(name+'.log')));persist()
   assert p.returncode==0 and not reason and not step['remainingGroup'],name+' failed; log retained'
 try:
  report['inputs'].append(pin(__file__))
  cgline=next(x for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'));cg=Path('/sys/fs/cgroup')/cgline[3:].lstrip('/');quotas=[];fraction=float(len(os.sched_getaffinity(0)))
  while cg.is_relative_to('/sys/fs/cgroup'):
   if (cg/'cpu.max').exists():
    q,period=(cg/'cpu.max').read_text().split();quotas.append(dict(path=str(cg/'cpu.max'),value=q+' '+period))
    if q!='max':fraction=min(fraction,int(q)/int(period))
   if cg==Path('/sys/fs/cgroup'):break
   cg=cg.parent
  report['executionEnvironment']=dict(cgroup=cgline,cpuMaxAncestors=quotas,affinityCount=len(os.sched_getaffinity(0)),effectiveQuotaCpuFraction=fraction,projectRuntimeCpuSelection=math.ceil(fraction),conservativeBuildCpuFloor=math.floor(fraction),cargoWorkers=2)
  assert fraction>=2
  baseline=json.loads((TASK/'baseline.json').read_text());report['baseline']=pin(TASK/'baseline.json')
  for row in baseline:
   if '/gpu-runtime/v1/' in row['path']:assert pin(row['path'])['sha256']==row['sha256'],'stable v1 changed'
  frozen=out/'sources'
  paths=[]
  for directory in ['web/linux/tests/guest-vulkan','web/linux/tests/guest-gpu','web/linux/tests/guest-vulkan-pipeline','web/linux/gpu-runtime/pipeline-candidate']:
   paths += [p for p in (ROOT/directory).rglob('*') if p.is_file() and p.suffix in ('.c','.h','.inc','.mjs','.vert','.frag')]
  paths += [ROOT/'web/linux/tests/guest-vulkan-wgpu'/p for p in ['Cargo.toml','Cargo.lock','src/lib.rs']]
  for p in paths:
   row=pin(p);report['inputs'].append(row);dest=frozen/p.relative_to(ROOT);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);assert pin(dest)['sha256']==row['sha256']
  crate=out/'crate';shutil.copytree(frozen/'web/linux/tests/guest-vulkan-wgpu',crate)
  runtime=out/'runtime';shutil.copytree(frozen/'web/linux/gpu-runtime/pipeline-candidate',runtime)
  # A private reflink copy keeps cache writes away from historical accepted builds.
  report['cachedTargetSource']=str(OLD/'target');run('copy-cargo-cache',['cp','-a','--reflink=auto',str(OLD/'target'),str(out/'cargo-target')])
  include=Path('/mnt/p6/build/gpu-host-p1-20261001/graphics-build-run1/headers-source/include')
  cc=Path('/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang')
  for p in [cc,OLD/'bindgen-cli/bin/wasm-bindgen',*include.rglob('*.h')]:report['inputs'].append(pin(p))
  tests=frozen/'web/linux/tests';flags=['-O2','-g0','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-Wall','-Wextra','-Werror','-std=c11','-I'+str(include),'-DGUEST_VK_ZINK=1']
  run('compile-candidate-icd',[cc,*flags,'-c',tests/'guest-vulkan/icd.c','-o',out/'guest-icd.o'])
  run('compile-native-controls',['clang','-O2','-g0','-std=c11','-ffunction-sections','-fdata-sections','-Wl,--gc-sections','-I'+str(include),tests/'guest-vulkan-pipeline/native-controls.c','-o',out/'native-controls'],limit=120,small=True)
  run('native-controls',[out/'native-controls'],limit=120,small=True)
  # This controls file intentionally compares frozen v1 against the new candidate.
  run('node-source-controls',['node','--max-old-space-size=512',ROOT/'web/linux/tests/guest-vulkan-pipeline/source-controls.mjs'],limit=120,small=True)
  run('rustc-version',['rustc','--version','--verbose']);assert (out/'rustc-version.log').read_bytes()==(OLD/'host-build-resources-final/rustc-version.log').read_bytes()
  bindgen=OLD/'bindgen-cli/bin/wasm-bindgen';run('bindgen-version',[bindgen,'--version']);assert (out/'bindgen-version.log').read_text().strip()=='wasm-bindgen 0.2.129'
  run('cargo-build',['cargo','build','--offline','--locked','--manifest-path',crate/'Cargo.toml','--release','--target','wasm32-unknown-unknown','-j2'],limit=1800)
  raw=out/'cargo-target/wasm32-unknown-unknown/release/guest_vulkan_wgpu_host.wasm';shutil.copyfile(raw,out/'guest_vulkan_wgpu_host.wasm')
  run('bindgen',[bindgen,'--target','web','--out-dir',runtime,out/'guest_vulkan_wgpu_host.wasm'])
  run('wasm-sections',['wasm-objdump','-h',runtime/'guest_vulkan_wgpu_host_bg.wasm']);assert '".debug' not in (out/'wasm-sections.log').read_text()
  run('wasm-validate',['wasm-validate','--enable-all',runtime/'guest_vulkan_wgpu_host_bg.wasm'])
  for row in report['inputs']:assert pin(row['path'])['sha256']==row['sha256'],'in-flight source changed: '+row['path']
  for row in baseline:
   if '/gpu-runtime/v1/' in row['path']:assert pin(row['path'])['sha256']==row['sha256']
  report.update(passBuild=True,profile=dict(optLevel=2,strip='debuginfo',locked=True,offline=True,binaryenOptimization=None),artifacts=[pin(p) for p in [out/'guest-icd.o',out/'guest_vulkan_wgpu_host.wasm',*runtime.iterdir()]],outputBytes=diskbytes())
 except BaseException as e:report['error']=repr(e);raise
 finally:report['elapsedSeconds']=time.monotonic()-started;persist()
 print(json.dumps({'passBuild':report['passBuild'],'report':str(out/'report.json'),'elapsedSeconds':report['elapsedSeconds']}))
if __name__=='__main__':main()
