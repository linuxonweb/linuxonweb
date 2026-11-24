#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
B=T/'objects/personality-gate-1';B.mkdir()
old=pathlib.Path('/mnt/p6/build/glibc-cxx-exception-closure-20261002')
oldcmd=json.loads((old/'logs/commands.json').read_text())
def flags(unit):
 row=[r for r in oldcmd if r['stage']=='release-cxxabi-'+unit][-1]
 a=row['argv'][1:];return a[:a.index('-MMD')]
backend=pathlib.Path('/mnt/p6/build/glibc-native-eh-routing-20261002/objects/composed/llc')
# Recipe pins specify the actual accepted path; no fallback compiler selection.
recipe=json.loads((T/'logs/personality-gate-recipe-2.json').read_text())
backend=pathlib.Path(recipe['backend'])
for row in recipe['pins']:
 assert pin(row['path'])=={'sha256':row['sha256'],'bytes':row['bytes']},row['path']
opts=['-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-native-eh-routing','-verify-machineinstrs']
def compile(unit,src,argv):
 bc=B/(unit+'.bc');obj=B/(unit+'.o')
 run('personality-'+unit+'-front',[C,*argv,'-MD','-MF',B/(unit+'.d'),'-emit-llvm','-c',src,'-o',bc])
 run('personality-'+unit+'-backend',[backend,*opts,'-filetype=obj',bc,'-o',obj])
 run('personality-'+unit+'-asm',[backend,*opts,'-filetype=asm',bc,'-o',B/(unit+'.s')])
 return obj
objects=[]
for u in ['cxa_exception','cxa_exception_storage','private_typeinfo','stdlib_typeinfo']:
 objects.append(compile(u,S/'libcxxabi/src'/f'{u}.cpp',flags(u)))
objects.append(compile('gate',R/'personality-gate.cpp',flags('cxa_exception')))
for mode,src in [('baseline',S/'libcxxabi/src/cxa_personality.cpp'),('patched',T/'source/libcxxabi/src/cxa_personality.cpp')]:
 compile('personality-'+mode,src,flags('cxa_personality'))
# Preserve genuine ordinary Unwind-wasm provider; no forced/CFA replacement used.
uw=[r for r in oldcmd if r['stage']=='release-unwind-wasm-gnu'][-1]['argv'][1:]
uwflags=uw[:uw.index('-MMD')]
objects.append(compile('unwind',pathlib.Path('/mnt/p6/project/linux/linuxonweb/tools/glibc/cxx-exception-closure/Unwind-wasm-gnu.c'),uwflags))
run('personality-tags',[L/'bin/clang','--target=wasm32-unknown-linux-gnu','-matomics','-mbulk-memory','-mexception-handling','-c',R/'personality-gate.S','-o',B/'tags.o'])
extra=[old/'objects/release'/f'{u}.o' for u in ['fallback_malloc','stdlib_exception']]
# Strong explicit diagnostic fatal imports prevent pulling genuine fatal bodies;
# every non-fatal function below remains its actual GNU/LLVM implementation.
exports=['foreign_direct','foreign_rethrow','foreign_escape','foreign_delete','foreign_query','exception_size','exception_align','observe_stack','__cpp_exception','__tls_base','__wasm_init_tls','__tls_size','__tls_align','__heap_base']
for mode in ['baseline','patched']:
 run('personality-'+mode+'-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--import-memory','--initial-memory=2097152','--max-memory=16777216','--error-limit=0',*['--export='+x for x in exports],*objects,B/('personality-'+mode+'.o'),B/'tags.o',*extra,old/'objects/accepted-malloc-malloc.o',old/'objects/accepted-elf-dl-tunables.o',old/'objects/accepted-startup-run2.o',old/'objects/libgnu-selected.a',old/'objects/libclang_rt.builtins.a','--why-extract='+str(B/(mode+'-why.txt')),'-Map',B/(mode+'-map.txt'),'-o',B/(mode+'.wasm')])
 run('personality-'+mode+'-execute',[NODE,R/'personality-test.mjs',T,mode])
