#!/usr/bin/env python3
"""Finite owner of a command group; retain argv/cwd/status and terminal members."""
import pathlib,os,sys,json,subprocess,time,signal,shutil,resource
T=pathlib.Path(os.environ['GLIBC_TASK']);label=sys.argv[1];limit=int(sys.argv[2]);args=sys.argv[3:];D=T/'logs/supervision';D.mkdir(exist_ok=True)
def storage(reserve):
 assert shutil.disk_usage(T).free>reserve
 assert int(subprocess.check_output(['du','-sk',str(T)]).split()[0])*1024<3221225472
def members(group):
 out=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   fields=p.read_text().rsplit(')',1)[1].split()
   if int(fields[2])==group and fields[0]!='Z':out.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return out
storage(8589934592);resource.setrlimit(resource.RLIMIT_CORE,(0,0));start=time.monotonic()
p=subprocess.Popen(args,start_new_session=True);r={'argv':args,'cwd':os.getcwd(),'pid':p.pid,'pgid':p.pid,'timeoutSeconds':limit,'actions':[]};f=D/(label+'.json');assert not f.exists();f.write_text(json.dumps(r,indent=2)+'\n');print('OWNED',label,'PID/PGID',p.pid,flush=True)
try:p.wait(timeout=limit)
except subprocess.TimeoutExpired:r['timedOut']=True
if members(p.pid):
 os.killpg(p.pid,signal.SIGTERM);r['actions'].append('SIGTERM owned PGID');deadline=time.monotonic()+2
 while members(p.pid) and time.monotonic()<deadline:time.sleep(.1)
 if members(p.pid):os.killpg(p.pid,signal.SIGKILL);r['actions'].append('SIGKILL owned PGID')
 deadline=time.monotonic()+5
 while members(p.pid) and time.monotonic()<deadline:time.sleep(.1)
p.wait();r.update(exit=p.returncode,elapsedSeconds=time.monotonic()-start,terminalMembers=members(p.pid));f.write_text(json.dumps(r,indent=2)+'\n');assert not r['terminalMembers'];storage(5368709120);sys.exit(p.returncode or int(r.get('timedOut',False)))
