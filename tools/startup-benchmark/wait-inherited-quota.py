#!/usr/bin/env python3
"""Wait for the executor's normal quota placement, then exec without moving groups."""
import json,os,pathlib,sys,time
if len(sys.argv)<2:raise SystemExit('command required')
started=time.monotonic()
while True:
 membership=pathlib.Path('/proc/self/cgroup').read_text().splitlines()
 quota=pathlib.Path('/sys/fs/cgroup/cpulimit.slice/cpu.max').read_text().split()
 if any(row.startswith('0::/cpulimit.slice/') for row in membership) and quota[0]!='max' and 0<int(quota[0])/int(quota[1])<=3:break
 if time.monotonic()-started>=10:raise SystemExit('inherited enforced quota placement not established')
 time.sleep(.1)
print(json.dumps({'inheritedQuotaWaitSeconds':round(time.monotonic()-started,3),'membershipUnchangedByTool':True}),flush=True)
os.execvp(sys.argv[1],sys.argv[1:])
