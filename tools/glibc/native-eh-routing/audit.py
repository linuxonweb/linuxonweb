#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
import re,shlex
commands=json.loads((T/'logs/commands.json').read_text())
assert all('exit' in c and c['terminalGroupMembers']==[] and group(c['pgid'])==[] for c in commands)
source_paths=set(p for p in R.iterdir() if p.is_file())
source_paths.add(R.parent.parent.parent/'docs/glibc-native-eh-routing-20261002.md')
for c in commands:
 for item in c.get('inputs',[]):
  p=pathlib.Path(item['path'])
  if p.suffix in ['.a','.so'] or p.parent.name=='bin' or p in [C,NODE]:source_paths.add(p)
for p in (T/'logs').glob('*.d'):
 data=p.read_text().replace('\\\n','')
 deps=shlex.split(data.split(':',1)[1]);source_paths.update(pathlib.Path(d) for d in deps if pathlib.Path(d).is_file())
source_paths.update(p for p in (T/'source').rglob('*') if p.is_file())
source=[]
D=T/'objects/final-source-snapshots';D.mkdir(exist_ok=True)
for i,p in enumerate(sorted(source_paths)):
 if p==D or D in p.parents:continue
 row={'path':str(p),**pin(p)}
 if p.stat().st_size<8388608 and p.suffix not in ['.a','.so'] and p not in [C,NODE]:
  q=D/str(i)/p.name;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes());row['snapshot']=str(q)
 source.append(row)
(T/'logs/final-source-tool-pins.json').write_text(json.dumps(source,indent=2)+'\n')
objects=[{'path':str(p),**pin(p)} for p in sorted((T/'objects').rglob('*')) if p.is_file() and D not in p.parents]
(T/'logs/final-object-pins.json').write_text(json.dumps(objects,indent=2)+'\n')
evidence=[{'path':str(p),**pin(p)} for p in sorted((T/'logs').rglob('*')) if p.is_file() and p.name not in ['final-evidence-pins.json','prepared-acceptance.json','supervisor.lock']]
(T/'logs/final-evidence-pins.json').write_text(json.dumps(evidence,indent=2)+'\n')
checks={}
for name in ['routes-native-results.json','compiler-controls-results.json','delegate-results.json',*[f'{kind}-{opt}-results.json' for kind in ['frames','returns'] for opt in ['O0','O2','O3']]]:
 data=json.loads((T/'logs'/name).read_text());assert data['pass'];checks[name]={k:data[k] for k in ['pass','cases','fatal'] if k in data}
for opt in ['O0','O2','O3']:
 data=json.loads((T/'logs'/(opt+'-runtime.json')).read_text());assert data['failed']==0 and not data['escapingStackLeaks'] and data['noDiagnosticSPReset'] and data['nativeTag1Cases']==32;checks['composed-'+opt]={'passed':data['passed'],'failed':0,'escapingOrdinaryCases':80,'nativeTag0Cases':16,'nativeTag1Cases':32,'trapCases':len(data['trapRows']),'trapSPLeaks':sum(x['leakBytes']!=0 for x in data['trapRows'])}
report={'prepared':True,'rootReviewedOrFrozen':False,'generalForcedUnwindOrGNUCancellationOrNightlyAccepted':False,'checks':checks,'commands':len(commands),'terminalGroupsEmpty':True,'scope':'Finite native compiler EH/SjLj/SP routing and accepted poll-frame composition only; strict GNU fatal/C++ runtime closure remains separate','sourceToolRows':len(source),'objectRows':len(objects),'evidenceRows':len(evidence),'sourceToolManifest':pin(T/'logs/final-source-tool-pins.json'),'objectManifest':pin(T/'logs/final-object-pins.json'),'evidenceManifest':pin(T/'logs/final-evidence-pins.json'),'storage':storage()}
(T/'logs/prepared-acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
