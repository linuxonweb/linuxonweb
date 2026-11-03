#!/usr/bin/env python3
"""Bounded test owner: retain CPU/RAM samples every second and exact child identities."""
import argparse,json,os,signal,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--output',type=Path,required=True)
p.add_argument('--seconds',type=int,default=120)
p.add_argument('command',nargs=argparse.REMAINDER)
a=p.parse_args()
if a.command and a.command[0]=='--': a.command.pop(0)
if not a.command or not 1<=a.seconds<=600: raise SystemExit('command and 1..600 second bound required')
out=a.output.resolve()
out.mkdir(parents=True,exist_ok=False)
if subprocess.check_output(['findmnt','-n','-o','FSTYPE','--target',str(out)],text=True).strip() in ('tmpfs','ramfs'): raise SystemExit('disk-backed output required')
if os.statvfs(out).f_bavail*os.statvfs(out).f_frsize<20*1024**3: raise SystemExit('20 GiB free reserve required')
(out/'t').mkdir()
env=os.environ.copy();env.update(TMPDIR=str(out/'t'),TMP=str(out/'t'),TEMP=str(out/'t'))
start=time.monotonic();wall=time.time()
log=(out/'command.log').open('wb')
child=subprocess.Popen(a.command,stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
tracked={}
def info(pid):
    try:
        raw=Path(f'/proc/{pid}/stat').read_text(); fields=raw[raw.rindex(')')+2:].split()
        status=Path(f'/proc/{pid}/status').read_text()
        affinity=next((line.split(':',1)[1].strip() for line in status.splitlines() if line.startswith('Cpus_allowed_list:')),None)
        cgroup=next((line[3:] for line in Path(f'/proc/{pid}/cgroup').read_text().splitlines() if line.startswith('0::')),None)
        quotas=[]
        if cgroup:
            directory=Path('/sys/fs/cgroup')/cgroup.lstrip('/')
            while directory==Path('/sys/fs/cgroup') or Path('/sys/fs/cgroup') in directory.parents:
                try: quotas.append({'path':str(directory),'cpu_max':(directory/'cpu.max').read_text().strip()})
                except OSError: pass
                if directory==Path('/sys/fs/cgroup'):break
                directory=directory.parent
        return {'pid':pid,'ppid':int(fields[1]),'pgrp':int(fields[2]),'start_ticks':int(fields[19]),'cpu_ticks':int(fields[11])+int(fields[12]),'rss_bytes':int(fields[21])*os.sysconf('SC_PAGE_SIZE'),'affinity':affinity,'cgroup':cgroup,'quotas':quotas}
    except (OSError,ValueError): return None
def descendants(pid):
    todo=[pid];seen=set()
    while todo:
        n=todo.pop()
        if n in seen:continue
        seen.add(n);entry=info(n)
        if entry: tracked[(n,entry['start_ticks'])]=entry
        try: todo.extend(map(int,Path(f'/proc/{n}/task/{n}/children').read_text().split()))
        except (OSError,ValueError):pass

def sample():
    descendants(child.pid)
    active=[]
    for (pid,ticks),old in list(tracked.items()):
        current=info(pid)
        if current and current['start_ticks']==ticks:active.append(current)
    mem={}
    for line in Path('/proc/meminfo').read_text().splitlines():
        fields=line.split()
        if fields[0] in ('MemAvailable:','MemTotal:','SwapFree:','SwapTotal:'):mem[fields[0][:-1]]=int(fields[1])*1024
    return {'elapsed_s':round(time.monotonic()-start,3),'system_cpu':Path('/proc/stat').read_text().splitlines()[0],'memory':mem,'owned':active,'sum_rss_bytes':sum(x['rss_bytes'] for x in active)}
reason=None;peak=0;count=0
with (out/'resources.jsonl').open('w') as samples:
    while True:
        s=sample();peak=max(peak,s['sum_rss_bytes']);count+=1
        samples.write(json.dumps(s)+'\n');samples.flush()
        status=child.poll()
        if status is not None:break
        if s['memory']['MemAvailable']<1024**3:reason='system available RAM below 1 GiB';break
        if time.monotonic()-start>a.seconds:reason='finite test deadline';break
        if (out/'command.log').stat().st_size>32*1024**2:reason='log bound';break
        time.sleep(1)
    for sig in (signal.SIGTERM,signal.SIGKILL):
        for (pid,ticks) in reversed(list(tracked)):
            current=info(pid)
            if current and current['start_ticks']==ticks:
                try:os.kill(pid,sig)
                except ProcessLookupError:pass
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:pass
        time.sleep(.2)
    after=[]
    for (pid,ticks) in tracked:
        current=info(pid)
        if current and current['start_ticks']==ticks:after.append(current)
log.close()
receipt={'started_unix':wall,'ended_unix':time.time(),'duration_s':round(time.monotonic()-start,3),'command':a.command,'exit_code':child.poll(),'stop_reason':reason,'peak_sum_rss_bytes':peak,'sum_rss_note':'Sampled sum; shared pages may be counted more than once.','resource_samples':count,'tracked_identities':[{'pid':p,'start_ticks':t} for p,t in tracked],'remaining':after}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:receipt[k] for k in ('duration_s','exit_code','stop_reason','peak_sum_rss_bytes','resource_samples','remaining')}))
raise SystemExit(0 if child.returncode==0 and not reason and not after else 1)
