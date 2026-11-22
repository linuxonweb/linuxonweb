#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
flags=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc','-isystem',L/'lib/clang/22/include','-I/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44/sysdeps/wasm32','-O2','-fno-builtin','-fno-stack-protector','-matomics','-mbulk-memory','-fno-optimize-sibling-calls','-fexceptions','-fwasm-exceptions']
(T/'source/routes-runtime.c').write_bytes((R.parent/'native-static-loader/routes-runtime.c').read_bytes())
run('route-runtime-front',[C,*flags,'-emit-llvm','-c',T/'source/routes-runtime.c','-o',T/'objects/routes-runtime.bc'])
run('route-tags',[L/'bin/clang',*flags,'-mexception-handling','-c',R/'routes.S','-o',T/'objects/routes-tags.o'])
for mode,tool,extra,expected in [('baseline',L/'bin/llc',[],1),('native',T/'objects/llc',['-wasm-native-eh-routing'],0)]:
 backend=['-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-verify-machineinstrs',*extra]
 run('route-'+mode+'-backend',[tool,*backend,'-filetype=obj',T/'source/baseline-routes.bc','-o',T/'objects'/('routes-'+mode+'.o')])
 run('route-'+mode+'-assembly',[tool,*backend,'-filetype=asm',T/'source/baseline-routes.bc','-o',T/'objects'/('routes-'+mode+'.s')])
 run('route-'+mode+'-runtime',[tool,*backend,'-filetype=obj',T/'objects/routes-runtime.bc','-o',T/'objects'/('routes-runtime-'+mode+'.o')])
 run('route-'+mode+'-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216','--export=route_invoke','--export=route_stack','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__tls_base','--export=__heap_base',T/'objects'/('routes-'+mode+'.o'),T/'objects'/('routes-runtime-'+mode+'.o'),T/'objects/routes-tags.o','-o',T/'objects'/('routes-'+mode+'.wasm')])
 run('route-'+mode+'-execute',[NODE,R/'routes-test.mjs',T,mode],expected=expected)
