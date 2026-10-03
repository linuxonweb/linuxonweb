#!/usr/bin/env python3
import subprocess,os,sys,time,json,signal,shutil,resource
from pathlib import Path
root=Path(__file__).resolve().parents[1]
phase=sys.argv[1]
jobs=os.environ.get('NIGHTLY_JOBS','2')
assert jobs in ('1','2','4')
commands={'xptcall':['build','--allow-subdirectory-build','xpcom/reflect/xptcall','-j'+jobs,'--verbose'],'expat':['build','--allow-subdirectory-build','parser/expat/target-objects','-j'+jobs,'--verbose'],'pixman':['build','--allow-subdirectory-build','gfx/pixman/pixman/pixman/target-objects','-j'+jobs,'--verbose'],'cairo':['build','--allow-subdirectory-build','gfx/cairo/cairo/src/target-objects','-j'+jobs,'--verbose'],'mozgtk':['build','--allow-subdirectory-build','widget/gtk/mozgtk/target-objects','-j'+jobs,'--verbose'],'configure':['configure'],'pre-export':['build','pre-export','-j2'],'export':['build','export','-j2'],'mfbt':['build','--allow-subdirectory-build','mfbt','-j2'],'build':['build','-j'+jobs],'ipc':['build','--allow-subdirectory-build','ipc/chromium','-j'+jobs],'js-builtin':['build','--allow-subdirectory-build','js/src/builtin','-j'+jobs],'js-vm':['build','--allow-subdirectory-build','js/src/vm','-j'+jobs],'abseil':['build','--allow-subdirectory-build','third_party/abseil-cpp/absl/base/malloc_internal_gn','-j'+jobs],'abseil-stack':['build','--allow-subdirectory-build','third_party/abseil-cpp/absl/debugging/examine_stack_gn','-j'+jobs],'rfp':['build','--allow-subdirectory-build','toolkit/components/resistfingerprinting/target-objects','-j'+jobs],'llama-c':['build','--allow-subdirectory-build','third_party/llama.cpp/ggml-c.o','-j'+jobs],'llama-mapping':['build','--allow-subdirectory-build','third_party/llama.cpp/llama-mmap.o','-j'+jobs],'inference':['build','--allow-subdirectory-build','config/external/mozinference','-j'+jobs,'--verbose'],'llama-linker':['build','--allow-subdirectory-build','toolkit/components/ml/backends/llama/target-objects','-j'+jobs,'--verbose'],'pingsender':['build','--allow-subdirectory-build','toolkit/components/telemetry/pingsender','-j'+jobs,'--verbose'],'gfxtest':['build','--allow-subdirectory-build','toolkit/xre/gfxtest','-j'+jobs,'--verbose'],'nss-certutil':['build','--allow-subdirectory-build','security/nss/cmd/certutil/certutil_certutil','-j'+jobs,'--verbose']}
if phase not in commands: raise SystemExit('Unknown phase')
run=sys.argv[2] if len(sys.argv)>2 else 'run1'
log=root/'logs'/f'{phase}-{run}.log'; status=root/'status'/f'{phase}-{run}.json'
if log.exists() or status.exists(): raise SystemExit('Refusing to overwrite evidence')
args=['bash','-c','set -eu; source "$1"; cd "$2"; exec /nix/store/28wlfb25i3q4wq06ap0n9gb04qkjdjyn-python3-3.11.15/bin/python3 ./mach "${@:3}"','nightly-musl',str(root/'recipe/environment.sh'),str(root/'source/firefox-159.0a1'),*commands[phase]]
policy=json.loads((root/'status/storage-policy.json').read_text())
limit=(20 if phase=="build" else 12)*60
if 'NIGHTLY_BUILD_TIMEOUT_SECONDS' in os.environ:
 if phase!='build': raise SystemExit('Build timeout override is only valid for the full build phase')
 requested=os.environ['NIGHTLY_BUILD_TIMEOUT_SECONDS']
 if not requested.isascii() or not requested.isdecimal(): raise SystemExit('Build timeout must be decimal seconds')
 limit=int(requested)
 if not 1200<=limit<=7200: raise SystemExit('Build timeout must remain bounded between 1200 and 7200 seconds')
memory_limit=24*1024**3 if phase=='build' else None
address_space_limit=memory_limit
if 'NIGHTLY_RESIDENT_MEMORY_GIB' in os.environ:
 if phase!='build': raise SystemExit('Resident-memory override is only valid for the full build phase')
 requested=os.environ['NIGHTLY_RESIDENT_MEMORY_GIB']
 if not requested.isascii() or not requested.isdecimal() or not 24<=int(requested)<=48:
  raise SystemExit('Resident-memory limit must be decimal GiB between 24 and 48')
 memory_limit=int(requested)*1024**3
if 'NIGHTLY_ADDRESS_SPACE_GIB' in os.environ:
 if phase!='build': raise SystemExit('Address-space override is only valid for the full build phase')
 requested=os.environ['NIGHTLY_ADDRESS_SPACE_GIB']
 if not requested.isascii() or not requested.isdecimal() or not 24<=int(requested)<=64:
  raise SystemExit('Address-space limit must be decimal GiB between 24 and 64')
 address_space_limit=int(requested)*1024**3
def available_memory():
 for line in Path('/proc/meminfo').read_text().splitlines():
  if line.startswith('MemAvailable:'): return int(line.split()[1])*1024
 raise RuntimeError('Cannot determine host available memory')
