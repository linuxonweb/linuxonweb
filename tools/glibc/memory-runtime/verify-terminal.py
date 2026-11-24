#!/usr/bin/env python3
import pathlib,os,json,shutil,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
def members(group):
 out=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   f=p.read_text().rsplit(')',1)[1].split()
   if int(f[2])==group and f[0]!='Z':out.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return out
groups=[]
for p in (T/'logs/supervision').glob('*.json'):
 j=json.loads(p.read_text());group=j['pgid'];rows=members(group);assert not rows;groups.append({'proof':str(p),'pgid':group,'terminalMembers':rows,'exit':j['exit']})
browsers=[]
for mode in ['native-run1','native-run2','fpcast-run1']:
 p=T/mode/'result.json';j=json.loads(p.read_text());rows=members(j['browserPid']);assert not rows and j['browserExit']['code']==0 and j['serverClosed'];browsers.append({'proof':str(p),'browserPidAndPgid':j['browserPid'],'terminalMembers':rows,'browserExit':j['browserExit'],'serverClosed':True})
listeners=subprocess.check_output(['ss','-ltnH','( sport = :4213 or sport = :9423 )'],text=True);assert not listeners.strip()
use=int(subprocess.check_output(['du','-sk',str(T)]).split()[0]);free=shutil.disk_usage(T).free;assert use<2097152 and free>5368709120
(T/'external-terminal-proof.json').write_text(json.dumps({'pass':True,'supervisedGroups':groups,'browserGroups':browsers,'ownedListeners':[],'taskKiB':use,'freeBytes':free},indent=2)+'\n');print('External owned groups/browsers/listeners/storage PASS')
