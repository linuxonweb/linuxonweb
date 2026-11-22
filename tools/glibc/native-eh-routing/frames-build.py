#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
flags=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc','-isystem',L/'lib/clang/22/include','-I/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44/sysdeps/wasm32','-fno-builtin','-fno-stack-protector','-matomics','-mbulk-memory','-fno-optimize-sibling-calls','-fexceptions','-fwasm-exceptions']
backend=['-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-native-eh-routing','-verify-machineinstrs']
run('frames-tags',[L/'bin/clang',*flags,'-mexception-handling','-c',R/'frames.S','-o',T/'objects/frames-tags.o'])
for opt in ['O0','O2','O3']:
 objects=[]
 for name,p in [('frames',R/'frames.c'),('cpp-frames',R/'frames.cpp'),('returns',R/'returns.c'),('frames-runtime',T/'source/routes-runtime.c')]:
  bc=T/'objects'/f'{name}-{opt}.bc';obj=T/'objects'/f'{name}-{opt}.o';objects.append(obj)
  run(f'{name}-{opt}-front',[C,*flags,'-'+opt,'-MD','-MF',T/'logs'/f'{name}-{opt}.d','-emit-llvm','-c',p,'-o',bc])
  run(f'{name}-{opt}-backend',[T/'objects/llc',*backend,'-filetype=obj',bc,'-o',obj])
  run(f'{name}-{opt}-asm',[T/'objects/llc',*backend,'-filetype=asm',bc,'-o',T/'objects'/f'{name}-{opt}.s'])
 exports=['frame_entry','inner_entry','retained_entry','frame_query','normal_entry','observe_stack','__cpp_exception','__c_longjmp','leaf_i32','leaf_i64','leaf_f32','leaf_f64','leaf_void','branch_i32','branch_i64','branch_f32','branch_f64','branch_void','sink_get']
 run('frames-'+opt+'-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216',*['--export='+e for e in exports],*objects,T/'objects/frames-tags.o','-o',T/'objects'/f'frames-{opt}.wasm'])
 run('frames-'+opt+'-execute',[NODE,R/'frames-test.mjs',T,opt])
 run('returns-'+opt+'-execute',[NODE,R/'returns-test.mjs',T,opt])
