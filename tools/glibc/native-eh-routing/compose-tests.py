#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
A=pathlib.Path('/mnt/p6/build/glibc-cancel-compiler-20261002');D=T/'objects/composed-controls-attempt2';D.mkdir() # Refuse rerun: retain this attempt; retries require a new owned path.
(T/'source/composition-stack-attempt2.S').write_text((R.parent/'cancel-compiler/stack.S').read_text().split('.globl restore_sp')[0]+'''\n.globl __c_longjmp
.tagtype __c_longjmp i32
__c_longjmp:
.text
.globl raise_tag1
.type raise_tag1,@function
raise_tag1:
 .functype raise_tag1 () -> ()
 i32.const 731
 throw __c_longjmp
 end_function
''')
flags=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-matomics','-mbulk-memory','-mexception-handling']
run('compose-stack-no-reset',[L/'bin/clang',*flags,'-c',T/'source/composition-stack-attempt2.S','-o',D/'stack.o'])
backend=['-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-native-eh-routing','-verify-machineinstrs']
exports=['__cpp_exception','__c_longjmp','raise_tag0','raise_tag1','actual_trap','read_sp','zero_frame','static_frame','dynamic_frame','nested_indirect','recursive','c_while','c_do','c_for','cpp_while','cpp_range_lambda','cpp_normal']
for level in ['O0','O2','O3']:
 objects=[]
 for name in ['controls.c','controls.cpp']:
  src=A/'objects/controls'/f'{level}-{name}.ll';copied=T/'source'/f'composed-{level}-{name}.ll';copied.write_bytes(src.read_bytes())
  assert 'wasm-gnu-cancel-prerequisite' in copied.read_text()
  obj=D/f'{level}-{name}.o';objects.append(obj)
  run(f'compose-{level}-{name}-backend',[T/'objects/composed/llc',*backend,'-filetype=obj',copied,'-o',obj])
  run(f'compose-{level}-{name}-assembly',[T/'objects/composed/llc',*backend,'-filetype=asm',copied,'-o',D/f'{level}-{name}.s'])
 # Preserve accepted diagnostic-only boundary exactly; no libc/cancellation
 # behavior is inferred from these compiler polling/cleanup control imports.
 runtime=A/'objects/controls/runtime.o'
 run('compose-'+level+'-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216',*['--export='+e for e in exports],*objects,runtime,D/'stack.o','-o',D/(level+'.wasm')])
 run('compose-'+level+'-execute',[NODE,R/'compose-test.mjs',T,level])
