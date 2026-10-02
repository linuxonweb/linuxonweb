#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
cases={
 'depth':('void *bad_entry(void){return __builtin_return_address(1);}','bad_entry 0\n','nonzero return depth rejected',True),
 'external':('extern int missing(void); int bad_entry(void){return missing();}','bad_entry 0\n','uncovered external',True),
 'definition':('volatile int x; __attribute__((noinline)) int bad_leaf(void){return x;} int bad_entry(void){return bad_leaf();}','bad_entry 0\n','uncovered definition',True),
 'tail':('volatile int x; __attribute__((noinline)) int bad_leaf(void){return x;} int bad_entry(void){return bad_leaf();}','bad_entry 0\nbad_leaf 0\n','tail call rejected',False),
}
results=[]
for name,(text,modules,needle,no_tail) in cases.items():
 src=T/'source'/f'negative-{name}.c';src.write_text(text+'\n')
 spec=T/'source'/f'negative-{name}.modules';spec.write_text(modules)
 flags=[*base,'-matomics','-mbulk-memory','-emit-llvm','-c']
 if no_tail:flags+=['-fno-optimize-sibling-calls']
 run('caller-negative-front-'+name,[CLANG,*flags,src,'-o',T/'objects'/f'negative-{name}.bc'])
 try:
  run('caller-negative-adapt-'+name,[T/'objects/caller-ir',T/'objects'/f'negative-{name}.bc',T/'objects'/f'negative-{name}.out.bc',spec,'bad_entry'])
  raise AssertionError('negative adapter unexpectedly accepted '+name)
 except RuntimeError:
  row=rows[-1];data=pathlib.Path(row['log']).read_text();assert row['exit']==3 and needle in data,(name,data)
  results.append({'name':name,'expectedExit':3,'actualExit':row['exit'],'diagnostic':data.strip(),'pass':True})
(T/'logs/caller-negative-results.json').write_text(json.dumps(results,indent=2)+'\n')
print('compile-negative-controls',len(results),'PASS')
