#!/usr/bin/env python3
"""Finite genuine GNU make inventory; terminate only our owned process group."""
import os,pathlib,subprocess,time,signal,json,shutil,resource,sys,re
def members(pgid):
 result=[]
 for entry in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   fields=entry.read_text().rsplit(')',1)[1].split()
   if int(fields[2])==pgid and fields[0]!='Z':result.append(int(entry.parent.name))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
 return result
t=pathlib.Path(os.environ['GLIBC_TASK']).resolve();limit=int(os.environ.get('GLIBC_INVENTORY_SECONDS','600'));assert 1<=limit<=600
label=sys.argv[1] if len(sys.argv)>1 else 'run1';assert re.fullmatch(r'[A-Za-z0-9_-]+',label)
for name in ['inventory-'+label+'-exit.json','inventory-'+label+'-command.json','inventory-'+label+'-progress.json','live-'+label+'.json','fullmake-'+label+'.log']:
 assert not (t/'logs'/name).exists(), 'select a unique run label: '+name
for name in ['TMPDIR','TMP','TEMP']:
 assert pathlib.Path(os.environ[name]).resolve().is_relative_to(t), 'temporary paths must remain task owned'
filesystem=subprocess.check_output(['findmnt','-n','-o','FSTYPE','--target',str(t)],text=True).strip()
assert filesystem not in ['tmpfs','ramfs'], 'persistent disk storage required'
initialFree=shutil.disk_usage(t).free
initialSize=int(subprocess.check_output(['du','-sk',str(t)]).split()[0])*1024
assert initialFree>=8589934592, '8 GiB launch reserve required'
assert initialSize<2147483648, '2 GiB task cap reached before launch'
argv=['make','-C',str(t/'objects/fullmake'),'-k','-j2','lib']
(t/'logs'/('inventory-'+label+'-command.json')).write_text(json.dumps({'argv':argv,'secondsLimit':limit,'reserveBytes':8589934592,'hardStopBytes':5368709120,'taskLimitBytes':2147483648,'prelaunchFilesystem':filesystem,'prelaunchAvailableBytes':initialFree,'prelaunchTaskBytes':initialSize},indent=2)+'\n')
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
log=(t/'logs'/('fullmake-'+label+'.log')).open('wb');p=subprocess.Popen(argv,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
(t/'logs'/('live-'+label+'.json')).write_text(json.dumps({'pid':p.pid,'pgid':p.pid,'argv':argv},indent=2)+'\n');print('owned GNU make PID/PGID',p.pid,flush=True)
started=time.monotonic();reason='completed';samples=[]
while p.poll() is None:
 elapsed=time.monotonic()-started;free=shutil.disk_usage(t).free
 size=int(subprocess.check_output(['du','-sk',str(t)]).split()[0])*1024
 objects=[]
 for obj in (t/'objects/fullmake').rglob('*.o'):
  try:
   with obj.open('rb') as f:
    if f.read(8)==b'\0asm\1\0\0\0' and obj.stat().st_size>8:objects.append(obj)
  except FileNotFoundError:pass
 row={'elapsedSeconds':round(elapsed,2),'taskBytes':size,'availableBytes':free,'completedObjects':len(objects)};samples.append(row)
 (t/'logs'/('inventory-'+label+'-progress.json')).write_text(json.dumps(samples,indent=2)+'\n')
 if elapsed>=limit:reason='time limit'
 elif free<=5368709120:reason='5 GiB hard stop'
 elif size>=2147483648:reason='2 GiB task cap'
 else:time.sleep(min(10,max(0.1,limit-elapsed)));continue
 os.killpg(p.pid,signal.SIGTERM)
 try:p.wait(timeout=2)
 except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
 break
status=p.wait();log.close()
# A reaped make parent does not prove that descendants left the owned group.
remaining=members(p.pid)
if remaining:
 os.killpg(p.pid,signal.SIGTERM);deadline=time.monotonic()+2
 while members(p.pid) and time.monotonic()<deadline:time.sleep(.1)
 if members(p.pid):os.killpg(p.pid,signal.SIGKILL)
 deadline=time.monotonic()+5
 while members(p.pid) and time.monotonic()<deadline:time.sleep(.1)
assert not members(p.pid), 'owned process-group members remain'
(t/'logs'/('inventory-'+label+'-exit.json')).write_text(json.dumps({'exit':status,'reason':reason,'elapsedSeconds':round(time.monotonic()-started,2),'pid':p.pid,'processGroupOwned':True,'processGroupLiveMembers':members(p.pid),'terminalAvailableBytes':shutil.disk_usage(t).free,'terminalTaskBytes':int(subprocess.check_output(['du','-sk',str(t)]).split()[0])*1024},indent=2)+'\n')
print('GNU make inventory',status,reason,flush=True)
