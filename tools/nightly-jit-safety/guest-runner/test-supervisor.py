#!/usr/bin/env python3
"""Actual tiny process-group readers, including a real zombie; no browser."""
import hashlib,importlib.util,json,pathlib,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('supervisor',HERE/'supervise-broad-session.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
command=[sys.executable,'-c','import os,time; child=os.fork();\nif child==0:os._exit(0)\nprint(child,flush=True);time.sleep(.5);os.waitpid(child,0);time.sleep(.1)']
child=subprocess.Popen(command,stdout=subprocess.PIPE,text=True,start_new_session=True)
seen=[]
try:
 descendant=int(child.stdout.readline());row=module.proc(child.pid);owner=module.owner(row)
 end=time.monotonic()+.4
 while time.monotonic()<end:
  seen=module.members(owner)
  if any(item['pid']==descendant and item['state']=='Z' for item in seen):break
  time.sleep(.01)
 assert any(item['pid']==descendant and item['state']=='Z' for item in seen),'actual zombie omitted'
 assert module.proc(descendant)['exe'] is None,'real zombie no executable'
 assert len(seen)==2 and all(item['pgid']==owner['pgid'] and item['sid']==owner['sid'] for item in seen)
 child.wait(timeout=5);assert child.returncode==0 and not module.members(owner),'physical group remains'
 raw=' /invalid\0'
 assert not module.browser_admitted({'pid':90,'pgid':90,'sid':90,'ppid':owner['pid'],'exe':'/bin/true','argv':raw},owner,pathlib.Path('/invalid'))
 report={'kind':'broad-supervisor-actual-tiny-group-check-v1','pass':True,'checks':5,'owner':owner,'actualZombieSnapshot':seen,'childExit':child.returncode,'ownerReaped':True,'physicalGroupEmpty':not module.members(owner),'forcedCleanup':False,'browserStarted':False,'guestAcceptance':False,'supervisorSHA256':hashlib.file_digest(open(HERE/'supervise-broad-session.py','rb'),'sha256').hexdigest()}
 (HERE.parent/'status/actual-tiny-group-check.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
finally:
 if child.poll() is None:child.wait(timeout=5) # Tiny workload is finite; never strand its child by stopping its parent.
