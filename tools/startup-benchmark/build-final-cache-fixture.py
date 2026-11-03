#!/usr/bin/env python3
"""Compose diagnostic resources before the immutable cache generation is hashed."""
import datetime,json,pathlib,subprocess,sys,time
if len(sys.argv)!=3:raise SystemExit('usage: OUTPUT BASE_IMAGE_DIRECTORY')
out=pathlib.Path(sys.argv[1]);base=pathlib.Path(sys.argv[2])
if out.exists():raise ValueError('fresh final cache fixture output required')
out.mkdir(parents=True);started=time.monotonic();record={'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'diagnosticOnly':True,'phases':[]}
commands=[['python3','tools/startup-benchmark/prepare-readiness.py','--output',str(out/'readiness'),'--nonce','readinessevidence','--base-dir',str(base)],['python3','tools/firefox-lifecycle/build-cache-image.py','--base-dir',str(out/'readiness'),'--output',str(out/'cache'),'--desktop-extras-manifest',str(out/'readiness/desktop-extras.cpio.json'),'--desktop-extras-file',str(out/'readiness/desktop-extras.cpio')]]
for command in commands:
 t=time.monotonic();p=subprocess.run(command,check=True);record['phases'].append({'command':command,'durationSeconds':round(time.monotonic()-t,3),'exitCode':p.returncode});(out/'phases.json').write_text(json.dumps(record,indent=2)+'\n')
record.update(finishedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),durationSeconds=round(time.monotonic()-started,3),passBuild=True);(out/'phases.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
