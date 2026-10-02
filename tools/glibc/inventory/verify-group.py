#!/usr/bin/env python3
"""Independent terminal cleanup proof for the recorded owned make group."""
import pathlib,os,json,time,signal
t=pathlib.Path(os.environ['GLIBC_TASK']);pgid=json.loads((t/'logs/live-process.json').read_text())['pgid']
def members():
 result=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   fields=p.read_text().rsplit(')',1)[1].split()
   if int(fields[2])==pgid and fields[0]!='Z':result.append(int(p.parent.name))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
 return result
before=members();actions=[]
if before:
 os.killpg(pgid,signal.SIGTERM);actions.append('SIGTERM owned PGID');deadline=time.monotonic()+2
 while members() and time.monotonic()<deadline:time.sleep(.1)
 if members():os.killpg(pgid,signal.SIGKILL);actions.append('SIGKILL owned PGID')
 deadline=time.monotonic()+5
 while members() and time.monotonic()<deadline:time.sleep(.1)
assert not members()
(t/'logs/terminal-group-proof.json').write_text(json.dumps({'pass':True,'pgid':pgid,'liveMembersBefore':before,'actions':actions,'liveMembersAfter':members(),'activeSupervisorSnapshot':'source-snapshots/active-run-supervisor-original.py','note':'Independent terminal audit supplements original in-flight supervisor; updated replay supervisor performs the same check'},indent=2)+'\n')
