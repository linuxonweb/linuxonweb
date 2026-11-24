#!/usr/bin/env python3
"""Replay only the selected 26 actual GNU make targets in their real subdirs."""
import os,pathlib,json,subprocess,sys,re
label=sys.argv[1];assert re.fullmatch(r'[A-Za-z0-9_-]+',label)
T=pathlib.Path(os.environ['GLIBC_TASK']);I=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])
assert not (T/('logs/make-last5-'+label+'-result.json')).exists()
selected=json.loads((T/'logs/selected-last5-syscalls.json').read_text())['wrappers']
original=json.loads((I/'logs/primary-failures.json').read_text())['failedUnits']
groups={}
for row in selected:
 matches=[r for r in original if r['primaryClass']=='unaudited generated syscall signature' and pathlib.Path(r['target']).stem==row['call']];assert len(matches)==1
 unit=pathlib.Path(matches[0]['unit']);groups.setdefault(str(unit.parent),[]).append(str(T/'objects/fullmake'/unit))
records=[]
for subdir,targets in sorted(groups.items()):
 command=['make','-C',str(T/'source/glibc-2.44'/subdir),'objdir='+str(T/'objects/fullmake'),'-j2',*targets]
 q=T/'logs'/('make-last5-'+label+'-'+subdir.replace('/','-')+'.log')
 with q.open('wb') as f:p=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
 records.append({'argv':command,'cwd':str(pathlib.Path.cwd()),'exit':p.returncode,'log':str(q)})
 (T/('logs/make-last5-'+label+'-result.json')).write_text(json.dumps({'pass':all(r['exit']==0 for r in records),'targetCount':5,'records':records},indent=2)+'\n')
 if p.returncode:raise SystemExit(p.returncode)
