#!/usr/bin/env python3
import sys,re
sys.dont_write_bytecode=True
from run import *
flags=[*base,'-I/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44/sysdeps/wasm32','-matomics','-mbulk-memory','-fno-optimize-sibling-calls','-fexceptions','-fwasm-exceptions']
run('routes-front',[CLANG,*flags,'-MD','-MF',T/'objects/routes.d','-emit-llvm','-S',R/'routes.c','-o',T/'objects/routes.ll'])
data=(T/'objects/routes.ll').read_text();names=re.findall(r'^define .*?@([A-Za-z0-9_.$]+)\(',data,re.M)
spec=T/'source/routes.modules';spec.write_text(''.join(f'{n} {1 if n.startswith("a_") else 2 if n.startswith("b_") else 0}\n' for n in names))
boundaries=T/'source/routes.boundaries';boundaries.write_text('eh_raise\nroute_jump\nsetjmp\n')
run('routes-adapt',[T/'objects/caller-ir',T/'objects/routes.ll',T/'objects/routes.bc',spec,'route_entry',boundaries])
run('routes-adapted-dis',[L/'bin/llvm-dis',T/'objects/routes.bc','-o',T/'objects/routes.adapted.ll'])
run('routes-backend',[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-filetype=obj',T/'objects/routes.bc','-o',T/'objects/routes.o'])
run('routes-native-asm',[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-filetype=asm',T/'objects/routes.bc','-o',T/'objects/routes.native.s'])
run('routes-runtime',[CLANG,*flags,'-c',R/'routes-runtime.c','-o',T/'objects/routes-runtime.o'])
run('routes-tags',[L/'bin/clang',*flags,'-mexception-handling','-c',R/'routes.S','-o',T/'objects/routes-tags.o'])
run('routes-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216','--export=route_invoke','--export=route_stack','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__tls_base','--export=__heap_base',T/'objects/routes.o',T/'objects/routes-runtime.o',T/'objects/routes-tags.o','-o',T/'objects/routes.wasm'])
run('routes-execute',['/home/a/.config/nvm/versions/node/v22.22.2/bin/node',R/'routes.mjs',T])
