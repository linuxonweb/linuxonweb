#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
fixtures={
 'definition':'define void @fixture_unknown() { ret void }\n',
 'call':'declare void @fixture_unknown()\ndefine void @fixture_inner(){ call void @fixture_unknown()\n ret void }\n',
 'indirect':'define void @fixture_inner(ptr %p){call void %p()\n ret void}\n'}
report=[]
for kind,text in fixtures.items():
 src=T/'source'/f'negative-{kind}.ll';src.write_text('target triple = "wasm32-unknown-linux-gnu"\n'+text)
 try:run('coverage-'+kind,[T/'objects/force-ir',src,T/'objects'/f'negative-{kind}.bc'])
 except RuntimeError:
  if rows[-1]['exit']!=3:raise
 else:raise RuntimeError('uncovered input accepted')
 report.append({'case':kind,'pass':True,'exit':3,'log':rows[-1]['log']})
(T/'logs/coverage-results.json').write_text(json.dumps(report,indent=2)+'\n')
