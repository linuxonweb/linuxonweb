#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
backend=['-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-verify-machineinstrs']
run('flag-off-private-route-asm',[T/'objects/llc',*backend,'-filetype=asm',T/'source/baseline-routes.bc','-o',T/'objects/routes-private-off.s'])
assert (T/'objects/routes-private-off.s').read_bytes()==(P/'objects/routes.native.s').read_bytes()
(T/'source/control.ll').write_text('target triple = "wasm32-unknown-linux-gnu"\ndefine i32 @control(i32 %n) { %v = add i32 %n, 3\n ret i32 %v }\n')
results=[]
for name,extra in [('modern',['-wasm-use-legacy-eh=false']),('wrong-target',['-mtriple=wasm32-unknown-unknown']),('wasm64',['-mtriple=wasm64-unknown-linux-gnu'])]:
 row=run('negative-'+name,[T/'objects/llc',*backend,'-wasm-native-eh-routing',*extra,T/'source/control.ll','-o',T/'objects'/('rejected-'+name+'.s')],expected=-6)
 data=pathlib.Path(row['log']).read_text()
 assert 'native EH routing' in data
 results.append({'name':name,'command':row,'diagnostic':data.splitlines()[0]})
(T/'logs/compiler-controls-results.json').write_text(json.dumps({'pass':True,'flagOffIdentical':True,'assemblyPin':pin(T/'objects/routes-private-off.s'),'unsupported':results},indent=2)+'\n')
