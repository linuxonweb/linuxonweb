#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
config=subprocess.check_output([str(L/'bin/llvm-config'),'--cxxflags','--ldflags','--libs','core','irreader','bitwriter','transformutils','support','--system-libs'],text=True).split()
run('caller-adapter-build',['/usr/bin/g++',R/'caller-ir.cpp',*config,'-o',T/'objects/caller-ir'])
flags=[*base,'-matomics','-mbulk-memory','-fno-optimize-sibling-calls','-emit-llvm','-c']
run('caller-raw',[CLANG,*flags,R/'caller-fixture.c','-o',T/'objects/caller.raw.bc'])
run('caller-adapt',[T/'objects/caller-ir',T/'objects/caller.raw.bc',T/'objects/caller.adapted.bc',R/'caller-modules.txt','caller_entry'])
run('caller-verify',[L/'bin/opt','-passes=verify',T/'objects/caller.adapted.bc','-disable-output'])
run('caller-dis',[L/'bin/llvm-dis',T/'objects/caller.adapted.bc','-o',T/'objects/caller.adapted.ll'])
run('caller-backend',[L/'bin/llc','-mattr=+atomics,+bulk-memory','-filetype=obj',T/'objects/caller.adapted.bc','-o',T/'objects/caller.o'])
run('caller-uncovered',[CLANG,*base,'-matomics','-mbulk-memory','-c',R/'caller-uncovered.c','-o',T/'objects/caller-uncovered.o'])
run('caller-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216','--export=caller_entry','--export=unseeded_entry','--export=uncovered_entered','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__tls_base','--export=__heap_base',T/'objects/caller.o',T/'objects/caller-uncovered.o','-o',T/'objects/caller.wasm'])
run('caller-execute',['/home/a/.config/nvm/versions/node/v22.22.2/bin/node',R/'caller.mjs',T])
