#!/usr/bin/env python3
from run import *
config=subprocess.check_output([str(L/'bin/llvm-config'),'--cxxflags','--ldflags','--libs','core','irreader','bitwriter','support','--system-libs'],text=True).split()
run('adapter-build',['/usr/bin/g++',R/'force-ir.cpp',*config,'-o',T/'objects/force-ir'])
for lang in ['c','cpp']:
 run('adapter-'+lang,[T/'objects/force-ir',T/'objects'/f'fixture-{lang}.opt.bc',T/'objects'/f'fixture-{lang}.force.bc'])
 run('adapter-verify-'+lang,[L/'bin/opt','-passes=verify',T/'objects'/f'fixture-{lang}.force.bc','-disable-output'])
 run('adapter-dis-'+lang,[L/'bin/llvm-dis',T/'objects'/f'fixture-{lang}.force.bc','-o',T/'objects'/f'fixture-{lang}.force.ll'])
 run('backend-'+lang,[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-use-legacy-eh','-filetype=obj',T/'objects'/f'fixture-{lang}.force.bc','-o',T/'objects'/f'fixture-{lang}.o'])
run('runtime-build',[CLANG,*base,'-I',G/'sysdeps/generic','-I','/mnt/p6/build/glibc-native-jumps-20261002/source/glibc-2.44/sysdeps/wasm32','-fwasm-exceptions','-mllvm','-wasm-enable-sjlj','-mllvm','-wasm-use-legacy-eh','-c',R/'runtime.c','-o',T/'objects/runtime.o'])
run('tags-build',[L/'bin/clang',*base,'-mexception-handling','-c',R/'tags.S','-o',T/'objects/tags.o'])
run('shape-link',[L/'bin/wasm-ld','--no-entry','-z','stack-size=65536','--export=fixture_run','--export=prototype_root','--export=prototype_stack_pointer','--export=prototype_used','--export=prototype_sequence','--export=prototype_stops','--export=prototype_failures','--export=prototype_live','--export=__cpp_exception',T/'objects/fixture-c.o',T/'objects/fixture-cpp.o',T/'objects/runtime.o',T/'objects/tags.o','-o',T/'objects/shape.wasm'])
