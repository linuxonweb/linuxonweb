#!/usr/bin/env python3
"""Bounded isolated commands; j2 Rust only, no Firefox build access."""
import os, sys, signal, resource, subprocess, time, shutil, json
from pathlib import Path
TASK=Path('/mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003');GIB=1024**3
TASK.mkdir(exist_ok=True);(TASK/'tmp').mkdir(exist_ok=True)
def ram():return int(next(l.split()[1] for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')))*1024
def group(pgid):
 rows=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   st=(p/'stat').read_text().rsplit(')',1)[1].split()
   if int(st[2])==pgid:rows.append((int(p.name),int((p/'statm').read_text().split()[1])*os.sysconf('SC_PAGE_SIZE')))
  except (OSError,ValueError,IndexError):pass
 return rows
assert ram()>4*GIB and shutil.disk_usage(TASK).free>20*GIB
name=sys.argv[1];argv=sys.argv[2:];assert name.replace('-','').isalnum()
def guards():
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_AS,(16*GIB,16*GIB));Path("/proc/self/oom_score_adj").write_text("1000")
env=dict(os.environ,TMPDIR=str(TASK/'tmp'),TMP=str(TASK/'tmp'),TEMP=str(TASK/'tmp'),CARGO_TARGET_DIR=str(TASK/'target'))
start=time.monotonic();peak=0;error=None
with (TASK/(name+'.log')).open('wb') as log:
 p=subprocess.Popen(argv,stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True,preexec_fn=guards)
 try:
  while p.poll() is None:
   peak=max(peak,sum(r for _,r in group(p.pid)))
   allocated=sum(f.stat().st_blocks*512 for f in TASK.rglob('*') if f.is_file())
   if peak>12*GIB or ram()<4*GIB or allocated>1*GIB or shutil.disk_usage(TASK).free<20*GIB or time.monotonic()-start>120:raise RuntimeError('resource/deadline guard')
   time.sleep(.5)
 except BaseException as e:error=str(e)
 finally:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  p.wait()
row=dict(argv=argv,exit=p.returncode,error=error,seconds=time.monotonic()-start,peakGroupRss=peak,pgid=p.pid,remainingGroup=group(p.pid),coreBytes=0,addressSpaceBytes=16*GIB,jobs=2,taskCapBytes=1*GIB,diskReserveBytes=20*GIB)
(TASK/(name+'.json')).write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row));sys.exit(0 if p.returncode==0 and error is None and not row['remainingGroup'] else 1)
