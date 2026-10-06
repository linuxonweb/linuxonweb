#!/usr/bin/env python3
"""Build and package an isolated public Vulkan candidate; never run a browser."""
import argparse, hashlib, json, math, os, re, resource, shutil, signal, struct, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TASK=Path('/mnt/p3/codex-build/firefox-gpu-oct06/pipeline-phase1')
OLD=Path('/mnt/p6/build/gpu-host-p1-20261001/graphics-build-run1')
GIB=1024**3
CC=Path('/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang')
def pin(path):
 p=Path(path).resolve(strict=True)
 with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
 return dict(path=str(p),bytes=p.stat().st_size,sha256=h)
def members(group):
 rows=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   s=(p/'stat').read_text().rsplit(')',1)[1].split()
   if int(s[2])==group:rows.append(dict(pid=int(p.name),start=int(s[19]),rss=int(s[21])*os.sysconf('SC_PAGE_SIZE')))
  except (OSError,ValueError,IndexError):pass
 return rows
def available():return int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024
def records(data):
 offset=0
 while True:
  start=offset;header=data[offset:offset+110];assert len(header)==110 and header[:6]==b'070701'
  size,namesize=int(header[54:62],16),int(header[94:102],16);assert 1<=namesize<=4096
  offset+=110;name=data[offset:offset+namesize];offset+=namesize;offset+=(-offset)%4
  body=data[offset:offset+size];offset+=size;offset+=(-offset)%4
  assert len(body)==size and name.endswith(b'\0') and offset<=len(data)
  key=name[:-1].decode().removeprefix('./').lstrip('/')
  yield key,header,name,body,data[start:offset]
  if key=='TRAILER!!!':return
