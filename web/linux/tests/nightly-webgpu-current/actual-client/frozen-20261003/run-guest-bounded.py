#!/usr/bin/env python3
"""One diagnostic owner; inherited Chrome limits and two strictly owned groups."""
import hashlib,json,os,pathlib,re,resource,runpy,shutil,signal,subprocess,sys,time
TASK=pathlib.Path('/mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003')
ROOT=pathlib.Path('/mnt/p6/project/linux/linuxonweb')
READERS=pathlib.Path('/mnt/p6/project/build/nightly-native-package-transform-20261003/bounded-run.py')
READERS_SHA='e5688f4e2a6fab354fbc067c205c47b8b36221a9eeb4f4453625daa5092ce264'
CHROME='/home/a/.local/archpkg/pacman/usr/lib/chromium/chromium'
GIB=1024**3
LIMITS={'addressSpaceBytes':2*1024**4,'coreBytes':0,'groupRssBytes':12*GIB,'availableFloorBytes':4*GIB,'timeoutSeconds':540,'taskCapBytes':1*GIB,'freeReserveBytes':20*GIB}
def sha(p):
 with open(p,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
assert sha(READERS)==READERS_SHA,'pinned reader source changed'
sys.dont_write_bytecode=True
borrowed=runpy.run_path(str(READERS));memory=borrowed['memory'];group=borrowed['group']
def write(p,r):p.write_text(json.dumps(r,indent=2)+'\n')
def guards():
 resource.setrlimit(resource.RLIMIT_AS,(LIMITS['addressSpaceBytes'],LIMITS['addressSpaceBytes']))
 resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def info(pid):
 try:
  base=pathlib.Path('/proc')/str(pid);tail=(base/'stat').read_text().rsplit(')',1)[1].split()
  return {'pid':pid,'ppid':int(tail[1]),'pgid':int(tail[2]),'session':int(tail[3]),'starttime':int(tail[19]),'state':tail[0],'asBytes':int(tail[20]),'exe':os.readlink(base/'exe'),'raw':(base/'cmdline').read_bytes().decode()}
 except (OSError,ValueError,IndexError):return None
def admit_chrome(row,nodepid,profile):
 if not row or row['exe']!=CHROME or row['ppid']!=nodepid or row['pid']!=row['pgid'] or row['pid']!=row['session']:return False
 argv=row['raw'].split('\0')
 if argv[-1]!='':return False
 argv.pop()
 if len(argv)==1:
  if any(c in argv[0] for c in "'\"\r\n\t"):return False
  argv=argv[0].split(' ')
 if not argv or argv[0]!=CHROME or argv[-1]!='about:blank' or any(not a or any(c.isspace() for c in a) for a in argv):return False
 if any(a=='--type' or a.startswith('--type=') for a in argv):return False
 return [a for a in argv if a.startswith('--user-data-dir')]==['--user-data-dir='+str(profile)] and [a for a in argv if a.startswith('--remote-debugging-port')]==['--remote-debugging-port=0']
def verify_group_owner(owner):
 current=info(owner['pid'])
 if current and (current['starttime']!=owner['starttime'] or current['exe']!=owner['exe'] or current['pgid']!=owner['pgid'] or current['session']!=owner['session']):
  raise RuntimeError('owned group leader identity changed')
 return owner['pgid']
def usage(cache=None):
 roots=[TASK/'t']
 if cache is not None:
  assert cache.parent.parent==TASK and cache.name=='cache' and cache.parent.name.startswith('guest-run')
  roots.append(cache)
 transient=r"du: cannot access '("+'|'.join(re.escape(str(root)) for root in roots)+r")/([^'\r\n]+)': No such file or directory"
 for attempt in range(3):
  result=subprocess.run(['du','-sb',str(TASK)],capture_output=True,text=True,env=dict(os.environ,LC_ALL='C'))
  total=re.fullmatch(r'(\d+)\t'+re.escape(str(TASK))+r'\n?',result.stdout)
  lines=result.stderr.splitlines()
  allowed=bool(lines) and all((m:=re.fullmatch(transient,line)) and '..' not in pathlib.Path(m[2]).parts for line in lines)
  if not total or not (result.returncode==0 and not lines or result.returncode==1 and allowed):
   raise RuntimeError('task disk usage failed: '+result.stderr[:4096])
  if result.returncode==0 or attempt==2:return int(total[1])
def verify_limits(pid):
 lines=(pathlib.Path('/proc')/str(pid)/'limits').read_text().splitlines()
 address=next(l for l in lines if l.startswith('Max address space')).split()
 core=next(l for l in lines if l.startswith('Max core file size')).split()
 assert int(address[-3])==LIMITS['addressSpaceBytes'] and int(address[-2])==LIMITS['addressSpaceBytes']
 assert int(core[-3])==0 and int(core[-2])==0
 return {'addressSpaceBytes':int(address[-3]),'coreBytes':int(core[-3]),'oomScoreAdjObserved':int((pathlib.Path('/proc')/str(pid)/'oom_score_adj').read_text())}
def main():
 if len(sys.argv)==2 and sys.argv[1]=='--probe':
  target=TASK/'gpu-guest-supervisor-probe.json';assert not target.exists()
  command=[sys.executable,'-c','import resource,json,pathlib,time;print(json.dumps({"AS":resource.getrlimit(resource.RLIMIT_AS),"core":resource.getrlimit(resource.RLIMIT_CORE),"oom":pathlib.Path("/proc/self/oom_score_adj").read_text().strip()}),flush=True);time.sleep(0.5)']
  child=subprocess.Popen(command,stdout=subprocess.PIPE,text=True,start_new_session=True,preexec_fn=guards)
  try:
   line=child.stdout.readline();observed=json.loads(line);row=info(child.pid);actual=verify_limits(child.pid);members=group(child.pid);available,swap=memory()
   assert row['pgid']==child.pid and row['session']==child.pid and any(m['pid']==child.pid and m['rssBytes']>0 for m in members)
   assert observed['AS']==[LIMITS['addressSpaceBytes']]*2 and observed['core']==[0,0]
   assert available>0 and swap>=0
   assert admit_chrome({'pid':1,'pgid':1,'session':1,'ppid':2,'exe':CHROME,'raw':CHROME+' --headless --remote-debugging-port=0 --user-data-dir='+str(TASK/'probe-profile')+' about:blank\0'},2,TASK/'probe-profile')
   bad={'pid':1,'pgid':1,'session':1,'ppid':2,'exe':CHROME,'raw':CHROME+' --remote-debugging-port=9222 --user-data-dir='+str(TASK/'probe-profile')+' about:blank\0'}
   assert not admit_chrome(bad,2,TASK/'probe-profile')
   child.wait(timeout=5);assert child.returncode==0 and not group(child.pid)
   report={'pass':True,'limits':LIMITS,'actualChildLimits':actual,'actualReaders':{'group':members,'availableBytes':available,'swapBytes':swap},'childExit':child.returncode,'ownedGroupEmpty':not group(child.pid),'wrapperSHA256':sha(__file__),'readerSHA256':READERS_SHA,'browserStarted':False,'guestStarted':False}
   write(target,report);print(json.dumps(report));return
  finally:
   if child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.wait()
 assert len(sys.argv)==4 and sys.argv[1]=='--run' and sys.argv[3] in ('hardware','software')
 out=pathlib.Path(sys.argv[2]);assert out.parent==TASK and not out.exists()
 preflight=json.loads((TASK/'guest-prelaunch.json').read_text())
 assert all(sha(s['path'])==s['sha256'] for s in preflight['sources'])
 probe=json.loads((TASK/'gpu-guest-supervisor-probe.json').read_text());assert probe['pass'] and probe['wrapperSHA256']==sha(TASK/'run-guest-bounded.py')
 available,swap=memory();assert available>=4*GIB and usage()<1*GIB and shutil.disk_usage(TASK).free>=20*GIB
 scratch=TASK/'t';scratch.mkdir(exist_ok=True)
 assert os.statvfs(scratch).f_bavail*os.statvfs(scratch).f_frsize>=20*GIB
 argv=['/usr/bin/node',str(TASK/'run-guest.mjs'),sys.argv[3],str(out)]
 env=dict(os.environ,TMPDIR='/mnt/p6/project/build/nrgs-20261003',TMP='/mnt/p6/project/build/nrgs-20261003',TEMP='/mnt/p6/project/build/nrgs-20261003',PYTHONDONTWRITEBYTECODE='1')
 started=time.monotonic();peak=0;peak_as={'bytes':0};minimum=available;reason=None;chrome=None;node=None;term=None;record=None
 log=TASK/(out.name+'-supervisor.log');status=TASK/(out.name+'-supervisor-status.json');assert not log.exists() and not status.exists()
 with log.open('xb') as output:
  child=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=guards)
  try:
   while not node:
    node=info(child.pid)
    if node:break
    assert child.poll() is None and time.monotonic()-started<2
    time.sleep(.01)
   assert node['pid']==node['pgid']==node['session'] and node['exe']==os.path.realpath('/usr/bin/node')
   node_limits=verify_limits(child.pid)
   while True:
    code=child.poll()
    if not chrome:
     # Only a direct child of this exact live Node owner can be admitted.
     node_now=info(child.pid)
     if node_now and node_now['starttime']==node['starttime']:
      for p in pathlib.Path('/proc').iterdir():
       if not p.name.isdecimal():continue
       row=info(int(p.name))
       if admit_chrome(row,child.pid,out/'profile'):
        chrome={k:row[k] for k in ['pid','ppid','pgid','session','starttime','exe']};chrome['limits']=verify_limits(row['pid']);break
    groups=[verify_group_owner(node)]+([verify_group_owner(chrome)] if chrome else [])
    members=[dict(m,ownedPGID=g) for g in groups for m in group(g)]
    live=[m for m in members if m['state']!='Z'];rss=sum(m['rssBytes'] for m in live);peak=max(peak,rss)
    for m in live:
     row=info(m['pid'])
     if row and row['pgid']==m['ownedPGID'] and row['asBytes']>peak_as['bytes']:peak_as={'pid':row['pid'],'ownedPGID':row['pgid'],'bytes':row['asBytes']}
    available,_=memory();minimum=min(minimum,available)
    if not reason:
     if time.monotonic()-started>540:reason='outerTimeout'
     elif rss>12*GIB:reason='ownedGroupRSS'
     elif available<4*GIB:reason='hostAvailableRAM'
     elif usage(out/'cache' if chrome else None)>1*GIB:reason='taskCap'
     elif shutil.disk_usage(TASK).free<20*GIB:reason='freeReserve'
     elif code is not None and live:reason='nodeExitedWithLiveOwnedDescendants'
    if reason:
     if term is None:term=time.monotonic()
     for g in groups:
      try:os.killpg(g,signal.SIGKILL if time.monotonic()-term>5 else signal.SIGTERM)
      except ProcessLookupError:pass
    record={'schema':1,'limits':LIMITS,'argv':argv,'nodeOwner':{k:node[k] for k in ['pid','pgid','session','starttime','exe']},'nodeObservedLimits':node_limits,'chromeOwner':chrome,'peakGroupRSSBytes':peak,'peakProcessAS':peak_as,'minimumAvailableBytes':minimum,'elapsedSeconds':time.monotonic()-started,'stopReason':reason,'childExit':code,'members':members,'baselineAcceptance':False,'jitAcceptance':False,'gpuAcceptance':False,'tlsAcceptance':False,'releaseAcceptance':False,'wrapperSHA256':sha(__file__),'readersSHA256':READERS_SHA}
    write(status,record)
    if code is not None and not members:break
    if code is not None and not live and time.monotonic()-started>555:break
    time.sleep(.5)
  except Exception as error:
   reason='supervisorException'
   record=record or {'schema':1,'limits':LIMITS,'argv':argv,'nodeOwner':node,'chromeOwner':chrome,'wrapperSHA256':sha(__file__),'baselineAcceptance':False,'jitAcceptance':False,'gpuAcceptance':False,'tlsAcceptance':False,'releaseAcceptance':False}
   record.update(stopReason=reason,supervisorException=str(error)[:4096],elapsedSeconds=time.monotonic()-started)
  finally:
   # Strictly owned groups only; no broad process-name selection.
   for owner in [node]+([chrome] if chrome else []):
    if not owner:continue
    g=verify_group_owner(owner)
    if group(g):
     try:os.killpg(g,signal.SIGKILL)
     except ProcessLookupError:pass
   child.wait(timeout=10)
  record.update(ownerReaped=True,childExit=child.returncode,nodeGroupEmpty=not group(child.pid),chromeGroupEmpty=not chrome or not group(chrome['pgid']),remainingNodeGroup=group(child.pid),remainingChromeGroup=group(chrome['pgid']) if chrome else [],logSHA256=sha(log))
  try:record['taskBytes']=usage(out/'cache' if chrome else None)
  except Exception as error:record.update(stopReason=record.get('stopReason') or 'supervisorException',terminalTaskUsageFailure=str(error)[:4096])
  write(status,record);print(json.dumps({k:record.get(k) for k in ['childExit','stopReason','ownerReaped','nodeGroupEmpty','chromeGroupEmpty','elapsedSeconds','peakGroupRSSBytes']}))
  if child.returncode or record.get('stopReason'):raise SystemExit(1)
if __name__=='__main__':main()
