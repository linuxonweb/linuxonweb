from pathlib import Path
import sys,os,json,time,subprocess,signal,shutil
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');run=sys.argv[1]
log=T/f'logs/cxx-runtime-{run}.log';status=T/f'status/cxx-runtime-{run}.json'
assert not log.exists() and not status.exists()
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for path in (T/'status').glob('*.json'):
 d=json.loads(path.read_text())
 if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):
  assert d['state']=='completed' and d['pgid'] not in groups,path
policy=json.loads((T/'status/storage-policy.json').read_text())
argv=['/home/a/.local/archpkg/pacman/usr/bin/ninja','-C',str(T/'native-unwind/runtimes-build'),'-j4','cxx_static','cxxabi_static','unwind_static']
env=os.environ.copy();env['NIX_CXXSTDLIB_COMPILE_wasm32_unknown_linux_musl']='';env['NIX_CXXSTDLIB_LINK_wasm32_unknown_linux_musl']=''
start=time.time();reason=None
with log.open('w') as out:
 p=subprocess.Popen(argv,stdout=out,stderr=subprocess.STDOUT,env=env,start_new_session=True)
 meta=dict(phase='cxx-runtime',run=run,argv=argv,pid=p.pid,pgid=p.pid,started=start,log=str(log),timeout_seconds=720,state='running')
 status.write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta),flush=True);next_check=0
 while p.poll() is None:
  now=time.time()
  if now>=next_check:
   usage=sum(int(subprocess.check_output(['du','-sx','--block-size=1',x]).split()[0]) for x in policy['owned_roots']);free=shutil.disk_usage(T).free
   meta.update(task_bytes=usage,free_bytes=free,checked=now);status.write_text(json.dumps(meta,indent=2)+'\n');next_check=now+20
   if usage>=policy['limit_bytes']:reason='authorized20GiBtasklimit'
   if free<=policy['reserve_bytes']:reason='20GiBdiskreserve'
  if now-start>720:reason='boundedphase'
  if reason:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   break
  time.sleep(2)
 meta.update(state='completed',exit_code=p.wait(),finished=time.time(),stop_reason=reason)
 status.write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta),flush=True)
raise SystemExit(meta['exit_code'] if meta['exit_code']>=0 else 128-meta['exit_code'])
