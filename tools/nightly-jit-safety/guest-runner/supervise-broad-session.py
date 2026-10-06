#!/usr/bin/env python3
"""Finite adaptation of Run59 baseline supervisor; only exact owned sessions."""
import ctypes,hashlib,json,os,pathlib,resource,shutil,signal,subprocess,re,sys,time
TASK=None
TASK_OUT=None
TASK_ID=None
HERE=pathlib.Path(__file__).resolve().parent
GIB=1024**3
LIMITS={'addressSpaceBytes':2*1024**4,'coreBytes':0,'groupRssBytes':12*GIB,'availableFloorBytes':4*GIB,'sessionWallSeconds':150,'supervisorWallSeconds':170,'naturalDrainSeconds':10,'taskCapBytes':4*GIB,'freeReserveBytes':20*GIB,'nodeOomScoreAdj':1000}
def write(path,value):
 temporary=path.with_suffix(path.suffix+'.tmp');temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)
def proc(pid):
 try:
  root=pathlib.Path('/proc')/str(pid);raw=(root/'stat').read_text();fields=raw.rsplit(')',1)[1].split()
  try:exe=os.readlink(root/'exe')
  except (FileNotFoundError,PermissionError):exe=None
  try:argv=(root/'cmdline').read_bytes().decode()
  except PermissionError:argv=None
  return {'pid':pid,'state':fields[0],'ppid':int(fields[1]),'pgid':int(fields[2]),'sid':int(fields[3]),'startTicks':fields[19],'rssBytes':int(fields[21])*os.sysconf('SC_PAGE_SIZE'),'asBytes':int(fields[20]),'exe':exe,'argv':argv}
 except (FileNotFoundError,ProcessLookupError):return None
def members(owner):
 rows=[]
 for item in pathlib.Path('/proc').iterdir():
  if not item.name.isdecimal():continue
  row=proc(int(item.name))
  if row and row['pgid']==owner['pgid']:
   if row['sid']!=owner['sid'] or int(row['startTicks'])<int(owner['startTicks']) or row['pid']==owner['pid'] and row['startTicks']!=owner['startTicks']:raise RuntimeError('exact owned group identity changed')
   rows.append(row) # Include zombies as physical members.
 return rows
def cleanup_members(identity):
 # Setup faults may prevent proc() from working; independently read only the
 # expected Popen session. PID/group/SID and boot-tick lower bound stay fixed.
 try:return members(identity)
 except BaseException:
  rows=[]
  for item in pathlib.Path('/proc').iterdir():
   if not item.name.isdecimal():continue
   try:fields=(item/'stat').read_text().rsplit(')',1)[1].split()
   except (FileNotFoundError,ProcessLookupError):continue
   if int(fields[2])!=identity['pgid']:continue
   if int(fields[3])!=identity['sid'] or int(fields[19])<int(identity['startTicks']) or int(item.name)==identity['pid'] and not identity.get('startBoundOnly',False) and fields[19]!=identity['startTicks']:raise RuntimeError('fallback owned session identity changed')
   rows.append({'pid':int(item.name),'ppid':int(fields[1]),'pgid':int(fields[2]),'sid':int(fields[3]),'state':fields[0],'startTicks':fields[19]})
  return rows
def owner(row):
 assert row and row['pid']==row['pgid']==row['sid']
 return {key:row[key] for key in ['pid','pgid','sid','startTicks','exe']}
def available():
 values=dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines());return int(values['MemAvailable'].split()[0])*1024
