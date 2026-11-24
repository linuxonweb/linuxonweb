#!/usr/bin/env python3
"""Retain independent O2/O3 outcomes for the exact built compiler, no runtime claim."""
import sys
sys.dont_write_bytecode=True
import json
from common_consumer13 import T,run,pin

out=T/'objects/consumer13-opt-diagnostics-1';out.mkdir()
original=next(row for row in json.loads((T/'logs/commands.json').read_text())
              if row['stage']=='consumer13-continuation-controls-O0-flagged')
results=[]
for opt in [2,3]:
 argv=list(original['argv'])
 argv[argv.index('-O0')]=f'-O{opt}'
 argv[argv.index('-o')+1]=str(out/f'O{opt}.o')
 try:
  row=run(f'consumer13-independent-O{opt}-flagged',argv)
 except AssertionError:
  row=json.loads((T/'logs/commands.json').read_text())[-1]
  if row['supervisorError'] or row['stopReason'] or row['terminalGroupMembers']:raise
 results.append({'optimization':opt,'exit':row['exit'],'pid':row['pid'],
                 'pgid':row['pgid'],'terminalGroupMembers':row['terminalGroupMembers'],
                 'log':row['log'],'logPin':pin(row['log']),
                 'diagnostic':__import__('pathlib').Path(row['log']).read_text()})
(T/'logs/consumer13-opt-diagnostics-1-result.json').write_text(
 json.dumps({'runtimeAcceptance':False,'results':results},indent=2)+'\n')