def record(header,name,body):
 header=header[:54]+f'{len(body):08x}'.encode()+header[62:94]+f'{len(name):08x}'.encode()+header[102:]
 return header+name+b'\0'*(-(110+len(name))%4)+body+b'\0'*(-len(body)%4)
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--package',type=Path,required=True);ap.add_argument('--fixture-rebind',type=Path);a=ap.parse_args()
 out=a.output.resolve();pkg=a.package.resolve();assert out.is_relative_to(TASK) and pkg.is_relative_to(TASK) and not out.exists() and not pkg.exists()
 out.mkdir();(out/'t').mkdir();began=time.monotonic()
 report=dict(passBuild=False,candidateOnly=True,gpuAcceptance=False,inputs=[],steps=[],limits=dict(totalWallSeconds=1800,compileLinkWallSeconds=600,optimizerWallSeconds=1200,ASBytes=16*GIB,groupRSSBytes=12*GIB,taskDiskBytes=8*GIB,diskCapScope=str(out),diskReserveBytes=20*GIB,hostAvailableFloorBytes=4*GIB))
 env=dict(os.environ,TMPDIR=str(out/'t'),TMP=str(out/'t'),TEMP=str(out/'t'),XDG_CACHE_HOME=str(out/'t'),PYTHONDONTWRITEBYTECODE='1',BINARYEN_CORES='4')
 def persist():(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 def diskbytes():return sum(p.stat().st_size for p in out.rglob('*') if p.is_file())+sum(p.stat().st_size for p in pkg.rglob('*') if p.is_file())
 def run(name,argv,limit=600):
  assert available()>=4*GIB and shutil.disk_usage(out).free>=20*GIB
  step=dict(name=name,argv=list(map(str,argv)),cwd=str(out),wallBoundSeconds=limit,CPUSeconds=6000);report['steps'].append(step);persist()
  def guards():
   resource.setrlimit(resource.RLIMIT_AS,(16*GIB,)*2);resource.setrlimit(resource.RLIMIT_CPU,(6000,)*2);resource.setrlimit(resource.RLIMIT_FSIZE,(4*GIB,)*2);resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  start=time.monotonic();peak=0;known={};reason=None;lastdisk=0
  with (out/(name+'.log')).open('xb') as log:
   p=subprocess.Popen(step['argv'],cwd=out,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=guards)
   own=next(x for x in members(p.pid) if x['pid']==p.pid);known[p.pid]=own['start'];step.update(pid=p.pid,pgid=p.pid,start=own['start']);persist()
   try:
    while p.poll() is None:
     rows=members(p.pid);known.update({x['pid']:x['start'] for x in rows});rss=sum(x['rss'] for x in rows);peak=max(peak,rss);now=time.monotonic()
     if now-start>limit or now-began>1800:reason='wall'
     elif rss>12*GIB:reason='groupRSS'
     elif available()<4*GIB:reason='hostRAM'
     elif shutil.disk_usage(out).free<20*GIB:reason='diskReserve'
     if now-lastdisk>10:
      report['polledOutputBytes']=diskbytes();lastdisk=now
      if report['polledOutputBytes']>8*GIB:reason='taskDisk'
     if reason:raise RuntimeError(name+': '+reason)
     time.sleep(.2)
   finally:
    rows=members(p.pid)
    if rows:
     assert all(x['start']==known.get(x['pid']) for x in rows),'owned group identity changed'
     os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=5)
    except subprocess.TimeoutExpired:
     rows=members(p.pid);assert all(x['start']==known.get(x['pid']) for x in rows);os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
    step.update(exit=p.returncode,elapsedSeconds=time.monotonic()-start,peakGroupRSSBytes=peak,stopReason=reason,reaped=True,remainingGroup=members(p.pid),log=pin(out/(name+'.log')));persist()
   assert p.returncode==0 and not reason and not step['remainingGroup'],name+' failed; preserve this build'
 def authenticate(row):
  now=pin(row['path']);assert now['bytes']==row['bytes'] and now['sha256']==row['sha256'],row['path'];return now
 try:
  report['inputs'].append(pin(__file__))
  cgline=next(x for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'));cg=Path('/sys/fs/cgroup')/cgline[3:].lstrip('/');fraction=float(len(os.sched_getaffinity(0)));quotas=[]
  while cg.is_relative_to('/sys/fs/cgroup'):
   if (cg/'cpu.max').exists():
    q,period=(cg/'cpu.max').read_text().split();quotas.append(dict(path=str(cg/'cpu.max'),value=q+' '+period))
    if q!='max':fraction=min(fraction,int(q)/int(period))
   if cg==Path('/sys/fs/cgroup'):break
   cg=cg.parent
  report['executionEnvironment']=dict(cgroup=cgline,cpuMaxAncestors=quotas,affinityCount=len(os.sched_getaffinity(0)),effectiveQuotaCpuFraction=fraction,projectRuntimeCpuSelection=math.ceil(fraction),conservativeBuildCpuFloor=math.floor(fraction),binaryenWorkers=4);assert fraction>=4
  report['storage']=dict(filesystem=subprocess.check_output(['findmnt','-n','-o','SOURCE,FSTYPE','-T',out],text=True).strip(),freeBytes=shutil.disk_usage(out).free)
  assert 'tmpfs' not in report['storage']['filesystem'] and 'ramfs' not in report['storage']['filesystem']
  host_report=TASK/'build1/report.json';assert pin(host_report)['sha256']=='8cedef600500185c6c34703f3160ac78cd7a0ba3284904a802bd51ac4024278f'
  host=json.loads(host_report.read_text());assert host['passBuild'];report['candidateHostBuild']=pin(host_report)
  rebind=None
  if a.fixture_rebind:
   rebind=json.loads(a.fixture_rebind.read_text());report['fixtureRebind']=dict(manifest=pin(a.fixture_rebind),deltas=rebind['deltas'])
   assert rebind['hostBuild']==pin(host_report)
   permitted={str(ROOT/'web/linux/tests/guest-vulkan-pipeline'/n) for n in ['client.c','guest.html','source-controls.mjs']}
   assert {r['original']['path'] for r in rebind['deltas']}==permitted
   for delta in rebind['deltas']:
    original=delta['original'];oldreport=authenticate(delta['originalReport']);assert original in json.loads(Path(oldreport['path']).read_text())['inputs']
    historical=authenticate(delta['historicalFrozen']);assert (historical['bytes'],historical['sha256'])==(original['bytes'],original['sha256'])
    assert delta['current']['path']==original['path'];authenticate(delta['current'])
  for row in host['inputs']:
   if rebind and row['path']==str(ROOT/'web/linux/tests/guest-vulkan-pipeline/source-controls.mjs'):
    delta=next(d for d in rebind['deltas'] if d['original']['path']==row['path']);assert delta['original']==row;report['inputs'].append(authenticate(delta['current']))
   else:authenticate(row)
  for row in host['artifacts']:authenticate(row)
  baseline=json.loads((TASK/'baseline.json').read_text());report['stableV1Pins']=[authenticate(row) for row in baseline if '/gpu-runtime/v1/' in row['path']]
  accepted=Path('/mnt/p6/project/build/guest-vulkan-wgpu-20261003/app-build-resources-regression/build.json');old_report=json.loads(accepted.read_text());assert old_report['pass']
  archive=OLD/'libvulkan-guest-static.a';expected=next(r for r in old_report['inputs'] if r['path']==str(archive));assert expected['sha256']=='de3ea65041731fd32e319a34e3282ec68933d7372ecc184a06b364fd671683f8';report['loaderProvenance']=dict(acceptedAppReport=pin(accepted),archive=authenticate(expected),originalRecipe=pin(ROOT/'web/linux/tests/guest-vulkan-wgpu/build.py'),upstreamMetadata=pin(OLD/'build.json'))
  include=OLD/'headers-source/include';report['inputs'] += [pin(CC),pin('/usr/bin/glslangValidator'),pin('/usr/bin/spirv-val'),pin('/usr/bin/wasm-opt'),pin(archive),*[pin(p) for p in include.rglob('*.h')]]
  frozen=out/'sources';source=ROOT/'web/linux/tests/guest-vulkan-pipeline';dest=frozen/'web/linux/tests/guest-vulkan-pipeline';dest.mkdir(parents=True)
  for p in source.iterdir():
   if p.is_file():report['inputs'].append(pin(p));shutil.copyfile(p,dest/p.name)
  transport_source=TASK/'build1/sources/web/linux/tests/guest-gpu'
  shutil.copytree(transport_source,frozen/'web/linux/tests/guest-gpu');report['inputs'] += [pin(transport_source/p) for p in ['guest-gpu.c','guest-gpu.h','host.mjs']]
  shaders=[];shaderpins=[]
  for name in ['flat.vert','flat.frag','index.vert']:
   spv=out/(name+'.spv');run('shader-'+name,['/usr/bin/glslangValidator','-V','--target-env','vulkan1.0',dest/name,'-o',spv]);run('validate-'+name,['/usr/bin/spirv-val','--target-env','vulkan1.0',spv]);run('disassemble-'+name,['spirv-dis',spv]);shaderpins.append(pin(spv))
   words=struct.unpack('<'+'I'*(spv.stat().st_size//4),spv.read_bytes());shaders.append('static const uint32_t shader_'+name.replace('.','_')+'[]={'+','.join(map(str,words))+'};')
  assert 'BuiltIn VertexIndex' not in (out/'disassemble-flat.vert.log').read_text() and 'BuiltIn VertexIndex' in (out/'disassemble-index.vert.log').read_text()
  assert ' Flat' in (out/'disassemble-flat.vert.log').read_text() and ' Flat' in (out/'disassemble-flat.frag.log').read_text()
  (dest/'shaders.h').write_text('#include <stdint.h>\n'+'\n'.join(shaders)+'\n');report['shaders']=shaderpins
  flags=['-std=c11','-O2','-g0','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-I'+str(include)]
  run('compile-client',[CC,*flags,'-MMD','-MF',out/'client.d','-c',dest/'client.c','-o',out/'client.o'])
  run('compile-transport',[CC,*flags,'-MMD','-MF',out/'transport.d','-c',frozen/'web/linux/tests/guest-gpu/guest-gpu.c','-o',out/'transport.o'])
  for dep in out.glob('*.d'):
   report['inputs'] += [pin(p) for p in dep.read_text().replace('\\\n',' ').split(':',1)[1].split()]
  run('client-symbols',['llvm-nm','--undefined-only',out/'client.o']);symbols=(out/'client-symbols.log').read_text();public=re.findall(r'\bU (vk\w+)$',symbols,re.M);assert len(public)>=25 and not re.search(r'\bU (?:guest_vk|gpu_)',symbols)
  run('loader-symbols',['llvm-nm','--defined-only',archive]);defined=(out/'loader-symbols.log').read_text()
  for name in public:assert re.search(r'\bT '+re.escape(name)+r'$',defined,re.M),name
  report['publicClientSymbols']=public
  raw=out/'guest-vulkan-pipeline.raw.wasm';icd=TASK/'build1/guest-icd.o';report['inputs'].append(pin(icd))
  run('link',[CC,'-pthread','-matomics','-mbulk-memory','-static',out/'client.o',archive,icd,out/'transport.o','-lm','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=8388608,--max-memory=4294967296,-z,stack-size=262144','-Wl,-Map='+str(out/'link.map'),'-o',raw])
  run('original-O2',['/usr/bin/wasm-opt',raw,'-O2','-o',out/'guest-vulkan-pipeline.optimized.wasm'],1200)
  final=out/'guest-vulkan-pipeline.fpcast.wasm';run('original-fpcast',['/usr/bin/wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23','--fpcast-emu',out/'guest-vulkan-pipeline.optimized.wasm','-o',final],1200)
  run('validate-final',['wasm-validate','--enable-all',final]);run('abi-final',['wasm-objdump','-x',final]);abi=(out/'abi-final.log').read_text();imports=re.findall(r' <- (\S+)',abi);assert 'env.memory' in imports and not(set(imports)-{'env.memory','linux.syscall','linux.get_thread_area','linux.copy_siginfo'});assert '.debug' not in abi
  report.update(imports=imports,profile=dict(musl=True,optLevel=2,debugInformation=False,originalOptimizer='/usr/bin/wasm-opt',fpcastMaxFuncParams=23))
  # All served candidate bytes are private copies; no public v1 artifact is changed.
  pkg.mkdir();shutil.copyfile(dest/'guest.html',pkg/'guest.html');shutil.copyfile(transport_source/'host.mjs',pkg/'host.mjs');(pkg/'runtime').mkdir()
  names=['bridge.mjs','graphics-renderer.mjs','guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm']
  for name in names:shutil.copyfile(TASK/'build1/runtime'/name,pkg/'runtime'/name)
  worker=ROOT/'web/linux/dist/guest-gpu-vk.js';report['inputs'].append(pin(worker));workerbytes=worker.read_bytes();old=b'../gpu-runtime/v1/bridge.mjs';assert workerbytes.count(old)==1
  (pkg/'guest-gpu-vk.js').write_bytes(workerbytes.replace(old,b'../gpu-runtime/pipeline-candidate/bridge.mjs'))
  base=ROOT/'web/linux/initramfs.cpio';manifestfile=ROOT/'web/linux/boot-manifest.json';manifest=json.loads(manifestfile.read_text())['assets']['plain'];assert pin(base)['sha256']==manifest['sha256'] and base.stat().st_size==manifest['bytes'];report['inputs'] += [pin(base),pin(manifestfile)]
  rawcpio=base.read_bytes();original=list(records(rawcpio));chunks=[];changes=0;binary=final.read_bytes();anchor=b'# Keep the picker available without requiring Firefox to fork a helper on NOMMU.'
  for key,header,name,body,encoded in original:
   if key=='init':
    assert body.count(anchor)==1;chunks.append(record(header,name,body.replace(anchor,b'# Isolated candidate pipeline-state public Vulkan fixture.\n/bin/guest-vulkan-pipeline &\n\n'+anchor)));changes+=1
   elif key=='TRAILER!!!':
    newname=b'bin/guest-vulkan-pipeline\0';fields=[0x7ffffffd,0o100755,0,0,1,0,len(binary),0,0,0,0,len(newname),0];newheader=b'070701'+b''.join(f'{x:08x}'.encode() for x in fields);chunks += [record(newheader,newname,binary),encoded]
   else:chunks.append(encoded)
  assert changes==1;tail=rawcpio[sum(len(x[4]) for x in original):];result=b''.join(chunks)+tail;(pkg/'initramfs.cpio').write_bytes(result)
  after=list(records(result));beforemap={r[0]:r[4] for r in original};aftermap={r[0]:r[4] for r in after};assert len(beforemap)==len(original) and len(aftermap)==len(after)
  assert set(aftermap)-set(beforemap)=={'bin/guest-vulkan-pipeline'} and not(set(beforemap)-set(aftermap));assert [k for k in beforemap if beforemap[k]!=aftermap[k]]==['init']
  closure=dict(passClosure=True,originalRecords=len(original),unchangedOriginalRecords=len(original)-1,modified=['init'],added=['bin/guest-vulkan-pipeline'],tailPreserved=result[len(result)-len(tail):]==tail if tail else True,sourceArchive=pin(base),candidateArchive=pin(pkg/'initramfs.cpio'),allEncodedRecords=[dict(name=r[0],bytes=len(r[4]),sha256=hashlib.sha256(r[4]).hexdigest()) for r in after]);(out/'archive-closure.json').write_text(json.dumps(closure,indent=2)+'\n')
  for row in report['inputs']:authenticate(row)
  for row in report['stableV1Pins']:authenticate(row)
  report.update(passBuild=True,artifacts=[pin(final),*[pin(pkg/p) for p in ['guest.html','guest-gpu-vk.js','host.mjs','initramfs.cpio']],*[pin(pkg/'runtime'/p) for p in names]],archiveClosure=pin(out/'archive-closure.json'),outputBytes=diskbytes(),elapsedSeconds=time.monotonic()-began);persist()
  metadata=dict(schema=1,passPackage=True,testOnly=True,bytes=len(result),archiveSha256=hashlib.sha256(result).hexdigest(),guestBinary=pin(final),appBuildSha256=pin(out/'report.json')['sha256'],candidateHostBuild=pin(host_report),candidateRuntime=dict(pipelineStateProfile=1,files={name:dict(file='runtime/'+name,**pin(pkg/'runtime'/name)) for name in names}),candidateWorker=dict(file='guest-gpu-vk.js',sourceSha256=pin(worker)['sha256'],**pin(pkg/'guest-gpu-vk.js')),candidatePage=dict(file='guest.html',**pin(pkg/'guest.html')),candidateHost=dict(file='host.mjs',**pin(pkg/'host.mjs')),expected=dict(rounds=24,graphicsPasses=24,graphicsDraws=33,graphicsReadbacks=72,largeFanSourceCount=4097,largeFanExpandedCount=12285,largeFanPieces=4),stableV1Pins=report['stableV1Pins'],archiveClosure=report['archiveClosure'],sourceArchive=pin(base),scope='new primitive candidate only; no Firefox or stable-v1 acceptance')
  (pkg/'package.json').write_text(json.dumps(metadata,indent=2)+'\n');print(json.dumps(dict(passBuild=True,report=pin(out/'report.json'),package=pin(pkg/'package.json'))))
 except BaseException as e:report['error']=repr(e);report['elapsedSeconds']=time.monotonic()-began;persist();raise
if __name__=='__main__':main()
