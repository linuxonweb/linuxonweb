#!/usr/bin/env python3
import subprocess,os,sys,time,json,signal,shutil
from pathlib import Path
root=Path("/mnt/p6/build/firefox-nightly-musl-recovery-20261002")
phase=sys.argv[1]
jobs=os.environ.get('NIGHTLY_JOBS','2')
assert jobs in ('2','4')
commands={'pixman':['build','--allow-subdirectory-build','gfx/pixman/pixman/pixman/target-objects','-j'+jobs,'--verbose'],'cairo':['build','--allow-subdirectory-build','gfx/cairo/cairo/src/target-objects','-j'+jobs,'--verbose'],'mozgtk':['build','--allow-subdirectory-build','widget/gtk/mozgtk/target-objects','-j'+jobs,'--verbose'],'configure':['configure'],'pre-export':['build','pre-export','-j2'],'export':['build','export','-j2'],'mfbt':['build','--allow-subdirectory-build','mfbt','-j2'],'build':['build','-j'+jobs],'ipc':['build','--allow-subdirectory-build','ipc/chromium','-j'+jobs],'js-builtin':['build','--allow-subdirectory-build','js/src/builtin','-j'+jobs],'js-vm':['build','--allow-subdirectory-build','js/src/vm','-j'+jobs],'abseil':['build','--allow-subdirectory-build','third_party/abseil-cpp/absl/base/malloc_internal_gn','-j'+jobs],'abseil-stack':['build','--allow-subdirectory-build','third_party/abseil-cpp/absl/debugging/examine_stack_gn','-j'+jobs],'rfp':['build','--allow-subdirectory-build','toolkit/components/resistfingerprinting/target-objects','-j'+jobs],'llama-c':['build','--allow-subdirectory-build','third_party/llama.cpp/ggml-c.o','-j'+jobs],'llama-mapping':['build','--allow-subdirectory-build','third_party/llama.cpp/llama-mmap.o','-j'+jobs],'inference':['build','--allow-subdirectory-build','config/external/mozinference','-j'+jobs,'--verbose'],'llama-linker':['build','--allow-subdirectory-build','toolkit/components/ml/backends/llama/target-objects','-j'+jobs,'--verbose'],'pingsender':['build','--allow-subdirectory-build','toolkit/components/telemetry/pingsender','-j'+jobs,'--verbose'],'gfxtest':['build','--allow-subdirectory-build','toolkit/xre/gfxtest','-j'+jobs,'--verbose'],'nss-certutil':['build','--allow-subdirectory-build','security/nss/cmd/certutil/certutil_certutil','-j'+jobs,'--verbose']}
if phase not in commands: raise SystemExit('Unknown phase')
run=sys.argv[2] if len(sys.argv)>2 else 'run1'
log=root/'logs'/f'{phase}-{run}.log'; status=root/'status'/f'{phase}-{run}.json'
if log.exists() or status.exists(): raise SystemExit('Refusing to overwrite evidence')
args=['bash','-c','set -eu; source "$1"; cd "$2"; exec /nix/store/28wlfb25i3q4wq06ap0n9gb04qkjdjyn-python3-3.11.15/bin/python3 ./mach "${@:3}"','nightly-musl',str(root/'recipe/environment.sh'),str(root/'source/firefox-159.0a1'),*commands[phase]]
policy=json.loads((root/'status/storage-policy.json').read_text())
start=time.time(); limit=(20 if phase=="build" else 12)*60; reason=None
with log.open('w') as out:
 p=subprocess.Popen(args,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
 meta={'phase':phase,'run':run,'argv':args,'pid':p.pid,'pgid':p.pid,'started':start,'log':str(log),'timeout_seconds':limit,'state':'running'}
 status.write_text(json.dumps(meta,indent=2)); print(json.dumps(meta),flush=True)
 next_check=start
 while p.poll() is None:
  now=time.time()
  if now>=next_check:
   usage=sum(int(subprocess.check_output(['du','-sx','--block-size=1',path]).split()[0]) for path in policy['owned_roots']); free=shutil.disk_usage(root).free
   meta.update(task_bytes=usage,free_bytes=free,checked=now); status.write_text(json.dumps(meta,indent=2)); next_check=now+20
   if usage>=policy['limit_bytes']: reason='authorized20GiBtasklimit'
   if free<=policy['reserve_bytes']: reason='20GiBdiskreserve'
  if now-start>limit: reason='boundedphase'
  if reason:
   os.killpg(p.pid,signal.SIGTERM)
   try: p.wait(timeout=10)
   except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL); p.wait()
   break
  time.sleep(2)
 meta.update(state='completed',exit_code=p.wait(),finished=time.time(),stop_reason=reason)
 status.write_text(json.dumps(meta,indent=2)); print(json.dumps(meta),flush=True)
raise SystemExit(meta['exit_code'] if meta['exit_code']>=0 else 128-meta['exit_code'])
