#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
up=S/'llvm/test/CodeGen/WebAssembly/cfg-stackify-eh-legacy.ll'
(T/'source/upstream-cfg-stackify-eh-legacy.ll').write_bytes(up.read_bytes())
(T/'logs/delegate-source.json').write_text(json.dumps({'upstream':str(up),**pin(up),'runtimeAdaptation':'unwind_mismatches_5; independent owned architecture catch-all'},indent=2)+'\n')
flags=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-O2','-fno-builtin','-fno-stack-protector','-matomics','-mbulk-memory','-fno-optimize-sibling-calls','-fexceptions','-fwasm-exceptions']
backend=['-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-native-eh-routing','-verify-machineinstrs','-wasm-disable-ehpad-sort']
run('delegate-front',[C,*flags,'-emit-llvm','-c',R/'delegate.c','-o',T/'objects/delegate-support.bc'])
for name,p in [('delegate',R/'delegate.ll'),('delegate-support',T/'objects/delegate-support.bc')]:
 run(name+'-backend',[T/'objects/llc',*backend,'-filetype=obj',p,'-o',T/'objects'/(name+'.o')])
 run(name+'-assembly',[T/'objects/llc',*backend,'-filetype=asm',p,'-o',T/'objects'/(name+'.s')])
exports=['delegate_entry','nested_delegate_entry','catchall_entry','delegate_reset','delegate_query','observe_stack','__cpp_exception','__c_longjmp']
run('delegate-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216',*['--export='+e for e in exports],T/'objects/delegate.o',T/'objects/delegate-support.o',T/'objects/frames-tags.o','-o',T/'objects/delegate.wasm'])
run('delegate-execute',[NODE,R/'delegate-test.mjs',T])