def usage():
 # Reuse the accepted ordinary narrow owned scratch/cache/profile ENOENT rule.
 def task_identity():
  st=TASK.stat();return (st.st_dev,st.st_ino)
 if TASK.resolve()!=TASK or task_identity()!=TASK_ID:raise RuntimeError('owned task root identity changed')
 roots=[TASK/'t']
 if TASK_OUT is not None:
  for root in [TASK_OUT/'cache',TASK_OUT/'profile']:
   if root.is_dir():roots.append(root)
 for root in roots:
  if not root.is_dir() or root.resolve()!=root:raise RuntimeError('noncanonical owned transient root')
 transient=r"du: cannot access '("+'|'.join(re.escape(str(root)) for root in roots)+r")/([^'\r\n]+)': No such file or directory"
 for attempt in range(3):
  result=subprocess.run(['du','-sb',str(TASK)],capture_output=True,text=True,env=dict(os.environ,LC_ALL='C'),timeout=10)
  if task_identity()!=TASK_ID:raise RuntimeError('owned task root identity changed')
  total=re.fullmatch(r'(\d+)\t'+re.escape(str(TASK))+r'\n?',result.stdout)
  lines=result.stderr.splitlines()
  allowed=bool(lines) and all((m:=re.fullmatch(transient,line)) and '..' not in pathlib.Path(m[2]).parts and (pathlib.Path(m[1])/m[2]).resolve().is_relative_to(pathlib.Path(m[1])) for line in lines)
  if not total or not (result.returncode==0 and not lines or result.returncode==1 and allowed):
   raise RuntimeError('task disk usage failed: '+result.stderr[:4096])
  if result.returncode==0 or attempt==2:return int(total[1])
def guards():
 resource.setrlimit(resource.RLIMIT_AS,(LIMITS['addressSpaceBytes'],)*2);resource.setrlimit(resource.RLIMIT_CORE,(0,0));pathlib.Path('/proc/self/oom_score_adj').write_text('1000')
def limits(pid):
 raw=(pathlib.Path('/proc')/str(pid)/'limits').read_text();return {'raw':raw,'oomScoreAdj':int((pathlib.Path('/proc')/str(pid)/'oom_score_adj').read_text())}
def owned_parent(row,node,supervisor_pid):
 return bool(row and row['ppid'] in [node['pid'],supervisor_pid] and int(row['startTicks'])>=int(node['startTicks']))
def browser_admitted(row,node,profile,supervisor_pid=None):
 if not row or not owned_parent(row,node,supervisor_pid) or row['pgid']!=node['pgid'] or row['sid']!=node['sid'] or row['exe']!='/home/a/.local/archpkg/pacman/usr/lib/chromium/chromium':return False
 argv=row['argv'].split('\0')
 if argv[-1]!='':return False
 argv.pop()
 return argv and argv[0]==row['exe'] and argv[-1]=='about:blank' and not any(arg.startswith('--type') for arg in argv) and [arg for arg in argv if arg.startswith('--user-data-dir')]==['--user-data-dir='+str(profile)] and [arg for arg in argv if arg.startswith('--remote-debugging-port')]==['--remote-debugging-port=0']
def parse(argv):
 assert len(argv)%2==0
 args={}
 for key,value in zip(argv[::2],argv[1::2]):
  assert key in ['--task-root','--out','--arm','--launch','--launch-sha256','--implementation','--implementation-sha256','--prelaunch-review','--prelaunch-review-sha256'] and key not in args;args[key]=value
 assert set(args)=={'--task-root','--out','--arm','--launch','--launch-sha256','--implementation','--implementation-sha256','--prelaunch-review','--prelaunch-review-sha256'}
 return args
def check_guard():
 if available()<LIMITS['availableFloorBytes']:return 'hostAvailableRAM'
 if usage()>=LIMITS['taskCapBytes']:return 'taskCap'
 if shutil.disk_usage(TASK).free<LIMITS['freeReserveBytes']:return 'freeReserve'
 return None
