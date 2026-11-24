#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
import re
rows_out=[]
for name,p in [('routes',T/'source/baseline-routes.bc'),('frames-O0',T/'objects/frames-O0.bc')]:
 q=T/'source'/('original-stackified-'+name+'.mir')
 run('audit-original-'+name,[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-stop-after=wasm-cfg-stackify',p,'-o',q])
 function=None;bb=None;prefix=[]
 for line in q.read_text().splitlines():
  if line.startswith('name:'):function=line.split(':',1)[1].strip()
  if re.match(r'  bb\.\d+',line):bb=line.strip();prefix=[]
  if line.startswith('    ') and line.strip() and not line.strip().startswith(('successors:','liveins:')):
   if 'CATCH_ALL_LEGACY' in line:rows_out.append({'input':name,'function':function,'block':bb,'leadingInstructions':prefix.copy()})
   prefix.append(line.strip())
(T/'logs/catch-layout-audit.json').write_text(json.dumps(rows_out,indent=2)+'\n')
print(json.dumps(rows_out,indent=2))