def prepare_child():
 if memory_limit is not None:
  resource.setrlimit(resource.RLIMIT_AS,(address_space_limit,address_space_limit))
  resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  # Prefer an owned build victim if the host still reaches its OOM boundary.
  Path('/proc/self/oom_score_adj').write_text('1000')
def group_memory(pgid):
 total=0
 for process in Path('/proc').iterdir():
  if not process.name.isdecimal(): continue
  try:
   fields=(process/'stat').read_text().rsplit(')',1)[1].split()
   if int(fields[2])==pgid: total+=int(fields[21])*os.sysconf('SC_PAGE_SIZE')
  except (FileNotFoundError,ProcessLookupError,PermissionError): continue
 return total
def live_group(pgid):
 members=[]
 for process in Path('/proc').iterdir():
  if not process.name.isdecimal(): continue
  try:
   fields=(process/'stat').read_text().rsplit(')',1)[1].split()
   if int(fields[2])==pgid and fields[0]!='Z': members.append(int(process.name))
  except (FileNotFoundError,ProcessLookupError,PermissionError): continue
 return members
def group_address_space(pgid):
 largest={'pid':None,'bytes':0}
 for process in Path('/proc').iterdir():
  if not process.name.isdecimal(): continue
  try:
   fields=(process/'stat').read_text().rsplit(')',1)[1].split()
   size=int(fields[20])
   if int(fields[2])==pgid and fields[0]!='Z' and size>largest['bytes']:
    largest={'pid':int(process.name),'bytes':size}
  except (FileNotFoundError,ProcessLookupError,PermissionError): continue
 return largest
def stop_group(p,grace_seconds=10):
 # The mach parent can exit before an optimizer which ignores SIGTERM.
 # Waiting only on the parent left Run48's 24 GiB optimizer alive.
 initial=live_group(p.pid)
 try: os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError: pass
 deadline=time.monotonic()+grace_seconds
 while time.monotonic()<deadline:
  p.poll()
  if not live_group(p.pid): break
  time.sleep(0.1)
 remaining=live_group(p.pid)
 if remaining:
  try: os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError: pass
 p.wait(timeout=10)
 deadline=time.monotonic()+10
 while live_group(p.pid) and time.monotonic()<deadline: time.sleep(0.1)
 survivors=live_group(p.pid)
 if survivors: raise RuntimeError('Owned build descendants survived cleanup: '+str(survivors))
 return {'initial_members':initial,'sigkill_members':remaining,'live_members_after':survivors}
def free_swap():
 for line in Path('/proc/meminfo').read_text().splitlines():
  if line.startswith('SwapFree:'): return int(line.split()[1])*1024
 raise RuntimeError('Cannot determine host free swap')
if memory_limit is not None:
 preflight_available=available_memory(); preflight_swap=free_swap()
 if preflight_available<4*1024**3 or preflight_available+preflight_swap<address_space_limit+2*1024**3:
  raise SystemExit('Full build needs 4 GiB available RAM and address-space limit plus 2 GiB in available RAM/free swap')
start=time.time(); reason=None
with log.open('w') as out:
 p=subprocess.Popen(args,stdout=out,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=prepare_child)
 meta={'phase':phase,'run':run,'argv':args,'pid':p.pid,'pgid':p.pid,'started':start,'log':str(log),'timeout_seconds':limit,'state':'running'}
 if memory_limit is not None: meta.update(process_address_space_limit_bytes=address_space_limit,group_rss_limit_bytes=memory_limit,host_available_memory_floor_bytes=2*1024**3,child_oom_score_adj=1000,child_core_limit_bytes=0,preflight_available_memory_bytes=preflight_available,preflight_free_swap_bytes=preflight_swap)
 status.write_text(json.dumps(meta,indent=2)); print(json.dumps(meta),flush=True)
 next_check=start
 while p.poll() is None:
  now=time.time()
  if memory_limit is not None:
   rss=group_memory(p.pid); available=available_memory()
   virtual=group_address_space(p.pid)
   if virtual['bytes']>meta.get('peak_process_address_space',{}).get('bytes',0):
    meta['peak_process_address_space']={**virtual,'observed_at':now}
   meta.update(group_rss_bytes=rss,host_available_memory_bytes=available,memory_checked=now)
   status.write_text(json.dumps(meta,indent=2))
   if rss>=memory_limit: reason='buildGroupMemoryLimit'
   if available<=2*1024**3: reason='hostAvailableMemoryReserve'
  if now>=next_check:
   usage=sum(int(subprocess.check_output(['du','-sx','--block-size=1',path]).split()[0]) for path in policy['owned_roots']); free=shutil.disk_usage(root).free
   meta.update(task_bytes=usage,free_bytes=free,checked=now); status.write_text(json.dumps(meta,indent=2)); next_check=now+20
   if usage>=policy['limit_bytes']: reason='authorizedTaskLimit'
   if free<=policy['reserve_bytes']: reason='20GiBdiskreserve'
  if now-start>limit: reason='boundedphase'
  if reason:
   meta['group_cleanup']=stop_group(p)
   break
  time.sleep(2)
 if live_group(p.pid): meta['group_cleanup']=stop_group(p)
 meta.update(state='completed',exit_code=p.wait(),finished=time.time(),stop_reason=reason)
 status.write_text(json.dumps(meta,indent=2)); print(json.dumps(meta),flush=True)
raise SystemExit(meta['exit_code'] if meta['exit_code']>=0 else 128-meta['exit_code'])
