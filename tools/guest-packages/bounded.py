#!/usr/bin/env python3
"""Run an owned finite build/test, retaining one-second aggregate resource samples."""
import argparse, datetime, json, os, pathlib, signal, subprocess, time

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def run(argv, cwd, out, seconds=270):
 out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
 log=out/'command.log'; samples=out/'resources.jsonl'; started=time.monotonic();stamp=utc()
 env=dict(os.environ);tmp=out/'tmp';tmp.mkdir(exist_ok=True)
 for k in ['TMPDIR','TMP','TEMP']:env[k]=str(tmp.resolve())
 with log.open('w') as stream,samples.open('w') as mon:
  p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
  reason=None;peak=0;group_peak=0;count=0
  try:
   while p.poll() is None:
    mem={x.split(':')[0]:int(x.split()[1])*1024 for x in pathlib.Path('/proc/meminfo').read_text().splitlines() if x.startswith(('MemTotal:','MemAvailable:'))}
    try:
     fields=(pathlib.Path('/proc')/str(p.pid)/'stat').read_text().rsplit(')',1)[1].split();rss=int(fields[21])*os.sysconf('SC_PAGE_SIZE');ticks=int(fields[11])+int(fields[12])
    except (FileNotFoundError,ProcessLookupError):rss=ticks=0
    group_rss=group_ticks=0;queue=[p.pid];seen=set()
    while queue:
     current=queue.pop()
     if current in seen:continue
     seen.add(current)
     try:
      d=pathlib.Path('/proc')/str(current);v=(d/'stat').read_text().rsplit(')',1)[1].split();group_rss+=int(v[21])*os.sysconf('SC_PAGE_SIZE');group_ticks+=int(v[11])+int(v[12]);queue.extend(map(int,(d/'task'/str(current)/'children').read_text().split()))
     except (FileNotFoundError,ProcessLookupError,PermissionError):pass
    peak=max(peak,rss);group_peak=max(group_peak,group_rss);count+=1;mon.write(json.dumps({'utc':utc(),'elapsedSeconds':round(time.monotonic()-started,3),'pid':p.pid,'ownerRssBytes':rss,'ownerCpuTicks':ticks,'ownedTreeRssBytes':group_rss,'ownedTreeCpuTicks':group_ticks,'ownedProcesses':len(seen),**mem})+'\n');mon.flush()
    if time.monotonic()-started>seconds:reason='deadline';break
    if mem['MemAvailable']<1024**3:reason='host_available_memory_floor';break
    time.sleep(1)
  finally:
   if p.poll() is None:
    # Only signal the process group created and still owned by this launcher.
    if os.getpgid(p.pid)==p.pid:os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=5)
    except subprocess.TimeoutExpired:
     if os.getpgid(p.pid)==p.pid:os.killpg(p.pid,signal.SIGKILL)
     p.wait()
  rec={'startedUtc':stamp,'finishedUtc':utc(),'durationSeconds':round(time.monotonic()-started,3),'argv':argv,'cwd':str(cwd),'exitCode':p.returncode,'stopReason':reason,'ownerPeakRssBytes':peak,'ownedTreePeakRssBytes':group_peak,'resourceSamples':count,'resourceScope':'one-second owned descendant tree RSS sum (shared pages may be counted more than once), CPU ticks and host available RAM','pass':p.returncode==0 and reason is None}
  (out/'result.json').write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps({k:rec[k] for k in ['startedUtc','durationSeconds','exitCode','stopReason','ownerPeakRssBytes','resourceSamples','pass']}),flush=True)
  return rec
if __name__=='__main__':
 q=argparse.ArgumentParser();q.add_argument('--cwd',required=True);q.add_argument('--out',required=True);q.add_argument('--seconds',type=int,default=270);q.add_argument('command',nargs=argparse.REMAINDER);a=q.parse_args();cmd=a.command[1:] if a.command[:1]==['--'] else a.command
 raise SystemExit(0 if run(cmd,a.cwd,a.out,a.seconds)['pass'] else 1)