def main():
 global TASK,TASK_OUT,TASK_ID
 assert len(sys.argv)>2 and sys.argv[1]=='--run';args=parse(sys.argv[2:]);TASK=pathlib.Path(args['--task-root']);out=pathlib.Path(args['--out']);TASK_OUT=out
 assert TASK.is_absolute() and TASK.resolve()==TASK and TASK.is_dir() and TASK.parent in [pathlib.Path('/mnt/p6/build'),pathlib.Path('/mnt/p6/project/build')] and TASK.name!='nightly-broad-guest-runner-20261004'
 assert out.is_absolute() and out.parent.resolve()==TASK and not out.exists() and args['--arm'] in ['enabled','disabled']
 st=TASK.stat();TASK_ID=(st.st_dev,st.st_ino)
 assert not check_guard()
 for key in ['--launch','--implementation','--prelaunch-review']:
  assert hashlib.file_digest(open(args[key],'rb'),'sha256').hexdigest()==args[key+'-sha256']
 implementation=json.loads(pathlib.Path(args['--implementation']).read_text())
 for row in implementation['files']:
  assert hashlib.file_digest(open(row['path'],'rb'),'sha256').hexdigest()==row['sha256']
 assert any(row['path']==str(pathlib.Path(__file__).resolve()) for row in implementation['files'])
 scratch=TASK/'t';assert scratch.resolve()==scratch and scratch.is_dir()
 # Orphans from a failed owned browser remain ours to reap, rather than
 # leaving zombies to PID1. No unowned process receives a wait or a signal.
 assert ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0
 env=dict(os.environ,TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch),PYTHONDONTWRITEBYTECODE='1',NIGHTLY_BROAD_SUPERVISOR=str(os.getpid()))
 command=['/usr/bin/node',str(HERE/'run-broad-session.mjs'),'--run',*sys.argv[2:]]
 started=time.monotonic();peak=0;minimum=available();reason=None;forced=False;browser=None;browser_limits=None;drain_started=None;terminate_started=None
 log=TASK/(out.name+'-supervisor.log');status=TASK/(out.name+'-supervisor.json');assert not log.exists() and not status.exists()
 node=None;node_limits=None
 record={'kind':'actual-nightly-broad-owned-supervision-v1','pass':False,'guestAcceptance':False,'jitAcceptance':False,'gpuAcceptance':False,'limits':LIMITS,'argv':command,'spawnPID':None,'nodeOwner':None,'nodeObservedLimits':None}
 spawn_tick_bound=int(time.clock_gettime(time.CLOCK_BOOTTIME)*os.sysconf('SC_CLK_TCK'))
 with log.open('xb') as output:
  child=subprocess.Popen(command,env=env,cwd='/mnt/p6/project/linux/linuxonweb',stdout=output,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=guards)
  try:
   record['spawnPID']=child.pid
   while node is None and time.monotonic()-started<2:node=proc(child.pid);time.sleep(.01)
   node=owner(node);node_limits=limits(child.pid)
   record.update(nodeOwner=node,nodeObservedLimits=node_limits)
   while True:
    code=child.poll()
    if browser is None:
     # Admit only an actual direct child of the pinned live Node, before any
     # abnormal reparenting. Detached-browser PID declarations alone do not do.
     # Subreaper-adopted orphans remain owned even after Node has exited.
     for item in pathlib.Path('/proc').iterdir():
      if not item.name.isdecimal():continue
      row=proc(int(item.name))
      if browser_admitted(row,node,out/'profile',os.getpid()):browser={key:row[key] for key in ['pid','pgid','sid','startTicks','exe']};browser_limits=limits(row['pid']);break
    owners=[node] # Chrome always inherits this already pinned session/group.
    rows=[dict(row,ownedPGID=entry['pgid']) for entry in owners for row in members(entry)]
    # Reap exact orphaned descendants naturally; reaping is not termination.
    for row in rows:
     if row['pid']!=child.pid and row['ppid']==os.getpid() and row['state']=='Z':
      try:os.waitpid(row['pid'],os.WNOHANG)
      except ChildProcessError:pass
    rows=[dict(row,ownedPGID=entry['pgid']) for entry in owners for row in members(entry)]
    rss=sum(row['rssBytes'] for row in rows if row['state']!='Z');peak=max(peak,rss);minimum=min(minimum,available())
    if not reason:
     if time.monotonic()-started>LIMITS['supervisorWallSeconds']:reason='outerTimeout'
     elif rss>LIMITS['groupRssBytes']:reason='ownedRSS'
     elif code is None and terminate_started is None:reason=check_guard()
    if code is not None and rows:
     drain_started=drain_started or time.monotonic()
     if time.monotonic()-drain_started>LIMITS['naturalDrainSeconds']:reason=reason or 'remainingOwnedDescendants'
    if reason:
     terminate_started=terminate_started or time.monotonic()
     for entry in owners:
      if members(entry):
       forced=True
       try:os.killpg(entry['pgid'],signal.SIGKILL if time.monotonic()-terminate_started>5 else signal.SIGTERM)
       except ProcessLookupError:pass
    record.update(browserOwner=browser,browserObservedLimits=browser_limits,peakGroupRssBytes=peak,minimumAvailableBytes=minimum,elapsedSeconds=time.monotonic()-started,stopReason=reason,forcedCleanup=forced,nodeExit=code,members=rows)
    write(status,record)
    if code is not None and not rows:break
    if reason and time.monotonic()-terminate_started>15:break
    time.sleep(.05)
  except BaseException as error:reason=reason or 'supervisorException';record['error']=type(error).__name__+': '+str(error)
  finally:
   # Popen(start_new_session=True) completed. Recover its actual exact session
   # if setup/limits failed before the normal owner publication. The unreaped
   # direct child cannot be confused with a reused PID.
   if node is None or not all(key in node for key in ['pid','pgid','sid','startTicks']) or not node['pid']==node['pgid']==node['sid']:
    try:observed=proc(child.pid)
    except BaseException as recovery_error:observed=None;record['identityRecoveryError']=str(recovery_error)
    if observed and observed['pid']==observed['pgid']==observed['sid']:node={key:observed[key] for key in ['pid','pgid','sid','startTicks','exe']}
    else:
     # Successful setsid plus an unreaped direct child pins the expected group.
     # getpgid/getsid are independent of proc() and do not publish acceptance.
     try:exact_session=os.getpgid(child.pid)==child.pid and os.getsid(child.pid)==child.pid
     except ProcessLookupError:exact_session=False
     node={'pid':child.pid,'pgid':child.pid,'sid':child.pid,'startTicks':str(spawn_tick_bound),'exe':None,'startBoundOnly':True}
     record['identityResolved']=False;record['fallbackSessionVerified']=exact_session
   if node is not None:
    record['nodeOwner']={key:node[key] for key in ['pid','pgid','sid','startTicks','exe']}
    if cleanup_members(node):
     forced=True
     try:os.killpg(node['pgid'],signal.SIGKILL)
     except ProcessLookupError:pass
   elif child.poll() is None:
    forced=True;child.kill()
   child.wait(timeout=10)
   if node is not None:
    end=time.monotonic()+5
    while time.monotonic()<end:
     rows=cleanup_members(node)
     if not rows:break
     for row in rows:
      if row['pid']!=child.pid and row['ppid']==os.getpid() and row['state']=='Z':
       try:os.waitpid(row['pid'],os.WNOHANG)
       except ChildProcessError:pass
     time.sleep(.1)
  node_remaining=cleanup_members(node) if node is not None else [{'identityUnresolved':True}]
  browser_remaining=node_remaining # full shared group proof
  producer=json.loads((out/'producer-result.json').read_text()) if (out/'producer-result.json').is_file() else {}
  record.update(stopReason=reason,forcedCleanup=forced,nodeExit=child.returncode,ownerReaped=True,nodeGroupEmpty=not node_remaining,browserGroupEmpty=not browser_remaining,remainingNodeGroup=node_remaining,remainingBrowserGroup=browser_remaining,elapsedSeconds=time.monotonic()-started,logSHA256=hashlib.file_digest(open(log,'rb'),'sha256').hexdigest())
  record['pass']=record.get('identityResolved') is not False and not reason and not forced and child.returncode==0 and not node_remaining and bool(browser) and not browser_remaining and producer.get('captureProducerPass') is True
  write(status,record);print(json.dumps(record));raise SystemExit(0 if record['pass'] else 1)
if __name__=='__main__':main()
